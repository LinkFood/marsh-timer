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

const MAX_ENTRIES_PER_RUN = 30; // conservative — each entry = 1 vector search + up to 5 link inserts
const MIN_SIMILARITY = 0.55;
const MATCH_LIMIT = 5;

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const fnName = 'hunt-pattern-link-worker';

  try {
    const supabase = createSupabaseClient();

    // Find recent entries that don't have pattern links yet.
    // We use the absence of a row in hunt_pattern_links with source_id = entry.id
    // Approach: get the most recent 200 entries, then filter in memory to only
    // those without any existing source_id link.
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

    const { data: recentEntries, error: entriesErr } = await supabase
      .from('hunt_knowledge')
      .select('id, content_type, state_abbr, embedding')
      .gte('created_at', twentyFourHoursAgo)
      .order('created_at', { ascending: false })
      .limit(200);

    if (entriesErr) {
      console.error(`[${fnName}] Query error:`, entriesErr);
      await logCronRun({ functionName: fnName, status: 'error', errorMessage: entriesErr.message, durationMs: Date.now() - startTime });
      return cronErrorResponse(entriesErr.message);
    }

    if (!recentEntries || recentEntries.length === 0) {
      await logCronRun({ functionName: fnName, status: 'success', summary: { message: 'no recent entries' }, durationMs: Date.now() - startTime });
      return cronResponse({ linked: 0, message: 'no recent entries' });
    }

    // Filter to EXTERNAL content types only
    const externalEntries = recentEntries.filter((e: any) => classifyContentType(e.content_type) === 'EXTERNAL');

    // Get IDs that already have source_id entries in hunt_pattern_links
    const entryIds = externalEntries.map((e: any) => e.id);
    const { data: existing } = await supabase
      .from('hunt_pattern_links')
      .select('source_id')
      .in('source_id', entryIds);

    const alreadyLinked = new Set<string>((existing || []).map((r: any) => r.source_id));
    const toProcess = externalEntries.filter((e: any) => !alreadyLinked.has(e.id)).slice(0, MAX_ENTRIES_PER_RUN);

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
        // Parse embedding (stored as JSON string in hunt_knowledge)
        let embedding: number[];
        if (typeof entry.embedding === 'string') {
          embedding = JSON.parse(entry.embedding);
        } else if (Array.isArray(entry.embedding)) {
          embedding = entry.embedding;
        } else {
          continue;
        }

        // Vector search
        const { data: matches, error: rpcErr } = await supabase.rpc('search_hunt_knowledge_v3', {
          query_embedding: embedding,
          match_threshold: MIN_SIMILARITY,
          match_count: MATCH_LIMIT + 5, // over-fetch, we'll filter same-type
          filter_state_abbr: entry.state_abbr || null,
          filter_content_types: null,
          filter_species: null,
          filter_date_from: null,
          filter_date_to: null,
          recency_weight: 0.3,
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
