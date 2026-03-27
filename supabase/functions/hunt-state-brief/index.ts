import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';
import { callClaude, parseTextContent, CLAUDE_MODELS } from '../_shared/anthropic.ts';
import { STATE_NAMES } from '../_shared/states.ts';

const VALID_STATES = new Set(Object.keys(STATE_NAMES));

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json().catch(() => ({}));
    const stateAbbr: string = body.state_abbr;
    const force: boolean = body.force === true;

    if (!stateAbbr || !VALID_STATES.has(stateAbbr)) {
      return errorResponse(req, `Invalid state_abbr: ${stateAbbr}`, 400);
    }

    const supabase = createSupabaseClient();
    const today = new Date().toISOString().split('T')[0];
    const stateName = STATE_NAMES[stateAbbr] || stateAbbr;

    // -----------------------------------------------------------------------
    // 1. Check cache
    // -----------------------------------------------------------------------
    if (!force) {
      const { data: cached } = await supabase
        .from('hunt_state_briefs')
        .select('*')
        .eq('state_abbr', stateAbbr)
        .eq('date', today)
        .limit(1)
        .single();

      if (cached) {
        console.log(`[hunt-state-brief] Cache hit for ${stateAbbr} on ${today}`);
        return successResponse(req, cached);
      }
    }

    // -----------------------------------------------------------------------
    // 2. Gather context data in parallel
    // -----------------------------------------------------------------------
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const [convergenceRes, signalsRes, patternLinksRes, alertsRes] = await Promise.all([
      // Convergence score (today or yesterday)
      supabase
        .from('hunt_convergence_scores')
        .select('score, weather_component, solunar_component, migration_component, pattern_component, birdcast_component, water_component, photoperiod_component, tide_component, reasoning')
        .eq('state_abbr', stateAbbr)
        .in('date', [today, yesterday])
        .order('date', { ascending: false })
        .limit(1),

      // Top signals from brain (last 24h)
      supabase
        .from('hunt_knowledge')
        .select('title, content_type, state_abbr, signal_weight, created_at')
        .eq('state_abbr', stateAbbr)
        .gte('created_at', twentyFourHoursAgo)
        .order('signal_weight', { ascending: false })
        .limit(10),

      // Pattern links (last 72h via RPC)
      supabase.rpc('get_recent_pattern_links', {
        p_state_abbr: stateAbbr,
        p_limit: 10,
        p_hours_back: 72,
      }),

      // Convergence alerts (last 7 days)
      supabase
        .from('hunt_convergence_alerts')
        .select('alert_type, reasoning, score, previous_score, created_at')
        .eq('state_abbr', stateAbbr)
        .gte('created_at', sevenDaysAgo)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    const convergence = convergenceRes.data?.[0] || null;
    const signals = Array.isArray(signalsRes.data) ? signalsRes.data : [];
    const patternLinks = Array.isArray(patternLinksRes.data) ? patternLinksRes.data : [];
    const alerts = Array.isArray(alertsRes.data) ? alertsRes.data : [];

    // -----------------------------------------------------------------------
    // 3. Build Sonnet prompt
    // -----------------------------------------------------------------------
    const contextParts: string[] = [];

    if (convergence) {
      contextParts.push(`CONVERGENCE SCORE: ${convergence.score}/100
Components: Weather ${convergence.weather_component}, Solunar ${convergence.solunar_component}, Migration ${convergence.migration_component}, Pattern ${convergence.pattern_component}, BirdCast ${convergence.birdcast_component}, Water ${convergence.water_component}, Photoperiod ${convergence.photoperiod_component}, Tide ${convergence.tide_component}
Engine reasoning: ${convergence.reasoning}`);
    }

    if (signals.length > 0) {
      const signalLines = signals.map((s: { title: string; content_type: string; signal_weight: number | null }) =>
        `- ${s.title} (${s.content_type}, weight: ${s.signal_weight ?? 'n/a'})`
      ).join('\n');
      contextParts.push(`TOP SIGNALS (last 24h):\n${signalLines}`);
    }

    if (patternLinks.length > 0) {
      const linkLines = patternLinks.map((pl: { source_title: string; matched_title: string; similarity: number; source_content_type: string; matched_content_type: string }) =>
        `- ${pl.source_content_type} → ${pl.matched_content_type} (${(pl.similarity * 100).toFixed(0)}% match): ${pl.source_title} ↔ ${pl.matched_title}`
      ).join('\n');
      contextParts.push(`PATTERN LINKS (cross-domain connections, last 72h):\n${linkLines}`);
    }

    if (alerts.length > 0) {
      const alertLines = alerts.map((a: { alert_type: string; score: number; previous_score: number; reasoning: string }) =>
        `- ${a.alert_type}: score ${a.previous_score}→${a.score}. ${a.reasoning}`
      ).join('\n');
      contextParts.push(`CONVERGENCE ALERTS (last 7 days):\n${alertLines}`);
    }

    const systemPrompt = `You are an environmental intelligence analyst. Write a 3-4 sentence daily assessment for ${stateName}. Lead with what changed or what's notable today. Explain what the signals mean together. Say what to watch for next. Be specific with numbers, trends, and comparisons. Do not list data — synthesize it into a narrative.`;

    const userContent = contextParts.length > 0
      ? `Here is today's environmental intelligence data for ${stateName} (${stateAbbr}):\n\n${contextParts.join('\n\n')}`
      : `No fresh signal data available for ${stateName} (${stateAbbr}) today. Write a brief note acknowledging the data gap and what to watch for when signals resume.`;

    // -----------------------------------------------------------------------
    // 4. Call Sonnet
    // -----------------------------------------------------------------------
    console.log(`[hunt-state-brief] Generating brief for ${stateAbbr}...`);
    const claudeResponse = await callClaude({
      model: CLAUDE_MODELS.sonnet,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      max_tokens: 500,
      temperature: 0.4,
    });

    const briefText = parseTextContent(claudeResponse);
    if (!briefText) {
      return errorResponse(req, 'AI returned empty response', 500);
    }

    // -----------------------------------------------------------------------
    // 5. Embed the brief into hunt_knowledge (EMBEDDING LAW)
    // -----------------------------------------------------------------------
    try {
      const embedText = `state-brief | ${stateAbbr} | ${today} | ${briefText}`;
      const embedding = await generateEmbedding(embedText, 'document');

      await supabase.from('hunt_knowledge').insert({
        title: `${stateAbbr} daily brief ${today}`,
        content: embedText,
        content_type: 'state-brief',
        tags: [stateAbbr, 'state-brief', today],
        state_abbr: stateAbbr,
        species: null,
        effective_date: today,
        metadata: { score: convergence?.score ?? null, date: today },
        embedding,
      });
    } catch (embedErr) {
      console.error(`[hunt-state-brief] Embed error for ${stateAbbr}:`, embedErr);
      // Non-fatal — continue to save the brief
    }

    // -----------------------------------------------------------------------
    // 6. Upsert to hunt_state_briefs
    // -----------------------------------------------------------------------
    const briefRow = {
      state_abbr: stateAbbr,
      date: today,
      content: briefText,
      score: convergence?.score ?? null,
      component_breakdown: convergence ? {
        weather: convergence.weather_component,
        solunar: convergence.solunar_component,
        migration: convergence.migration_component,
        pattern: convergence.pattern_component,
        birdcast: convergence.birdcast_component,
        water: convergence.water_component,
        photoperiod: convergence.photoperiod_component,
        tide: convergence.tide_component,
      } : null,
      signals: signals.slice(0, 5).map((s: { title: string; content_type: string }) => ({
        title: s.title,
        content_type: s.content_type,
      })),
      pattern_links: patternLinks.slice(0, 5).map((pl: { source_title: string; matched_title: string; similarity: number; source_content_type: string; matched_content_type: string }) => ({
        source_title: pl.source_title,
        matched_title: pl.matched_title,
        similarity: pl.similarity,
        source_type: pl.source_content_type,
        matched_type: pl.matched_content_type,
      })),
    };

    const { data: upserted, error: upsertErr } = await supabase
      .from('hunt_state_briefs')
      .upsert(briefRow, { onConflict: 'state_abbr,date' })
      .select()
      .single();

    if (upsertErr) {
      console.error(`[hunt-state-brief] Upsert error:`, upsertErr);
      // Return the brief even if upsert fails
      return successResponse(req, briefRow);
    }

    console.log(`[hunt-state-brief] Brief generated for ${stateAbbr}, score=${briefRow.score}`);
    return successResponse(req, upserted);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[hunt-state-brief] Fatal:`, msg);
    return errorResponse(req, msg, 500);
  }
});
