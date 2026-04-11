import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';

const DATE_DOMAINS = [
  'weather-event', 'nws-alert', 'convergence-score', 'birdcast-daily',
  'migration-spike', 'ocean-buoy', 'space-weather', 'anomaly-alert',
];

// ─── Date Endpoint ──────────────────────────────────────────────────────────

async function handleDate(req: Request, params: {
  date: string;
  state?: string;
  domains?: string[];
}): Promise<Response> {
  const { date, state, domains } = params;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse(req, 'Valid date required (YYYY-MM-DD)');
  }

  const d = new Date(date);
  const from = new Date(d.getTime() - 3 * 86400000).toISOString().split('T')[0];
  const to = new Date(d.getTime() + 3 * 86400000).toISOString().split('T')[0];

  const supabase = createSupabaseClient();
  const queryDomains = domains && domains.length > 0 ? domains : DATE_DOMAINS;

  // Per-content-type parallel queries (no IN-clause on 7M rows)
  const perType = await Promise.all(
    queryDomains.map(async (ct) => {
      let q = supabase
        .from('hunt_knowledge')
        .select('id, title, content, content_type, state_abbr, effective_date, confidence')
        .eq('content_type', ct)
        .gte('effective_date', from)
        .lte('effective_date', to)
        .order('effective_date', { ascending: false })
        .limit(10);
      if (state) q = q.eq('state_abbr', state);
      const { data, error } = await q;
      if (error) console.error(`[hunt-api/date] ${ct} error:`, error.message);
      return { domain: ct, entries: data || [] };
    })
  );

  // Also fetch brain narratives for the date window
  let narrativeQuery = supabase
    .from('hunt_knowledge')
    .select('id, title, content, content_type, state_abbr, effective_date, confidence')
    .eq('content_type', 'brain-narrative')
    .gte('effective_date', from)
    .lte('effective_date', to)
    .order('effective_date', { ascending: false })
    .limit(10);
  if (state) narrativeQuery = narrativeQuery.eq('state_abbr', state);
  const { data: narratives, error: narError } = await narrativeQuery;
  if (narError) console.error('[hunt-api/date] narrative error:', narError.message);

  // Build grouped response
  const grouped: Record<string, unknown[]> = {};
  let totalEntries = 0;
  for (const { domain, entries } of perType) {
    if (entries.length > 0) {
      grouped[domain] = entries;
      totalEntries += entries.length;
    }
  }

  return successResponse(req, {
    date,
    state: state || null,
    window: { from, to },
    entries_found: totalEntries,
    domains: grouped,
    brain_narratives: narratives || [],
  });
}

// ─── Similar Endpoint ───────────────────────────────────────────────────────

async function handleSimilar(req: Request, params: {
  date: string;
  state?: string;
  top_k?: number;
}): Promise<Response> {
  const { date, state, top_k } = params;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse(req, 'Valid date required (YYYY-MM-DD)');
  }

  const supabase = createSupabaseClient();
  const k = Math.min(top_k || 5, 20);

  // Step 1: Get entries from the target date (diverse content types)
  const d = new Date(date);
  const from = new Date(d.getTime() - 1 * 86400000).toISOString().split('T')[0];
  const to = new Date(d.getTime() + 1 * 86400000).toISOString().split('T')[0];

  let seedQuery = supabase
    .from('hunt_knowledge')
    .select('content, content_type')
    .gte('effective_date', from)
    .lte('effective_date', to)
    .order('created_at', { ascending: false })
    .limit(20);
  if (state) seedQuery = seedQuery.eq('state_abbr', state);
  const { data: seedEntries, error: seedError } = await seedQuery;

  if (seedError) {
    console.error('[hunt-api/similar] seed query error:', seedError.message);
    return errorResponse(req, 'Failed to fetch seed data', 500);
  }

  if (!seedEntries || seedEntries.length === 0) {
    return successResponse(req, {
      query_date: date,
      state: state || null,
      similar_dates: [],
      message: 'No data found for this date to generate similarity query',
    });
  }

  // Pick first 5 by content diversity
  const seen = new Set<string>();
  const diverse: typeof seedEntries = [];
  for (const entry of seedEntries) {
    if (!seen.has(entry.content_type)) {
      seen.add(entry.content_type);
      diverse.push(entry);
      if (diverse.length >= 5) break;
    }
  }

  // Step 2: Generate embedding from concatenated content
  const combined = diverse.map(e => e.content).join('\n\n').slice(0, 4000);
  let embedding: number[];
  try {
    embedding = await generateEmbedding(combined, 'query');
  } catch (err) {
    console.error('[hunt-api/similar] embedding error:', err);
    return errorResponse(req, 'Failed to generate embedding', 500);
  }

  // Step 3: Vector search excluding the target date range (±3 days)
  const excludeFrom = new Date(d.getTime() - 3 * 86400000).toISOString().split('T')[0];
  const excludeTo = new Date(d.getTime() + 3 * 86400000).toISOString().split('T')[0];

  // Use date_from/date_to to search outside the exclusion window
  // We search in two windows: before excludeFrom and after excludeTo
  // Use the broader search and then filter out the excluded range
  const { data: vectorResults, error: vecError } = await supabase.rpc('search_hunt_knowledge_v3', {
    query_embedding: embedding,
    match_threshold: 0.3,
    match_count: k * 10, // fetch extra to have enough after date grouping
    filter_content_types: null,
    filter_state_abbr: state || null,
    filter_species: null,
    filter_date_from: null,
    filter_date_to: null,
    recency_weight: 0.0,
    exclude_du_report: true,
  });

  if (vecError) {
    console.error('[hunt-api/similar] vector search error:', vecError.message);
    return errorResponse(req, 'Vector search failed', 500);
  }

  // Filter out entries in the excluded date range and group by effective_date
  type VecResult = {
    id: string;
    title: string;
    content: string;
    content_type: string;
    state_abbr: string;
    effective_date: string;
    similarity: number;
  };

  const filtered = (vectorResults as VecResult[] || []).filter(r => {
    if (!r.effective_date) return false;
    return r.effective_date < excludeFrom || r.effective_date > excludeTo;
  });

  // Group by effective_date
  const byDate: Record<string, VecResult[]> = {};
  for (const r of filtered) {
    const key = r.effective_date;
    if (!byDate[key]) byDate[key] = [];
    byDate[key].push(r);
  }

  // Score each date by average similarity, take top_k
  const scoredDates = Object.entries(byDate)
    .map(([dt, entries]) => ({
      date: dt,
      similarity: entries.reduce((sum, e) => sum + e.similarity, 0) / entries.length,
      domains_active: [...new Set(entries.map(e => e.content_type))],
      key_events: entries.slice(0, 3).map(e => ({
        title: e.title,
        content_type: e.content_type,
        similarity: e.similarity,
      })),
      entry_count: entries.length,
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, k);

  return successResponse(req, {
    query_date: date,
    state: state || null,
    similar_dates: scoredDates,
  });
}

// ─── Narratives Endpoint ────────────────────────────────────────────────────

async function handleNarratives(req: Request, params: {
  state?: string;
  limit?: number;
}): Promise<Response> {
  const { state, limit: maxResults } = params;
  const resultLimit = Math.min(maxResults || 10, 50);

  const supabase = createSupabaseClient();

  let q = supabase
    .from('hunt_knowledge')
    .select('id, title, content, content_type, state_abbr, effective_date, confidence, metadata')
    .eq('content_type', 'brain-narrative')
    .order('effective_date', { ascending: false })
    .limit(resultLimit);
  if (state) q = q.eq('state_abbr', state);

  const { data, error } = await q;
  if (error) {
    console.error('[hunt-api/narratives] error:', error.message);
    return errorResponse(req, 'Failed to fetch narratives', 500);
  }

  const narratives = (data || []).map(entry => ({
    id: entry.id,
    title: entry.title,
    content: entry.content,
    confidence: entry.confidence,
    state: entry.state_abbr,
    date: entry.effective_date,
    metadata: entry.metadata,
  }));

  return successResponse(req, { narratives });
}

// ─── Router ─────────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405);

    const body = await req.json();
    const { endpoint } = body;

    if (!endpoint) return errorResponse(req, 'endpoint required');

    switch (endpoint) {
      case 'date':
        return await handleDate(req, {
          date: body.date,
          state: body.state,
          domains: Array.isArray(body.domains) ? body.domains : undefined,
        });

      case 'similar':
        return await handleSimilar(req, {
          date: body.date,
          state: body.state,
          top_k: body.top_k,
        });

      case 'narratives':
        return await handleNarratives(req, {
          state: body.state,
          limit: body.limit,
        });

      default:
        return errorResponse(req, `Unknown endpoint: ${endpoint}. Valid: date, similar, narratives`);
    }
  } catch (error) {
    console.error('[hunt-api]', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});
