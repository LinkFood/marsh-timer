import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { callClaude, CLAUDE_MODELS, parseTextContent } from '../_shared/anthropic.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { generateEmbedding } from '../_shared/embedding.ts';

const FUNCTION_NAME = 'hunt-web-curator';

serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const supabase = createSupabaseClient();

  try {
    // 1. Fetch unprocessed discoveries
    const { data: discoveries, error: fetchError } = await supabase
      .from('hunt_web_discoveries')
      .select('*')
      .is('curator_decision', null)
      .order('created_at', { ascending: true })
      .limit(30);

    if (fetchError) throw fetchError;

    if (!discoveries || discoveries.length === 0) {
      await logCronRun({
        functionName: FUNCTION_NAME,
        status: 'success',
        summary: { message: 'No pending discoveries' },
        durationMs: Date.now() - startTime,
      });
      return successResponse(req, { processed: 0, embedded: 0, skipped: 0, flagged: 0 });
    }

    // 2. Process in batches of 10
    let totalEmbedded = 0;
    let totalSkipped = 0;
    let totalFlagged = 0;

    for (let i = 0; i < discoveries.length; i += 10) {
      const batch = discoveries.slice(i, i + 10);

      // Build curator prompt
      const batchText = batch.map((d: Record<string, unknown>, idx: number) =>
        `[${idx}] URL: ${d.source_url || 'unknown'}\nTitle: ${d.title || 'untitled'}\nContent: ${(d.content as string).slice(0, 500)}\nQuery that found it: ${d.query}`
      ).join('\n\n---\n\n');

      const curatorResponse = await callClaude({
        model: CLAUDE_MODELS.opus,
        system: `You are a data curator for an environmental intelligence brain with 295K+ entries from 21 scientific sources (eBird, NOAA, NASA, NWS, USGS, BirdCast, Drought Monitor, etc.).

For each web discovery, decide:
EMBED — Contains specific environmental/scientific data from credible sources (.gov, .edu, research institutions, NOAA, USGS, eBird, NWS). Fills a genuine knowledge gap. Has specific data points (numbers, dates, measurements, locations).
SKIP — Opinion piece, marketing, retail marketing, forum post, duplicate of standard knowledge, outdated (>2 years unless historical reference data), no specific data points, or general information easily found anywhere.
FLAG — Potentially valuable but from unfamiliar source, contradicts known data, or you're uncertain about quality.

Be selective. The brain's strength is curated, high-quality data. Only embed content that genuinely adds environmental intelligence value.

Respond ONLY with a JSON array. No other text:
[{"index": 0, "decision": "embed", "reasoning": "USGS water level report for WA, specific measurements, fills gap", "content_type": "water-level-report", "quality_score": 0.85}]`,
        messages: [{ role: 'user', content: `Review these ${batch.length} web discoveries:\n\n${batchText}` }],
        max_tokens: 2048,
        temperature: 0.1,
      });

      // Parse curator decisions
      const responseText = parseTextContent(curatorResponse);
      let decisions: Array<{ index: number; decision: string; reasoning: string; content_type: string; quality_score: number }>;
      try {
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        decisions = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
        if (!Array.isArray(decisions)) decisions = [];
      } catch {
        console.error(`[${FUNCTION_NAME}] Failed to parse decisions:`, responseText.slice(0, 200));
        continue;
      }

      // 3. Apply decisions
      for (const decision of decisions) {
        if (decision.index >= batch.length) continue;
        const discovery = batch[decision.index] as Record<string, unknown>;

        await supabase
          .from('hunt_web_discoveries')
          .update({
            curator_decision: decision.decision,
            curator_reasoning: decision.reasoning,
            content_type: decision.content_type,
            quality_score: decision.quality_score,
          })
          .eq('id', discovery.id);

        if (decision.decision === 'embed') {
          try {
            const content = (discovery.content as string).slice(0, 4000);
            const embedding = await generateEmbedding(content, 'document');

            await supabase.from('hunt_knowledge').insert({
              title: (discovery.title as string) || 'Web Discovery',
              content: (discovery.content as string).slice(0, 8000),
              content_type: decision.content_type || 'web-discovery',
              source: (discovery.source_url as string) || 'tavily',
              species: (discovery.species as string) || null,
              state: (discovery.state_abbr as string) || null,
              embedding,
            });

            await supabase
              .from('hunt_web_discoveries')
              .update({ embedded_at: new Date().toISOString() })
              .eq('id', discovery.id);

            totalEmbedded++;
          } catch (embedErr) {
            console.error(`[${FUNCTION_NAME}] Embed error for discovery ${discovery.id}:`, embedErr);
          }
        } else if (decision.decision === 'skip') {
          totalSkipped++;
        } else if (decision.decision === 'flag') {
          totalFlagged++;
        }
      }
    }

    const summary = {
      processed: discoveries.length,
      embedded: totalEmbedded,
      skipped: totalSkipped,
      flagged: totalFlagged,
    };
    console.log(`[${FUNCTION_NAME}] Complete:`, JSON.stringify(summary));

    await logCronRun({
      functionName: FUNCTION_NAME,
      status: 'success',
      summary,
      durationMs: Date.now() - startTime,
    });

    return successResponse(req, summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${FUNCTION_NAME}] Fatal error:`, msg);
    await logCronRun({
      functionName: FUNCTION_NAME,
      status: 'error',
      errorMessage: msg,
      durationMs: Date.now() - startTime,
    });
    return errorResponse(req, 'Internal server error', 500);
  }
});
