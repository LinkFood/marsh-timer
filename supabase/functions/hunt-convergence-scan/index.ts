import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';
import { callClaude, CLAUDE_MODELS, parseTextContent } from '../_shared/anthropic.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { getOpenArc, createArc, transitionArc, fireNarrator } from '../_shared/arcReactor.ts';

const FUNCTION_NAME = 'hunt-convergence-scan';

serve(async (req: Request) => {
  // Cache origin header immediately — request object can become invalid
  // when many concurrent calls arrive (e.g., weather-realtime fires one per state)
  let origin = '';
  try {
    origin = req.headers.get('origin') ?? '';
  } catch {
    // Request already closed — return minimal response
    console.error(`[${FUNCTION_NAME}] Cannot read headers: request closed before processing`);
    return new Response(JSON.stringify({ error: 'Request closed before processing' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cors = handleCors(req);
  if (cors) return cors;

  const startTime = Date.now();
  const supabase = createSupabaseClient();

  try {
    let body: Record<string, any> = {};
    try {
      body = await req.json().catch(() => ({}));
    } catch {
      // Body read can also fail on closed requests
      await logCronRun({ functionName: FUNCTION_NAME, status: 'error', errorMessage: 'Request body unreadable (connection closed)', durationMs: Date.now() - startTime });
      return new Response(JSON.stringify({ error: 'Request body unreadable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const { state_abbr, trigger_event, trigger_type, trigger_severity } = body;

    if (!state_abbr) {
      return errorResponse(req, 'state_abbr required', 400);
    }

    console.log(`[${FUNCTION_NAME}] Scanning ${state_abbr} — trigger: ${trigger_type} (${trigger_severity})`);

    const now = new Date();
    const fortyEightHours = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
    const sevenDays = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const today = now.toISOString().split('T')[0];

    // 1. Pull current data across ALL domains for this state
    const domainQueries = await Promise.all([
      // Weather events (last 48h)
      supabase.from('hunt_knowledge')
        .select('title, content_type, metadata, created_at')
        .eq('state_abbr', state_abbr)
        .in('content_type', ['realtime-weather-event', 'weather-event'])
        .gte('created_at', fortyEightHours)
        .order('created_at', { ascending: false })
        .limit(10),

      // Drought (last 7 days)
      supabase.from('hunt_knowledge')
        .select('title, content, content_type, metadata')
        .eq('state_abbr', state_abbr)
        .eq('content_type', 'drought-weekly')
        .gte('effective_date', sevenDays)
        .order('effective_date', { ascending: false })
        .limit(1),

      // Bird data (last 7 days)
      supabase.from('hunt_knowledge')
        .select('title, content_type, metadata, created_at')
        .eq('state_abbr', state_abbr)
        .in('content_type', ['birdcast-daily', 'birdcast-historical', 'migration-spike-extreme', 'migration-spike-significant', 'birdweather-daily'])
        .gte('created_at', sevenDays)
        .order('created_at', { ascending: false })
        .limit(10),

      // Water levels (last 7 days)
      supabase.from('hunt_knowledge')
        .select('title, content_type, metadata')
        .eq('state_abbr', state_abbr)
        .eq('content_type', 'usgs-water')
        .gte('effective_date', sevenDays)
        .order('effective_date', { ascending: false })
        .limit(3),

      // NWS alerts (last 48h)
      supabase.from('hunt_knowledge')
        .select('title, content_type, metadata, created_at')
        .eq('state_abbr', state_abbr)
        .eq('content_type', 'nws-alert')
        .gte('created_at', fortyEightHours)
        .limit(5),

      // Climate indices (last 30 days)
      supabase.from('hunt_knowledge')
        .select('title, content, content_type')
        .eq('content_type', 'climate-index')
        .gte('effective_date', thirtyDaysAgo)
        .order('effective_date', { ascending: false })
        .limit(3),

      // Storm events (last 7 days)
      supabase.from('hunt_knowledge')
        .select('title, content_type, metadata')
        .eq('state_abbr', state_abbr)
        .eq('content_type', 'storm-event')
        .gte('effective_date', now.toISOString().split('T')[0].slice(0, 8) + '01') // this month
        .order('effective_date', { ascending: false })
        .limit(5),

      // Latest convergence score
      supabase.from('hunt_convergence_scores')
        .select('score, weather_component, migration_component, solunar_component, pattern_component, reasoning')
        .eq('state_abbr', state_abbr)
        .order('date', { ascending: false })
        .limit(1),

      // Air quality (last 48h)
      supabase.from('hunt_knowledge')
        .select('title, content_type, metadata')
        .eq('state_abbr', state_abbr)
        .eq('content_type', 'air-quality')
        .gte('created_at', fortyEightHours)
        .order('created_at', { ascending: false })
        .limit(3),

      // Soil conditions (last 7 days)
      supabase.from('hunt_knowledge')
        .select('title, content_type, metadata')
        .eq('state_abbr', state_abbr)
        .eq('content_type', 'soil-conditions')
        .gte('created_at', sevenDays)
        .order('created_at', { ascending: false })
        .limit(3),

      // Ocean buoy (last 48h, coastal only)
      supabase.from('hunt_knowledge')
        .select('title, content_type, metadata')
        .eq('state_abbr', state_abbr)
        .eq('content_type', 'ocean-buoy')
        .gte('created_at', fortyEightHours)
        .order('created_at', { ascending: false })
        .limit(3),

      // Space weather (last 48h, global)
      supabase.from('hunt_knowledge')
        .select('title, content_type, metadata')
        .eq('content_type', 'space-weather')
        .gte('created_at', fortyEightHours)
        .order('created_at', { ascending: false })
        .limit(3),

      // River discharge (last 7 days)
      supabase.from('hunt_knowledge')
        .select('title, content_type, metadata')
        .eq('state_abbr', state_abbr)
        .eq('content_type', 'river-discharge')
        .gte('created_at', sevenDays)
        .order('created_at', { ascending: false })
        .limit(3),
    ]);

    // 2. Count converging domains
    const domains: Record<string, { count: number; summary: string }> = {};
    const labels = ['weather', 'drought', 'biological', 'water', 'nws', 'climate', 'storms', 'convergence', 'air_quality', 'soil', 'ocean', 'space_weather', 'river'];

    for (let i = 0; i < domainQueries.length; i++) {
      const { data } = domainQueries[i];
      if (data && data.length > 0) {
        const label = labels[i];
        domains[label] = {
          count: data.length,
          summary: data.slice(0, 3).map((d: any) => d.title || d.content_type).join('; '),
        };
      }
    }

    const convergingCount = Object.keys(domains).length;
    console.log(`[${FUNCTION_NAME}] ${state_abbr}: ${convergingCount} domains with data`);

    // 3. If < 3 domains, not enough for compound risk
    if (convergingCount < 3) {
      await logCronRun({ functionName: FUNCTION_NAME, status: 'success', summary: { state: state_abbr, domains: convergingCount, alert: false }, durationMs: Date.now() - startTime });
      return successResponse(req, { state: state_abbr, domains: convergingCount, alert: false, reason: 'Insufficient domain convergence' });
    }

    // 4. Historical pattern search
    const domainSummary = Object.entries(domains)
      .map(([k, v]) => `${k}: ${v.summary}`)
      .join('. ');
    const searchQuery = `${state_abbr} compound environmental event: ${trigger_event}. Current: ${domainSummary}`;

    let historicalMatches: any[] = [];
    try {
      const embedding = await generateEmbedding(searchQuery, 'query');
      const { data: matches } = await supabase.rpc('search_hunt_knowledge_v3', {
        query_embedding: embedding,
        match_threshold: 0.4,
        match_count: 10,
        filter_state_abbr: state_abbr,
      });
      historicalMatches = (matches || []).filter((m: any) =>
        m.effective_date && new Date(m.effective_date) < new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
      );
    } catch (err) {
      console.error(`[${FUNCTION_NAME}] Historical search failed:`, err);
    }

    // 5. Score compound risk
    const hasHistoricalMatch = historicalMatches.length > 0;
    const avgSimilarity = historicalMatches.length > 0
      ? historicalMatches.reduce((sum: number, m: any) => sum + (m.similarity || 0), 0) / historicalMatches.length
      : 0;

    const shouldAlert =
      (convergingCount >= 4) ||
      (convergingCount >= 3 && hasHistoricalMatch && avgSimilarity > 0.5) ||
      (convergingCount >= 3 && trigger_severity === 'high');

    if (!shouldAlert) {
      await logCronRun({ functionName: FUNCTION_NAME, status: 'success', summary: { state: state_abbr, domains: convergingCount, historical: historicalMatches.length, alert: false }, durationMs: Date.now() - startTime });
      return successResponse(req, { state: state_abbr, domains: convergingCount, historical: historicalMatches.length, alert: false });
    }

    // 5b. Dedup: skip if we already have a compound-risk-alert for this state today
    const { data: existingAlert } = await supabase
      .from('hunt_knowledge')
      .select('id')
      .eq('content_type', 'compound-risk-alert')
      .eq('state_abbr', state_abbr)
      .eq('effective_date', today)
      .limit(1)
      .maybeSingle();

    if (existingAlert) {
      console.log(`[${FUNCTION_NAME}] Alert already exists for ${state_abbr} on ${today}, skipping Claude call`);
      await logCronRun({ functionName: FUNCTION_NAME, status: 'success', summary: { state: state_abbr, domains: convergingCount, alert: false, reason: 'dedup' }, durationMs: Date.now() - startTime });
      return successResponse(req, { state: state_abbr, domains: convergingCount, alert: false, reason: 'Already alerted today' });
    }

    // 6. Call Claude to synthesize compound risk alert
    // Tiered: Haiku for 3-4 domains (routine), Sonnet for 5+ (high-signal)
    const alertModel = convergingCount >= 5 ? CLAUDE_MODELS.sonnet : CLAUDE_MODELS.haiku;
    const contextLines = [
      `State: ${state_abbr}`,
      `Trigger: ${trigger_event} (${trigger_severity})`,
      `Converging domains (${convergingCount}):`,
      ...Object.entries(domains).map(([k, v]) => `  ${k} (${v.count} signals): ${v.summary}`),
      '',
      historicalMatches.length > 0 ? `Historical precedents (${historicalMatches.length}):` : 'No historical matches found.',
      ...historicalMatches.slice(0, 5).map((m: any) => `  ${m.title} (${m.content_type}, sim:${(m.similarity || 0).toFixed(2)})`),
    ];

    const synthesisResponse = await callClaude({
      model: alertModel,
      system: `You are a compound risk analyst. You receive real-time environmental data from multiple domains converging in one state. Write a 3-4 sentence alert that:
1. Names the state and the trigger event
2. Lists which domains are converging and why that matters
3. References historical precedent if available
4. States the watch period (7 days for weather, 30 for drought)
Never predict outcomes. State what signals are converging and what happened historically when this pattern appeared.`,
      messages: [{ role: 'user', content: contextLines.join('\n') }],
      max_tokens: 300,
      temperature: 0.2,
    });

    const alertText = parseTextContent(synthesisResponse);

    // 7. Embed and insert compound risk alert
    const alertEmbedding = await generateEmbedding(alertText, 'document');

    const { error: insertErr } = await supabase.from('hunt_knowledge').insert({
      title: `COMPOUND RISK: ${state_abbr} — ${convergingCount} domains converging (${today})`,
      content: alertText,
      content_type: 'compound-risk-alert',
      state_abbr,
      species: null,
      effective_date: today,
      signal_weight: 2.0,
      tags: [state_abbr, 'compound-risk', 'multi-domain', trigger_type, ...Object.keys(domains)],
      metadata: {
        source: 'convergence-scan',
        trigger_type,
        trigger_severity,
        trigger_event,
        converging_domains: convergingCount,
        domain_types: Object.keys(domains),
        historical_matches: historicalMatches.length,
        avg_similarity: avgSimilarity,
        confidence: convergingCount >= 5 ? 'high' : convergingCount >= 4 ? 'medium' : 'elevated',
      },
      embedding: alertEmbedding,
    });

    if (insertErr) {
      console.error(`[${FUNCTION_NAME}] Insert error:`, insertErr.message);
    }

    // 8. Track for grading (deduplicate: one outcome per state per day)
    const { data: existingOutcome } = await supabase
      .from('hunt_alert_outcomes')
      .select('id')
      .eq('alert_source', 'compound-risk')
      .eq('state_abbr', state_abbr)
      .eq('alert_date', today)
      .limit(1)
      .maybeSingle();

    // Build expected_signals from the actual converging domains
    const DOMAIN_SIGNAL_MAP: Record<string, string[]> = {
      weather: ['weather-event', 'nws-alert'],
      biological: ['birdcast-daily', 'migration-spike-significant', 'migration-spike-extreme'],
      drought: ['drought-weekly'],
      water: ['usgs-water', 'river-discharge'],
      nws: ['nws-alert'],
      climate: ['climate-index'],
      storms: ['storm-event'],
      air_quality: ['air-quality'],
      soil: ['soil-conditions'],
      ocean: ['ocean-buoy'],
      space_weather: ['space-weather'],
      river: ['river-discharge'],
    };
    const expectedSignals = [...new Set(
      Object.keys(domains).flatMap(d => DOMAIN_SIGNAL_MAP[d] || [])
    )];
    // Fallback if empty
    if (expectedSignals.length === 0) expectedSignals.push('weather-event', 'nws-alert');

    if (!existingOutcome) {
      const outcomeDeadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const { error: outcomeErr } = await supabase.from('hunt_alert_outcomes').insert({
        alert_source: 'compound-risk',
        state_abbr,
        alert_date: today,
        predicted_outcome: {
          claim: `${convergingCount} domains converging in ${state_abbr}: ${Object.keys(domains).join(', ')}`,
          expected_signals: expectedSignals,
          severity: trigger_severity,
          converging_domains: convergingCount,
        },
        outcome_window_hours: 168,
        outcome_deadline: outcomeDeadline.toISOString(),
      });
      if (outcomeErr) console.error(`[${FUNCTION_NAME}] Outcome insert failed:`, outcomeErr.message);
    } else {
      console.log(`[${FUNCTION_NAME}] Outcome already exists for ${state_abbr} on ${today}, skipping`);
    }

    // === ARC REACTOR: Create or transition arc ===
    try {
      const existingArc = await getOpenArc(supabase, state_abbr);

      if (!existingArc) {
        // No open arc — create directly in recognition (buildup was implicit)
        const arcResult = await createArc(supabase, state_abbr, 'recognition', {
          buildup_signals: {
            domains: Object.keys(domains),
            convergence_score: domainQueries[7]?.data?.[0]?.score || 0,
            trigger: `${convergingCount} domains converging: ${Object.keys(domains).join(', ')}`,
          },
          recognition_claim: {
            claim: `${convergingCount} domains converging in ${state_abbr}`,
            expected_signals: expectedSignals,
            pattern_type: 'compound-risk',
          },
          outcome_deadline: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });
        if (arcResult) fireNarrator(state_abbr, 'arc_created');
      } else if (existingArc.current_act === 'buildup') {
        // Transition from buildup to recognition
        await transitionArc(supabase, existingArc.id, 'recognition', {
          recognition_claim: {
            claim: `${convergingCount} domains converging in ${state_abbr}`,
            expected_signals: expectedSignals,
            pattern_type: 'compound-risk',
          },
          outcome_deadline: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });
        fireNarrator(state_abbr, 'act_transition');
      }
      // If arc already in recognition/outcome/grade, don't overwrite
    } catch (arcErr) {
      console.error(`[${FUNCTION_NAME}] Arc reactor error:`, arcErr);
    }

    const summary = {
      state: state_abbr,
      domains: convergingCount,
      historical: historicalMatches.length,
      alert: true,
      confidence: convergingCount >= 5 ? 'high' : 'medium',
    };

    console.log(`[${FUNCTION_NAME}] COMPOUND RISK ALERT: ${state_abbr} — ${convergingCount} domains`);
    await logCronRun({ functionName: FUNCTION_NAME, status: 'success', summary, durationMs: Date.now() - startTime });
    return successResponse(req, summary);

  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error(`[${FUNCTION_NAME}]`, errMsg);
    await logCronRun({ functionName: FUNCTION_NAME, status: 'error', errorMessage: errMsg, durationMs: Date.now() - startTime }).catch(() => {});
    try {
      return errorResponse(req, errMsg, 500);
    } catch {
      // req may be closed — return minimal response
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
});
