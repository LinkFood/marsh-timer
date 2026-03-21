import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';

serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    const supabase = createSupabaseClient();
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get recent high-signal entries
    const { data: recentSignals } = await supabase
      .from('hunt_knowledge')
      .select('title, content_type, state_abbr, metadata, created_at')
      .in('content_type', [
        'nws-alert', 'weather-event', 'migration-spike-extreme',
        'migration-spike-significant', 'anomaly-alert', 'disaster-watch',
        'convergence-score', 'correlation-discovery'
      ])
      .gte('created_at', twentyFourHoursAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(50);

    const prompts: string[] = [];

    // Strategy 1: NWS alerts
    const nwsAlerts = (recentSignals || []).filter(s => s.content_type === 'nws-alert');
    if (nwsAlerts.length > 0) {
      const states = [...new Set(nwsAlerts.map(a => a.state_abbr).filter(Boolean))];
      if (states.length === 1) {
        const alertWords = (nwsAlerts[0]?.title || '').split(' ').slice(0, 2).join(' ');
        prompts.push(`What's causing the ${alertWords.toLowerCase()} in ${states[0]}?`);
      } else if (states.length > 1) {
        prompts.push(`${nwsAlerts.length} weather alerts active across ${states.slice(0, 3).join(', ')} — what's happening?`);
      }
    }

    // Strategy 2: Weather events
    const wxEvents = (recentSignals || []).filter(s => s.content_type === 'weather-event');
    if (wxEvents.length > 0 && prompts.length < 3) {
      const frontPassages = wxEvents.filter(e => e.title?.includes('front') || e.title?.includes('Front'));
      const pressureDrops = wxEvents.filter(e => e.title?.includes('pressure') || e.title?.includes('Pressure'));
      if (frontPassages.length > 0) {
        const state = frontPassages[0].state_abbr;
        if (state) prompts.push(`A front just passed through ${state} — what usually follows?`);
      } else if (pressureDrops.length > 0) {
        prompts.push(`Pressure changes detected in ${pressureDrops.length} stations — what patterns does this match?`);
      }
    }

    // Strategy 3: Migration spikes
    const migSpikes = (recentSignals || []).filter(s =>
      s.content_type === 'migration-spike-extreme' || s.content_type === 'migration-spike-significant'
    );
    if (migSpikes.length > 0 && prompts.length < 3) {
      const state = migSpikes[0].state_abbr;
      if (state) prompts.push(`Migration spike detected in ${state} — what's driving it?`);
    }

    // Strategy 4: Anomalies
    const anomalies = (recentSignals || []).filter(s => s.content_type === 'anomaly-alert');
    if (anomalies.length > 0 && prompts.length < 3) {
      prompts.push(`An anomaly was detected — what's unusual right now?`);
    }

    // Fill with evergreen
    const evergreen = [
      "What's the brain detecting right now?",
      "Which states have the strongest signals today?",
      "Show me the most interesting data from the last 24 hours",
      "How accurate have the brain's predictions been?",
      "What patterns are converging across the country?",
    ];
    let idx = 0;
    while (prompts.length < 4 && idx < evergreen.length) {
      prompts.push(evergreen[idx++]);
    }

    // Get brain stats for welcome state
    const { count: totalEntries } = await supabase
      .from('hunt_knowledge')
      .select('*', { count: 'exact', head: true });

    // Get latest cron timestamp
    const { data: latestCron } = await supabase
      .from('hunt_cron_log')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return successResponse(req, {
      prompts: prompts.slice(0, 4),
      stats: {
        total_entries: totalEntries || 0,
        sources: 21,
        high_signal_count: (recentSignals || []).length,
        alerts_active: nwsAlerts.length,
        last_update: latestCron?.created_at || null,
      }
    });
  } catch (error: any) {
    console.error('[hunt-suggested-prompts]', error);
    return errorResponse(req, error.message || 'Unknown error', 500);
  }
});
