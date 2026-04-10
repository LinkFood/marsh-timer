import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(req.url);
    const stateAbbr = url.searchParams.get('state')?.toUpperCase();

    if (!stateAbbr || !/^[A-Z]{2}$/.test(stateAbbr)) {
      return new Response(JSON.stringify({ error: 'Missing ?state=XX' }), {
        status: 400, headers: jsonHeaders,
      });
    }

    const supabase = createSupabaseClient();
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const fortyEightHoursAgo = new Date(now.getTime() - 48 * 3600_000).toISOString();
    const todayStart = today + 'T00:00:00Z';

    // All content types we want for "this day in history"
    const HISTORY_TYPES = [
      'storm-event', 'earthquake-event', 'climate-index', 'climate-index-daily',
      'drought-weekly', 'drought-index', 'ghcn-daily', 'astronomical',
      'astronomical-event', 'space-weather', 'geomagnetic-kp', 'noaa-tide',
      'tide-gauge', 'ocean-buoy', 'river-discharge', 'usgs-water',
      'soil-conditions', 'snotel-daily', 'crop-progress', 'snow-cover-monthly',
      'glerl-ice-cover', 'nasa-daily', 'air-quality', 'noaa-coops-water',
    ];

    // Fire queries in parallel with timing
    const t: Record<string, number> = {};
    const s = Date.now;
    function T<X>(n: string, p: PromiseLike<X>): Promise<X> {
      const a = s(); return Promise.resolve(p).then(r => { t[n] = s() - a; return r; });
    }

    // ONLY query small dedicated tables — NO hunt_knowledge (7M rows, too slow)
    // History comes from frontend useThisDayInHistory hook instead
    const [weatherRes, solunarRes, convergenceRes, claimsRes, anomaliesRes] = await Promise.all([
      T('weather', supabase.from('hunt_weather_forecast').select('date, temp_high_f, temp_low_f, wind_speed_max_mph, wind_direction_dominant, pressure_msl, precipitation_mm, weather_code, cloud_cover_pct, updated_at').eq('state_abbr', stateAbbr).eq('date', today).limit(1)),
      T('solunar', supabase.from('hunt_solunar_cache').select('data').eq('date', today).limit(1)),
      T('convergence', supabase.from('hunt_convergence_scores').select('score, date, weather_component, solunar_component, migration_component, pattern_component, birdcast_component, water_component, photoperiod_component, tide_component').eq('state_abbr', stateAbbr).order('date', { ascending: false }).limit(1)),
      T('claims', supabase.from('hunt_alert_outcomes').select('id, alert_source, state_abbr, alert_date, predicted_outcome, outcome_deadline, outcome_checked, outcome_grade, outcome_reasoning, created_at').or(`state_abbr.eq.${stateAbbr},state_abbr.is.null`).order('created_at', { ascending: false }).limit(10)),
      // Anomalies from convergence_alerts (small table) instead of hunt_knowledge
      T('anomalies', supabase.from('hunt_convergence_alerts').select('id, state_abbr, score, domains_active, alert_type, created_at').eq('state_abbr', stateAbbr).order('created_at', { ascending: false }).limit(5)),
    ]);
    console.log('[hunt-today-briefing] Timings:', JSON.stringify(t));

    // --- Parse current weather from forecast table ---
    const weatherRow = Array.isArray(weatherRes.data) && weatherRes.data.length > 0
      ? weatherRes.data[0] as Record<string, any>
      : null;
    let current_weather = null;
    if (weatherRow) {
      // WMO weather codes → conditions text
      const WMO: Record<number, string> = {
        0: 'Clear', 1: 'Mostly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
        45: 'Foggy', 48: 'Freezing Fog', 51: 'Light Drizzle', 53: 'Drizzle',
        55: 'Heavy Drizzle', 61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
        71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow', 80: 'Rain Showers',
        81: 'Heavy Showers', 82: 'Violent Showers', 85: 'Snow Showers',
        95: 'Thunderstorm', 96: 'T-storm w/ Hail', 99: 'Severe T-storm',
      };
      const windDeg = weatherRow.wind_direction_dominant ?? 0;
      const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
      const windDir = dirs[Math.round(windDeg / 22.5) % 16] || '';

      current_weather = {
        temperature_f: Math.round((weatherRow.temp_high_f + weatherRow.temp_low_f) / 2),
        temp_high_f: Math.round(weatherRow.temp_high_f),
        temp_low_f: Math.round(weatherRow.temp_low_f),
        conditions: WMO[weatherRow.weather_code] ?? `Code ${weatherRow.weather_code}`,
        wind_mph: Math.round(weatherRow.wind_speed_max_mph ?? 0),
        wind_direction: windDir,
        pressure_mb: Math.round(weatherRow.pressure_msl ?? 0),
        humidity_pct: null, // not in forecast table
        dewpoint_f: null,
        visibility_mi: null,
        cloud_cover_pct: weatherRow.cloud_cover_pct ?? null,
        precipitation_mm: weatherRow.precipitation_mm ?? 0,
      };
    }

    // --- Parse solunar from cache ---
    let solunar = null;
    const solRow = solunarRes.data?.[0];
    if (solRow) {
      const solData = typeof solRow.data === 'string' ? JSON.parse(solRow.data) : (solRow.data || {});
      solunar = {
        moon_phase: solData.moon_phase ?? solData.phase ?? '',
        moon_illumination: solData.moon_illumination ?? solData.illumination ?? 0,
        next_major: solData.major_1 ?? solData.next_major ?? '',
        next_minor: solData.minor_1 ?? solData.next_minor ?? '',
        rating: solData.rating ?? solData.overall_rating ?? 'fair',
      };
    }

    // --- Parse convergence ---
    let convergence = null;
    const convRow = convergenceRes.data?.[0];
    if (convRow) {
      convergence = {
        total_score: convRow.score ?? 0,
        components: [
          { domain: 'weather', score: convRow.weather_component ?? 0, max_score: 25, label: 'Weather' },
          { domain: 'migration', score: convRow.migration_component ?? 0, max_score: 25, label: 'Migration' },
          { domain: 'birdcast', score: convRow.birdcast_component ?? 0, max_score: 20, label: 'BirdCast' },
          { domain: 'solunar', score: convRow.solunar_component ?? 0, max_score: 15, label: 'Solunar' },
          { domain: 'water', score: convRow.water_component ?? 0, max_score: 15, label: 'Water' },
          { domain: 'pattern', score: convRow.pattern_component ?? 0, max_score: 15, label: 'Pattern' },
          { domain: 'photoperiod', score: convRow.photoperiod_component ?? 0, max_score: 10, label: 'Photoperiod' },
          { domain: 'tide', score: convRow.tide_component ?? 0, max_score: 10, label: 'Tide' },
        ],
      };
    }

    // History handled by frontend useThisDayInHistory hook
    const this_day_history: any[] = [];

    // --- Parse claims/grades ---
    const claims_grades = (Array.isArray(claimsRes.data) ? claimsRes.data : []).map((c: any) => {
      // predicted_outcome can be a string or an object with .claim
      let claimText = '';
      if (typeof c.predicted_outcome === 'string') {
        claimText = c.predicted_outcome;
      } else if (c.predicted_outcome?.claim) {
        claimText = c.predicted_outcome.claim;
      } else {
        claimText = c.alert_source || 'Unknown claim';
      }
      return {
        id: c.id,
        claim_text: claimText,
        status: c.outcome_grade
          ? c.outcome_grade
          : (c.outcome_checked ? 'missed' : 'watching'),
        deadline: c.outcome_deadline || null,
        grade_reason: c.outcome_reasoning || null,
        accuracy_pct: null,
        created_at: c.created_at,
      };
    });

    // --- Parse anomalies from convergence_alerts ---
    const anomalies = (Array.isArray(anomaliesRes.data) ? anomaliesRes.data : []).map((a: any) => ({
      id: a.id,
      description: `${a.alert_type || 'Convergence'}: ${stateAbbr} — ${a.domains_active || 0} domains (score ${a.score || '?'})`,
      domains: [],
      severity: (a.score || 0) > 80 ? 3 : (a.score || 0) > 50 ? 2 : 1,
      detected_at: a.created_at,
    }));

    // --- Brain stats (from header BrainHeartbeat, no slow hunt_knowledge query) ---
    const brain_stats = {
      total_entries: 6955000, // approximate, updated by BrainHeartbeat component
      content_types: 83,
      entries_today: 0,
    };

    return new Response(JSON.stringify({
      current_weather,
      solunar,
      convergence,
      this_day_history,
      claims_grades,
      anomalies,
      brain_stats,
      _timings: t,
    }), { headers: jsonHeaders });
  } catch (err) {
    console.error('[hunt-today-briefing] Fatal:', err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    }), { status: 500, headers: jsonHeaders });
  }
});
