// hunt-atlas-spot — Atlas spot dossier: the archive half of a spot's NOW + PAST.
//
// READ-ONLY. Given a state (required, 2-letter) and an optional date (default
// today), returns everything the archive knows about that place right now and
// what it rhymes with in its own recorded history. The hero surface of the map:
// zoom to a spot → this is what the spot is doing, and what it's done before.
//
// Honest by construction (Vision honesty laws):
//   - Fires on recorded fact only (never a forecast). Every number traces to a
//     source row and carries its resolution label.
//   - GHCN-daily is STATE-LEVEL in the archive (state_abbr, no per-station
//     lat/lng) — so weather + front are explicitly labeled resolution:"state".
//   - The rhyme carries its denominator: the z-score's n_years/baseline, and
//     the pool the "days like today" list was drawn from.
//   - Data floors are honest: GHCN in the archive runs 1950 → ~2025-12; the
//     latest recorded year for the target day-of-year is the "defendant" (as_of).
//
// Sources:
//   - ghcn-daily  : weather NOW, the front signal, the anomaly + rhyme baseline.
//   - tide-gauge  : nearest coastal gauge reading (NOAA CO-OPS), nearest by
//                   state/lat-lng centroid — the archive holds ~22 gauges.
//   - nws-alert   : recent official alert count for the state.
//
// Query strategy (READ-ONLY, no precompute — a table would be a WRITE):
//   One paginated pull of a ±3-day day-of-year window across all years for the
//   state (~530 rows) powers weather NOW, the front trend, the anomaly z-score,
//   the rhyme pool, AND the lineup's temp component at once. Side queries: the
//   same-window tide-gauge pull (the lineup's tide component), tide snapshot,
//   nws-alert count. Moon age is pure math (zero queries). All state-scoped,
//   all sub-second.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';
import { handleCors, getCorsHeaders } from '../_shared/cors.ts';
import { STATE_CENTROIDS } from '../_shared/states.ts';

const FIRST_YEAR = 1950;        // GHCN-daily archive floor in hunt_knowledge
const MIN_YEARS = 5;            // below this the baseline is too thin — z stays null
const WINDOW_DAYS = 3;          // ±N day-of-year window for the front + rhyme pool
const RHYME_LIMIT = 5;          // how many "days like today" to surface
const PAGE_SIZE = 1000;         // PostgREST hard cap per request
const MAX_PAGES = 4;            // safety bound (±3d × ~76yr ≈ 530 rows for one state)
const FRONT_DROP_F = 8;         // avg-high fall (°F) over the window that reads as a front
const TIDE_RECENT_FROM = '2025-11-25'; // recent tide snapshot floor (archive edge ~2025-12)
const ALERT_LOOKBACK_DAYS = 30; // "recent" window for nws-alert count

// LINEUP ("last time the moon, the tide, and the cold lined up like this"):
const MOON_TOL_DAYS = 2;        // ±days of moon age that reads as "same moon"
const TEMP_TOL_F = 5;           // pool anomaly must be within this of today's anomaly
const TEMP_NEAR_F = 2;          // |anomaly| below this reads as "near normal"
const TIDE_ELEV_FT = 0.5;       // |residual| at/above this reads as off-predicted
const LINEUP_MIN_TIDE_DAYS = 60; // fewer joint tide days than this → moon×temp fallback

const AVG_HIGH_RE = /average high of ([\d.]+)\s*°?F/i;
const AVG_LOW_RE = /low of ([\d.]+)\s*°?F/i;
const STATIONS_RE = /across (\d+) reporting stations/i;
const PRECIP_RE = /average of ([\d.]+)\s*inches of precipitation/i;
const NO_PRECIP_RE = /No measurable precipitation/i;

interface DayObs {
  date: string;   // YYYY-MM-DD
  year: number;
  offset: number; // day-of-year offset from the target (−3..+3)
  high: number | null;
  low: number | null;
  precip: number | null;     // inches; 0 when "no measurable"
  stations: number | null;
}

function round(n: number | null, dp = 2): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function resolveTargetDate(dateParam: string | null): { iso: string; mm: string; dd: string } | null {
  let y: number, mo: number, d: number;
  if (!dateParam) {
    const now = new Date();
    y = now.getUTCFullYear(); mo = now.getUTCMonth() + 1; d = now.getUTCDate();
  } else {
    const m = dateParam.match(/(?:(\d{4})[-/])?(\d{1,2})[-/](\d{1,2})$/);
    if (!m) return null;
    y = m[1] ? parseInt(m[1], 10) : new Date().getUTCFullYear();
    mo = parseInt(m[2], 10); d = parseInt(m[3], 10);
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const mm = String(mo).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return { iso: `${y}-${mm}-${dd}`, mm, dd };
}

// ---------------------------------------------------------------------------
// MOON math — lifted from hunt-atlas-solunar (Schlyter low-precision lunar
// theory, longitude terms only). Pure computation, zero I/O: geocentric moon
// ecliptic longitude + sun longitude → elongation → age in days since new.
// Good to well under the ±MOON_TOL_DAYS bucket used for the lineup.
// ---------------------------------------------------------------------------
const SYNODIC = 29.530588853; // days, mean synodic month
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
const rev = (x: number): number => ((x % 360) + 360) % 360;
const sind = (d: number): number => Math.sin(d * DEG);
const cosd = (d: number): number => Math.cos(d * DEG);
const atan2d = (y: number, x: number): number => Math.atan2(y, x) * RAD;

function moonLonEcl(jd: number): number {
  const d = jd - 2451543.5; // Schlyter epoch (2000 Jan 0.0)

  // Sun (needed for perturbations)
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = rev(356.0470 + 0.9856002585 * d);
  const Ls = rev(ws + Ms);

  // Moon orbital elements
  const N = 125.1228 - 0.0529538083 * d;
  const i = 5.1454;
  const w = 318.0634 + 0.1643573223 * d;
  const a = 60.2666; // Earth radii
  const ecc = 0.054900;
  const M = rev(115.3654 + 13.0649929509 * d);

  // Eccentric anomaly (iterate)
  let E = M + RAD * ecc * sind(M) * (1 + ecc * cosd(M));
  for (let k = 0; k < 6; k++) {
    E = E - (E - RAD * ecc * sind(E) - M) / (1 - ecc * cosd(E));
  }

  // Position in orbital plane → geocentric ecliptic longitude
  const x = a * (cosd(E) - ecc);
  const yy = a * Math.sqrt(1 - ecc * ecc) * sind(E);
  const r = Math.sqrt(x * x + yy * yy);
  const v = rev(atan2d(yy, x));
  const xeclip = r * (cosd(N) * cosd(v + w) - sind(N) * sind(v + w) * cosd(i));
  const yeclip = r * (sind(N) * cosd(v + w) + cosd(N) * sind(v + w) * cosd(i));
  let lon = rev(atan2d(yeclip, xeclip));

  // Perturbation arguments
  const Lm = rev(N + w + M);   // Moon mean longitude
  const Mm = M;                // Moon mean anomaly
  const D = rev(Lm - Ls);      // Mean elongation
  const F = rev(Lm - N);       // Argument of latitude

  // Longitude perturbations (degrees)
  lon +=
    -1.274 * sind(Mm - 2 * D) +
    0.658 * sind(2 * D) +
    -0.186 * sind(Ms) +
    -0.059 * sind(2 * Mm - 2 * D) +
    -0.057 * sind(Mm - 2 * D + Ms) +
    0.053 * sind(Mm + 2 * D) +
    0.046 * sind(2 * D - Ms) +
    0.041 * sind(Mm - Ms) +
    -0.035 * sind(D) +
    -0.031 * sind(Mm + Ms) +
    -0.015 * sind(2 * F - 2 * D) +
    0.011 * sind(Mm - 4 * D);

  return rev(lon);
}

function sunLongitude(jd: number): number {
  const d = jd - 2451543.5;
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = rev(356.0470 + 0.9856002585 * d);
  const ecc = 0.016709 - 1.151e-9 * d;
  let E = Ms + RAD * ecc * sind(Ms) * (1 + ecc * cosd(Ms));
  for (let k = 0; k < 5; k++) {
    E = E - (E - RAD * ecc * sind(E) - Ms) / (1 - ecc * cosd(E));
  }
  const xv = cosd(E) - ecc;
  const yv = Math.sqrt(1 - ecc * ecc) * sind(E);
  const v = rev(atan2d(yv, xv));
  return rev(v + ws);
}

/** Moon age (days since new, 0..29.5) at 12:00 UTC of an ISO date. */
function moonAgeOnDate(iso: string): number {
  const jd = Date.parse(`${iso}T12:00:00Z`) / 86400000 + 2440587.5;
  const elong = rev(moonLonEcl(jd) - sunLongitude(jd)); // 0 new, 180 full
  return (elong / 360) * SYNODIC;
}

/** Circular distance between two moon ages (days, on the synodic cycle). */
function moonAgeDist(a: number, b: number): number {
  const d = Math.abs(a - b) % SYNODIC;
  return Math.min(d, SYNODIC - d);
}

function moonPhaseName(age: number): string {
  if (age < 1.84566) return 'New Moon';
  if (age < 5.53699) return 'Waxing Crescent';
  if (age < 9.22831) return 'First Quarter';
  if (age < 12.91963) return 'Waxing Gibbous';
  if (age < 16.61096) return 'Full Moon';
  if (age < 20.30228) return 'Waning Gibbous';
  if (age < 23.99361) return 'Last Quarter';
  if (age < 27.68493) return 'Waning Crescent';
  return 'New Moon';
}

function haversineish(aLat: number, aLng: number, bLat: number, bLng: number): number {
  // Cheap squared planar distance (good enough for nearest-neighbor ranking).
  const dLat = aLat - bLat;
  const dLng = (aLng - bLng) * Math.cos((aLat + bLat) / 2 * Math.PI / 180);
  return dLat * dLat + dLng * dLng;
}

function parseGhcn(content: string): { high: number | null; low: number | null; precip: number | null; stations: number | null } {
  const c = String(content ?? '');
  const hm = c.match(AVG_HIGH_RE);
  const lm = c.match(AVG_LOW_RE);
  const sm = c.match(STATIONS_RE);
  const pm = c.match(PRECIP_RE);
  const high = hm ? parseFloat(hm[1]) : null;
  const low = lm ? parseFloat(lm[1]) : null;
  const stations = sm ? parseInt(sm[1], 10) : null;
  let precip: number | null = null;
  if (pm) precip = parseFloat(pm[1]);
  else if (NO_PRECIP_RE.test(c)) precip = 0;
  return {
    high: Number.isFinite(high as number) ? high : null,
    low: Number.isFinite(low as number) ? low : null,
    precip: Number.isFinite(precip as number) ? precip : null,
    stations: Number.isFinite(stations as number) ? stations : null,
  };
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;
  const jsonHeaders = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };

  try {
    const url = new URL(req.url);
    const stateParam = url.searchParams.get('state')?.toUpperCase().trim() || null;
    const dateParam = url.searchParams.get('date');
    const latParam = url.searchParams.get('lat');
    const lngParam = url.searchParams.get('lng');

    if (!stateParam) {
      return new Response(JSON.stringify({ error: 'Missing required ?state= (2-letter).' }),
        { status: 400, headers: jsonHeaders });
    }
    const centroid = STATE_CENTROIDS[stateParam];
    if (!centroid) {
      return new Response(JSON.stringify({ error: `Unknown state '${stateParam}'.` }),
        { status: 400, headers: jsonHeaders });
    }
    const target = resolveTargetDate(dateParam);
    if (!target) {
      return new Response(JSON.stringify({ error: 'Invalid date. Use YYYY-MM-DD or MM-DD.' }),
        { status: 400, headers: jsonHeaders });
    }

    const lat = latParam !== null && Number.isFinite(+latParam) ? +latParam : centroid.lat;
    const lng = lngParam !== null && Number.isFinite(+lngParam) ? +lngParam : centroid.lng;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ---- Build the ±WINDOW_DAYS day-of-year date list across all years -------
    const thisYear = new Date().getUTCFullYear();
    const dateSet = new Set<string>();
    const offsetOf = new Map<string, number>(); // iso -> day-of-year offset
    for (let y = FIRST_YEAR; y <= thisYear; y++) {
      for (let off = -WINDOW_DAYS; off <= WINDOW_DAYS; off++) {
        const dt = new Date(Date.UTC(y, +target.mm - 1, +target.dd));
        dt.setUTCDate(dt.getUTCDate() + off);
        const iso = dt.toISOString().slice(0, 10);
        dateSet.add(iso);
        offsetOf.set(iso, off);
      }
    }
    const dateList = Array.from(dateSet);

    // ---- One paginated pull of the state's window rows -----------------------
    const obs: DayObs[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const { data, error } = await supabase
        .from('hunt_knowledge')
        .select('effective_date, content')
        .eq('content_type', 'ghcn-daily')
        .eq('state_abbr', stateParam)
        .in('effective_date', dateList)
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        return new Response(JSON.stringify({ error: `Weather query failed: ${error.message}` }),
          { status: 502, headers: jsonHeaders });
      }
      if (!data || data.length === 0) break;
      for (const row of data) {
        const iso = String(row.effective_date).slice(0, 10);
        const off = offsetOf.get(iso);
        if (off === undefined) continue;
        const p = parseGhcn(row.content as string);
        obs.push({
          date: iso,
          year: parseInt(iso.slice(0, 4), 10),
          offset: off,
          high: p.high, low: p.low, precip: p.precip, stations: p.stations,
        });
      }
      if (data.length < PAGE_SIZE) break;
    }

    // ---- ANOMALY (exact day-of-year, most-recent year = defendant) -----------
    const exact = obs.filter((o) => o.offset === 0 && o.high !== null)
      .sort((a, b) => a.year - b.year);
    let anomaly: Record<string, unknown> = {
      metric: 'avg_high_f',
      value: null, as_of_year: null,
      baseline_mean: null, baseline_std: null, z: null, n_years: 0,
      resolution: 'state', min_years: MIN_YEARS,
      baseline: `per-state avg-high for ${target.mm}-${target.dd}, ${FIRST_YEAR} → present`,
    };
    let defendant: DayObs | null = null;
    if (exact.length > 0) {
      defendant = exact[exact.length - 1];
      const baseline = exact.slice(0, exact.length - 1);
      anomaly.value = round(defendant.high);
      anomaly.as_of_year = defendant.year;
      anomaly.n_years = baseline.length;
      if (baseline.length >= MIN_YEARS) {
        const mean = baseline.reduce((s, o) => s + (o.high as number), 0) / baseline.length;
        const variance = baseline.reduce((s, o) => s + ((o.high as number) - mean) ** 2, 0) / (baseline.length - 1);
        const std = Math.sqrt(variance);
        anomaly.baseline_mean = round(mean);
        anomaly.baseline_std = round(std);
        anomaly.z = std > 0 ? round(((defendant.high as number) - mean) / std) : null;
      }
    }

    // ---- WEATHER NOW (the defendant day) -------------------------------------
    const weather = defendant ? {
      as_of_date: defendant.date,
      avg_high_f: round(defendant.high),
      avg_low_f: round(defendant.low),
      precip_in: round(defendant.precip),
      station_count: defendant.stations,
      resolution: 'state',
      label: 'state-level (GHCN-daily)',
      note: `Most recent recorded ${target.mm}-${target.dd} for ${centroid.name} (archive edge ~2025-12).`,
    } : null;

    // ---- FRONT signal (the defendant year's 3-day run-up) --------------------
    let front: Record<string, unknown> = {
      signal: 'unknown', temp_change_f: null, precip_recent_in: null,
      window: [], resolution: 'state',
      note: 'Not enough recent recorded days to read a front.',
    };
    if (defendant) {
      const run = obs
        .filter((o) => o.year === defendant!.year && o.offset <= 0 && o.high !== null)
        .sort((a, b) => a.offset - b.offset);
      if (run.length >= 2) {
        const first = run[0].high as number;
        const last = run[run.length - 1].high as number;
        const highs = run.map((o) => o.high as number);
        const maxHigh = Math.max(...highs);
        const change = last - first;                 // negative = cooling
        const dropFromPeak = maxHigh - last;         // positive = cooled off the peak
        const precipRecent = run[run.length - 1].precip ?? 0;
        let signal: string;
        if (dropFromPeak >= FRONT_DROP_F) signal = 'front_passing';
        else if (change <= -3) signal = 'cooling';
        else if (change >= 3) signal = 'warming';
        else signal = 'steady';
        front = {
          signal,
          temp_change_f: round(change),
          drop_from_peak_f: round(dropFromPeak),
          precip_recent_in: round(precipRecent),
          window: run.map((o) => ({ date: o.date, high: round(o.high), low: round(o.low), precip: round(o.precip) })),
          resolution: 'state',
          note: signal === 'front_passing'
            ? `Avg-high fell ${round(dropFromPeak)}°F off its recent peak${precipRecent > 0.05 ? ` with ${round(precipRecent)}" rain` : ''} — reads as a front moving through.`
            : signal === 'cooling' ? `Cooling trend (${round(change)}°F over ${run.length} days).`
            : signal === 'warming' ? `Warming trend (+${round(change)}°F over ${run.length} days).`
            : 'Temperatures steady — no front signal.',
        };
      }
    }

    // ---- RHYME ("days like today here") --------------------------------------
    // Pool = the whole ±window across years, excluding the defendant day itself.
    // Ranked by |avg-high − today's value|; the closest are what today rhymes with.
    let rhyme: Array<Record<string, unknown>> = [];
    if (defendant && defendant.high !== null) {
      const todayHigh = defendant.high as number;
      const pool = obs.filter((o) =>
        o.high !== null && !(o.year === defendant!.year && o.offset === 0));
      pool.sort((a, b) =>
        Math.abs((a.high as number) - todayHigh) - Math.abs((b.high as number) - todayHigh));
      const picked = pool.slice(0, RHYME_LIMIT);

      // One side query for notable content_types on the picked rhyme dates.
      const rhymeDates = picked.map((o) => o.date);
      const notableByDate = new Map<string, string[]>();
      if (rhymeDates.length > 0) {
        const { data: notable } = await supabase
          .from('hunt_knowledge')
          .select('effective_date, content_type')
          .eq('state_abbr', stateParam)
          .in('effective_date', rhymeDates)
          .neq('content_type', 'ghcn-daily')
          .limit(500);
        for (const r of notable ?? []) {
          const iso = String(r.effective_date).slice(0, 10);
          if (!notableByDate.has(iso)) notableByDate.set(iso, []);
          const arr = notableByDate.get(iso)!;
          const ct = r.content_type as string;
          if (!arr.includes(ct)) arr.push(ct);
        }
      }

      rhyme = picked.map((o) => {
        const delta = round((o.high as number) - todayHigh);
        const types = (notableByDate.get(o.date) ?? []).slice(0, 6);
        return {
          date: o.date,
          high: round(o.high),
          delta_f: delta,
          precip_in: round(o.precip),
          also_recorded: types,
          note: `Avg high ${round(o.high)}°F (${(delta ?? 0) >= 0 ? '+' : ''}${delta}°F vs today)`
            + (types.length ? ` — also on file: ${types.join(', ')}.` : '.'),
        };
      });
    }

    // ---- LINEUP ("last time the moon, the tide, and the cold lined up") -----
    // The dossier's lead sentence. Joint match over the SAME ±window pool:
    // computed moon age (pure math, zero gaps) × GHCN temp anomaly (state) ×
    // observed tide residual (this state's own gauge, if it has one). Inland
    // states fall back to moon×temp and SAY so. Zero matches is a valid,
    // honest output — "never in N recorded years" is emitted as fact, not
    // padded into a fake match.
    let lineup: Record<string, unknown> | null = null;
    if (defendant) {
      // Per-offset day-of-year mean high — the anomaly baseline for pool days.
      const offSum = new Map<number, { s: number; n: number }>();
      for (const o of obs) {
        if (o.high === null) continue;
        const cur = offSum.get(o.offset) ?? { s: 0, n: 0 };
        cur.s += o.high; cur.n += 1;
        offSum.set(o.offset, cur);
      }
      const offMean = (off: number): number | null => {
        const c = offSum.get(off);
        return c && c.n >= MIN_YEARS ? c.s / c.n : null;
      };

      // Tide pool: same DOY window, this state's own gauge history (if any).
      // One paginated pull; if the state has multiple gauges, keep the one
      // with the deepest record in the window.
      const byStation = new Map<string, Map<string, number>>(); // sid -> date -> residual
      const stationName = new Map<string, string>();
      for (let page = 0; page < MAX_PAGES; page++) {
        const from = page * PAGE_SIZE;
        const { data, error } = await supabase
          .from('hunt_knowledge')
          .select('effective_date, metadata')
          .eq('content_type', 'tide-gauge')
          .eq('state_abbr', stateParam)
          .in('effective_date', dateList)
          .range(from, from + PAGE_SIZE - 1);
        if (error || !data || data.length === 0) break;
        for (const r of data) {
          const md = (r.metadata ?? {}) as Record<string, unknown>;
          const sid = String(md.station_id ?? md.station_name ?? '');
          const res = Number(md.residual_ft);
          if (!sid || !Number.isFinite(res)) continue;
          const iso = String(r.effective_date).slice(0, 10);
          if (!byStation.has(sid)) byStation.set(sid, new Map());
          byStation.get(sid)!.set(iso, res);
          if (md.station_name) stationName.set(sid, String(md.station_name));
        }
        if (data.length < PAGE_SIZE) break;
      }
      let bestSid: string | null = null;
      for (const sid of byStation.keys()) {
        if (!bestSid || byStation.get(sid)!.size > byStation.get(bestSid)!.size) bestSid = sid;
      }
      const tidePool = bestSid ? byStation.get(bestSid)! : new Map<string, number>();
      const tideStation = bestSid ? (stationName.get(bestSid) ?? bestSid) : null;

      // "Today", honestly: moon is computed for the target date itself (pure
      // math, no gap); temp is the defendant day (most recent recorded); tide
      // is the gauge's most recent recorded day in the window.
      const moonToday = moonAgeOnDate(target.iso);
      const meanAtZero = offMean(0);
      const tempAnomToday = meanAtZero !== null ? (defendant.high as number) - meanAtZero : null;
      let tideToday: { date: string; residual: number } | null = null;
      for (const [iso, res] of tidePool) {
        if (!tideToday || iso > tideToday.date) tideToday = { date: iso, residual: res };
      }
      const useTide = tidePool.size >= LINEUP_MIN_TIDE_DAYS && tideToday !== null;

      if (tempAnomToday !== null) {
        const tempMatch = (anom: number): boolean =>
          Math.abs(tempAnomToday) < TEMP_NEAR_F
            ? Math.abs(anom) < TEMP_NEAR_F
            : Math.sign(anom) === Math.sign(tempAnomToday) && Math.abs(anom - tempAnomToday) <= TEMP_TOL_F;
        const tideMatch = (res: number): boolean =>
          Math.abs(tideToday!.residual) < TIDE_ELEV_FT
            ? Math.abs(res) < TIDE_ELEV_FT
            : Math.sign(res) === Math.sign(tideToday!.residual) && Math.abs(res) >= TIDE_ELEV_FT;

        // Candidates: every pool day outside the defendant year that has all
        // the components this lineup uses. That count IS the denominator.
        const years = new Set<number>();
        let searched = 0;
        const matches: Array<Record<string, unknown>> = [];
        for (const o of obs) {
          if (o.year === defendant.year || o.high === null) continue;
          const m = offMean(o.offset);
          if (m === null) continue;
          const res = useTide ? tidePool.get(o.date) : undefined;
          if (useTide && res === undefined) continue;
          searched++;
          years.add(o.year);
          const anom = (o.high as number) - m;
          if (!tempMatch(anom)) continue;
          if (useTide && !tideMatch(res as number)) continue;
          const age = moonAgeOnDate(o.date);
          if (moonAgeDist(age, moonToday) > MOON_TOL_DAYS) continue;
          matches.push({
            date: o.date,
            moon_age: round(age),
            temp_anomaly_f: round(anom, 1),
            tide_residual_ft: useTide ? round(res as number) : null,
          });
        }
        matches.sort((a, b) => (a.date as string) < (b.date as string) ? 1 : -1);
        const nYears = years.size;

        const moonPhrase = `moon age within ±${MOON_TOL_DAYS} days of ${round(moonToday, 1)} (${moonPhaseName(moonToday)})`;
        const tempPhrase = Math.abs(tempAnomToday) < TEMP_NEAR_F
          ? `avg-high within ${TEMP_NEAR_F}°F of normal (near normal, like today)`
          : `avg-high ${tempAnomToday > 0 ? 'above' : 'below'} normal, within ${TEMP_TOL_F}°F of today's ${round(tempAnomToday, 1)}°F anomaly`;
        const tidePhrase = !useTide ? null
          : Math.abs((tideToday as { residual: number }).residual) < TIDE_ELEV_FT
            ? `tide within ${TIDE_ELEV_FT} ft of predicted (near predicted, like today) at ${tideStation}`
            : `tide ${(tideToday as { residual: number }).residual > 0 ? 'above' : 'below'} predicted by ≥${TIDE_ELEV_FT} ft at ${tideStation}`;

        lineup = {
          mode: useTide ? 'moon_tide_temp' : 'moon_temp',
          components: useTide ? ['moon', 'tide', 'temperature'] : ['moon', 'temperature'],
          last_date: matches.length > 0 ? matches[0].date : null,
          n_matches: matches.length,
          n_years: nYears,
          n_days_searched: searched,
          matches: matches.slice(0, 10),
          today: {
            moon_date: target.iso,
            moon_age: round(moonToday),
            moon_phase: moonPhaseName(moonToday),
            temp_anomaly_f: round(tempAnomToday, 1),
            temp_as_of: defendant.date,
            tide_residual_ft: useTide ? round((tideToday as { residual: number }).residual) : null,
            tide_as_of: useTide ? (tideToday as { date: string }).date : null,
            tide_station: useTide ? tideStation : null,
          },
          thresholds: {
            moon_age_tol_days: MOON_TOL_DAYS,
            temp_tol_f: TEMP_TOL_F,
            temp_near_f: TEMP_NEAR_F,
            tide_elev_ft: TIDE_ELEV_FT,
          },
          resolution: useTide ? 'state (temp) + station (tide)' : 'state',
          honest_note:
            `Match = ${[moonPhrase, tempPhrase, tidePhrase].filter(Boolean).join('; ')}. `
            + `Searched ${searched} recorded days across ${nYears} years (±${WINDOW_DAYS} days of ${target.mm}-${target.dd}, ${FIRST_YEAR} → present).`
            + (useTide ? '' : ` ${centroid.name} has no tide gauge in the archive — lineup is moon × temperature only.`)
            + ` Temperature is state-level; moon is computed astronomy for ${target.iso}; temp as of ${defendant.date}`
            + (useTide ? `; tide as of ${(tideToday as { date: string }).date}.` : '.')
            + ' Recorded fact only — never a forecast.',
        };
      }
    }

    // ---- TIDE NOW (nearest coastal gauge) ------------------------------------
    let tide: Record<string, unknown> | null = null;
    {
      const { data: snap } = await supabase
        .from('hunt_knowledge')
        .select('state_abbr, effective_date, metadata')
        .eq('content_type', 'tide-gauge')
        .gte('effective_date', TIDE_RECENT_FROM)
        .limit(400);
      // Latest reading per station.
      const latestByStation = new Map<string, { state: string; date: string; md: Record<string, unknown> }>();
      for (const r of snap ?? []) {
        const md = (r.metadata ?? {}) as Record<string, unknown>;
        const sid = String(md.station_id ?? md.station_name ?? '');
        if (!sid) continue;
        const date = String(r.effective_date).slice(0, 10);
        const prev = latestByStation.get(sid);
        if (!prev || date > prev.date) latestByStation.set(sid, { state: r.state_abbr as string, date, md });
      }
      // Nearest station by its state centroid to the target point.
      let best: { dist: number; state: string; date: string; md: Record<string, unknown> } | null = null;
      for (const s of latestByStation.values()) {
        const c = STATE_CENTROIDS[s.state];
        if (!c) continue;
        const dist = haversineish(lat, lng, c.lat, c.lng);
        if (!best || dist < best.dist) best = { dist, ...s };
      }
      if (best) {
        const md = best.md;
        const isLocal = best.state === stateParam;
        tide = {
          station_name: md.station_name ?? null,
          station_id: md.station_id ?? null,
          state: best.state,
          is_local: isLocal,
          date: best.date,
          daily_mean_ft: md.daily_mean_ft ?? null,
          predicted_ft: md.predicted_ft ?? null,
          residual_ft: md.residual_ft ?? null,
          datum: md.datum ?? null,
          source: 'noaa-coops',
          resolution: 'station',
          note: isLocal
            ? `${md.station_name} gauge (in ${centroid.name}); reading ${best.date}.`
            : `Nearest coastal gauge is ${md.station_name}, ${best.state} — ${centroid.name} has no gauge in the archive. Reading ${best.date}.`,
        };
      } else {
        tide = null;
      }
    }

    // ---- NWS ALERTS (recent count for the state) -----------------------------
    let alerts: Record<string, unknown> = { count: 0, lookback_days: ALERT_LOOKBACK_DAYS, recent: [] };
    {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - ALERT_LOOKBACK_DAYS);
      const sinceIso = since.toISOString().slice(0, 10);
      const { data: al, count } = await supabase
        .from('hunt_knowledge')
        .select('effective_date, content, metadata', { count: 'exact' })
        .eq('content_type', 'nws-alert')
        .eq('state_abbr', stateParam)
        .gte('effective_date', sinceIso)
        .order('effective_date', { ascending: false })
        .limit(5);
      const recent = (al ?? []).map((r) => {
        const md = (r.metadata ?? {}) as Record<string, unknown>;
        const typeMatch = String(r.content ?? '').match(/type:([^|]+?)\s+severity:/i);
        return {
          date: String(r.effective_date).slice(0, 10),
          type: typeMatch ? typeMatch[1].trim() : null,
          severity: md.severity ?? null,
        };
      });
      alerts = { count: count ?? recent.length, lookback_days: ALERT_LOOKBACK_DAYS, recent };
    }

    // ---- Assemble ------------------------------------------------------------
    return new Response(JSON.stringify({
      spot: {
        state: stateParam,
        name: centroid.name,
        lat, lng,
        used_input_coords: latParam !== null && lngParam !== null,
      },
      target_date: target.iso,
      month_day: `${target.mm}-${target.dd}`,
      generated_at: new Date().toISOString(),
      sources: ['ghcn-daily', 'tide-gauge', 'nws-alert'],
      lineup,
      now: {
        weather,
        front,
        tide,
        alerts,
      },
      past: {
        anomaly,
        rhyme,
        rhyme_pool: {
          window_days: WINDOW_DAYS,
          years: `${FIRST_YEAR} → present`,
          ranked_by: 'closest avg-high to today',
          note: 'Denominator for the rhyme: the pool is every recorded day within ±3 calendar days of this day-of-year across all years; the list is the closest matches by avg-high.',
        },
      },
    }), { status: 200, headers: jsonHeaders });

  } catch (e) {
    return new Response(JSON.stringify({ error: `Unexpected error: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 500, headers: jsonHeaders });
  }
});
