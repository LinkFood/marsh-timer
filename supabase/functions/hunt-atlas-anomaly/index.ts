// hunt-atlas-anomaly — Atlas Rung 2: the state-level weather-anomaly trigger.
//
// READ-ONLY. For a given date (default: today), computes each state's
// weather anomaly as a z-score of its most-recent recorded avg-high for that
// day-of-year vs that same state's own GHCN-daily history for the same
// month-day across all recorded years (1950 → present).
//
// Honest by construction (Vision honesty laws):
//   - Fires on recorded fact only (no forecast).
//   - Carries its own denominator: n_years, baseline_mean, baseline_std.
//   - State-level resolution ONLY. GHCN-daily in the archive is aggregated
//     per state (state_abbr, no per-station lat/lng), so this is a STATE dot,
//     explicitly labeled resolution:"state". Sub-state drill needs station data.
//
// Data source: hunt_knowledge rows where content_type = 'ghcn-daily'.
// Each row is one state-day, e.g.:
//   "On July 5, 2025, Virginia recorded an average high of 86°F and low of
//    63.2°F across 113 reporting stations. ..."
// effective_date is the calendar date; avg-high is parsed from content.
//
// Query strategy (READ-ONLY, no precompute table — a table would be a WRITE):
//   Build the explicit list of YYYY-MM-DD for the target month-day across every
//   year and pull with effective_date=in.(...). One paginated query covers all
//   states; grouped + reduced in code. ~3.8k rows total, sub-second.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';
import { handleCors, getCorsHeaders } from '../_shared/cors.ts';
import { STATE_CENTROIDS } from '../_shared/states.ts';

const FIRST_YEAR = 1950;           // GHCN-daily archive floor in hunt_knowledge
const MIN_YEARS = 5;               // below this, baseline is too thin — z stays null
const PAGE_SIZE = 1000;            // PostgREST hard cap per request
const MAX_PAGES = 8;               // safety bound (8k rows >> 50 states x ~80 years)
const AVG_HIGH_RE = /average high of ([\d.]+)\s*°?F/i;

type StateAgg = { year: number; value: number }[];

interface StateResult {
  state: string;
  name: string;
  lat: number;
  lng: number;
  resolution: 'state';
  value: number | null;          // observed day-0 avg-high for this day-of-year (°F)
  as_of_year: number | null;     // the year that `value` was recorded
  baseline_mean: number | null;  // mean of baseline years (°F)
  baseline_std: number | null;   // sample std of baseline years (°F)
  z: number | null;              // (value - baseline_mean) / baseline_std
  n_years: number;               // count of baseline observations
  // 'live' = actual target-day reading from hunt_weather_history; 'live-yesterday' =
  // yesterday's reading (today's row not posted yet); 'archive' = most-recent GHCN year.
  day0_source: 'live' | 'live-yesterday' | 'archive';
  as_of_date: string | null;     // the calendar date `value` was recorded (today / yesterday / latest GHCN year)
}

function round(n: number | null, dp = 2): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function isoPlusDays(iso: string, days: number): string {
  const dt = new Date(iso + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

// Resolve target date. Accepts YYYY-MM-DD, MM-DD, or MM/DD. Defaults to today (UTC).
// The year matters now: past the GHCN archive edge, day-0 comes from the live feed.
function resolveTargetDate(dateParam: string | null): { year: number; mm: string; dd: string } | null {
  const now = new Date();
  const thisYear = now.getUTCFullYear();
  if (!dateParam) {
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return { year: thisYear, mm, dd };
  }
  const m = dateParam.match(/(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})$/);
  if (!m) return null;
  const year = m[1] ? parseInt(m[1], 10) : thisYear;
  const mm = m[2].padStart(2, '0');
  const dd = m[3].padStart(2, '0');
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;
  return { year, mm, dd };
}

// liveTemp: the actual recorded high for the target date from hunt_weather_history
// (null when the row is missing or we're at/before the GHCN edge for this state).
function computeStateResult(
  abbr: string,
  obs: StateAgg,
  targetYear: number,
  targetIso: string,
  yesterdayIso: string,
  liveTemp: number | null,
  yesterdayTemp: number | null,
): StateResult {
  const centroid = STATE_CENTROIDS[abbr];
  const base: StateResult = {
    state: abbr,
    name: centroid?.name ?? abbr,
    lat: centroid?.lat ?? 0,
    lng: centroid?.lng ?? 0,
    resolution: 'state',
    value: null,
    as_of_year: null,
    baseline_mean: null,
    baseline_std: null,
    z: null,
    n_years: 0,
    day0_source: 'archive',
    as_of_date: null,
  };
  if (obs.length === 0) return base;

  // Sort ascending by year; the latest year is the most-recent GHCN reading.
  obs.sort((a, b) => a.year - b.year);
  const latest = obs[obs.length - 1];

  // Past the GHCN archive edge for this day-of-year (target year beyond the latest
  // recorded GHCN year): day-0 is the live station feed. Fallback chain — today's
  // reading → yesterday's reading (labeled) → the GHCN defendant (below). The live
  // observation is measured against the full GHCN distribution (every year baseline).
  const pastEdge = targetYear > latest.year;
  const haveToday = liveTemp !== null && Number.isFinite(liveTemp);
  const haveYesterday = yesterdayTemp !== null && Number.isFinite(yesterdayTemp);
  if (pastEdge && (haveToday || haveYesterday)) {
    const useYesterday = !haveToday;
    const observed = (useYesterday ? yesterdayTemp : liveTemp) as number;
    base.value = round(observed);
    base.as_of_year = targetYear;
    base.as_of_date = useYesterday ? yesterdayIso : targetIso;
    base.day0_source = useYesterday ? 'live-yesterday' : 'live';
    base.n_years = obs.length;
    if (obs.length < MIN_YEARS) return base;
    const mean = obs.reduce((s, o) => s + o.value, 0) / obs.length;
    const variance = obs.reduce((s, o) => s + (o.value - mean) ** 2, 0) / (obs.length - 1);
    const std = Math.sqrt(variance);
    base.baseline_mean = round(mean);
    base.baseline_std = round(std);
    base.z = std > 0 ? round((observed - mean) / std) : null;
    return base;
  }

  // At or before the edge — unchanged: latest year is the "defendant", the rest are the baseline.
  const baseline = obs.slice(0, obs.length - 1);
  base.value = round(latest.value);
  base.as_of_year = latest.year;
  base.as_of_date = `${latest.year}-${targetIso.slice(5)}`;
  base.n_years = baseline.length;

  if (baseline.length < MIN_YEARS) return base;

  const mean = baseline.reduce((s, o) => s + o.value, 0) / baseline.length;
  const variance =
    baseline.reduce((s, o) => s + (o.value - mean) ** 2, 0) / (baseline.length - 1);
  const std = Math.sqrt(variance);

  base.baseline_mean = round(mean);
  base.baseline_std = round(std);
  base.z = std > 0 ? round((latest.value - mean) / std) : null;
  return base;
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const jsonHeaders = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };

  try {
    const url = new URL(req.url);
    const stateParam = url.searchParams.get('state')?.toUpperCase().trim() || null;
    const dateParam = url.searchParams.get('date');

    const target = resolveTargetDate(dateParam);
    if (!target) {
      return new Response(
        JSON.stringify({ error: 'Invalid date. Use YYYY-MM-DD or MM-DD.' }),
        { status: 400, headers: jsonHeaders },
      );
    }
    if (stateParam && !STATE_CENTROIDS[stateParam]) {
      return new Response(
        JSON.stringify({ error: `Unknown state '${stateParam}'.` }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Explicit per-year date list for this month-day (date column can't LIKE).
    const thisYear = new Date().getUTCFullYear();
    const dateList: string[] = [];
    for (let y = FIRST_YEAR; y <= thisYear; y++) dateList.push(`${y}-${target.mm}-${target.dd}`);

    // Day-0 for dates past the GHCN archive edge: the actual recorded high from
    // hunt_weather_history (cron-fed daily, current through yesterday). Small table
    // — one bounded read of BOTH target + yesterday (the fallback: today's row →
    // yesterday's, labeled → GHCN defendant). Fired in parallel with the page pulls.
    const targetIso = `${target.year}-${target.mm}-${target.dd}`;
    const yesterdayIso = isoPlusDays(targetIso, -1);
    const whPromise = (async () => {
      let wq = supabase
        .from('hunt_weather_history')
        .select('state_abbr, date, temp_high_f')
        .in('date', [targetIso, yesterdayIso]);
      if (stateParam) wq = wq.eq('state_abbr', stateParam);
      return await wq;
    })();

    // GHCN page pulls fired in parallel — each .range() slice is ordered and
    // self-contained, so parallel firing keeps deterministic pages while
    // collapsing the serial round-trips into one wall-clock wait.
    const pagePromises = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let q = supabase
        .from('hunt_knowledge')
        .select('state_abbr, effective_date, content')
        .eq('content_type', 'ghcn-daily')
        .in('effective_date', dateList)
        .order('effective_date', { ascending: true })
        .range(from, to);
      if (stateParam) q = q.eq('state_abbr', stateParam);
      pagePromises.push(q);
    }
    const pageResults = await Promise.all(pagePromises);

    // Group parsed observations by state.
    const byState = new Map<string, StateAgg>();
    for (const { data, error } of pageResults) {
      if (error) {
        return new Response(
          JSON.stringify({ error: `Query failed: ${error.message}` }),
          { status: 502, headers: jsonHeaders },
        );
      }
      for (const row of data ?? []) {
        const abbr = row.state_abbr as string | null;
        if (!abbr || !STATE_CENTROIDS[abbr]) continue;
        const m = String(row.content ?? '').match(AVG_HIGH_RE);
        if (!m) continue;
        const value = parseFloat(m[1]);
        if (!Number.isFinite(value)) continue;
        const year = parseInt(String(row.effective_date).slice(0, 4), 10);
        if (!Number.isFinite(year)) continue;
        if (!byState.has(abbr)) byState.set(abbr, []);
        byState.get(abbr)!.push({ year, value });
      }
    }

    // Collect the live day-0 readings — today's and yesterday's — per state.
    const liveByState = new Map<string, number>();
    const yesterdayByState = new Map<string, number>();
    {
      const { data: whData, error: whErr } = await whPromise;
      if (whErr) console.error('weather_history query failed:', whErr.message);
      for (const r of whData ?? []) {
        const abbr = r.state_abbr as string | null;
        const t = r.temp_high_f;
        if (!abbr || typeof t !== 'number' || !Number.isFinite(t)) continue;
        const d = String(r.date).slice(0, 10);
        if (d === targetIso) liveByState.set(abbr, t);
        else if (d === yesterdayIso) yesterdayByState.set(abbr, t);
      }
    }

    const targetStates = stateParam ? [stateParam] : Object.keys(STATE_CENTROIDS);
    const states = targetStates
      .map((abbr) => computeStateResult(
        abbr, byState.get(abbr) ?? [], target.year, targetIso, yesterdayIso,
        liveByState.get(abbr) ?? null, yesterdayByState.get(abbr) ?? null,
      ))
      .sort((a, b) => (Math.abs(b.z ?? 0) - Math.abs(a.z ?? 0)));

    const withData = states.filter((s) => s.value !== null).length;

    return new Response(
      JSON.stringify({
        metric: 'avg_high_f',
        month_day: `${target.mm}-${target.dd}`,
        target_date: targetIso,
        resolution: 'state',
        source: 'ghcn-daily',
        live_source: 'hunt_weather_history',
        baseline: 'per-state historical avg-high for this day-of-year, 1950 → present',
        min_years: MIN_YEARS,
        generated_at: new Date().toISOString(),
        count: states.length,
        count_with_data: withData,
        states,
      }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `Unexpected error: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
