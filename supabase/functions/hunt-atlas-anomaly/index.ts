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
  value: number | null;          // most-recent recorded avg-high for this day-of-year (°F)
  as_of_year: number | null;     // the year that `value` was recorded
  baseline_mean: number | null;  // mean of prior years (°F)
  baseline_std: number | null;   // sample std of prior years (°F)
  z: number | null;              // (value - baseline_mean) / baseline_std
  n_years: number;               // count of baseline (prior-year) observations
}

function round(n: number | null, dp = 2): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// Resolve target month-day. Accepts YYYY-MM-DD, MM-DD, or MM/DD. Defaults to today (UTC).
function resolveMonthDay(dateParam: string | null): { mm: string; dd: string } | null {
  if (!dateParam) {
    const now = new Date();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    return { mm, dd };
  }
  const m = dateParam.match(/(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})$/);
  if (!m) return null;
  const mm = m[1].padStart(2, '0');
  const dd = m[2].padStart(2, '0');
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;
  return { mm, dd };
}

function computeStateResult(abbr: string, obs: StateAgg): StateResult {
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
  };
  if (obs.length === 0) return base;

  // Sort ascending by year; the latest year is the "defendant", the rest are the baseline.
  obs.sort((a, b) => a.year - b.year);
  const latest = obs[obs.length - 1];
  const baseline = obs.slice(0, obs.length - 1);

  base.value = round(latest.value);
  base.as_of_year = latest.year;
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

    const md = resolveMonthDay(dateParam);
    if (!md) {
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
    for (let y = FIRST_YEAR; y <= thisYear; y++) dateList.push(`${y}-${md.mm}-${md.dd}`);

    // Group parsed observations by state.
    const byState = new Map<string, StateAgg>();

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

      const { data, error } = await q;
      if (error) {
        return new Response(
          JSON.stringify({ error: `Query failed: ${error.message}` }),
          { status: 502, headers: jsonHeaders },
        );
      }
      if (!data || data.length === 0) break;

      for (const row of data) {
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

      if (data.length < PAGE_SIZE) break;
    }

    const targetStates = stateParam ? [stateParam] : Object.keys(STATE_CENTROIDS);
    const states = targetStates
      .map((abbr) => computeStateResult(abbr, byState.get(abbr) ?? []))
      .sort((a, b) => (Math.abs(b.z ?? 0) - Math.abs(a.z ?? 0)));

    const withData = states.filter((s) => s.value !== null).length;

    return new Response(
      JSON.stringify({
        metric: 'avg_high_f',
        month_day: `${md.mm}-${md.dd}`,
        resolution: 'state',
        source: 'ghcn-daily',
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
