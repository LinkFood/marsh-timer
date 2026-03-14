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
    const { data } = await supabase.rpc('search_hunt_knowledge_v2', {
      query_embedding: embedding,
      match_threshold: opts.min_similarity ?? 0.55,
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
      min_similarity: 0.55,
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

    console.log(`[brainScan] ${entryId}: ${result.matches.length} pattern matches found`);
  } catch (err) {
    // Non-fatal — scanning is best-effort
    console.warn('[brainScan] enrich failed (non-fatal):', err);
  }
}
