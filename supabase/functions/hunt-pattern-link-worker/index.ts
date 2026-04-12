import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { classifyContentType } from '../_shared/contentTypes.ts';

// ---------------------------------------------------------------------------
// Pattern Link Worker
//
// Runs every 15 minutes. Processes the last N unlinked entries from hunt_knowledge,
// runs vector similarity search for each, and writes matches to hunt_pattern_links.
//
// Decoupled from ingestion functions to avoid connection pool exhaustion:
// ingestion writes data fast, this worker links it in a controlled batch.
//
// Only processes EXTERNAL content types (no alert-grade/convergence-score bookkeeping).
// ---------------------------------------------------------------------------

const MAX_ENTRIES_PER_RUN = 3; // ultra-conservative — pool is stressed
const MIN_SIMILARITY = 0.55;
const MATCH_LIMIT = 3;

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const fnName = 'hunt-pattern-link-worker';

  try {
    const supabase = createSupabaseClient();

    // Single content_type query — simplest test
    console.log(`[${fnName}] Querying weather-event entries...`);
    const q1Start = Date.now();
    const { data: recentIds, error: idsErr } = await supabase
      .from('hunt_knowledge')
      .select('id, content_type, state_abbr')
      .eq('content_type', 'weather-event')
      .order('created_at', { ascending: false })
      .limit(5);
    console.log(`[${fnName}] weather-event query took ${Date.now() - q1Start}ms, got ${recentIds?.length ?? 0} rows`);

    if (idsErr) {
      console.error(`[${fnName}] IDs query error:`, idsErr);
      await logCronRun({ functionName: fnName, status: 'error', errorMessage: idsErr.message, durationMs: Date.now() - startTime });
      return cronErrorResponse(idsErr.message);
    }

    if (!recentIds || recentIds.length === 0) {
      await logCronRun({ functionName: fnName, status: 'success', summary: { message: 'no recent entries' }, durationMs: Date.now() - startTime });
      return cronResponse({ linked: 0, message: 'no recent entries' });
    }

    // Filter to EXTERNAL content types only
    const externalIds = recentIds.filter((e: any) => classifyContentType(e.content_type) === 'EXTERNAL');

    // Check which already have links (small query with just source_id)
    const idList = externalIds.map((e: any) => e.id);
    const { data: existing } = await supabase
      .from('hunt_pattern_links')
      .select('source_id')
      .in('source_id', idList);

    const alreadyLinked = new Set<string>((existing || []).map((r: any) => r.source_id));
    const toProcess = externalIds.filter((e: any) => !alreadyLinked.has(e.id)).slice(0, MAX_ENTRIES_PER_RUN);

    console.log(`[${fnName}] Processing ${toProcess.length} unlinked external entries (${externalEntries.length} total external, ${externalEntries.length - toProcess.length} already linked)`);

    if (toProcess.length === 0) {
      await logCronRun({ functionName: fnName, status: 'success', summary: { linked: 0, message: 'all recent external entries already linked' }, durationMs: Date.now() - startTime });
      return cronResponse({ linked: 0, message: 'all already linked' });
    }

    let linksWritten = 0;
    let entriesWithMatches = 0;
    let errors = 0;

    for (const entry of toProcess) {
      try {
        // Fetch the embedding one at a time (avoiding the bulk-select timeout)
        const { data: entryWithEmbedding, error: fetchErr } = await supabase
          .from('hunt_knowledge')
          .select('embedding')
          .eq('id', entry.id)
          .single();

        if (fetchErr || !entryWithEmbedding) { errors++; continue; }

        let embedding: number[];
        if (typeof entryWithEmbedding.embedding === 'string') {
          embedding = JSON.parse(entryWithEmbedding.embedding);
        } else if (Array.isArray(entryWithEmbedding.embedding)) {
          embedding = entryWithEmbedding.embedding;
        } else {
          continue;
        }

        // Vector search — use same params as alert-grader (proven to work)
        const { data: matches, error: rpcErr } = await supabase.rpc('search_hunt_knowledge_v3', {
          query_embedding: embedding,
          match_threshold: 0.40,
          match_count: 10,
          filter_state_abbr: entry.state_abbr || null,
          filter_content_types: null,
          filter_species: null,
          filter_date_from: null,
          filter_date_to: null,
          recency_weight: 0.1,
          exclude_du_report: true,
        });

        if (rpcErr) {
          errors++;
          continue;
        }

        if (!matches || matches.length === 0) continue;

        // Filter: cross-domain only (different content_type), skip self
        const filtered = matches
          .filter((m: any) => m.id !== entry.id && m.content_type !== entry.content_type)
          .slice(0, MATCH_LIMIT);

        if (filtered.length === 0) continue;

        // Write links
        const rows = filtered.map((m: any) => ({
          source_id: entry.id,
          matched_id: m.id,
          similarity: m.similarity,
          source_content_type: entry.content_type,
          matched_content_type: m.content_type,
          state_abbr: entry.state_abbr || null,
        }));

        const { error: insertErr } = await supabase.from('hunt_pattern_links').insert(rows);
        if (insertErr) {
          errors++;
          continue;
        }

        linksWritten += rows.length;
        entriesWithMatches++;
      } catch (err) {
        errors++;
      }
    }

    const summary = {
      processed: toProcess.length,
      entries_with_matches: entriesWithMatches,
      links_written: linksWritten,
      errors,
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
