import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== 'POST') return errorResponse(req, 'Method not allowed', 405);

    const { state_abbr, species } = await req.json().catch(() => ({}));
    const supabase = createSupabaseClient();

    const today = new Date();
    const month = today.getMonth() + 1;
    const day = today.getDate();

    const recalls: Array<{ year: number; entries: unknown[] }> = [];

    for (const year of [2021, 2022, 2023, 2024, 2025]) {
      const fromDay = Math.max(1, day - 3);
      const toDay = Math.min(28, day + 3);
      const mm = String(month).padStart(2, '0');
      const from = `${year}-${mm}-${String(fromDay).padStart(2, '0')}`;
      const to = `${year}-${mm}-${String(toDay).padStart(2, '0')}`;

      let query = supabase
        .from('hunt_knowledge')
        .select('id, title, content, content_type, state_abbr, species, effective_date, metadata')
        .gte('effective_date', from)
        .lte('effective_date', to)
        .neq('content_type', 'du_report')
        .order('effective_date', { ascending: false })
        .limit(5);

      if (state_abbr) query = query.eq('state_abbr', state_abbr);
      if (species) query = query.eq('species', species);

      const { data } = await query;
      if (data && data.length > 0) {
        recalls.push({ year, entries: data });
      }
    }

    return successResponse(req, { recalls, date: today.toISOString().split('T')[0] });
  } catch (error) {
    console.error('[hunt-recall]', error);
    return errorResponse(req, 'Internal server error', 500);
  }
});
