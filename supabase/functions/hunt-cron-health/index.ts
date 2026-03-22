import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createSupabaseClient();

    // Expected cron names — query per function so high-frequency crons
    // (weather-realtime) don't push others out of a global LIMIT
    const cronNames = [
      'hunt-weather-watchdog', 'hunt-weather-realtime', 'hunt-nws-monitor',
      'hunt-migration-monitor', 'hunt-birdcast', 'hunt-nasa-power',
      'hunt-convergence-engine', 'hunt-scout-report', 'hunt-convergence-alerts',
      'hunt-forecast-tracker', 'hunt-migration-report-card',
      'hunt-convergence-report-card', 'hunt-du-map', 'hunt-du-alerts',
      'hunt-web-curator', 'hunt-anomaly-detector', 'hunt-correlation-engine',
      'hunt-alert-grader', 'hunt-alert-calibration', 'hunt-solunar-precompute',
      'hunt-absence-detector', 'hunt-disaster-watch',
      'hunt-convergence-scan', 'hunt-brain-synthesizer', 'hunt-synthesis-reviewer',
      'hunt-convergence-alerts-pm',
      'hunt-birdweather-daily', 'hunt-snow-cover-daily', 'hunt-snotel-daily',
      'hunt-gbif-daily', 'hunt-multi-species-daily', 'hunt-search-trends-daily',
      'hunt-query-signal-daily', 'hunt-power-outage-6h',
      'hunt-climate-indices-weekly', 'hunt-movebank-weekly',
      'hunt-phenology-weekly', 'hunt-crop-progress-weekly',
      'hunt-historical-news-weekly', 'hunt-usfws-survey-monthly',
      'hunt-drought-monitor', 'hunt-inaturalist-weekly',
    ];

    // Fetch last 5 runs per function in one query using IN filter + higher limit
    const { data: logs, error } = await supabase
      .from('hunt_cron_log')
      .select('*')
      .in('function_name', cronNames)
      .order('created_at', { ascending: false })
      .limit(cronNames.length * 5);

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
      { name: 'hunt-nws-monitor', schedule: 'every 1hr', critical: true },
      { name: 'hunt-migration-monitor', schedule: 'daily 7am', critical: true },
      { name: 'hunt-birdcast', schedule: 'daily', critical: false },
      { name: 'hunt-nasa-power', schedule: 'daily 6:30am', critical: false },
      { name: 'hunt-convergence-engine', schedule: 'daily 8am', critical: true },
      { name: 'hunt-scout-report', schedule: 'daily 9am', critical: false },
      { name: 'hunt-convergence-alerts', schedule: 'daily 8:15am', critical: false },
      { name: 'hunt-forecast-tracker', schedule: 'daily 10am', critical: true },
      { name: 'hunt-migration-report-card', schedule: 'daily 11am', critical: false },
      { name: 'hunt-convergence-report-card', schedule: 'weekly Sun noon', critical: false },
      { name: 'hunt-du-map', schedule: 'Mon+Thu noon', critical: false },
      { name: 'hunt-du-alerts', schedule: 'weekly', critical: false },
      { name: 'hunt-web-curator', schedule: 'daily 7am', critical: false },
      { name: 'hunt-anomaly-detector', schedule: 'daily 9:30am', critical: false },
      { name: 'hunt-correlation-engine', schedule: 'daily 10:30am', critical: false },
      { name: 'hunt-alert-grader', schedule: 'daily 11:30am', critical: false },
      { name: 'hunt-alert-calibration', schedule: 'weekly Sun 1pm', critical: false },
      { name: 'hunt-solunar-precompute', schedule: 'weekly Sun 6am', critical: false },
      { name: 'hunt-absence-detector', schedule: 'weekly Sun 2pm', critical: false },
      { name: 'hunt-disaster-watch', schedule: 'Wed+Sat 6am', critical: false },
      { name: 'hunt-convergence-scan', schedule: 'on-demand', critical: false },
      { name: 'hunt-brain-synthesizer', schedule: 'daily 12pm', critical: false },
      { name: 'hunt-synthesis-reviewer', schedule: 'weekly Sun 3pm', critical: false },
      { name: 'hunt-birdweather-daily', schedule: 'daily 5:30am', critical: false },
      { name: 'hunt-snow-cover-daily', schedule: 'daily 7am', critical: false },
      { name: 'hunt-snotel-daily', schedule: 'daily 8am', critical: false },
      { name: 'hunt-gbif-daily', schedule: 'daily 9:45am', critical: false },
      { name: 'hunt-multi-species-daily', schedule: 'daily 11am', critical: false },
      { name: 'hunt-search-trends-daily', schedule: 'daily 12pm', critical: false },
      { name: 'hunt-query-signal-daily', schedule: 'daily 11pm', critical: false },
      { name: 'hunt-power-outage-6h', schedule: 'every 3hr', critical: true },
      { name: 'hunt-climate-indices-weekly', schedule: 'weekly Mon 11am', critical: false },
      { name: 'hunt-movebank-weekly', schedule: 'weekly Mon 2pm', critical: false },
      { name: 'hunt-phenology-weekly', schedule: 'weekly Wed 9am', critical: false },
      { name: 'hunt-crop-progress-weekly', schedule: 'weekly Fri 2pm', critical: false },
      { name: 'hunt-historical-news-weekly', schedule: 'weekly Sat 8am', critical: false },
      { name: 'hunt-usfws-survey-monthly', schedule: 'monthly 1st 6am', critical: false },
      { name: 'hunt-drought-monitor', schedule: 'weekly Tue 7am', critical: false },
      { name: 'hunt-inaturalist-weekly', schedule: 'weekly Wed 11am', critical: false },
      { name: 'hunt-convergence-alerts-pm', schedule: 'daily 4pm', critical: false },
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
