import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { classifyContentType } from '../_shared/contentTypes.ts';

// ---------------------------------------------------------------------------
// Pattern Link Worker
//
// Runs every 15 minutes. Walks the freshest unlinked EXTERNAL entries across a
// curated set of diverse, string-producing content types, runs vector similarity
// search for each, and writes cross-domain matches to hunt_pattern_links. These
// are the "strings" the board draws between domains.
//
// Decoupled from ingestion functions to avoid connection pool exhaustion:
// ingestion writes data fast, this worker links it in a controlled, time-budgeted
// slice per invocation and relies on the schedule to make progress. It never tries
// to catch up the whole backlog in one run.
//
// READ-PATTERN LAW (9.8M-row brain, verified 2026-07-10):
//   - NEVER order candidate queries by created_at: on bulk-backfilled types
//     (storm-event / tide-gauge / ghcn-daily) `order=created_at.desc` scans and
//     times out (57014). A `created_at >= <bound>` filter + LIMIT with NO ORDER BY
//     returns in <12s because the planner stops at the limit.
//   - The IVFFlat rebuild (lists=2645, probes lowered in simple_vector_search v3)
//     makes the vector RPC ~0.5-3s again — that regression was the April death.
//   - Always pass the state filter to the vector RPC when the entry has a state.
// ---------------------------------------------------------------------------

// The LIVE worker scans the DIVERSE, string-producing EXTERNAL types — the ones
// whose nearest neighbors reach ACROSS domains (a severe-weather alert near a
// historical storm event; a migration spike near daily migration counts). These
// are the strings the board draws.
//
// Deliberately EXCLUDED here: high-self-similarity bulk types (drought-weekly,
// tide-gauge, ghcn-daily, usgs-water, weather-realtime/-daily, snotel, ...). Two
// reasons, verified 2026-07-10:
//   1. Their nearest neighbors are almost always the SAME type (weekly drought
//      readings cluster on drought readings) — the cross-domain filter empties
//      them, so they produce ~no links.
//   2. Their recent-window gather is slow-to-timeout (millions of rows, uniform
//      backfill created_at) — usgs-water times out even bounded.
// The 3-month bulk backlog for those types is handled by the separate catch-up
// plan (design-only), not the live cadence.
// Ordered by cross-domain YIELD (proven producers first). The migration-spike
// family and migration-daily reliably have cross-domain neighbors; nws-alert and
// storm-event yield the alert->storm strings intermittently; the rest are diverse
// enough to reach across domains when a real signal aligns. Processing the reliable
// producers first means even a small time-budgeted slice writes strings.
const SCAN_TYPES = [
  'migration-spike-moderate', 'migration-spike-significant', 'migration-spike-extreme',
  'migration-spike', 'migration-daily', 'nws-alert', 'storm-event',
  'weather-event', 'earthquake-event', 'birdcast-daily', 'climate-index',
  'wildfire-perimeter', 'space-weather', 'air-quality', 'ocean-buoy',
];

const RECENT_PER_TYPE = 4;        // fresh candidates pulled per type
const RECENT_WINDOW_DAYS = 5;     // "recent" = written within this many days
const MAX_ENTRIES_PER_RUN = 6;    // hard cap: keeps worst-case (6 * 15s RPC cap) under the edge ceiling
const GATHER_BUDGET_MS = 35_000;  // stop gathering candidates after this
const TIME_BUDGET_MS = 90_000;    // stop starting new link work after this
const MATCH_COUNT = 12;           // pull deeper than MATCH_LIMIT so cross-domain neighbors surface
const MIN_SIMILARITY = 0.55;
const MATCH_LIMIT = 3;            // links written per source entry

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const fnName = 'hunt-pattern-link-worker';
  const errorDetails: string[] = [];

  try {
    const supabase = createSupabaseClient();

    const typesThisRun = SCAN_TYPES;
    const recentBound = new Date(Date.now() - RECENT_WINDOW_DAYS * 86_400_000).toISOString();

    // Gather fresh candidates. NO ORDER BY — a created_at lower-bound + LIMIT is
    // the only index-safe way to pull recent rows; ordering by created_at scans
    // and times out (57014) on the larger types.
    const candidates: Array<{ id: string; content_type: string; state_abbr: string | null }> = [];
    for (const ct of typesThisRun) {
      if (Date.now() - startTime > GATHER_BUDGET_MS) break;
      try {
        const { data, error } = await supabase
          .from('hunt_knowledge')
          .select('id, content_type, state_abbr')
          .eq('content_type', ct)
          .gte('created_at', recentBound)
          .limit(RECENT_PER_TYPE);
        if (error) {
          errorDetails.push(`gather ${ct}: ${(error.message || String(error)).slice(0, 60)}`);
          continue;
        }
        if (data && data.length) candidates.push(...(data as any[]));
      } catch (e) {
        errorDetails.push(`gather ${ct}: ${(e instanceof Error ? e.message : String(e)).slice(0, 60)}`);
      }
    }

    // EXTERNAL only (defensive — the list is already all EXTERNAL).
    const externalIds = candidates.filter((e) => classifyContentType(e.content_type) === 'EXTERNAL');

    if (externalIds.length === 0) {
      await logCronRun({
        functionName: fnName,
        status: errorDetails.length ? 'partial' : 'success',
        summary: { types_scanned: typesThisRun, candidates: 0, linked: 0, message: 'no recent candidates', error_details: errorDetails },
        durationMs: Date.now() - startTime,
      });
      return cronResponse({ linked: 0, message: 'no recent candidates', types_scanned: typesThisRun });
    }

    // Which already have links?
    const idList = externalIds.map((e) => e.id);
    const { data: existing } = await supabase
      .from('hunt_pattern_links')
      .select('source_id')
      .in('source_id', idList);

    const alreadyLinked = new Set<string>((existing || []).map((r: any) => r.source_id));
    const toProcess = externalIds.filter((e) => !alreadyLinked.has(e.id)).slice(0, MAX_ENTRIES_PER_RUN);

    console.log(`[${fnName}] types=[${typesThisRun.join(',')}] candidates=${externalIds.length} unlinked=${toProcess.length}`);

    if (toProcess.length === 0) {
      await logCronRun({
        functionName: fnName,
        status: errorDetails.length ? 'partial' : 'success',
        summary: { types_scanned: typesThisRun, candidates: externalIds.length, linked: 0, message: 'all recent candidates already linked', error_details: errorDetails },
        durationMs: Date.now() - startTime,
      });
      return cronResponse({ linked: 0, message: 'all already linked', types_scanned: typesThisRun });
    }

    let linksWritten = 0;
    let entriesWithMatches = 0;
    let errors = errorDetails.length;
    let processed = 0;

    for (const entry of toProcess) {
      if (Date.now() - startTime > TIME_BUDGET_MS) {
        console.log(`[${fnName}] time budget reached, stopping after ${processed} entries`);
        break;
      }
      processed++;
      try {
        // Fetch the embedding one at a time (PK lookup, avoids the bulk-select timeout).
        const { data: entryWithEmbedding, error: fetchErr } = await supabase
          .from('hunt_knowledge')
          .select('embedding')
          .eq('id', entry.id)
          .single();

        if (fetchErr) {
          errorDetails.push(`${entry.id.slice(0, 8)}: fetchErr=${(fetchErr.message || String(fetchErr)).slice(0, 80)}`);
          errors++;
          continue;
        }
        if (!entryWithEmbedding || !entryWithEmbedding.embedding) {
          errorDetails.push(`${entry.id.slice(0, 8)}: null embedding`);
          errors++;
          continue;
        }

        let embedding: number[];
        if (typeof entryWithEmbedding.embedding === 'string') {
          try {
            embedding = JSON.parse(entryWithEmbedding.embedding);
          } catch (_e) {
            errorDetails.push(`${entry.id.slice(0, 8)}: parse fail`);
            errors++;
            continue;
          }
        } else if (Array.isArray(entryWithEmbedding.embedding)) {
          embedding = entryWithEmbedding.embedding;
        } else {
          errorDetails.push(`${entry.id.slice(0, 8)}: bad type ${typeof entryWithEmbedding.embedding}`);
          errors++;
          continue;
        }

        if (embedding.length !== 512) {
          errorDetails.push(`${entry.id.slice(0, 8)}: wrong dims ${embedding.length}`);
          errors++;
          continue;
        }

        // simple_vector_search — minimal RPC (v3: probes=5, statement_timeout=15s).
        const { data: matches, error: rpcErr } = await supabase.rpc('simple_vector_search', {
          query_embedding: embedding,
          match_count: MATCH_COUNT,
          filter_state_abbr: entry.state_abbr || null,
          exclude_id: entry.id,
        });

        if (rpcErr) {
          errorDetails.push(`${entry.id.slice(0, 8)}: rpc=${(rpcErr.message || String(rpcErr)).slice(0, 80)}`);
          errors++;
          continue;
        }

        if (!matches || matches.length === 0) continue;

        // Above threshold + cross-domain only.
        const filtered = (matches as any[])
          .filter((m) => m.similarity >= MIN_SIMILARITY && m.content_type !== entry.content_type)
          .slice(0, MATCH_LIMIT);

        if (filtered.length === 0) continue;

        const rows = filtered.map((m) => ({
          source_id: entry.id,
          matched_id: m.id,
          similarity: m.similarity,
          source_content_type: entry.content_type,
          matched_content_type: m.content_type,
          state_abbr: entry.state_abbr || null,
        }));

        const { error: insertErr } = await supabase.from('hunt_pattern_links').insert(rows);
        if (insertErr) {
          errorDetails.push(`${entry.id.slice(0, 8)}: insert=${(insertErr.message || String(insertErr)).slice(0, 80)}`);
          errors++;
          continue;
        }

        linksWritten += rows.length;
        entriesWithMatches++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorDetails.push(`${entry.id.slice(0, 8)}: ${msg.slice(0, 100)}`);
        errors++;
      }
    }

    const summary = {
      types_scanned: typesThisRun,
      candidates: externalIds.length,
      processed,
      entries_with_matches: entriesWithMatches,
      links_written: linksWritten,
      errors,
      error_details: errorDetails.slice(0, 10),
      run_at: new Date().toISOString(),
    };

    console.log(`[${fnName}] Done:`, summary);

    await logCronRun({
      functionName: fnName,
      status: errors > 0 ? 'partial' : 'success',
      summary,
      durationMs: Date.now() - startTime,
    });

    return cronResponse(summary);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[${fnName}] Fatal:`, msg);
    await logCronRun({ functionName: fnName, status: 'error', errorMessage: msg, durationMs: Date.now() - startTime });
    return cronErrorResponse(msg);
  }
});
