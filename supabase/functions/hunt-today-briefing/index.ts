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

    // Build "this day" queries: one per sampled year
    const YEARS_TO_CHECK = [
      1955, 1960, 1965, 1970, 1975, 1980, 1985, 1990, 1995,
      2000, 2005, 2010, 2015, 2020, 2025,
    ];
    const historyQueries = YEARS_TO_CHECK.map(yr => {
      const dateStr = `${yr}-${mm}-${dd}`;
      return supabase
        .from('hunt_knowledge')
        .select('title, content, content_type, state_abbr, effective_date, metadata')
        .eq('effective_date', dateStr)
        .in('content_type', HISTORY_TYPES)
        .order('signal_weight', { ascending: false })
        .limit(2);
    });

    // Fire ALL queries in parallel
    const [
      weatherRes,
      solunarRes,
      convergenceRes,
      claimsRes,
      anomaliesRes,
      brainTotalRes,
      entriesTodayRes,
      ...historyResults
    ] = await Promise.all([
      // 1. Current weather for this state
      supabase
        .from('hunt_knowledge')
        .select('title, content, content_type, metadata, created_at')
        .eq('state_abbr', stateAbbr)
        .in('content_type', ['weather-realtime', 'weather-forecast', 'weather-event'])
        .order('created_at', { ascending: false })
        .limit(5),

      // 2. Solunar for today
      supabase
        .from('hunt_solunar_precomputed')
        .select('*')
        .eq('date', today)
        .limit(1),

      // 3. Convergence score
      supabase
        .from('hunt_convergence_scores')
        .select('score, date, weather_component, solunar_component, migration_component, pattern_component, birdcast_component, water_component, photoperiod_component, tide_component')
        .eq('state_abbr', stateAbbr)
        .order('date', { ascending: false })
        .limit(1),

      // 4. Claims & grades
      supabase
        .from('hunt_alert_outcomes')
        .select('id, alert_source, state_abbr, alert_date, predicted_outcome, outcome_deadline, outcome_checked, outcome_grade, outcome_reasoning, created_at')
        .or(`state_abbr.eq.${stateAbbr},state_abbr.is.null`)
        .order('created_at', { ascending: false })
        .limit(10),

      // 5. Anomalies (last 48h)
      supabase
        .from('hunt_knowledge')
        .select('id, title, content, content_type, metadata, created_at')
        .eq('state_abbr', stateAbbr)
        .in('content_type', ['anomaly-alert', 'convergence-score', 'correlation-discovery', 'compound-risk-alert'])
        .gte('created_at', fortyEightHoursAgo)
        .order('created_at', { ascending: false })
        .limit(5),

      // 6. Brain total (estimated)
      supabase
        .from('hunt_knowledge')
        .select('id', { count: 'estimated', head: true }),

      // 7. Entries added today
      supabase
        .from('hunt_knowledge')
        .select('id', { count: 'estimated', head: true })
        .gte('created_at', todayStart),

      // 8+. History queries (one per year)
      ...historyQueries,
    ]);

    // --- Parse current weather ---
    const weatherRows = Array.isArray(weatherRes.data) ? weatherRes.data : [];
    let current_weather = null;
    if (weatherRows.length > 0) {
      const w = weatherRows[0];
      const m = (w.metadata || {}) as Record<string, any>;
      current_weather = {
        temperature_f: m.temperature_f ?? m.temp_f ?? m.temperature ?? null,
        conditions: m.conditions ?? m.sky_condition ?? m.weather ?? w.title ?? '',
        wind_mph: m.wind_mph ?? m.wind_speed ?? null,
        wind_direction: m.wind_direction ?? m.wind_dir ?? '',
        pressure_mb: m.pressure_mb ?? m.slp ?? m.altimeter ?? null,
        humidity_pct: m.humidity_pct ?? m.relative_humidity ?? null,
        dewpoint_f: m.dewpoint_f ?? m.dewpoint ?? null,
        visibility_mi: m.visibility_mi ?? m.visibility ?? null,
        cloud_cover_pct: m.cloud_cover_pct ?? m.cloud_cover ?? null,
      };
    }

    // --- Parse solunar ---
    let solunar = null;
    const solRow = solunarRes.data?.[0];
    if (solRow) {
      solunar = {
        moon_phase: solRow.moon_phase ?? solRow.phase_name ?? '',
        moon_illumination: solRow.illumination ?? solRow.moon_illumination ?? 0,
        next_major: solRow.major_1 ?? solRow.next_major ?? '',
        next_minor: solRow.minor_1 ?? solRow.next_minor ?? '',
        rating: solRow.rating ?? solRow.overall_rating ?? 'fair',
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

    // --- Parse this day in history ---
    const this_day_history: Array<{
      year: number;
      content_type: string;
      summary: string;
      state_abbr: string | null;
      metadata: Record<string, unknown> | null;
    }> = [];
    const seenYears = new Set<string>();

    for (const res of historyResults) {
      if (!res.data || !Array.isArray(res.data)) continue;
      for (const entry of res.data) {
        const yr = entry.effective_date?.split('-')[0];
        if (!yr) continue;
        const key = `${yr}-${entry.content_type}`;
        if (seenYears.has(key)) continue;
        seenYears.add(key);
        this_day_history.push({
          year: parseInt(yr, 10),
          content_type: entry.content_type || '',
          summary: entry.title || (entry.content || '').slice(0, 150),
          state_abbr: entry.state_abbr || null,
          metadata: entry.metadata || null,
        });
      }
    }
    this_day_history.sort((a, b) => a.year - b.year);

    // --- Parse claims/grades ---
    const claims_grades = (Array.isArray(claimsRes.data) ? claimsRes.data : []).map((c: any) => ({
      id: c.id,
      claim_text: c.predicted_outcome || c.alert_source || 'Unknown claim',
      status: c.outcome_grade
        ? c.outcome_grade
        : (c.outcome_checked ? 'missed' : 'watching'),
      deadline: c.outcome_deadline || null,
      grade_reason: c.outcome_reasoning || null,
      accuracy_pct: null,
      created_at: c.created_at,
    }));

    // --- Parse anomalies ---
    const anomalies = (Array.isArray(anomaliesRes.data) ? anomaliesRes.data : []).map((a: any) => {
      const m = (a.metadata || {}) as Record<string, any>;
      const domains: string[] = [];
      if (a.content_type === 'correlation-discovery' && m.domains) {
        domains.push(...(Array.isArray(m.domains) ? m.domains : [String(m.domains)]));
      } else if (a.content_type === 'compound-risk-alert' && m.converging_domains) {
        domains.push(...(Array.isArray(m.converging_domains) ? m.converging_domains : []));
      } else {
        const ct = a.content_type.replace('-', ' ');
        domains.push(ct);
      }
      return {
        id: a.id,
        description: a.title || (a.content || '').slice(0, 120),
        domains,
        severity: a.metadata?.severity ?? 1,
        detected_at: a.created_at,
      };
    });

    // --- Brain stats ---
    const brain_stats = {
      total_entries: brainTotalRes.count ?? 0,
      content_types: 83, // approximate, avoid slow query
      entries_today: entriesTodayRes.count ?? 0,
    };

    return new Response(JSON.stringify({
      current_weather,
      solunar,
      convergence,
      this_day_history,
      claims_grades,
      anomalies,
      brain_stats,
    }), { headers: jsonHeaders });
  } catch (err) {
    console.error('[hunt-today-briefing] Fatal:', err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    }), { status: 500, headers: jsonHeaders });
  }
});
