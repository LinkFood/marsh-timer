import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { logCronRun } from '../_shared/cronLog.ts';

const FUNCTION_NAME = 'hunt-synthesis-reviewer';

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const startTime = Date.now();
  const supabase = createSupabaseClient();

  try {
    // Fetch active syntheses
    const { data: syntheses } = await supabase
      .from('hunt_knowledge')
      .select('id, title, state_abbr, metadata, signal_weight, created_at')
      .eq('content_type', 'ai-synthesis')
      .order('created_at', { ascending: false })
      .limit(200);

    if (!syntheses || syntheses.length === 0) {
      await logCronRun({ functionName: FUNCTION_NAME, status: 'success', summary: { reviewed: 0 }, durationMs: Date.now() - startTime });
      return successResponse(req, { reviewed: 0 });
    }

    let reinforced = 0, challenged = 0, superseded = 0, archived = 0;

    for (const syn of syntheses) {
      const meta = syn.metadata || {};
      const status = meta.status || 'active';
      if (status !== 'active' && status !== 'challenged') continue;

      const createdAt = new Date(syn.created_at);
      const daysSince = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

      // Check for newer synthesis in same state
      if (syn.state_abbr) {
        const { data: newer } = await supabase
          .from('hunt_knowledge')
          .select('id')
          .eq('content_type', 'ai-synthesis')
          .eq('state_abbr', syn.state_abbr)
          .gt('created_at', syn.created_at)
          .limit(1);

        if (newer && newer.length > 0 && newer[0].id !== syn.id) {
          await supabase.from('hunt_knowledge').update({
            signal_weight: 0.5,
            metadata: { ...meta, status: 'superseded', superseded_by: newer[0].id, reviewed_at: new Date().toISOString() },
          }).eq('id', syn.id);
          superseded++;
          continue;
        }
      }

      // Check for new data that reinforces
      const { count: newDataCount } = await supabase
        .from('hunt_knowledge')
        .select('*', { count: 'exact', head: true })
        .eq('state_abbr', syn.state_abbr)
        .neq('content_type', 'ai-synthesis')
        .gt('created_at', syn.created_at);

      if (newDataCount && newDataCount > 5) {
        // New data landed — reinforce
        const confirmations = (meta.confirmations || 0) + 1;
        const newWeight = Math.min(2.0, (syn.signal_weight || 1.0) + 0.1);
        await supabase.from('hunt_knowledge').update({
          signal_weight: newWeight,
          metadata: { ...meta, confirmations, status: 'active', reviewed_at: new Date().toISOString() },
        }).eq('id', syn.id);
        reinforced++;
      } else if (daysSince > 30 && (meta.confirmations || 0) === 0) {
        // Old with no confirmations — archive
        await supabase.from('hunt_knowledge').update({
          signal_weight: 0.25,
          metadata: { ...meta, status: 'archived', reviewed_at: new Date().toISOString() },
        }).eq('id', syn.id);
        archived++;
      }
    }

    const summary = { reviewed: syntheses.length, reinforced, challenged, superseded, archived };
    await logCronRun({ functionName: FUNCTION_NAME, status: 'success', summary, durationMs: Date.now() - startTime });
    return successResponse(req, summary);
  } catch (err: any) {
    await logCronRun({ functionName: FUNCTION_NAME, status: 'error', errorMessage: err.message, durationMs: Date.now() - startTime });
    return errorResponse(req, err.message, 500);
  }
});
