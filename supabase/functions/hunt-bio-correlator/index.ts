import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// ---------------------------------------------------------------------------
// Bio-Environmental Correlator (recurring cron version)
//
// Creates bio-environmental-correlation entries — the BRIDGE layer that
// enables cross-domain similarity in the embedding space. Without these,
// raw weather data and raw biological data don't form pattern links because
// they use different vocabularies.
//
// For each recent bird entry (last 24h), find env events in the same state
// within a 72-hour window, build a narrative correlation, embed via Voyage,
// and insert as bio-environmental-correlation type.
//
// No vector search needed — just regular DB queries. Works regardless of
// IVFFlat index health.
//
// This is the heart of the narrative density blitz from the v3 spec.
// ---------------------------------------------------------------------------

const BIRD_TYPES = [
  "birdcast-daily",
  "migration-spike-extreme",
  "migration-spike-significant",
  "migration-spike-moderate",
  "migration-daily",
];

const ENV_TYPES = [
  "weather-event",
  "nws-alert",
  "usgs-water",
  "drought-weekly",
  "storm-event",
  "climate-index",
  "soil-conditions",
  "air-quality",
  "river-discharge",
  "ocean-buoy",
  "space-weather",
];

const MAX_BIRD_ENTRIES_PER_RUN = 100; // bumped after parallelization (5 concurrent x faster runs)
const TIME_BUDGET_MS = 110000; // stop at 110s to leave headroom under 150s limit

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const fnName = 'hunt-bio-correlator';

  try {
    const supabase = createSupabaseClient();
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    // 1. Pull recent bird entries — query each type separately (avoid IN-clause slowness)
    const queries = BIRD_TYPES.map(ct =>
      supabase
        .from('hunt_knowledge')
        .select('id, title, content, content_type, state_abbr, effective_date')
        .eq('content_type', ct)
        .gte('created_at', twentyFourHoursAgo)
        .not('state_abbr', 'is', null)
        .not('effective_date', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10)
    );
    const results = await Promise.all(queries);
    const birdEntries: any[] = [];
    for (const r of results) {
      if (r.data) birdEntries.push(...r.data);
    }

    // Backfill mode: if not enough recent entries, pull older ones too.
    // This grows the bridge layer toward the v3 spec target of ~20,000 entries.
    if (birdEntries.length < MAX_BIRD_ENTRIES_PER_RUN) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const backfillQueries = BIRD_TYPES.map(ct =>
        supabase
          .from('hunt_knowledge')
          .select('id, title, content, content_type, state_abbr, effective_date')
          .eq('content_type', ct)
          .gte('created_at', thirtyDaysAgo)
          .lt('created_at', twentyFourHoursAgo)
          .not('state_abbr', 'is', null)
          .not('effective_date', 'is', null)
          .order('created_at', { ascending: false })
          .limit(50)
      );
      const backfillResults = await Promise.all(backfillQueries);
      for (const r of backfillResults) {
        if (r.data) birdEntries.push(...r.data);
      }
      console.log(`[${fnName}] Backfill: added older entries, total now ${birdEntries.length}`);
    }

    if (birdEntries.length === 0) {
      await logCronRun({ functionName: fnName, status: 'success', summary: { processed: 0, message: 'no recent bird entries' }, durationMs: Date.now() - startTime });
      return cronResponse({ correlations: 0, message: 'no recent bird entries' });
    }

    // 2. Skip entries that already have a correlation written.
    // Look back 30 days to dedup against backfill entries.
    const dedupCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data: existingCorrelations } = await supabase
      .from('hunt_knowledge')
      .select('metadata')
      .eq('content_type', 'bio-environmental-correlation')
      .gte('created_at', dedupCutoff)
      .limit(2000);

    const alreadyCorrelated = new Set<string>();
    if (existingCorrelations) {
      for (const c of existingCorrelations) {
        const meta = c.metadata as Record<string, unknown> | null;
        const birdId = meta?.bird_entry_id;
        if (typeof birdId === 'string') alreadyCorrelated.add(birdId);
      }
    }

    const toProcess = birdEntries
      .filter(b => !alreadyCorrelated.has(b.id))
      .slice(0, MAX_BIRD_ENTRIES_PER_RUN);

    console.log(`[${fnName}] ${birdEntries.length} bird entries, ${alreadyCorrelated.size} already correlated, processing ${toProcess.length}`);

    if (toProcess.length === 0) {
      await logCronRun({ functionName: fnName, status: 'success', summary: { processed: 0, message: 'all already correlated' }, durationMs: Date.now() - startTime });
      return cronResponse({ correlations: 0, message: 'all already correlated' });
    }

    // 3. For each bird entry, find env events in same state within 72hr window
    // Process 5 bird entries concurrently to speed up the run
    const correlationEntries: Array<{ text: string; meta: Record<string, any> }> = [];
    let envQueriesDone = 0;
    const PARALLEL = 5;

    async function processBird(bird: any): Promise<{ envEvents: any[]; envQueries: number } | null> {
      const dateObj = new Date(bird.effective_date);
      const dateFrom = new Date(dateObj.getTime() - 3 * 86400000).toISOString().split('T')[0];
      const dateTo = new Date(dateObj.getTime() + 3 * 86400000).toISOString().split('T')[0];

      const envQueries = ENV_TYPES.map(ct =>
        supabase
          .from('hunt_knowledge')
          .select('id, title, content_type, effective_date')
          .eq('content_type', ct)
          .eq('state_abbr', bird.state_abbr)
          .gte('effective_date', dateFrom)
          .lte('effective_date', dateTo)
          .limit(3)
      );
      const envResults = await Promise.all(envQueries);

      const envEvents: any[] = [];
      for (const r of envResults) {
        if (r.data) envEvents.push(...r.data);
      }

      return { envEvents, envQueries: ENV_TYPES.length };
    }

    for (let i = 0; i < toProcess.length; i += PARALLEL) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log(`[${fnName}] Time budget reached, stopping at index ${i}`);
        break;
      }

      const batch = toProcess.slice(i, i + PARALLEL);
      const results = await Promise.all(batch.map(b => processBird(b)));

      for (let j = 0; j < batch.length; j++) {
        const bird = batch[j];
        const result = results[j];
        if (!result) continue;
        envQueriesDone += result.envQueries;
        const envEvents = result.envEvents;

        if (envEvents.length === 0) continue;

      // Build correlation text
      const envSummary = envEvents
        .slice(0, 15)
        .map((e: any) => `- [${e.content_type}] ${e.title} (${e.effective_date})`)
        .join('\n');

      const corrText = [
        `bio-environmental-correlation | ${bird.state_abbr} | ${bird.effective_date}`,
        `Biological signal: ${bird.title} (${bird.content_type})`,
        `Environmental context (72hr window):`,
        envSummary,
        `Cross-domain match count: ${envEvents.length}`,
      ].join('\n');

      const envTypes = [...new Set(envEvents.map((e: any) => e.content_type))];

      correlationEntries.push({
        text: corrText,
        meta: {
          title: `Bio-Env Correlation: ${bird.state_abbr} ${bird.effective_date} — ${bird.content_type}`,
          content: corrText,
          content_type: 'bio-environmental-correlation',
          state_abbr: bird.state_abbr,
          species: null, // domain-agnostic; no longer hardcoded "duck"
          effective_date: bird.effective_date,
          tags: [bird.state_abbr, 'correlation', 'bio-signal', 'bridge', bird.content_type, ...envTypes],
          metadata: {
            source: 'hunt-bio-correlator',
            bird_entry_id: bird.id,
            bird_content_type: bird.content_type,
            bird_title: bird.title,
            env_matches: envEvents.length,
            env_types: envTypes,
            env_entries: envEvents.slice(0, 15).map((e: any) => ({
              id: e.id,
              title: e.title,
              type: e.content_type,
              date: e.effective_date,
            })),
          },
        },
      });
      }
    }

    if (correlationEntries.length === 0) {
      await logCronRun({ functionName: fnName, status: 'success', summary: { processed: toProcess.length, correlations: 0, env_queries: envQueriesDone }, durationMs: Date.now() - startTime });
      return cronResponse({ processed: toProcess.length, correlations: 0, message: 'no env events to correlate' });
    }

    // 4. Embed in batches of 20 (Voyage limit)
    const texts = correlationEntries.map(e => e.text);
    const embeddings = await batchEmbed(texts, 'document');

    if (!embeddings || embeddings.length !== texts.length) {
      throw new Error(`Embedding mismatch: expected ${texts.length}, got ${embeddings?.length ?? 0}`);
    }

    // 5. Insert into hunt_knowledge
    const rows = correlationEntries.map((e, i) => ({
      ...e.meta,
      embedding: embeddings[i],
    }));

    let inserted = 0;
    for (let i = 0; i < rows.length; i += 20) {
      const chunk = rows.slice(i, i + 20);
      const { error: insertErr } = await supabase
        .from('hunt_knowledge')
        .insert(chunk);
      if (insertErr) {
        console.error(`[${fnName}] Insert error batch ${i / 20}:`, insertErr.message);
      } else {
        inserted += chunk.length;
      }
    }

    const summary = {
      bird_entries_found: birdEntries.length,
      processed: toProcess.length,
      correlations_built: correlationEntries.length,
      inserted,
      env_queries_done: envQueriesDone,
      run_at: new Date().toISOString(),
    };

    console.log(`[${fnName}] Done:`, summary);
    await logCronRun({ functionName: fnName, status: 'success', summary, durationMs: Date.now() - startTime });
    return cronResponse(summary);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[${fnName}] Fatal:`, msg);
    await logCronRun({ functionName: fnName, status: 'error', errorMessage: msg, durationMs: Date.now() - startTime });
    return cronErrorResponse(msg);
  }
});
