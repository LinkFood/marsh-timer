import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405);

    const { query, species, state_abbr, limit: maxResults } = await req.json();
    if (!query) return errorResponse(req, 'query required');

    const supabase = createSupabaseClient();
    const resultLimit = Math.min(maxResults || 10, 20);

    // Generate embedding for query
    const embedUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/hunt-generate-embedding`;
    const embedRes = await fetch(embedUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ text: query, input_type: 'query' }),
    });

    let vectorResults: unknown[] = [];
    if (embedRes.ok) {
      const { embedding } = await embedRes.json();
      if (embedding) {
        const { data } = await supabase.rpc('search_hunt_knowledge_by_embedding', {
          query_embedding: embedding,
          match_threshold: 0.3,
          match_count: resultLimit,
        });
        vectorResults = data || [];
      }
    }

    // Keyword search as fallback/supplement
    const escapedQuery = query.replace(/[%_\\]/g, '\\$&');
    let keywordQuery = supabase
      .from('hunt_state_facts')
      .select('species_id, state_name, facts')
      .limit(resultLimit);

    // Also search seasons notes
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
    });
  } catch (error) {
    console.error('[hunt-search]', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});
