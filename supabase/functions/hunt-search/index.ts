import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405);

    const {
      query,
      species,
      state_abbr,
      limit: maxResults,
      content_types,
      date_from,
      date_to,
      recency_weight,
      exclude_du_report,
    } = await req.json();
    if (!query) return errorResponse(req, 'query required');

    const supabase = createSupabaseClient();
    const resultLimit = Math.min(maxResults || 10, 20);

    // Generate embedding for query directly via Voyage API (no HTTP hop)
    let vectorResults: unknown[] = [];
    try {
      const embedding = await generateEmbedding(query, 'query');
      if (embedding) {
        const { data } = await supabase.rpc('search_hunt_knowledge_v3', {
          query_embedding: embedding,
          match_threshold: 0.3,
          match_count: resultLimit,
          filter_content_types: content_types || null,
          filter_state_abbr: state_abbr || null,
          filter_species: species || null,
          filter_date_from: date_from || null,
          filter_date_to: date_to || null,
          recency_weight: recency_weight ?? 0.1,
          exclude_du_report: exclude_du_report ?? false,
        });
        // Deduplicate by title + effective_date
        const seen = new Set<string>();
        const deduped = (data || []).filter((r: any) => {
          const key = `${r.title}-${r.effective_date}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        vectorResults = deduped;
      }
    } catch (embedError) {
      console.error('[hunt-search] embedding failed:', embedError);
    }

    // Group results by content_type for display
    const grouped: Record<string, any[]> = {};
    for (const r of (vectorResults as any[] || [])) {
      const type = r.content_type || 'other';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(r);
    }

    // Keyword search as fallback/supplement
    const escapedQuery = query.replace(/[%_\\]/g, '\\$&');
    let keywordQuery = supabase
      .from('hunt_state_facts')
      .select('species_id, state_name, facts')
      .limit(resultLimit);

    let seasonQuery = supabase
      .from('hunt_seasons')
      .select('species_id, state_abbr, state_name, season_type, zone, notes')
      .ilike('notes', `%${escapedQuery}%`)
      .limit(resultLimit);

    if (species) {
      keywordQuery = keywordQuery.eq('species_id', species);
      seasonQuery = seasonQuery.eq('species_id', species);
    }
    if (state_abbr) {
      seasonQuery = seasonQuery.eq('state_abbr', state_abbr);
    }

    const [keywordRes, seasonRes] = await Promise.all([keywordQuery, seasonQuery]);

    return successResponse(req, {
      vector: vectorResults,
      keywords: {
        facts: keywordRes.data || [],
        seasons: seasonRes.data || [],
      },
      grouped,
    });
  } catch (error) {
    console.error('[hunt-search]', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});
