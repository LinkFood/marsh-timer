// Query-on-write brain scanning module.
// When new data is ingested, immediately search the brain with the same embedding
// to find historical pattern matches. Results are stored as metadata on the new entry.
// This is SCANNING, not alerting — the system recognizes patterns silently.

import { createSupabaseClient } from './supabase.ts';

interface PatternMatch {
  id: string;
  title: string;
  content_type: string;
  similarity: number;
}

interface ScanResult {
  matches: PatternMatch[];
  scanned: boolean;
}

/**
 * Scan the brain for pattern matches using an already-generated embedding.
 * Searches hunt_knowledge_v2 excluding DU reports and the entry's own content type
 * to find cross-domain correlations (e.g., weather event → historical migration pattern).
 *
 * @param embedding - The 512-dim embedding vector (already generated for storage)
 * @param opts - Scan options
 * @returns Pattern matches with similarity scores
 */
export async function scanBrainOnWrite(
  embedding: number[],
  opts: {
    state_abbr?: string;
    exclude_content_type?: string;
    min_similarity?: number;
    limit?: number;
  } = {}
): Promise<ScanResult> {
  try {
    const supabase = createSupabaseClient();
    const { data } = await supabase.rpc('search_hunt_knowledge_v3', {
      query_embedding: embedding,
      match_threshold: opts.min_similarity ?? 0.50,
      match_count: opts.limit ?? 5,
      filter_state_abbr: opts.state_abbr || null,
      filter_content_types: null,
      filter_species: null,
      filter_date_from: null,
      filter_date_to: null,
      recency_weight: 0.3,
      exclude_du_report: true,
    });

    if (!data || data.length === 0) {
      return { matches: [], scanned: true };
    }

    // Filter out matches of the same content type to find cross-domain patterns
    const crossDomain = opts.exclude_content_type
      ? data.filter((r: { content_type: string }) => r.content_type !== opts.exclude_content_type)
      : data;

    const matches: PatternMatch[] = crossDomain.map((r: { id: string; title: string; content_type: string; similarity: number }) => ({
      id: r.id,
      title: r.title,
      content_type: r.content_type,
      similarity: r.similarity,
    }));

    // Detect cross-domain convergence
    const uniqueTypes = new Set(matches.map(m => m.content_type));
    if (uniqueTypes.size >= 3) {
      console.log(`[brainScan] Cross-domain convergence detected: ${uniqueTypes.size} types — ${[...uniqueTypes].join(', ')}`);
    }

    // Count synthesis reinforcements
    const synthesisMatches = matches.filter(m => m.content_type === 'ai-synthesis');
    if (synthesisMatches.length >= 2) {
      console.log(`[brainScan] New data reinforcing ${synthesisMatches.length} synthesis entries`);
      for (const syn of synthesisMatches) {
        try {
          const { data: existing } = await supabase
            .from('hunt_knowledge')
            .select('metadata, signal_weight')
            .eq('id', syn.id)
            .single();
          if (existing) {
            const meta = existing.metadata || {};
            const confirmations = (meta.confirmations || 0) + 1;
            await supabase.from('hunt_knowledge').update({
              signal_weight: Math.min(2.0, (existing.signal_weight || 1.0) + 0.05),
              metadata: { ...meta, confirmations, last_confirmed: new Date().toISOString() },
            }).eq('id', syn.id);
          }
        } catch { /* best-effort */ }
      }
    }

    return { matches, scanned: true };
  } catch (err) {
    console.warn('[brainScan] scan failed (non-fatal):', err);
    return { matches: [], scanned: false };
  }
}

/**
 * Enrich a hunt_knowledge metadata object with pattern scan results.
 * Call this AFTER inserting the new entry, then update its metadata.
 */
export async function enrichWithPatternScan(
  entryId: string,
  embedding: number[],
  opts: {
    state_abbr?: string;
    exclude_content_type?: string;
  } = {}
): Promise<void> {
  try {
    const result = await scanBrainOnWrite(embedding, {
      state_abbr: opts.state_abbr,
      exclude_content_type: opts.exclude_content_type,
      min_similarity: 0.50,
      limit: 5,
    });

    if (!result.scanned || result.matches.length === 0) return;

    const supabase = createSupabaseClient();

    // Get current metadata
    const { data: entry } = await supabase
      .from('hunt_knowledge')
      .select('metadata')
      .eq('id', entryId)
      .single();

    if (!entry) return;

    // Merge pattern_matches into existing metadata
    const updatedMetadata = {
      ...(entry.metadata || {}),
      pattern_matches: result.matches,
      pattern_scan_at: new Date().toISOString(),
    };

    await supabase
      .from('hunt_knowledge')
      .update({ metadata: updatedMetadata })
      .eq('id', entryId);

    // Write pattern links to hunt_pattern_links
    await writePatternLinks(entryId, result.matches, {
      state_abbr: opts.state_abbr,
      source_content_type: opts.exclude_content_type,
    });

    console.log(`[brainScan] ${entryId}: ${result.matches.length} pattern matches found`);
  } catch (err) {
    // Non-fatal — scanning is best-effort
    console.warn('[brainScan] enrich failed (non-fatal):', err);
  }
}

/**
 * Scan + link in one call. Use this when you have the source entry ID.
 * Writes pattern links to hunt_pattern_links for every match above threshold.
 * This is the function fire-and-forget data ingestion should use.
 */
export async function scanAndLink(
  sourceId: string,
  embedding: number[],
  opts: {
    state_abbr?: string;
    source_content_type: string;
    min_similarity?: number;
    limit?: number;
  }
): Promise<number> {
  try {
    const result = await scanBrainOnWrite(embedding, {
      state_abbr: opts.state_abbr,
      exclude_content_type: opts.source_content_type,
      min_similarity: opts.min_similarity ?? 0.50,
      limit: opts.limit ?? 5,
    });

    if (!result.scanned || result.matches.length === 0) return 0;

    await writePatternLinks(sourceId, result.matches, {
      state_abbr: opts.state_abbr,
      source_content_type: opts.source_content_type,
    });

    return result.matches.length;
  } catch (err) {
    console.warn('[brainScan] scanAndLink failed (non-fatal):', err);
    return 0;
  }
}

/**
 * Write pattern links to hunt_pattern_links.
 * One row per match linking the new entry to the historical match.
 * Best-effort — failures are logged but don't block the pipeline.
 */
async function writePatternLinks(
  sourceId: string,
  matches: PatternMatch[],
  opts: { state_abbr?: string; source_content_type?: string } = {}
): Promise<void> {
  if (matches.length === 0) return;

  try {
    const supabase = createSupabaseClient();

    const rows = matches.map((m) => ({
      source_id: sourceId,
      matched_id: m.id,
      similarity: m.similarity,
      source_content_type: opts.source_content_type || null,
      matched_content_type: m.content_type,
      state_abbr: opts.state_abbr || null,
    }));

    const { error } = await supabase
      .from('hunt_pattern_links')
      .insert(rows);

    if (error) {
      console.warn('[brainScan] writePatternLinks insert error:', error.message);
    } else {
      console.log(`[brainScan] wrote ${rows.length} pattern links for ${sourceId}`);
    }
  } catch (err) {
    console.warn('[brainScan] writePatternLinks failed (non-fatal):', err);
  }
}
