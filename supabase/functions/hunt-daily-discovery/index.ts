import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse, cronResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { callClaude, CLAUDE_MODELS } from '../_shared/anthropic.ts';
import { generateEmbedding } from '../_shared/embedding.ts';

/**
 * Daily Discovery Engine
 *
 * Runs once daily (via pg_cron or manual trigger). Scans today's
 * correlation-discovery, anomaly-alert, and ai-synthesis entries.
 * Ranks by interestingness. Picks the top finding. Uses Sonnet to
 * write a one-paragraph discovery. Stores it for the landing page.
 *
 * Also computes "Environmental Deja Vu" — finds the historical date
 * most similar to today's environmental signature.
 */

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createSupabaseClient();
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // --- Step 1: Gather today's intelligence output ---
    const { data: candidates } = await supabase
      .from('hunt_knowledge')
      .select('id,title,content,content_type,state_abbr,effective_date,metadata,signal_weight')
      .in('content_type', ['correlation-discovery', 'anomaly-alert', 'ai-synthesis'])
      .gte('created_at', `${yesterday}T00:00:00Z`)
      .order('created_at', { ascending: false })
      .limit(100);

    if (!candidates || candidates.length === 0) {
      return req.method === 'GET'
        ? successResponse(req, { discovery: null, deja_vu: null, message: 'No candidates today' })
        : cronResponse({ discovery: null, message: 'No candidates today' });
    }

    // --- Step 2: Score each candidate for "interestingness" ---
    const scored = candidates.map(c => {
      let score = 0;
      const meta = (c.metadata || {}) as Record<string, unknown>;

      // Anomaly severity bonus
      if (c.content_type === 'anomaly-alert') {
        const severity = meta.severity as string;
        const zScore = Math.abs((meta.z_score as number) || 0);
        if (severity === 'extreme') score += 40;
        else if (severity === 'high') score += 25;
        else if (severity === 'elevated') score += 15;
        score += Math.min(zScore * 5, 30); // z-score bonus, capped at 30
      }

      // Correlation cross-domain bonus (rare domain pairs = more interesting)
      if (c.content_type === 'correlation-discovery') {
        const similarity = (meta.similarity as number) || 0;
        score += similarity * 30; // 0.45-1.0 → 13-30 points
        // Bonus for truly cross-domain (different source vs match types)
        const seed = (meta.seed_type as string) || '';
        const match = (meta.match_type as string) || '';
        if (seed !== match) score += 20; // different domains = more interesting
      }

      // Synthesis confidence bonus
      if (c.content_type === 'ai-synthesis') {
        const confidence = meta.confidence as string;
        const domains = (meta.domains_fused as number) || 0;
        if (confidence === 'high') score += 30;
        else if (confidence === 'medium') score += 15;
        score += domains * 3; // more domains fused = more interesting
      }

      // Signal weight bonus
      score += ((c.signal_weight as number) || 1) * 5;

      return { ...c, interestingness: score };
    });

    // Sort by interestingness
    scored.sort((a, b) => b.interestingness - a.interestingness);

    const topCandidates = scored.slice(0, 5);

    // --- Step 3: Generate discovery narrative via Sonnet ---
    const candidateContext = topCandidates.map((c, i) =>
      `${i + 1}. [${c.content_type}] ${c.state_abbr || 'US'} | Score: ${c.interestingness}\n${c.content.slice(0, 300)}`
    ).join('\n\n');

    const discoveryResponse = await callClaude({
      model: CLAUDE_MODELS.sonnet,
      system: `You are the Duck Countdown Brain — a cross-domain environmental intelligence system with ${candidates.length} new findings from the last 24 hours.

Pick the SINGLE most interesting finding from the candidates below and write a 2-3 sentence discovery. Lead with what's surprising. Be specific — name states, numbers, domains. This will be the first thing someone sees on the landing page.

Format:
HEADLINE: [8-12 word headline]
DISCOVERY: [2-3 sentences, plain English, specific, surprising]
STATE: [most relevant state abbreviation, or US for national]
DOMAINS: [comma-separated domains involved]`,
      messages: [{ role: 'user', content: `Today's top candidates:\n\n${candidateContext}` }],
      max_tokens: 300,
      temperature: 0.3,
    });

    // Parse the response
    const text = discoveryResponse.content?.[0]?.type === 'text' ? discoveryResponse.content[0].text : '';
    const headlineMatch = text.match(/HEADLINE:\s*(.+)/);
    const discoveryMatch = text.match(/DISCOVERY:\s*([\s\S]+?)(?=STATE:|$)/);
    const stateMatch = text.match(/STATE:\s*(\w+)/);
    const domainsMatch = text.match(/DOMAINS:\s*(.+)/);

    const headline = headlineMatch?.[1]?.trim() || 'Daily Discovery';
    const discovery = discoveryMatch?.[1]?.trim() || text.slice(0, 300);
    const state = stateMatch?.[1]?.trim() || null;
    const domains = domainsMatch?.[1]?.trim().split(',').map(d => d.trim()) || [];

    // --- Step 4: Store the discovery ---
    const discoveryContent = `${headline}\n\n${discovery}`;
    const embedding = await generateEmbedding(discoveryContent, 'document');

    await supabase.from('hunt_knowledge').insert({
      title: `Daily Discovery: ${today}`,
      content: discoveryContent,
      content_type: 'daily-discovery',
      state_abbr: state,
      effective_date: today,
      tags: ['daily-discovery', ...domains, today],
      signal_weight: 2.0,
      embedding: JSON.stringify(embedding),
      metadata: {
        headline,
        discovery,
        state,
        domains,
        candidates_considered: candidates.length,
        top_score: topCandidates[0]?.interestingness || 0,
        source_types: [...new Set(topCandidates.map(c => c.content_type))],
        generated_at: new Date().toISOString(),
      },
    });

    // --- Step 5: Environmental Deja Vu ---
    // Find the most similar historical date to today's conditions
    // Use today's highest-scored ai-synthesis as the query vector
    let dejaVu: { date: string; similarity: number; summary: string } | null = null;

    const todaySynthesis = candidates.find(c => c.content_type === 'ai-synthesis');
    if (todaySynthesis) {
      const queryEmbedding = await generateEmbedding(todaySynthesis.content.slice(0, 500), 'query');

      const { data: similar } = await supabase.rpc('search_hunt_knowledge_v3', {
        query_embedding: queryEmbedding,
        match_threshold: 0.5,
        match_count: 5,
        filter_content_types: ['ai-synthesis', 'storm-event', 'weather-event'],
        filter_state_abbr: todaySynthesis.state_abbr || null,
        filter_date_from: null,
        filter_date_to: yesterday, // exclude today
        recency_weight: 0.0, // no recency bias — find the best historical match
        exclude_du_report: true,
      });

      if (similar && similar.length > 0) {
        // Pick the most similar entry that's NOT from today
        const match = similar.find((s: any) => s.effective_date && s.effective_date < yesterday);
        if (match) {
          dejaVu = {
            date: match.effective_date,
            similarity: match.similarity,
            summary: match.content?.slice(0, 200) || '',
          };
        }
      }
    }

    // Store deja vu as metadata on today's discovery
    if (dejaVu) {
      // Update the discovery we just inserted
      await supabase
        .from('hunt_knowledge')
        .update({ metadata: {
          headline, discovery, state, domains,
          candidates_considered: candidates.length,
          top_score: topCandidates[0]?.interestingness || 0,
          source_types: [...new Set(topCandidates.map(c => c.content_type))],
          generated_at: new Date().toISOString(),
          deja_vu: dejaVu,
        }})
        .eq('content_type', 'daily-discovery')
        .eq('effective_date', today);
    }

    const result = {
      headline,
      discovery,
      state,
      domains,
      deja_vu: dejaVu,
      candidates_considered: candidates.length,
    };

    return req.method === 'GET'
      ? successResponse(req, result)
      : cronResponse(result);

  } catch (error) {
    console.error('[hunt-daily-discovery]', error);
    return req.method === 'GET'
      ? errorResponse(req, 'Internal error', 500)
      : cronResponse({ error: String(error) }, 500);
  }
});
