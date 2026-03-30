import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

// Cron definitions — duplicated from hunt-cron-health to avoid network hop
const EXPECTED_CRONS = [
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
  { name: 'hunt-birdweather', schedule: 'daily 5:30am', critical: false },
  { name: 'hunt-snow-cover', schedule: 'daily 7am', critical: false },
  { name: 'hunt-snotel', schedule: 'daily 8am', critical: false },
  { name: 'hunt-gbif', schedule: 'daily 9:45am', critical: false },
  { name: 'hunt-multi-species', schedule: 'daily 11am', critical: false },
  { name: 'hunt-search-trends', schedule: 'daily 12pm', critical: false },
  { name: 'hunt-query-signal', schedule: 'daily 11pm', critical: false },
  { name: 'hunt-power-outage', schedule: 'every 6hr', critical: false },
  { name: 'hunt-climate-indices', schedule: 'weekly Mon 11am', critical: false },
  { name: 'hunt-movebank', schedule: 'weekly Mon 2pm', critical: false },
  { name: 'hunt-phenology', schedule: 'weekly Wed 9am', critical: false },
  { name: 'hunt-crop-progress', schedule: 'weekly Fri 2pm', critical: false },
  { name: 'hunt-historical-news', schedule: 'weekly Sat 8am', critical: false },
  { name: 'hunt-usfws-survey', schedule: 'monthly 1st 6am', critical: false },
  { name: 'hunt-drought-monitor', schedule: 'weekly Tue 7am', critical: false },
  { name: 'hunt-inaturalist', schedule: 'weekly Wed 11am', critical: false },
  { name: 'hunt-river-discharge', schedule: 'daily 5am', critical: false },
  { name: 'hunt-soil-monitor', schedule: 'daily 5:30am', critical: false },
  { name: 'hunt-air-quality', schedule: 'daily 6:15am', critical: false },
  { name: 'hunt-wildfire-perimeters', schedule: 'daily 8:30am', critical: false },
  { name: 'hunt-ocean-buoy', schedule: 'every 6hr', critical: false },
  { name: 'hunt-space-weather', schedule: 'every 6hr', critical: false },
  { name: 'hunt-arc-narrator', schedule: 'daily 9am', critical: false },
  { name: 'hunt-murmuration-index', schedule: 'daily', critical: false },
];

const CRON_NAMES = EXPECTED_CRONS.map(c => c.name);

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createSupabaseClient();

    // Run all queries in parallel — heavy stats read from precomputed cache
    const [
      brainEstimate,
      growthToday,
      cachedGrowth,
      cachedTypes,
      alertPerf,
      discoveries,
      scans,
      cronLogs,
    ] = await Promise.all([
      // 1. Brain total — approximate count from pg_class
      supabase.rpc('hunt_ops_brain_total'),

      // 2. Growth today (estimated count — avoids full scan)
      supabase
        .from('hunt_knowledge')
        .select('id', { count: 'estimated', head: true })
        .gte('created_at', new Date().toISOString().slice(0, 10)),

      // 3. Growth by day — from precomputed cache (instant)
      supabase
        .from('hunt_ops_cache')
        .select('value')
        .eq('key', 'growth_by_day')
        .single(),

      // 4. Content type breakdown — from precomputed cache (instant)
      supabase
        .from('hunt_ops_cache')
        .select('value')
        .eq('key', 'content_types')
        .single(),

      // 5. Alert performance (30d)
      supabase.rpc('hunt_ops_alert_performance'),

      // 6. Discoveries
      supabase.rpc('hunt_ops_discoveries'),

      // 7. Convergence scans (last 20)
      supabase
        .from('hunt_cron_log')
        .select('function_name, status, summary, error_message, created_at, duration_ms')
        .eq('function_name', 'hunt-convergence-scan')
        .order('created_at', { ascending: false })
        .limit(20),

      // 8. Cron logs — placeholder (per-function queries below)
      Promise.resolve({ data: null }),
    ]);

    // Per-function cron log queries — all in parallel (avoids global LIMIT skewing)
    const cronLogResults = (await Promise.all(
      CRON_NAMES.map(name =>
        supabase
          .from('hunt_cron_log')
          .select('*')
          .eq('function_name', name)
          .order('created_at', { ascending: false })
          .limit(5)
          .then(res => res.data || [])
      )
    )).flat();

    // Build cron health (same logic as hunt-cron-health)
    const latest: Record<string, any> = {};
    const history: Record<string, any[]> = {};
    for (const log of cronLogResults) {
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

    const cronHealth = EXPECTED_CRONS.map(cron => {
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

    // Assemble response — table-returning RPCs return arrays, grab first row
    const alertData = Array.isArray(alertPerf.data) ? alertPerf.data[0] : alertPerf.data;
    const discoveryData = Array.isArray(discoveries.data) ? discoveries.data[0] : discoveries.data;
    const total30d = alertData?.total_30d ?? 0;
    const confirmed = alertData?.confirmed ?? 0;
    const partial = alertData?.partial ?? 0;

    return successResponse(req, {
      brain: {
        total: brainEstimate.data ?? 0,
        growth_today: growthToday.count ?? 0,
        growth_by_day: cachedGrowth.data?.value ?? [],
        content_types: cachedTypes.data?.value ?? [],
      },
      crons: {
        crons: cronHealth,
        healthy_count: cronHealth.filter(h => h.health === 'healthy').length,
        error_count: cronHealth.filter(h => h.health === 'error').length,
        late_count: cronHealth.filter(h => h.health === 'late').length,
        unknown_count: cronHealth.filter(h => h.health === 'unknown' || h.health === 'never_run').length,
      },
      alerts: {
        total_30d: total30d,
        confirmed,
        partial,
        missed: alertData?.missed ?? 0,
        false_alarm: alertData?.false_alarm ?? 0,
        pending: alertData?.pending ?? 0,
        accuracy: total30d > 0 ? Math.round(((confirmed + partial) / total30d) * 1000) / 10 : 0,
      },
      discoveries: {
        pending: discoveryData?.pending ?? 0,
        embedded: discoveryData?.embedded ?? 0,
        skipped: discoveryData?.skipped ?? 0,
      },
      scans: scans.data ?? [],
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[hunt-ops-dashboard] Fatal error:', err);
    return errorResponse(req, 'Internal server error', 500);
  }
});
