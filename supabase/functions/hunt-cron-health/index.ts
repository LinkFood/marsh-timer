import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createSupabaseClient();

    // Get latest run for each function
    const { data: logs, error } = await supabase
      .from('hunt_cron_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('[hunt-cron-health] Query error:', error);
      return errorResponse(req, 'Failed to query cron logs', 500);
    }

    // Group by function name, take latest per function
    const latest: Record<string, any> = {};
    const history: Record<string, any[]> = {};

    for (const log of (logs || [])) {
      if (!latest[log.function_name]) {
        latest[log.function_name] = log;
      }
      if (!history[log.function_name]) {
        history[log.function_name] = [];
      }
      if (history[log.function_name].length < 5) {
        history[log.function_name].push(log);
      }
    }

    // Expected crons and their schedules
    const expected = [
      { name: 'hunt-weather-watchdog', schedule: 'daily 6am', critical: true },
      { name: 'hunt-weather-realtime', schedule: 'every 15 min', critical: true },
      { name: 'hunt-nws-monitor', schedule: 'every 3hr', critical: true },
      { name: 'hunt-migration-monitor', schedule: 'daily 7am', critical: true },
      { name: 'hunt-birdcast', schedule: 'daily', critical: false },
      { name: 'hunt-nasa-power', schedule: 'daily 6:30am', critical: false },
      { name: 'hunt-convergence-engine', schedule: 'daily 8am', critical: true },
      { name: 'hunt-scout-report', schedule: 'daily 9am', critical: false },
      { name: 'hunt-convergence-alerts', schedule: 'daily 8:15am', critical: false },
      { name: 'hunt-forecast-tracker', schedule: 'daily 10am', critical: true },
      { name: 'hunt-migration-report-card', schedule: 'daily 11am', critical: false },
      { name: 'hunt-convergence-report-card', schedule: 'weekly Sun noon', critical: false },
      { name: 'hunt-du-map', schedule: 'weekly', critical: false },
      { name: 'hunt-du-alerts', schedule: 'weekly', critical: false },
    ];

    const health = expected.map(cron => {
      const last = latest[cron.name];
      const age = last ? (Date.now() - new Date(last.created_at).getTime()) / (1000 * 60 * 60) : null;

      let healthStatus = 'unknown';
      if (!last) {
        healthStatus = 'never_run';
      } else if (last.status === 'error') {
        healthStatus = 'error';
      } else if (cron.schedule.includes('15 min') && age && age > 0.5) {
        healthStatus = 'late';
      } else if (cron.schedule.includes('daily') && age && age > 26) {
        healthStatus = 'late';
      } else if (cron.schedule.includes('3hr') && age && age > 4) {
        healthStatus = 'late';
      } else {
        healthStatus = 'healthy';
      }

      return {
        name: cron.name,
        schedule: cron.schedule,
        critical: cron.critical,
        health: healthStatus,
        last_run: last?.created_at || null,
        last_status: last?.status || null,
        last_summary: last?.summary || null,
        hours_ago: age ? Math.round(age * 10) / 10 : null,
        recent_history: (history[cron.name] || []).map(h => ({
          status: h.status,
          when: h.created_at,
          summary: h.summary,
        })),
      };
    });

    return successResponse(req, {
      crons: health,
      healthy_count: health.filter(h => h.health === 'healthy').length,
      error_count: health.filter(h => h.health === 'error').length,
      late_count: health.filter(h => h.health === 'late').length,
      unknown_count: health.filter(h => h.health === 'unknown' || h.health === 'never_run').length,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[hunt-cron-health] Fatal error:', err);
    return errorResponse(req, 'Internal server error', 500);
  }
});
