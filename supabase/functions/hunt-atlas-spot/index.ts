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
//   - LIVE layer  : nws-alert / weather-event / compound-risk-alert rows with
//                   effective_date = the ACTUAL today — recorded alerts on file
//                   today (never a forecast; the rows already exist).
//
// Query strategy (READ-ONLY, no precompute — a table would be a WRITE):
//   One paginated pull of a −3..+10 day-of-year window across all years for the
//   state (~1,078 rows) powers weather NOW, the front trend, the anomaly z-score,
//   the rhyme pool, the lineup's temp component, AND the "what followed" trail
//   (next-7-recorded-days aftermath) for every named date at once. The core pool
//   (rhyme/lineup/anomaly) stays ±3; offsets +4..+10 exist only so each pool day
//   carries its own recorded aftermath. Side queries: the same-window tide-gauge
//   pull (the lineup's tide component + per-date residuals), ONE batched on-file
//   provenance query over all named dates, tide snapshot, nws-alert count. Moon
//   age is pure math (zero queries). All state-scoped, all sub-second.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';
import { handleCors, getCorsHeaders } from '../_shared/cors.ts';
import { STATE_CENTROIDS } from '../_shared/states.ts';

const FIRST_YEAR = 1950;        // GHCN-daily archive floor in hunt_knowledge
const MIN_YEARS = 5;            // below this the baseline is too thin — z stays null
const WINDOW_DAYS = 3;          // ±N day-of-year CORE window (front + rhyme + lineup pool)
const AFTERMATH_DAYS = 7;       // "what followed" — recorded days traced after any named date
const WINDOW_AFTER = WINDOW_DAYS + AFTERMATH_DAYS; // pull runs −3..+10 so every pool day carries its trail
const RHYME_LIMIT = 5;          // how many "days like today" to surface
const PAGE_SIZE = 1000;         // PostgREST hard cap per request
const MAX_PAGES = 6;            // (−3..+10)d ≈ 14 rows/yr × ~77 yrs ≈ 1,078 ghcn rows; tide gauges can run more
const COOL_OUTCOME_F = 5;       // recorded avg-high drop that counts as "cooled" for the control line
const ON_FILE_PER_DATE = 2;     // max provenance items attached to a named date
const ON_FILE_TYPES = ['storm-event', 'nws-alert', 'historical-newspaper', 'onthisday-event'];
const FRONT_DROP_F = 8;         // avg-high fall (°F) over the window that reads as a front
const ALERT_LOOKBACK_DAYS = 30; // "recent" window for nws-alert count
const LIVE_TYPES = ['nws-alert', 'weather-event', 'compound-risk-alert']; // recorded-today live layer
const LIVE_LIMIT = 10;          // bounded pull; identical titles collapse to one chip with a count

// LINEUP ("last time the moon, the tide, and the cold lined up like this"):
// SEMANTIC RHYME ("days that READ like today, here"):
const SEMANTIC_MATCH_COUNT = 24;   // asked of the RPC — self + same-year near-dates get filtered in JS
const SEMANTIC_LIMIT = 12;         // matches surfaced after filtering
const SEMANTIC_THRESHOLD = 0.3;    // RPC cosine floor (wide open — templated ghcn text never reads below ~0.85)
const SEMANTIC_NOVEL_FLOOR = 0.90; // best non-self raw cosine below this = today reads like nothing on record.
                                   // Tuned empirically 2026-07-07: typical defendant days probe 0.944–0.964
                                   // best-non-self (VA/PA/WY summer, VA winter, LA Katrina); the most
                                   // anomalous day in the archive (TX 2021-02-15, Uri) still found 0.936
                                   // (its true precedent, the Feb 2011 freeze). 0.90 sits below the worst
                                   // observed best-match on the worst day — it fires only on real novelty.
const SEMANTIC_EXCLUDE_DAYS = 3;   // ±calendar days of the defendant excluded — "yesterday" is not a rhyme

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
  offset: number; // day-of-year offset from the target (−3..+10; core pool is |offset| ≤ 3)
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

/** A metadata value that is a finite number, else null (never undefined/string). */
function mnum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// THAT-DAY event families: a storm-event on an earlier date only counts toward the
// requested day when it plausibly SPANS onto it (multi-day systems). Single-day
// convective types (tornado/wind/hail) never carry forward.
const THATDAY_MULTIDAY_RE = /blizzard|winter storm|hurricane|tropical|flood/i;
// Pre-1996 the federal storm ledger held only these types — used for the era note.
const THATDAY_LEDGER_LIMITED_RE = /tornado|wind|hail/i;

function isoPlusDays(iso: string, days: number): string {
  const dt = new Date(iso + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-'./(])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

/** One-line provenance phrase from an on-file row's title (per content type). */
function onFileLine(ct: string, title: string): string {
  const t = String(title ?? '').trim();
  if (ct === 'storm-event') {
    // "Heavy Snow RALEIGH WV 2000-02-04" → "Heavy Snow — Raleigh"
    const m = t.match(/^(.*?)\s+([A-Z][A-Z .&'()/-]*?)\s+[A-Z]{2}\s+\d{4}-\d{2}-\d{2}$/);
    if (m) return `${m[1]} — ${titleCase(m[2])}`;
    return t.replace(/\s+\d{4}-\d{2}-\d{2}$/, '');
  }
  if (ct === 'nws-alert') return t.replace(/\s+-\s+[A-Z]{2}$/, '');
  if (ct === 'historical-newspaper') {
    // "newspaper Image 2 of The daily Alaska empire (Juneau, Alaska), April 11, 1939 …"
    const m = t.match(/of\s+(.+?)\s*\(/i);
    if (m) return titleCase(m[1]);
  }
  return t.length > 90 ? `${t.slice(0, 87)}…` : t;
}

const ON_FILE_PRIORITY: Record<string, number> = {
  'storm-event': 0, 'nws-alert': 1, 'historical-newspaper': 2, 'onthisday-event': 3,
};

const LIVE_PRIORITY: Record<string, number> = {
  'nws-alert': 0, 'compound-risk-alert': 1, 'weather-event': 2,
};

/** Human chip title from a live row's title (per content type). */
function liveTitle(ct: string, title: string): string {
  const t = String(title ?? '').trim();
  if (ct === 'nws-alert') return t.replace(/\s+-\s+[A-Z]{2}$/, ''); // "Flood Watch - PA" → "Flood Watch"
  if (ct === 'weather-event') {
    // "PA pressure_drop 2026-07-05" → "Pressure drop"
    const m = t.match(/^[A-Z]{2}\s+([a-z_]+)\s+\d{4}-\d{2}-\d{2}$/);
    if (m) { const w = m[1].replace(/_/g, ' '); return w[0].toUpperCase() + w.slice(1); }
  }
  if (ct === 'compound-risk-alert') {
    // "COMPOUND RISK: PA — 6 domains converging (2026-07-05)" → "6 domains converging"
    const m = t.match(/—\s*(.+?)\s*\(\d{4}-\d{2}-\d{2}\)$/);
    if (m) return m[1];
  }
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
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
    // slim=1 → compute only the blocks hunt-morning-line consumes (lineup +
    // control, plus the cheap pure-compute anomaly/weather/front/rhyme). Skips
    // the expensive optional reads (semantic vector search, tide-now, nws/live
    // alert reads, on-file provenance, that-day) so the internal spot call the
    // morning line makes is ~2s instead of ~8s. Default (no param) is unchanged:
    // the public/frontend response stays full and byte-identical.
    const slim = url.searchParams.get('slim') === '1' || url.searchParams.get('slim') === 'true';

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

    // ---- THAT DAY — the requested date's OWN rows (date-native) ---------------
    // The rest of the dossier anchors to the most recent same month-day; this
    // block answers "what did THIS exact date do", from the archive's own rows.
    // Kicked off here so its four bounded queries run in parallel with every
    // block below; awaited just before assembly. Any failure isolates to this
    // block's honest_note — it never breaks the rest of the dossier.
    const archiveEdge = new Date().toISOString().slice(0, 10);
    const thatDayPromise: Promise<Record<string, unknown> | null> = (async () => {
      if (slim) return null; // slim: morning-line doesn't read that_day
      if (target.iso > archiveEdge) return null; // a future date has no recorded "that day"
      try {
        const dMinus3 = isoPlusDays(target.iso, -3);
        const [wRes, eRes, tRes, oRes, qRes] = await Promise.all([
          // weather — the requested date's OWN state ghcn-daily row
          supabase.from('hunt_knowledge')
            .select('content, metadata')
            .eq('content_type', 'ghcn-daily')
            .eq('state_abbr', stateParam)
            .eq('effective_date', target.iso)
            .limit(1),
          // events — this date, plus multi-day systems that began up to 3 days earlier.
          // Ordered by deaths at the DB (bounded filter → cheap in-memory sort) so a
          // mega-event's highest-severity rows are never lost to the PostgREST row cap
          // before the JS rank runs; JS then re-ranks with the full deaths/damage/injuries key.
          supabase.from('hunt_knowledge')
            .select('effective_date, title, content, metadata')
            .eq('content_type', 'storm-event')
            .eq('state_abbr', stateParam)
            .is('metadata->superseded', null)
            .gte('effective_date', dMinus3)
            .lte('effective_date', target.iso)
            .order('metadata->deaths', { ascending: false, nullsFirst: false })
            .limit(300),
          // tide — every station's own reading that day
          supabase.from('hunt_knowledge')
            .select('metadata')
            .eq('content_type', 'tide-gauge')
            .eq('state_abbr', stateParam)
            .eq('effective_date', target.iso)
            .limit(50),
          // world — onthisday-event rows on this EXACT date (year matters; null state_abbr)
          supabase.from('hunt_knowledge')
            .select('title, content')
            .eq('content_type', 'onthisday-event')
            .eq('effective_date', target.iso)
            .limit(10),
          // quakes — the date's own earthquake-event-v2 rows (ComCat, M4.5+ US,
          // event_time_utc on every row). Point events: same-day only.
          supabase.from('hunt_knowledge')
            .select('title, metadata')
            .eq('content_type', 'earthquake-event-v2')
            .eq('state_abbr', stateParam)
            .eq('effective_date', target.iso)
            .order('metadata->magnitude', { ascending: false, nullsFirst: false })
            .limit(6),
        ]);

        // weather
        let weather: Record<string, unknown> | null = null;
        if (wRes.data && wRes.data.length > 0) {
          const md = (wRes.data[0].metadata ?? {}) as Record<string, unknown>;
          weather = {
            avg_high_f: mnum(md.avg_high_f),
            avg_low_f: mnum(md.avg_low_f),
            precip_in: mnum(md.avg_precip_in),
            stations: mnum(md.station_count),
            max_f: mnum(md.max_temp_f),
            min_f: mnum(md.min_temp_f),
            narrative: (wRes.data[0].content as string) ?? null,
          };
        }

        // events — keep same-day rows always; keep earlier rows only when they
        // mark a multi-day family. Rank by blended severity: deaths dominate,
        // but a mass-casualty/mass-damage event outranks a marginally deadlier
        // small one (La Plata F4, 1 death/122 inj/$114M, must lead its day).
        const severityScore = (e: { deaths: number | null; injuries: number | null; damage_usd: number | null }) =>
          (e.deaths ?? 0) * 100 + (e.injuries ?? 0) + (e.damage_usd ?? 0) / 1e6;
        const targetMs = Date.parse(target.iso + 'T00:00:00Z');
        const events = (eRes.data ?? [])
          .map((r) => {
            const md = (r.metadata ?? {}) as Record<string, unknown>;
            const iso = String(r.effective_date).slice(0, 10);
            const isSameDay = iso === target.iso;
            const family = THATDAY_MULTIDAY_RE.test(String(md.event_type ?? '') + ' ' + String(r.title ?? ''));
            if (!isSameDay && !family) return null; // earlier single-day event doesn't span onto this date
            const daysEarlier = Math.round((targetMs - Date.parse(iso + 'T00:00:00Z')) / 86400000);
            return {
              title: (r.title as string) ?? null,
              narrative: (r.content as string) ?? null, // FULL content, never truncated
              deaths: mnum(md.deaths),
              injuries: mnum(md.injuries),
              damage_usd: mnum(md.damage_usd),
              county: (md.county as string) ?? null,
              began: iso,
              span_note: isSameDay ? null : `began ${daysEarlier} day${daysEarlier === 1 ? '' : 's'} earlier`,
              provenance_url: (md.provenance_url as string) ?? null,
              _event_type: String(md.event_type ?? r.title ?? ''),
            };
          })
          .filter((e): e is NonNullable<typeof e> => e !== null)
          .sort((a, b) => severityScore(b) - severityScore(a))
          .slice(0, 8);
        const eventTypes = events.map((e) => e._event_type);
        for (const e of events) delete (e as Record<string, unknown>)._event_type;

        // tide — all stations that day. v2 rows carry daily-MAX residuals; v1
        // rows (pre-contract) recorded daily MEANS under different keys. A
        // stored row must never render blank — surface the mean-basis reading
        // honestly rather than deny data the archive holds.
        const tide = (tRes.data ?? []).map((r) => {
          const md = (r.metadata ?? {}) as Record<string, unknown>;
          const hasMax = md.residual_max_ft != null || md.daily_max_ft != null;
          const hasMean = md.residual_ft != null || md.daily_mean_ft != null;
          return {
            station_name: (md.station_name as string) ?? null,
            residual_max_ft: mnum(md.residual_max_ft),
            residual_max_time_utc: (md.residual_max_time_utc as string) ?? null,
            daily_max_ft: mnum(md.daily_max_ft),
            residual_mean_ft: hasMax ? null : mnum(md.residual_ft),
            daily_mean_ft: hasMax ? null : mnum(md.daily_mean_ft),
            basis: hasMax ? 'daily-max' : hasMean ? 'daily-mean' : null,
            provenance_url: (md.provenance_url as string) ?? null,
          };
        });

        // quakes — the day's own seismic rows, magnitude-desc
        const quakes = (qRes.data ?? []).map((r) => {
          const md = (r.metadata ?? {}) as Record<string, unknown>;
          return {
            magnitude: mnum(md.magnitude),
            place: (md.place as string) ?? (r.title as string) ?? null,
            event_time_utc: (md.event_time_utc as string) ?? null,
            depth_km: mnum(md.depth_km),
            felt: mnum(md.felt),
            provenance_url: (md.provenance_url as string) ?? null,
          };
        });

        // world — onthisday-event, exact date, cap 3
        const world = (oRes.data ?? []).slice(0, 3).map((r) => ({
          title: (r.title as string) ?? null,
          content: (r.content as string) ?? null,
        }));

        // era note — honest about the ledger's own limits before 1996 / 1950
        const ledgerLimited = events.length === 0
          || eventTypes.every((t) => THATDAY_LEDGER_LIMITED_RE.test(t));
        let era_note: string | null = null;
        if (target.iso < '1950-01-01' && events.length === 0) {
          era_note = 'The federal storm ledger begins in 1950 — for this day, only the instruments speak.';
        } else if (target.iso < '1996-01-01' && ledgerLimited) {
          era_note = 'Before 1996 the federal storm ledger kept only tornadoes, thunderstorm wind, and hail — absence here is the ledger\'s limit, not the day\'s.';
        }

        return {
          date: target.iso,
          weather,
          events,
          quakes,
          tide,
          world,
          era_note,
          honest_note: `Searched the archive's own rows for ${target.iso} — ghcn-daily, storm-event, and earthquake rows for ${centroid.name}, this state's tide gauges, and worldwide onthisday-event — every line above traces to a stored row; blank fields mean no row on file for that date.`,
        };
      } catch (e) {
        return {
          date: target.iso,
          weather: null,
          events: [],
          quakes: [],
          tide: [],
          world: [],
          era_note: null,
          honest_note: `that_day lookup failed: ${e instanceof Error ? e.message : String(e)} — the rest of the dossier is unaffected.`,
        };
      }
    })();

    // ---- Build the −WINDOW_DAYS..+WINDOW_AFTER day-of-year date list ---------
    // Core pool is ±WINDOW_DAYS; the +4..+10 tail exists so every pool day has
    // its own recorded "what followed" trail in the SAME pull.
    const thisYear = new Date().getUTCFullYear();
    const dateSet = new Set<string>();
    const offsetOf = new Map<string, number>(); // iso -> day-of-year offset
    for (let y = FIRST_YEAR; y <= thisYear; y++) {
      for (let off = -WINDOW_DAYS; off <= WINDOW_AFTER; off++) {
        const dt = new Date(Date.UTC(y, +target.mm - 1, +target.dd));
        dt.setUTCDate(dt.getUTCDate() + off);
        const iso = dt.toISOString().slice(0, 10);
        dateSet.add(iso);
        offsetOf.set(iso, off);
      }
    }
    const dateList = Array.from(dateSet);

    // ---- Fire every read independent of the GHCN pull in parallel ------------
    // Each overlaps the GHCN pull below AND all the CPU compute that follows;
    // every one is awaited only where its result is first needed. Nothing here
    // depends on the pull, so the whole dossier collapses to roughly the cost of
    // its single slowest query instead of a dozen serial round-trips.
    const tidePoolPromise = (async (): Promise<{ tidePool: Map<string, number>; tideStation: string | null }> => {
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
          .order('effective_date', { ascending: true }) // deterministic pages (see ghcn pull note)
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
      return { tidePool, tideStation };
    })();

    // TIDE NOW — this state's own recent gauge (fast, state-filtered window +
    // JS max-date), else the nearest currently-reporting gauge from a recent
    // roster. tide-gauge grew to ~747k rows and has no index serving
    // (content_type, state_abbr, effective_date), so an ordered full-history
    // scan runs 10–45s and the no-state roster read is planner-unstable (0.4–30s).
    // Fix: (1) the local read is state-filtered + bounded to a recent window and
    // picks the newest in JS (no ORDER BY to stall on empty states) — reliably
    // sub-second; (2) the no-state roster is time-budgeted, so a slow plan yields
    // an honest "no recent gauge" instead of stalling the whole dossier. Deep
    // historical surge still lives in that_day.tide (its own bounded query).
    // A hard outer budget wraps the whole block: states with a recent local gauge
    // answer in <1s, but states with only OLD tide rows scan ~6s just to prove
    // "no recent gauge" (and an ORDER BY there hits the 57014 statement timeout),
    // because tide-gauge has no index serving state+effective_date. The budget
    // yields an honest null in those cases rather than stalling the dossier.
    const TIDENOW_BUDGET_MS = 2000;
    const tideNowPromise: Promise<Record<string, unknown> | null> = slim ? Promise.resolve(null) : Promise.race([
      (async (): Promise<Record<string, unknown> | null> => {
      const RECENT_TIDE_DAYS = 120;   // window that counts as a "current" reading
      const ROSTER_BUDGET_MS = 1500;  // hard cap on the un-indexable roster read
      const tideFloor = isoPlusDays(new Date().toISOString().slice(0, 10), -RECENT_TIDE_DAYS);

      // 1. Local gauge — state-filtered recent window, newest by JS max.
      const { data: localRows } = await supabase
        .from('hunt_knowledge')
        .select('effective_date, metadata')
        .eq('content_type', 'tide-gauge')
        .eq('state_abbr', stateParam)
        .gte('effective_date', tideFloor)
        .limit(500);
      let localBest: { date: string; md: Record<string, unknown> } | null = null;
      for (const r of localRows ?? []) {
        const date = String(r.effective_date).slice(0, 10);
        if (!localBest || date > localBest.date) localBest = { date, md: (r.metadata ?? {}) as Record<string, unknown> };
      }
      if (localBest) {
        const md = localBest.md;
        return {
          station_name: md.station_name ?? null,
          station_id: md.station_id ?? null,
          state: stateParam,
          is_local: true,
          date: localBest.date,
          daily_mean_ft: md.daily_mean_ft ?? null,
          predicted_ft: md.predicted_ft ?? null,
          residual_ft: md.residual_ft ?? null,
          datum: md.datum ?? null,
          source: 'noaa-coops',
          resolution: 'station',
          note: `${md.station_name} gauge (in ${centroid.name}); most recent reading on file ${localBest.date}.`,
        };
      }

      // 2. No local recent gauge → nearest currently-reporting gauge, time-budgeted.
      const roster = await Promise.race([
        supabase
          .from('hunt_knowledge')
          .select('state_abbr, effective_date, metadata')
          .eq('content_type', 'tide-gauge')
          .gte('effective_date', tideFloor)
          .limit(500)
          .then((r) => r.data ?? null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), ROSTER_BUDGET_MS)),
      ]);
      if (!roster) return null; // no roster within budget → honestly no gauge to show
      const latestByStation = new Map<string, { state: string; date: string; md: Record<string, unknown> }>();
      for (const r of roster) {
        const md = (r.metadata ?? {}) as Record<string, unknown>;
        const sid = String(md.station_id ?? md.station_name ?? '');
        if (!sid) continue;
        const date = String(r.effective_date).slice(0, 10);
        const prev = latestByStation.get(sid);
        if (!prev || date > prev.date) latestByStation.set(sid, { state: r.state_abbr as string, date, md });
      }
      let best: { dist: number; state: string; date: string; md: Record<string, unknown> } | null = null;
      for (const s of latestByStation.values()) {
        const c = STATE_CENTROIDS[s.state];
        if (!c) continue;
        const dist = haversineish(lat, lng, c.lat, c.lng);
        if (!best || dist < best.dist) best = { dist, ...s };
      }
      if (!best) return null;
      const md = best.md;
      const isLocal = best.state === stateParam;
      return {
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
          : `Nearest currently-reporting gauge is ${md.station_name}, ${best.state} — ${centroid.name} has no recent gauge in the archive. Reading ${best.date}.`,
      };
      })(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIDENOW_BUDGET_MS)),
    ]);

    // NWS ALERTS — recent count for the state. Bounded count (never count:'exact'
    // on hunt_knowledge): one light key-only pull capped at PAGE_SIZE for the
    // count, one 5-row pull for the display list, both in parallel.
    const nwsPromise: Promise<Record<string, unknown>> = slim
      ? Promise.resolve({ count: 0, lookback_days: ALERT_LOOKBACK_DAYS, recent: [] })
      : (async (): Promise<Record<string, unknown>> => {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - ALERT_LOOKBACK_DAYS);
      const sinceIso = since.toISOString().slice(0, 10);
      const [cntRes, recRes] = await Promise.all([
        supabase.from('hunt_knowledge')
          .select('effective_date')
          .eq('content_type', 'nws-alert')
          .eq('state_abbr', stateParam)
          .gte('effective_date', sinceIso)
          .limit(PAGE_SIZE),
        supabase.from('hunt_knowledge')
          .select('effective_date, content, metadata')
          .eq('content_type', 'nws-alert')
          .eq('state_abbr', stateParam)
          .gte('effective_date', sinceIso)
          .order('effective_date', { ascending: false })
          .limit(5),
      ]);
      const recent = (recRes.data ?? []).map((r) => {
        const md = (r.metadata ?? {}) as Record<string, unknown>;
        const typeMatch = String(r.content ?? '').match(/type:([^|]+?)\s+severity:/i);
        return {
          date: String(r.effective_date).slice(0, 10),
          type: typeMatch ? typeMatch[1].trim() : null,
          severity: md.severity ?? null,
        };
      });
      const count = cntRes.data ? cntRes.data.length : recent.length;
      return { count, lookback_days: ALERT_LOOKBACK_DAYS, recent };
    })();

    // LIVE layer — recorded alerts on file for the ACTUAL today (independent read).
    const livePromise: Promise<Array<Record<string, unknown>>> = slim ? Promise.resolve([]) : (async (): Promise<Array<Record<string, unknown>>> => {
      const todayIso = new Date().toISOString().slice(0, 10);
      const { data: liveRows, error: liveErr } = await supabase
        .from('hunt_knowledge')
        .select('content_type, title')
        .in('content_type', LIVE_TYPES)
        .eq('state_abbr', stateParam)
        .eq('effective_date', todayIso)
        .limit(LIVE_LIMIT);
      if (liveErr) console.error('live query failed:', liveErr.message);
      const byTitle = new Map<string, { type: string; title: string; count: number }>();
      for (const r of liveRows ?? []) {
        const ct = String(r.content_type);
        const title = liveTitle(ct, String(r.title ?? ''));
        if (!title) continue;
        const key = `${ct}|${title}`;
        const cur = byTitle.get(key);
        if (cur) cur.count += 1;
        else byTitle.set(key, { type: ct, title, count: 1 });
      }
      return Array.from(byTitle.values())
        .sort((a, b) => (LIVE_PRIORITY[a.type] ?? 9) - (LIVE_PRIORITY[b.type] ?? 9));
    })();

    // DAY-0 live feed — today's + yesterday's hunt_weather_history for this state,
    // in one bounded read. Past the GHCN edge, day-0 prefers today's live row,
    // then yesterday's (labeled), then falls through to the GHCN defendant.
    const whPromise = (async (): Promise<{ rows: Array<Record<string, unknown>>; yesterdayIso: string }> => {
      const yesterdayIso = isoPlusDays(target.iso, -1);
      const { data, error } = await supabase
        .from('hunt_weather_history')
        .select('date, temp_high_f, temp_low_f, precipitation_total_mm')
        .eq('state_abbr', stateParam)
        .in('date', [target.iso, yesterdayIso])
        .limit(2);
      if (error) console.error('weather_history query failed:', error.message);
      return { rows: (data ?? []) as Array<Record<string, unknown>>, yesterdayIso };
    })();

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
        .order('effective_date', { ascending: true }) // REQUIRED: unordered .range() pages are
        // non-deterministic in PostgREST — pages can overlap/skip rows, silently dropping
        // exact-day rows and emptying the anomaly/control for a state that HAS the data.
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

    // ---- Shared lookups over the pull ----------------------------------------
    const byDate = new Map<string, DayObs>();
    for (const o of obs) byDate.set(o.date, o);
    /** Core pool membership — rhyme/lineup/denominators stay ±WINDOW_DAYS. */
    const inCore = (o: DayObs): boolean => Math.abs(o.offset) <= WINDOW_DAYS;

    /**
     * AFTERMATH — what the recorded days after `dateIso` actually did.
     * Pure lookups over the same pull; recorded fact only. Returns null when the
     * day itself has no recorded high.
     */
    const aftermathFor = (dateIso: string): Record<string, unknown> | null => {
      const day0 = byDate.get(dateIso);
      if (!day0 || day0.high === null) return null;
      const h0 = day0.high as number;
      const series: Array<{ date: string; high: number; delta_f: number }> = [];
      for (let k = 1; k <= AFTERMATH_DAYS; k++) {
        const d = isoPlusDays(dateIso, k);
        const o = byDate.get(d);
        if (o && o.high !== null) {
          series.push({ date: d, high: round(o.high) as number, delta_f: round(o.high - h0, 1) as number });
        }
      }
      const n = series.length;
      let low = Infinity, lowDays = 0, hi = -Infinity, hiDays = 0;
      for (const pt of series) {
        const daysOut = Math.round((Date.parse(pt.date + 'T00:00:00Z') - Date.parse(dateIso + 'T00:00:00Z')) / 86400000);
        if (pt.high < low) { low = pt.high; lowDays = daysOut; }
        if (pt.high > hi) { hi = pt.high; hiDays = daysOut; }
      }
      const maxDrop = n > 0 ? h0 - low : null;   // positive = cooled off that day
      const maxRise = n > 0 ? hi - h0 : null;    // positive = warmed past that day
      let outcome: string | null = null;
      if (n === 0) outcome = null;
      else if (n < 3) outcome = `only ${n} recorded day${n === 1 ? '' : 's'} follow on file`;
      else if ((maxDrop as number) >= COOL_OUTCOME_F && (maxDrop as number) >= (maxRise as number))
        outcome = `cooled ${Math.round(maxDrop as number)}°F within ${lowDays} day${lowDays === 1 ? '' : 's'}`;
      else if ((maxRise as number) >= COOL_OUTCOME_F)
        outcome = `warmed ${Math.round(maxRise as number)}°F within ${hiDays} day${hiDays === 1 ? '' : 's'}`;
      else
        outcome = `held steady through the week (within ${round(Math.max(maxDrop as number, maxRise as number), 1)}°F)`;
      return {
        n_days: n,
        series,
        max_drop_f: round(maxDrop, 1),
        days_to_low: n > 0 ? lowDays : null,
        max_rise_f: round(maxRise, 1),
        days_to_high: n > 0 ? hiDays : null,
        outcome,
      };
    };
    const cooled = (am: Record<string, unknown> | null): boolean =>
      !!am && (am.n_days as number) >= 3 && ((am.max_drop_f as number | null) ?? -Infinity) >= COOL_OUTCOME_F;
    const aftermathComparable = (am: Record<string, unknown> | null): boolean =>
      !!am && (am.n_days as number) >= 3;

    // Per-offset day-of-year mean high — the anomaly baseline for any pool day.
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

    // ---- Tide pool (awaited — the paginated pull was fired in parallel above) -
    // Feeds the lineup's tide component AND per-named-date tide residuals.
    const { tidePool, tideStation } = await tidePoolPromise;

    /** THAT DAY — a named date's own numbers, from the same pull + pure math. */
    const thatDayFor = (o: DayObs): Record<string, unknown> => {
      const m = offMean(o.offset);
      const res = tidePool.get(o.date);
      return {
        high: round(o.high),
        anomaly_f: m !== null && o.high !== null ? round(o.high - m, 1) : null,
        tide_residual_ft: res !== undefined ? round(res) : null,
        tide_station: res !== undefined ? tideStation : null,
        moon_phase: moonPhaseName(moonAgeOnDate(o.date)),
      };
    };

    // ---- ANOMALY (exact day-of-year, most-recent year = defendant) -----------
    const exact = obs.filter((o) => o.offset === 0 && o.high !== null)
      .sort((a, b) => a.year - b.year);
    // Never a silent {} — when the number can't be computed, `reason` says why.
    // The most-recent recorded GHCN year for this day-of-year — the "defendant".
    // Drives the historical blocks below (front / rhyme / lineup / semantic),
    // which stay archive-based by design.
    let defendant: DayObs | null = null;
    if (exact.length > 0) defendant = exact[exact.length - 1];

    // ---- LIVE DAY-0 (past the GHCN archive edge) -----------------------------
    // For target dates beyond this state's latest recorded GHCN year, the actual
    // day-0 reading comes from hunt_weather_history (cron-fed daily, current
    // through yesterday) — a plain bounded .eq() select on a small table. It
    // feeds ONLY weather NOW and the anomaly z; the historical blocks below keep
    // using the GHCN defendant.
    const targetYear = parseInt(target.iso.slice(0, 4), 10);
    // Day-0 fallback chain past the GHCN edge: today's live row → yesterday's
    // live row (clearly labeled) → the GHCN defendant (handled below via isLive).
    // Uses the parallel weather_history read (today + yesterday) fired above.
    let liveDay0: { high: number | null; low: number | null; precip_in: number | null; date: string; source: 'live' | 'live-yesterday' } | null = null;
    if (defendant && targetYear > defendant.year) {
      const { rows: whRows, yesterdayIso } = await whPromise;
      const byWhDate = new Map<string, Record<string, unknown>>();
      for (const r of whRows) byWhDate.set(String(r.date).slice(0, 10), r);
      const todayRow = byWhDate.get(target.iso);
      const yestRow = byWhDate.get(yesterdayIso);
      const pickRow = todayRow ?? yestRow ?? null;
      if (pickRow) {
        const isYesterday = !todayRow;
        const high = typeof pickRow.temp_high_f === 'number' && Number.isFinite(pickRow.temp_high_f) ? pickRow.temp_high_f : null;
        const low = typeof pickRow.temp_low_f === 'number' && Number.isFinite(pickRow.temp_low_f) ? pickRow.temp_low_f : null;
        const mm = typeof pickRow.precipitation_total_mm === 'number' && Number.isFinite(pickRow.precipitation_total_mm) ? pickRow.precipitation_total_mm : null;
        liveDay0 = {
          high, low,
          precip_in: mm !== null ? mm / 25.4 : null,
          date: isYesterday ? yesterdayIso : target.iso,
          source: isYesterday ? 'live-yesterday' : 'live',
        };
      }
    }
    const isLive = liveDay0 !== null && liveDay0.high !== null;

    // ---- ANOMALY (exact day-of-year) -----------------------------------------
    // Past the edge: observed = the live day, baseline = the FULL GHCN distribution
    // (every recorded year). At/before the edge: unchanged — latest year is the
    // defendant, the rest are the baseline.
    let anomaly: Record<string, unknown> = {
      metric: 'avg_high_f',
      value: null, as_of_year: null, as_of_date: null,
      baseline_mean: null, baseline_std: null, z: null, n_years: 0,
      resolution: 'state', min_years: MIN_YEARS, day0_source: 'archive',
      baseline: `per-state avg-high for ${target.mm}-${target.dd}, ${FIRST_YEAR} → present`,
      reason: obs.length === 0
        ? `No GHCN-daily rows on file for ${centroid.name} in the ±${WINDOW_DAYS}-day window of ${target.mm}-${target.dd} — nothing to measure against.`
        : `No recorded ${target.mm}-${target.dd} with a usable avg-high on file for ${centroid.name} — the window has data but the exact day-of-year does not.`,
    };
    if (defendant) {
      const baseline = isLive ? exact : exact.slice(0, exact.length - 1);
      const observed = isLive ? (liveDay0!.high as number) : (defendant.high as number);
      anomaly.value = round(observed);
      anomaly.as_of_year = isLive ? targetYear : defendant.year;
      anomaly.as_of_date = isLive ? liveDay0!.date : defendant.date;
      anomaly.n_years = baseline.length;
      anomaly.day0_source = isLive ? liveDay0!.source : 'archive';
      if (baseline.length >= MIN_YEARS) {
        const mean = baseline.reduce((s, o) => s + (o.high as number), 0) / baseline.length;
        const variance = baseline.reduce((s, o) => s + ((o.high as number) - mean) ** 2, 0) / (baseline.length - 1);
        const std = Math.sqrt(variance);
        anomaly.baseline_mean = round(mean);
        anomaly.baseline_std = round(std);
        anomaly.z = std > 0 ? round((observed - mean) / std) : null;
        anomaly.reason = anomaly.z === null
          ? 'Baseline has zero spread (std = 0) — z is undefined, not zero.'
          : null;
      } else {
        anomaly.reason = `Only ${baseline.length} prior recorded year${baseline.length === 1 ? '' : 's'} on file — below the ${MIN_YEARS}-year floor, so z is withheld rather than faked.`;
      }
    }

    // ---- WEATHER NOW ---------------------------------------------------------
    // Past the edge: the actual recorded day from the live feed. Otherwise: the
    // most-recent recorded GHCN day-of-year (the defendant).
    const weather = isLive ? {
      as_of_date: liveDay0!.date,
      avg_high_f: round(liveDay0!.high),
      avg_low_f: round(liveDay0!.low),
      precip_in: round(liveDay0!.precip_in),
      station_count: null,
      resolution: 'state',
      label: liveDay0!.source === 'live-yesterday'
        ? 'state-level (live station feed — yesterday)'
        : 'state-level (live station feed)',
      day0_source: liveDay0!.source,
      note: liveDay0!.source === 'live-yesterday'
        ? `Yesterday's live station reading (${liveDay0!.date}) — today's row is not on file yet; day-0 basis past the GHCN archive edge (~2025-12).`
        : `Live station feed for ${target.iso} (hunt_weather_history, current through yesterday) — day-0 basis past the GHCN archive edge (~2025-12).`,
    } : (defendant ? {
      as_of_date: defendant.date,
      avg_high_f: round(defendant.high),
      avg_low_f: round(defendant.low),
      precip_in: round(defendant.precip),
      station_count: defendant.stations,
      resolution: 'state',
      label: 'state-level (GHCN-daily)',
      day0_source: 'archive',
      note: `Most recent recorded ${target.mm}-${target.dd} for ${centroid.name} (archive edge ~2025-12).`,
    } : null);

    // ---- FRONT signal (the defendant year's 3-day run-up) --------------------
    // `as_of` is the DATE THE FRONT READ IS BASED ON (the GHCN archive edge, ~a
    // year behind the wall clock) — surfaced so "no front" can never read as a
    // statement about the actual today. Today's recorded alerts live in `live`.
    let front: Record<string, unknown> = {
      signal: 'unknown', temp_change_f: null, precip_recent_in: null,
      window: [], resolution: 'state', as_of: null,
      note: 'Not enough recent recorded days to read a front.',
    };
    if (defendant) {
      front.as_of = defendant.date; // even the "can't read a front" state carries its basis date
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
          as_of: defendant.date,
          note: signal === 'front_passing'
            ? `Avg-high fell ${round(dropFromPeak)}°F off its recent peak${precipRecent > 0.05 ? ` with ${round(precipRecent)}" rain` : ''} — reads as a front moving through.`
            : signal === 'cooling' ? `Cooling trend (${round(change)}°F over ${run.length} days).`
            : signal === 'warming' ? `Warming trend (+${round(change)}°F over ${run.length} days).`
            : 'Temperatures steady — no front signal.',
        };
      }
    }

    // ---- RHYME ("days like today here") --------------------------------------
    // Pool = the CORE ±window across years, excluding the defendant day itself.
    // Ranked by |avg-high − today's value|; the closest are what today rhymes
    // with. Each picked day carries its own story: that day's numbers, what the
    // recorded days after it did, and (filled below) what else is on file.
    let rhyme: Array<Record<string, unknown>> = [];
    if (defendant && defendant.high !== null) {
      const todayHigh = defendant.high as number;
      const pool = obs.filter((o) =>
        inCore(o) && o.high !== null && !(o.year === defendant!.year && o.offset === 0));
      pool.sort((a, b) =>
        Math.abs((a.high as number) - todayHigh) - Math.abs((b.high as number) - todayHigh));
      const picked = pool.slice(0, RHYME_LIMIT);

      rhyme = picked.map((o) => {
        const delta = round((o.high as number) - todayHigh);
        const am = aftermathFor(o.date);
        return {
          date: o.date,
          high: round(o.high),
          delta_f: delta,
          precip_in: round(o.precip),
          that_day: thatDayFor(o),
          aftermath: am,
          outcome: am ? (am.outcome as string | null) : null,
          also_recorded: [] as string[],           // filled by the on-file batch below
          on_file: [] as Array<Record<string, unknown>>, // filled by the on-file batch below
          note: `Avg high ${round(o.high)}°F (${(delta ?? 0) >= 0 ? '+' : ''}${delta}°F vs today)`,
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
    let lineupMatchesAll: Array<Record<string, unknown>> = []; // unsliced — feeds the control line
    if (defendant) {
      // "Today", honestly: moon is computed for the target date itself (pure
      // math, no gap); temp is the defendant day (most recent recorded); tide
      // is the gauge's most recent recorded day in the window.
      const moonToday = moonAgeOnDate(target.iso);
      const meanAtZero = offMean(0);
      // Anchor "today"'s temperature to the live day-0 reading for CURRENT dates
      // (same fallback chain as the NOW block: live → live-yesterday → archive);
      // historical/dated requests keep the archive defendant, byte-identical.
      const lineupTempBasis = isLive ? (liveDay0!.high as number) : (defendant.high as number);
      const lineupDay0Source = isLive ? liveDay0!.source : 'archive';
      const lineupTempAsOf = isLive ? liveDay0!.date : defendant.date;
      const tempAnomToday = meanAtZero !== null ? lineupTempBasis - meanAtZero : null;
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
          if (!inCore(o)) continue; // the +4..+10 tail is aftermath fuel, not pool
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
          const am = aftermathFor(o.date);
          matches.push({
            date: o.date,
            moon_age: round(age),
            moon_phase: moonPhaseName(age),
            temp_anomaly_f: round(anom, 1),
            tide_residual_ft: useTide ? round(res as number) : null,
            that_day: thatDayFor(o),
            aftermath: am,
            outcome: am ? (am.outcome as string | null) : null,
            on_file: [] as Array<Record<string, unknown>>, // filled by the on-file batch below
          });
        }
        matches.sort((a, b) => (a.date as string) < (b.date as string) ? 1 : -1);
        lineupMatchesAll = matches;
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
          day0_source: lineupDay0Source,
          today: {
            moon_date: target.iso,
            moon_age: round(moonToday),
            moon_phase: moonPhaseName(moonToday),
            temp_anomaly_f: round(tempAnomToday, 1),
            temp_as_of: lineupTempAsOf,
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
            + (useTide ? '' : (tidePool.size > 0
                ? ` ${centroid.name}'s gauge has too few joint tide days in this window — lineup is moon × temperature only.`
                : ` No tide-gauge days on file for ${centroid.name} in this window — lineup is moon × temperature only.`))
            + ` Temperature is state-level; moon is computed astronomy for ${target.iso}; temp as of ${lineupTempAsOf}`
            + (useTide ? `; tide as of ${(tideToday as { date: string }).date}.` : '.')
            + ' Recorded fact only — never a forecast.',
        };
      }
    }

    // ---- THE CONTROL LINE (mandatory — without it the lineup is a horoscope) -
    // Base rate over ALL recorded years of this exact day-of-year, matched or
    // not: how often did the following week actually cool ≥COOL_OUTCOME_F°F?
    // The lineup-matched days' rate is only meaningful next to this number.
    // Never a silent null/{}: when there's no defendant day there's no base rate
    // to count — the object says so explicitly (counts stay null, reason filled).
    let control: Record<string, unknown> = {
      outcome: `avg high cooled ≥${COOL_OUTCOME_F}°F within the next ${AFTERMATH_DAYS} recorded days`,
      matched_n: null, matched_outcome_n: null, all_n: null, all_outcome_n: null,
      reason: `No recorded ${target.mm}-${target.dd} on file for ${centroid.name} — no base rate to count.`,
      note: null,
    };
    if (defendant) {
      let allN = 0, allOutcomeN = 0;
      for (const o of exact) {
        if (o.year === defendant.year) continue; // today's trail hasn't been recorded yet
        const am = aftermathFor(o.date);
        if (!aftermathComparable(am)) continue;
        allN++;
        if (cooled(am)) allOutcomeN++;
      }
      let matchedN = 0, matchedOutcomeN = 0;
      for (const m of lineupMatchesAll) {
        const am = m.aftermath as Record<string, unknown> | null;
        if (!aftermathComparable(am)) continue;
        matchedN++;
        if (cooled(am)) matchedOutcomeN++;
      }
      control = {
        outcome: `avg high cooled ≥${COOL_OUTCOME_F}°F within the next ${AFTERMATH_DAYS} recorded days`,
        matched_n: matchedN,
        matched_outcome_n: matchedOutcomeN,
        all_n: allN,
        all_outcome_n: allOutcomeN,
        reason: null,
        note: `Control: of ${allN} recorded ${target.mm}-${target.dd}s here (every year, lineup-matched or not), `
          + `${allOutcomeN} cooled ≥${COOL_OUTCOME_F}°F within the following ${AFTERMATH_DAYS} recorded days. `
          + `The ${matchedN} lineup-matched days with a recorded week after them: ${matchedOutcomeN}. `
          + 'Recorded fact only — a base rate, never a forecast.',
      };
    }

    // ---- ON FILE — one batched provenance query over every named date --------
    // ONE bounded query (never per-date): storm-event / nws-alert /
    // historical-newspaper / onthisday-event rows on the exact named dates.
    // State-scoped types match state_abbr; onthisday-event rows land with
    // state_abbr=null from a separate ingest pipe — matched by exact date only
    // and labeled "in the world" (they light up automatically as the pipe fills).
    // Fired in parallel with the semantic rhyme below (each touches only its own
    // results — on-file mutates rhyme/lineup, semantic returns a fresh object).
    const onFilePromise: Promise<void> = slim ? Promise.resolve() : (async (): Promise<void> => {
      const namedDates = new Set<string>();
      for (const r of rhyme) namedDates.add(r.date as string);
      const lineupMatches = (lineup?.matches ?? []) as Array<Record<string, unknown>>;
      for (const m of lineupMatches) namedDates.add(m.date as string);
      if (namedDates.size > 0) {
        const { data: onFileRows, error: onFileErr } = await supabase
          .from('hunt_knowledge')
          .select('effective_date, content_type, state_abbr, title')
          .in('effective_date', Array.from(namedDates))
          .neq('content_type', 'ghcn-daily')
          .is('metadata->superseded', null)
          .or(`state_abbr.eq.${stateParam},and(state_abbr.is.null,content_type.eq.onthisday-event)`)
          .limit(600);
        if (onFileErr) console.error('on-file query failed:', onFileErr.message);
        const alsoByDate = new Map<string, string[]>();
        const onFileByDate = new Map<string, Array<Record<string, unknown>>>();
        for (const r of onFileRows ?? []) {
          const iso = String(r.effective_date).slice(0, 10);
          const ct = String(r.content_type);
          const isHere = r.state_abbr === stateParam;
          if (isHere) {
            if (!alsoByDate.has(iso)) alsoByDate.set(iso, []);
            const arr = alsoByDate.get(iso)!;
            if (!arr.includes(ct)) arr.push(ct);
          }
          if (!ON_FILE_TYPES.includes(ct)) continue;
          if (!isHere && ct !== 'onthisday-event') continue; // null-state rows only count for the world type
          const line = onFileLine(ct, String(r.title ?? ''));
          if (!line) continue;
          if (!onFileByDate.has(iso)) onFileByDate.set(iso, []);
          const items = onFileByDate.get(iso)!;
          if (items.some((it) => it.line === line)) continue;
          items.push({ type: ct, line, scope: isHere ? 'here' : 'in the world' });
        }
        const onFileFor = (iso: string): Array<Record<string, unknown>> =>
          (onFileByDate.get(iso) ?? [])
            .sort((a, b) => (ON_FILE_PRIORITY[a.type as string] ?? 9) - (ON_FILE_PRIORITY[b.type as string] ?? 9))
            .slice(0, ON_FILE_PER_DATE);
        for (const r of rhyme) {
          const iso = r.date as string;
          const types = (alsoByDate.get(iso) ?? []).slice(0, 6);
          r.also_recorded = types;
          r.on_file = onFileFor(iso);
        }
        for (const m of lineupMatches) {
          m.on_file = onFileFor(m.date as string);
        }
      }
    })();

    // ---- SEMANTIC RHYME ("days that READ like today, here") ------------------
    // The structured rhyme above matches on ONE number (avg-high). This layer
    // matches on MEANING: the defendant day's embedded daily narrative searched
    // against every other recorded day for this state (voyage-3-lite 512-dim
    // cosine via search_hunt_knowledge_v3 / IVFFlat). Lorenz-honest: the match
    // basis is the day's reduced recorded narrative — temps, precipitation,
    // station coverage — never the full atmospheric state, and NEVER a forecast.
    // When nothing on record reads like today, novel:true IS the finding, not
    // an error. Composed AFTER every other block; any failure isolates here.
    const semanticPromise: Promise<Record<string, unknown>> = slim
      ? Promise.resolve({ unavailable: true, reason: 'skipped (slim mode — lineup/control only)' })
      : (async (): Promise<Record<string, unknown>> => {
      if (!defendant) {
        return { unavailable: true, reason: 'No recorded day on file to search from.' };
      }
      try {
        // 1. The query vector — today's defendant row's own embedding (exact-
        //    date bounded read; order-by scans on hunt_knowledge time out). The
        //    denominator (this state's estimated daily-record count) needs only
        //    the state, so it runs in the SAME round-trip as the embedding read.
        const [{ data: embRows, error: embErr }, denomRes] = await Promise.all([
          supabase.from('hunt_knowledge')
            .select('embedding')
            .eq('content_type', 'ghcn-daily')
            .eq('state_abbr', stateParam)
            .eq('effective_date', defendant.date)
            .not('embedding', 'is', null)
            .limit(1),
          supabase.from('hunt_knowledge')
            .select('id', { count: 'estimated', head: true })
            .eq('content_type', 'ghcn-daily')
            .eq('state_abbr', stateParam),
        ]);
        const nSearched: number | null = typeof denomRes.count === 'number' ? denomRes.count : null;
        if (embErr || !embRows || embRows.length === 0 || !embRows[0].embedding) {
          return {
            unavailable: true,
            reason: embErr
              ? `Defendant embedding read failed: ${embErr.message}`
              : `The defendant day (${defendant.date}) has no embedding on file.`,
          };
        }
        const queryEmbedding = embRows[0].embedding;

        // 2. The search — this state's own ghcn-daily records only. One retry,
        //    5xx only (never retry 4xx).
        const rpcArgs = {
          query_embedding: queryEmbedding,
          match_threshold: SEMANTIC_THRESHOLD,
          match_count: SEMANTIC_MATCH_COUNT,
          filter_content_types: ['ghcn-daily'],
          filter_state_abbr: stateParam,
          filter_species: null,
          filter_date_from: null,
          filter_date_to: null,
          recency_weight: 0.0,
          exclude_du_report: false,
        };
        // The IVFFlat rebuild is pending, so this vector search can run long on
        // data-heavy states. It is the last, non-load-bearing block — time-budget
        // it so a slow search degrades to an honest `unavailable` instead of
        // stalling the whole dossier (5xx-only single retry preserved).
        const SEMANTIC_BUDGET_MS = 4000;
        const runSearch = async () => {
          let r = await supabase.rpc('search_hunt_knowledge_v3', rpcArgs);
          if (r.error && r.status >= 500) r = await supabase.rpc('search_hunt_knowledge_v3', rpcArgs);
          return r;
        };
        const TIMEOUT = Symbol('timeout');
        const raced = await Promise.race([
          runSearch(),
          new Promise<typeof TIMEOUT>((res) => setTimeout(() => res(TIMEOUT), SEMANTIC_BUDGET_MS)),
        ]);
        if (raced === TIMEOUT) {
          return {
            unavailable: true,
            reason: `Vector search exceeded the ${SEMANTIC_BUDGET_MS / 1000}s time budget — semantic rhyme withheld to keep the dossier fast (IVFFlat rebuild pending).`,
          };
        }
        const resp = raced;
        if (resp.error) {
          return { unavailable: true, reason: `Vector search failed: ${resp.error.message}` };
        }

        // 3. Filter in JS: drop the defendant itself and its ±3-calendar-day
        //    neighbors (same weather system reads like itself — that's not a
        //    rhyme), recover RAW cosine from the signal-weighted similarity,
        //    dedupe by date keeping the best.
        const defMs = Date.parse(defendant.date + 'T00:00:00Z');
        const bestByDate = new Map<string, { sim: number; content: string }>();
        for (const hit of (resp.data ?? []) as Array<Record<string, unknown>>) {
          if ((hit?.metadata as Record<string, unknown> | null)?.superseded === true) continue;
          const iso = String(hit.effective_date ?? '').slice(0, 10);
          if (!iso) continue;
          const dayDist = Math.abs(Date.parse(iso + 'T00:00:00Z') - defMs) / 86400000;
          if (dayDist <= SEMANTIC_EXCLUDE_DAYS) continue;
          const sw = Number(hit.signal_weight);
          const raw = Number.isFinite(sw) && sw > 0 ? Number(hit.similarity) / sw : Number(hit.similarity);
          if (!Number.isFinite(raw)) continue;
          const prev = bestByDate.get(iso);
          if (!prev || raw > prev.sim) bestByDate.set(iso, { sim: raw, content: String(hit.content ?? '') });
        }
        const ranked = Array.from(bestByDate.entries())
          .sort((a, b) => b[1].sim - a[1].sim)
          .slice(0, SEMANTIC_LIMIT);

        const method = 'voyage-512 cosine over this state\'s own daily records';
        const basis = `each day's embedded daily narrative (avg high/low, precipitation, station coverage — not the full weather state)`;
        const depth = `${centroid.name}'s own GHCN-daily record, ${FIRST_YEAR} → ~2025-12`;
        const bestSim = ranked.length > 0 ? ranked[0][1].sim : null;

        // 5. NOVELTY — Lorenz/sigma-dissimilarity teaching: when no good analog
        //    exists, say so at full weight instead of forcing weak matches.
        if (bestSim === null || bestSim < SEMANTIC_NOVEL_FLOOR) {
          return {
            novel: true,
            note: 'today doesn\'t read like anything on record here — that itself is the finding',
            matches: [],
            method,
            basis_date: defendant.date,
            best_similarity: round(bestSim, 4),
            novelty_floor: SEMANTIC_NOVEL_FLOOR,
            n_searched: nSearched,
            honest_note: `0 days read like ${defendant.date} (the most recent recorded ${target.mm}-${target.dd} here) above the ${SEMANTIC_NOVEL_FLOOR} similarity floor`
              + (bestSim !== null ? ` (closest: ${round(bestSim, 3)})` : '')
              + `. Matched by meaning on ${basis} across ${nSearched !== null ? `~${nSearched}` : 'all'} recorded days in ${depth}. Recorded fact only — never a forecast.`,
          };
        }

        // 6. Matches — each carries its own parsed numbers; dates that overlap
        //    the ±window pool reuse the existing that_day / aftermath context.
        const matches = ranked.map(([iso, m]) => {
          const p = parseGhcn(m.content);
          const inPool = byDate.get(iso);
          const am = inPool ? aftermathFor(iso) : null;
          return {
            date: iso,
            similarity: round(m.sim, 4),
            high: round(p.high),
            precip_in: round(p.precip),
            that_day: inPool ? thatDayFor(inPool) : null,
            outcome: am ? (am.outcome as string | null) : null,
            // Out-of-pool matches carry that_day:null/outcome:null — say why, don't leave bare nulls.
            note: !inPool
              ? 'aftermath not on file'
              : (p.high !== null
                  ? `Avg high ${round(p.high)}°F${p.precip !== null && p.precip > 0 ? ` · ${round(p.precip)}" precip` : ''}`
                  : null),
          };
        });

        return {
          novel: false,
          matches,
          method,
          basis_date: defendant.date,
          best_similarity: round(bestSim, 4),
          novelty_floor: SEMANTIC_NOVEL_FLOOR,
          n_searched: nSearched,
          honest_note: `${matches.length} recorded days read most like ${defendant.date} (the most recent recorded ${target.mm}-${target.dd} here). Matched by meaning on ${basis}, cosine over ${nSearched !== null ? `~${nSearched}` : 'all'} recorded days in ${depth}. Similarity is closeness of the recorded description — recorded fact only, never a forecast.`,
        };
      } catch (e) {
        return {
          unavailable: true,
          reason: `Semantic rhyme failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    })();

    // ---- Assemble ------------------------------------------------------------
    // Everything above was fired in parallel — the two GHCN-independent reads
    // (tide-now/nws/live), the on-file mutation into rhyme/lineup, the semantic
    // search, and that-day. Collect them all here; the total wall-clock is the
    // single slowest of them, not their sum. Semantic is time-budgeted so it can
    // never dominate; the roster read is time-budgeted for the same reason.
    const tide = await tideNowPromise;
    const alerts = await nwsPromise;
    const live = await livePromise;
    await onFilePromise;
    const semanticRhyme = await semanticPromise;
    const that_day = await thatDayPromise;
    return new Response(JSON.stringify({
      spot: {
        state: stateParam,
        name: centroid.name,
        lat, lng,
        used_input_coords: latParam !== null && lngParam !== null,
      },
      target_date: target.iso,
      month_day: `${target.mm}-${target.dd}`,
      that_day,
      generated_at: new Date().toISOString(),
      sources: ['ghcn-daily', 'tide-gauge', 'nws-alert', 'storm-event', 'historical-newspaper', 'onthisday-event'],
      lineup,
      control,
      now: {
        weather,
        front,
        tide,
        alerts,
        // Recorded alerts on file for the ACTUAL today (never a forecast).
        live,
        live_as_of: new Date().toISOString().slice(0, 10),
      },
      past: {
        anomaly,
        rhyme,
        semantic_rhyme: semanticRhyme,
        rhyme_pool: {
          window_days: WINDOW_DAYS,
          aftermath_days: AFTERMATH_DAYS,
          years: `${FIRST_YEAR} → present`,
          ranked_by: 'closest avg-high to today',
          note: 'Denominator for the rhyme: the pool is every recorded day within ±3 calendar days of this day-of-year across all years; the list is the closest matches by avg-high. Each named date carries its own recorded aftermath (next 7 recorded days) — fact, never a forecast.',
        },
      },
    }), { status: 200, headers: jsonHeaders });

  } catch (e) {
    return new Response(JSON.stringify({ error: `Unexpected error: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 500, headers: jsonHeaders });
  }
});