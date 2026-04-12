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

const MAX_ENTRIES_PER_RUN = 1; // one at a time — edge function timeout is tight
const MIN_SIMILARITY = 0.55;
const MATCH_LIMIT = 3;

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const fnName = 'hunt-pattern-link-worker';

  try {
    const supabase = createSupabaseClient();

    // Query lower-volume content types first — vector search is fast when
    // there's less data to compare against. drought/air/soil/ocean are small.
    const { data: recentIds, error: idsErr } = await supabase
      .from('hunt_knowledge')
      .select('id, content_type, state_abbr')
      .eq('content_type', 'drought-weekly')
      .order('created_at', { ascending: false })
      .limit(5);

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

    console.log(`[${fnName}] Processing ${toProcess.length} unlinked external entries (${externalIds.length} total external, ${externalIds.length - toProcess.length} already linked)`);

    if (toProcess.length === 0) {
      await logCronRun({ functionName: fnName, status: 'success', summary: { linked: 0, message: 'all recent external entries already linked' }, durationMs: Date.now() - startTime });
      return cronResponse({ linked: 0, message: 'all already linked' });
    }

    let linksWritten = 0;
    let entriesWithMatches = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (const entry of toProcess) {
      try {
        // Fetch the embedding one at a time (avoiding the bulk-select timeout)
        const { data: entryWithEmbedding, error: fetchErr } = await supabase
          .from('hunt_knowledge')
          .select('embedding')
          .eq('id', entry.id)
          .single();

        if (fetchErr) {
          errorDetails.push(`${entry.id.slice(0,8)}: fetchErr=${(fetchErr.message || String(fetchErr)).slice(0, 80)}`);
          errors++;
          continue;
        }
        if (!entryWithEmbedding) {
          errorDetails.push(`${entry.id.slice(0,8)}: null row`);
          errors++;
          continue;
        }
        if (!entryWithEmbedding.embedding) {
          errorDetails.push(`${entry.id.slice(0,8)}: null embedding field`);
          errors++;
          continue;
        }

        let embedding: number[];
        if (typeof entryWithEmbedding.embedding === 'string') {
          try {
            embedding = JSON.parse(entryWithEmbedding.embedding);
          } catch (e) {
            errorDetails.push(`${entry.id.slice(0,8)}: parse fail`);
            errors++;
            continue;
          }
        } else if (Array.isArray(entryWithEmbedding.embedding)) {
          embedding = entryWithEmbedding.embedding;
        } else {
          errorDetails.push(`${entry.id.slice(0,8)}: bad type ${typeof entryWithEmbedding.embedding}`);
          errors++;
          continue;
        }

        if (embedding.length !== 512) {
          errorDetails.push(`${entry.id.slice(0,8)}: wrong dims ${embedding.length}`);
          errors++;
          continue;
        }

        // Use simple_vector_search — minimal RPC, no recency_boost or signal_weight overhead
        const { data: matches, error: rpcErr } = await supabase.rpc('simple_vector_search', {
          query_embedding: embedding,
          match_count: 10,
          filter_state_abbr: entry.state_abbr || null,
          exclude_id: entry.id,
        });

        if (rpcErr) {
          errorDetails.push(`${entry.id.slice(0,8)}: rpc=${(rpcErr.message || String(rpcErr)).slice(0, 80)}`);
          errors++;
          continue;
        }

        if (!matches || matches.length === 0) {
          console.log(`[${fnName}] No matches above threshold for ${entry.id} (${entry.content_type})`);
          continue;
        }
        console.log(`[${fnName}] ${entry.id}: ${matches.length} raw matches`);

        // Filter: above threshold + cross-domain
        const filtered = matches
          .filter((m: any) => m.similarity >= MIN_SIMILARITY && m.content_type !== entry.content_type)
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
          errorDetails.push(`${entry.id.slice(0,8)}: insert=${(insertErr.message || String(insertErr)).slice(0, 80)}`);
          errors++;
          continue;
        }

        linksWritten += rows.length;
        entriesWithMatches++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errorDetails.push(`${entry.id.slice(0,8)}: ${msg.slice(0, 100)}`);
        errors++;
      }
    }

    const summary = {
      processed: toProcess.length,
      entries_with_matches: entriesWithMatches,
      links_written: linksWritten,
      errors,
      error_details: errorDetails,
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
