import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const body = await req.json().catch(() => ({}));
    const filterState = body.state_abbr || null;
    const filterType = body.content_type || null;
    const limit = Math.min(body.limit || 50, 100);

    const supabase = createSupabaseClient();
    const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();

    const INTEL_TYPES = [
      'correlation-discovery',
      'anomaly-alert',
      'alert-grade',
      'disaster-watch',
      'migration-spike-extreme',
      'migration-spike-significant',
    ];

    let query = supabase
      .from('hunt_knowledge')
      .select('id, title, content, content_type, state_abbr, metadata, created_at')
      .in('content_type', filterType ? [filterType] : INTEL_TYPES)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (filterState) {
      query = query.eq('state_abbr', filterState);
    }

    const { data, error } = await query;

    if (error) {
      return errorResponse(req, error.message, 500);
    }

    // Truncate content to 200 chars for feed display
    const items = (data || []).map(row => ({
      ...row,
      content: row.content?.length > 200 ? row.content.slice(0, 200) + '...' : row.content,
    }));

    // Sort by created_at
    const combined = [...items]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, limit);

    return successResponse(req, combined);
  } catch (err) {
    return errorResponse(req, err instanceof Error ? err.message : 'Internal error', 500);
  }
});
