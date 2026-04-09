import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';
import { callClaude, CLAUDE_MODELS, parseTextContent } from '../_shared/anthropic.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { STATE_ABBRS } from '../_shared/states.ts';

const FUNCTION_NAME = 'hunt-brain-synthesizer';
const MAX_STATES_PER_RUN = 3;
const HARD_TIMEOUT_MS = 120_000; // 120s hard cutoff — leave 30s buffer before 150s edge limit

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  let body: Record<string, any> = {};
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    // Request already closed before we could read body — still proceed with defaults
  }

  const startTime = Date.now();
  const supabase = createSupabaseClient();

  try {
    const now = new Date();
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);
    const today = now.toISOString().split('T')[0];
    let synthesized = 0;
    let skipped = 0;
    let timedOut = false;

    // Batch support: split 50 states into batches of MAX_STATES_PER_RUN
    const batchNum = body.batch ? Number(body.batch) : null;
    let statesToProcess: string[];
    const totalBatches = Math.ceil(STATE_ABBRS.length / MAX_STATES_PER_RUN);
    if (batchNum && batchNum >= 1 && batchNum <= totalBatches) {
      const start = (batchNum - 1) * MAX_STATES_PER_RUN;
      statesToProcess = STATE_ABBRS.slice(start, start + MAX_STATES_PER_RUN);
      console.log(`[${FUNCTION_NAME}] Batch ${batchNum}/${totalBatches}: processing ${statesToProcess.join(', ')}`);
    } else {
      // No batch specified — pick a rotating slice based on day-of-year
      const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
      const batchIndex = dayOfYear % totalBatches;
      const start = batchIndex * MAX_STATES_PER_RUN;
      statesToProcess = STATE_ABBRS.slice(start, start + MAX_STATES_PER_RUN);
      console.log(`[${FUNCTION_NAME}] Auto-batch ${batchIndex + 1}/${totalBatches} (day ${dayOfYear}): processing ${statesToProcess.join(', ')}`);
    }

    for (const state of statesToProcess) {
      // Hard timeout check
      if (Date.now() - startTime > HARD_TIMEOUT_MS) {
        console.warn(`[${FUNCTION_NAME}] Hard timeout reached at ${Date.now() - startTime}ms — stopping`);
        timedOut = true;
        break;
      }

      const { data: entries } = await supabase
        .from('hunt_knowledge')
        .select('id, title, content, content_type, metadata, effective_date')
        .eq('state_abbr', state)
        .gte('created_at', fortyEightHoursAgo.toISOString())
        .neq('content_type', 'ai-synthesis')
        .order('created_at', { ascending: false })
        .limit(50);

      if (!entries || entries.length < 10) {
        skipped++;
        continue;
      }

      const typeGroups: Record<string, typeof entries> = {};
      for (const e of entries) {
        const t = e.content_type || 'unknown';
        if (!typeGroups[t]) typeGroups[t] = [];
        typeGroups[t].push(e);
      }

      const domainCount = Object.keys(typeGroups).length;
      if (domainCount < 3) {
        skipped++;
        continue;
      }

      console.log(`[${FUNCTION_NAME}] ${state}: ${entries.length} entries across ${domainCount} domains — synthesizing`);

      const contextLines: string[] = [
        `State: ${state}`,
        `Time window: last 48 hours`,
        `Total entries: ${entries.length}`,
        `Domains: ${Object.keys(typeGroups).join(', ')}`,
        '',
      ];

      for (const [type, items] of Object.entries(typeGroups)) {
        contextLines.push(`--- ${type} (${items.length} entries) ---`);
        for (const item of items.slice(0, 5)) {
          contextLines.push(`  ${item.title}`);
          if (item.content) contextLines.push(`  ${item.content.slice(0, 200)}`);
        }
        contextLines.push('');
      }

      try {
        const synthesisResponse = await callClaude({
          model: CLAUDE_MODELS.haiku,
          system: `You are an environmental intelligence synthesizer. You receive clustered data from multiple domains (weather, water, seismic, biological, atmospheric) for a specific state and time window. Write a concise synthesis (3-5 sentences) that:
1. Identifies the key pattern: what's converging?
2. References specific data points (dates, values, sources)
3. Notes historical precedent if the data includes it
4. States confidence based on signal diversity and count
Never predict. State what the data shows and what happened historically in similar conditions.
Format: Start with the state and the pattern, then the evidence, then the confidence.`,
          messages: [{ role: 'user', content: contextLines.join('\n') }],
          max_tokens: 500,
          temperature: 0.2,
        });

        const synthesisText = parseTextContent(synthesisResponse);
        if (!synthesisText || synthesisText.length < 50) continue;

        const embedding = await generateEmbedding(synthesisText, 'document');

        const sourceIds = entries.slice(0, 20).map(e => e.id);
        const { error: insertErr } = await supabase.from('hunt_knowledge').insert({
          title: `AI Synthesis: ${state} — ${today}`,
          content: synthesisText,
          content_type: 'ai-synthesis',
          state_abbr: state,
          species: null,
          effective_date: today,
          signal_weight: 1.5,
          tags: [state, 'ai-synthesis', ...Object.keys(typeGroups)],
          metadata: {
            source: 'brain-synthesizer',
            domains_fused: domainCount,
            source_count: entries.length,
            source_ids: sourceIds,
            domain_types: Object.keys(typeGroups),
            confidence: domainCount >= 5 ? 'high' : domainCount >= 3 ? 'medium' : 'low',
            synthesized_at: now.toISOString(),
            confirmations: 0,
            status: 'active',
          },
          embedding,
        });

        if (insertErr) {
          console.error(`[${FUNCTION_NAME}] Insert error for ${state}:`, insertErr.message);
        } else {
          synthesized++;
          console.log(`[${FUNCTION_NAME}] Synthesized ${state}: ${domainCount} domains, ${entries.length} entries`);
        }
      } catch (err) {
        console.error(`[${FUNCTION_NAME}] Synthesis error for ${state}:`, err);
      }

      await new Promise(r => setTimeout(r, 500));
    }

    const summary = {
      states_checked: statesToProcess.length,
      synthesized,
      skipped,
      timed_out: timedOut,
      batch: batchNum,
      duration_ms: Date.now() - startTime,
    };
    await logCronRun({ functionName: FUNCTION_NAME, status: timedOut ? 'partial' : 'success', summary, durationMs: Date.now() - startTime });
    return cronResponse(summary);
  } catch (err: any) {
    await logCronRun({ functionName: FUNCTION_NAME, status: 'error', errorMessage: err.message, durationMs: Date.now() - startTime });
    return cronErrorResponse(err.message);
  }
});
