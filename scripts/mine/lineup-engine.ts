/**
 * lineup-engine.ts — THE LINEUP RETRODICTION TEST kernel (timebox gate 1).
 *
 * Implements scripts/mine/REGISTRATION-LINEUP-RETRO.md (frozen 2026-07-16,
 * commit c135065). The registration is THE LAW; where this file and the
 * registration disagree, the registration wins and this file is wrong.
 *
 * PURE kernel: no network, no filesystem, no clock, no Math.random. The
 * substrate is injectable (LineupStore) so synthetic fixtures drive every
 * branch (development firewall, §8). The loader/orchestrator/report live in
 * lineup-retro.ts; tests in lineup-engine.test.ts.
 *
 * The predicate is copied verbatim-faithful from hunt-atlas-spot (§3):
 * tempMatch (incl. the near-normal branch), tideMatch, moonMatch, the
 * argmax-station rule (determinized: ties by station id asc), the useTide
 * floor (≥ 60 joint tide days in the −3..+10 window), and the mode fallback
 * (moon_tide_temp → moon_temp). Moon math is the Schlyter block copied
 * VERBATIM from supabase/functions/hunt-atlas-spot/index.ts — NEVER
 * frames.ts moonPhase. Claims parse through the product's own
 * parseOutcomeString (supabase/functions/_shared/morningLine.ts). Grading
 * reimplements hunt-morning-grader's precedent/held paths (§5).
 *
 * Documented deviations (§11, each a ruling): D1 as-if-live day-0 = the index
 * day itself; D2 symmetric leave-index-year-out baseline AND pool; D3 grading
 * ground = the GHCN rows themselves; D4 ±10-calendar-day anti-leakage guard
 * in the primary (verbatim variant prints as S7; ±7/±14 as S8).
 */

import { parseOutcomeString } from "../../supabase/functions/_shared/morningLine";

// ─── frozen constants (registration §12 — byte-exact; never touch without a
//     version bump) ─────────────────────────────────────────────────────────────
export const WINDOW_DAYS = 3; // ±3 day-of-year core window
export const AFTERMATH_DAYS = 7; // next 7 recorded days
export const WINDOW_AFTER = WINDOW_DAYS + AFTERMATH_DAYS; // −3..+10 pull window (tide station window, spot verbatim)
export const MOON_TOL_DAYS = 2; // ±2 days circular
export const TEMP_TOL_F = 5;
export const TEMP_NEAR_F = 2;
export const TIDE_ELEV_FT = 0.5;
export const LINEUP_MIN_TIDE_DAYS = 60; // tide joint-day floor
export const MIN_YEARS = 5; // baseline floor
export const OUTCOME_BAR_F = 5; // COOL_OUTCOME_F / OUTCOME_BAR_F — ≥5°F same direction in claim window
export const GUARD_DAYS = 10; // D4 anti-leakage guard (±10 calendar days)
export const GUARD_SENSITIVITY: [number, number] = [7, 14]; // S8
export const G2_OFFSET = 3; // §8 — outside the null set
export const IMPORTANCE_FLOOR = 0.02; // Δ ≥ +2.0pp
export const G0_FLOOR = 0.02; // G0 bar: Δ_pos ≥ +2.0pp
export const G0_MCNEMAR_BAR = 1e-6; // …with descriptive McNemar p ≤ 1e-6
export const EPOCH_SPLIT_YEAR = 1988; // S5: 1950–1987 vs 1988–2025
export const S1_MIN_YEARS = 10; // S1 argmax-|z| state floor
export const ERA_START = "1950-01-01";
export const ERA_END = "2025-12-31";
export const SEED_DEFAULT = 42; // fixtures + parity-probe selection only
export const BH_Q = 0.05; // one 57-test family (§9)

/** Rotations: 5..71 minus the Metonic ghosts {19, 38, 57} = 64 replicates (§7). */
export const ROTATION_OFFSETS: number[] = Array.from({ length: 67 }, (_, i) => i + 5)
  .filter((k) => k !== 19 && k !== 38 && k !== 57);
export const N_ROTATIONS = ROTATION_OFFSETS.length; // 64; exact p = 1/65

/** The 50 states (the era's index population — no DC/territories). */
export const STATE_ABBRS: string[] = [
  "AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD",
  "ME", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH",
  "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY",
];

// ---------------------------------------------------------------------------
// MOON math — copied VERBATIM from supabase/functions/hunt-atlas-spot/index.ts
// (~lines 187-288; Schlyter low-precision lunar theory, longitude terms only).
// Pure computation, zero I/O. NOT frames.ts moonPhase (a different
// approximation) — registration §2/§12.
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
export function moonAgeOnDate(iso: string): number {
  const jd = Date.parse(`${iso}T12:00:00Z`) / 86400000 + 2440587.5;
  const elong = rev(moonLonEcl(jd) - sunLongitude(jd)); // 0 new, 180 full
  return (elong / 360) * SYNODIC;
}

/** Circular distance between two moon ages (days, on the synodic cycle). */
export function moonAgeDist(a: number, b: number): number {
  const d = Math.abs(a - b) % SYNODIC;
  return Math.min(d, SYNODIC - d);
}

// ─── verbatim predicate branches (hunt-atlas-spot lineup block, §3) ─────────────

/** tempMatch — verbatim incl. the near-normal branch. */
export function tempMatchFn(anom: number, anomToday: number): boolean {
  return Math.abs(anomToday) < TEMP_NEAR_F
    ? Math.abs(anom) < TEMP_NEAR_F
    : Math.sign(anom) === Math.sign(anomToday) && Math.abs(anom - anomToday) <= TEMP_TOL_F;
}

/** tideMatch — verbatim. */
export function tideMatchFn(res: number, tideToday: number): boolean {
  return Math.abs(tideToday) < TIDE_ELEV_FT
    ? Math.abs(res) < TIDE_ELEV_FT
    : Math.sign(res) === Math.sign(tideToday) && Math.abs(res) >= TIDE_ELEV_FT;
}

/** moonMatch — verbatim: circular age distance ≤ MOON_TOL_DAYS. */
export function moonMatchFn(age: number, ageToday: number): boolean {
  return moonAgeDist(age, ageToday) <= MOON_TOL_DAYS;
}

// ─── calendar ───────────────────────────────────────────────────────────────────
const DAY_MS = 864e5;
export const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export interface Cal {
  ts0: number;
  total: number;
  iso: string[];
  year: Uint16Array;
  month: Uint8Array;
  dom: Uint8Array; // day of month
  year0: number;
  yearSpan: number;
  idx(iso: string): number;
}

/** Contiguous daily calendar. Whole years REQUIRED (Jan 1 → Dec 31) so the
 *  rotation remap (§7) is total — asserted, never assumed. */
export function makeCal(startIso: string, endIso: string): Cal {
  if (!startIso.endsWith("-01-01") || !endIso.endsWith("-12-31")) {
    throw new Error(`calendar must span whole years (got ${startIso}..${endIso}) — §7 rotation totality`);
  }
  const ts0 = Date.parse(`${startIso}T00:00:00Z`);
  const tsN = Date.parse(`${endIso}T00:00:00Z`);
  const total = Math.round((tsN - ts0) / DAY_MS) + 1;
  const iso = new Array<string>(total);
  const year = new Uint16Array(total);
  const month = new Uint8Array(total);
  const dom = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    const s = new Date(ts0 + i * DAY_MS).toISOString().slice(0, 10);
    iso[i] = s;
    year[i] = Number(s.slice(0, 4));
    month[i] = Number(s.slice(5, 7));
    dom[i] = Number(s.slice(8, 10));
  }
  const year0 = year[0];
  const yearSpan = year[total - 1] - year0 + 1;
  return {
    ts0, total, iso, year, month, dom, year0, yearSpan,
    idx: (s: string) => Math.round((Date.parse(`${s}T00:00:00Z`) - ts0) / DAY_MS),
  };
}

// ─── the injectable substrate (§8 development firewall) ─────────────────────────
export interface TideStationData {
  id: string; // station_id — the argmax tie-break key (id asc)
  name: string;
  res: Float64Array; // residual_ft per day index; NaN = no reading (the ONLY key the product's tidePool reads, §2)
}

export interface LineupStore {
  startIso: string;
  endIso: string;
  states: string[]; // index population (production: the 50)
  high: Map<string, Float64Array>; // avg_high_f per day index; NaN = missing
  tide: Map<string, TideStationData[]>; // per state; absent/empty = inland (moon_temp fallback)
}

// ─── env: everything precomputable once, replicate-independent ─────────────────

export interface StateEnv {
  abbr: string;
  high: Float64Array;
  // per (md, off∈0..6) sums over ALL years — LOYO (D2) subtracts the index
  // year's own value at read time (total-minus-year)
  offSum: Float64Array; // [mdCount*7]
  offCnt: Int16Array; // [mdCount*7]
  off0Sq: Float64Array; // [mdCount] sum of squares at offset 0 (S1 z)
  // grading precompute (§5): cumulative max drop/rise over RECORDED days
  // d+1..d+k (−Infinity when none recorded), and a hole bitmask (bit k−1 set =
  // day d+k has no recorded high)
  cumDrop: Float32Array; // [T*7]
  cumRise: Float32Array; // [T*7]
  holeBits: Uint8Array; // [T]
  // the day's claim AS A PRECEDENT: aftermathFor(day) → outcome string →
  // parseOutcomeString (the product's own parser). verb: 0 = no claim
  // (thin/none), 1 = cooled, 2 = warmed, 3 = held. win = claim window days.
  verb: Int8Array; // [T]
  win: Int8Array; // [T]
  cooled: Uint8Array; // [T] control-line cooled flag: n≥3 AND maxDrop ≥ 5 (S6)
  stations: TideStationData[]; // sorted by id asc (argmax tie-break)
}

export interface Env {
  cal: Cal;
  states: string[];
  T: number;
  mdCount: number;
  mdOfDay: Int32Array; // day → md index
  mdBase: Int32Array; // [mdCount*yearSpan] → the (year, month-day) base day index; −1 off-store.
  // Built with Date.UTC — Feb 29 in a non-leap year ROLLS to Mar 1, exactly the
  // deployed spot's date construction (new Date(Date.UTC(y, mm-1, dd))).
  moonAge: Float64Array; // [T] Schlyter age per day (pure math, precomputed once)
  st: StateEnv[];
  s1State: Int16Array; // [T] per date: argmax-|z| state (n_years ≥ 10) — S1; −1 = none.
  // z is temp-only (LOYO offset-0 baseline) so it is rotation-INVARIANT and
  // precomputed once. Ties broken by state-abbr asc (deterministic).
}

// ─── aftermath → claim (aftermathFor verbatim → parseOutcomeString) ─────────────

/** round(n, dp) — copied from hunt-atlas-spot (claim strings must match). */
function roundDp(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * aftermathFor (§3 verbatim): next 7 CALENDAR days with a recorded high after
 * day d; n<3 → thin; maxDrop ≥5 AND maxDrop ≥ maxRise → cooled; elif maxRise
 * ≥5 → warmed; else held. Returns the exact outcome STRING the product
 * publishes (null when the day itself has no recorded high or n = 0 follows —
 * the spot emits outcome null at n=0, which parses to no claim).
 */
export function aftermathOutcome(high: Float64Array, d: number, T: number): string | null {
  const h0 = high[d];
  if (!Number.isFinite(h0)) return null;
  let n = 0;
  let low = Infinity, lowDays = 0, hi = -Infinity, hiDays = 0;
  for (let k = 1; k <= AFTERMATH_DAYS; k++) {
    const p = d + k;
    if (p >= T) continue;
    const v = high[p];
    if (!Number.isFinite(v)) continue;
    n++;
    if (v < low) { low = v; lowDays = k; }
    if (v > hi) { hi = v; hiDays = k; }
  }
  if (n === 0) return null;
  if (n < 3) return `only ${n} recorded day${n === 1 ? '' : 's'} follow on file`;
  const maxDrop = h0 - low;
  const maxRise = hi - h0;
  if (maxDrop >= OUTCOME_BAR_F && maxDrop >= maxRise)
    return `cooled ${Math.round(maxDrop)}°F within ${lowDays} day${lowDays === 1 ? '' : 's'}`;
  if (maxRise >= OUTCOME_BAR_F)
    return `warmed ${Math.round(maxRise)}°F within ${hiDays} day${hiDays === 1 ? '' : 's'}`;
  return `held steady through the week (within ${roundDp(Math.max(maxDrop, maxRise), 1)}°F)`;
}

/**
 * Grade a precedent claim against index day d's own recorded aftermath
 * (hunt-morning-grader semantics, §5). day0 = high(d) (D1/D3).
 * Returns 1 HIT, 0 MISS, 2 UNGRADEABLE.
 *  - cooled/warmed: HIT iff any recorded day at days_out ≤ win moved ≥5°F in
 *    the claim direction (a hit stands even with holes — grader verbatim);
 *    no hit + window holes → UNGRADEABLE; else MISS.
 *  - held: MISS iff any recorded day in +1..+7 has |move| ≥ 5°F (breach beats
 *    holes — grader verbatim); no breach + holes → UNGRADEABLE; else HIT.
 */
export function gradeClaim(S: StateEnv, d: number, verb: number, win: number): 0 | 1 | 2 {
  const o = d * 7;
  if (verb === 1) {
    if (S.cumDrop[o + win - 1] >= OUTCOME_BAR_F) return 1;
    return (S.holeBits[d] & ((1 << win) - 1)) !== 0 ? 2 : 0;
  }
  if (verb === 2) {
    if (S.cumRise[o + win - 1] >= OUTCOME_BAR_F) return 1;
    return (S.holeBits[d] & ((1 << win) - 1)) !== 0 ? 2 : 0;
  }
  // held: full 7 days, window ignored (grader verbatim)
  if (Math.max(S.cumDrop[o + 6], S.cumRise[o + 6]) >= OUTCOME_BAR_F) return 0;
  return (S.holeBits[d] & 0x7f) !== 0 ? 2 : 1;
}

// ─── buildEnv ───────────────────────────────────────────────────────────────────

export function buildEnv(store: LineupStore): Env {
  const cal = makeCal(store.startIso, store.endIso);
  const T = cal.total;
  const ys = cal.yearSpan;

  // md keys: every (month, day-of-month) present in the calendar (366 on any
  // span containing a leap year)
  const mdIdxOf = new Int32Array(1332).fill(-1); // m*100+dd → dense md index
  const mdOfDay = new Int32Array(T);
  const mdKeys: number[] = [];
  for (let d = 0; d < T; d++) {
    const key = cal.month[d] * 100 + cal.dom[d];
    if (mdIdxOf[key] < 0) {
      mdIdxOf[key] = mdKeys.length;
      mdKeys.push(key);
    }
    mdOfDay[d] = mdIdxOf[key];
  }
  const mdCount = mdKeys.length;

  // mdBase: Date.UTC construction — Feb 29 rolls to Mar 1 in non-leap years,
  // exactly as the deployed spot builds its dateList.
  const mdBase = new Int32Array(mdCount * ys).fill(-1);
  for (let q = 0; q < mdCount; q++) {
    const m = Math.floor(mdKeys[q] / 100);
    const dd = mdKeys[q] % 100;
    for (let y = 0; y < ys; y++) {
      const idx = Math.round((Date.UTC(cal.year0 + y, m - 1, dd) - cal.ts0) / DAY_MS);
      if (idx >= 0 && idx < T) mdBase[q * ys + y] = idx;
    }
  }

  // moon ages: all dates precomputed once (27,759 in production)
  const moonAge = new Float64Array(T);
  for (let d = 0; d < T; d++) moonAge[d] = moonAgeOnDate(cal.iso[d]);

  // per-state precompute
  const st: StateEnv[] = store.states.map((abbr) => {
    const high = store.high.get(abbr) ?? new Float64Array(T).fill(NaN);
    if (high.length !== T) throw new Error(`${abbr}: high array length ${high.length} ≠ calendar ${T}`);

    const offSum = new Float64Array(mdCount * 7);
    const offCnt = new Int16Array(mdCount * 7);
    const off0Sq = new Float64Array(mdCount);
    for (let q = 0; q < mdCount; q++) {
      for (let y = 0; y < ys; y++) {
        const b = mdBase[q * ys + y];
        if (b < 0) continue;
        for (let off = 0; off < 7; off++) {
          const p = b + off - WINDOW_DAYS;
          if (p < 0 || p >= T) continue;
          const v = high[p];
          if (!Number.isFinite(v)) continue;
          offSum[q * 7 + off] += v;
          offCnt[q * 7 + off]++;
          if (off === WINDOW_DAYS) off0Sq[q] += v * v;
        }
      }
    }

    const cumDrop = new Float32Array(T * 7).fill(-Infinity);
    const cumRise = new Float32Array(T * 7).fill(-Infinity);
    const holeBits = new Uint8Array(T);
    const verb = new Int8Array(T);
    const win = new Int8Array(T);
    const cooled = new Uint8Array(T);
    for (let d = 0; d < T; d++) {
      const h0 = high[d];
      if (!Number.isFinite(h0)) { holeBits[d] = 0x7f; continue; }
      let mDrop = -Infinity, mRise = -Infinity, holes = 0, n = 0, maxDrop = -Infinity;
      for (let k = 1; k <= 7; k++) {
        const p = d + k;
        const v = p < T ? high[p] : NaN;
        if (Number.isFinite(v)) {
          n++;
          if (h0 - v > mDrop) mDrop = h0 - v;
          if (v - h0 > mRise) mRise = v - h0;
        } else {
          holes |= 1 << (k - 1);
        }
        cumDrop[d * 7 + k - 1] = mDrop;
        cumRise[d * 7 + k - 1] = mRise;
      }
      holeBits[d] = holes;
      maxDrop = mDrop;
      cooled[d] = n >= 3 && maxDrop >= OUTCOME_BAR_F ? 1 : 0;
      // the claim this day makes AS A PRECEDENT — built as the product's own
      // outcome string, parsed by the product's own parser (round-trip law)
      const parsed = parseOutcomeString(aftermathOutcome(high, d, T));
      verb[d] = parsed.verb === "cooled" ? 1 : parsed.verb === "warmed" ? 2 : parsed.verb === "held" ? 3 : 0;
      win[d] = parsed.window_days ?? 0;
    }

    const stations = [...(store.tide.get(abbr) ?? [])].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const s of stations) {
      if (s.res.length !== T) throw new Error(`${abbr}/${s.id}: res array length ${s.res.length} ≠ calendar ${T}`);
    }
    return { abbr, high, offSum, offCnt, off0Sq, cumDrop, cumRise, holeBits, verb, win, cooled, stations };
  });

  // S1: per date, the argmax-|z| state with LOYO n_years ≥ 10 (temp-only →
  // rotation-invariant, precomputed once). Ties → state-abbr asc (= st order).
  const s1State = new Int16Array(T).fill(-1);
  for (let d = 0; d < T; d++) {
    const q = mdOfDay[d];
    let bestZ = -1;
    for (let si = 0; si < st.length; si++) {
      const S = st[si];
      const v = S.high[d];
      if (!Number.isFinite(v)) continue;
      const cnt = S.offCnt[q * 7 + WINDOW_DAYS] - 1; // LOYO: v itself is counted
      if (cnt < S1_MIN_YEARS) continue;
      const sum = S.offSum[q * 7 + WINDOW_DAYS] - v;
      const mean = sum / cnt;
      const varL = (S.off0Sq[q] - v * v - cnt * mean * mean) / (cnt - 1);
      if (!(varL > 0)) continue;
      const z = Math.abs((v - mean) / Math.sqrt(varL));
      if (z > bestZ) { bestZ = z; s1State[d] = si; }
    }
  }

  return { cal, states: store.states, T, mdCount, mdOfDay, mdBase, moonAge, st, s1State };
}

// ─── rotation remap (§7) — moon+tide world rotates against the fixed ground ─────
// Calendar-mapped: same month/day at year+k, Feb 29 → Feb 28, wrapping on the
// era's year axis ((y−y0+k) mod span; 2025→1950 on the production 76-year
// axis). Total (never −1) because the calendar spans whole years.
export function makeRemap(cal: Cal, offsetYears: number): Int32Array {
  const remap = new Int32Array(cal.total);
  for (let d = 0; d < cal.total; d++) {
    const y2 = cal.year0 + ((cal.year[d] - cal.year0 + offsetYears) % cal.yearSpan);
    const m = cal.month[d];
    let dd = cal.dom[d];
    if (m === 2 && dd === 29 && !isLeap(y2)) dd = 28;
    remap[d] = Math.round((Date.UTC(y2, m - 1, dd) - cal.ts0) / DAY_MS);
  }
  return remap;
}

/** G2 stacking: read through `inner` (a null rotation) then `outer` (the G2 shift). */
export function composeRemap(outer: Int32Array, inner: Int32Array): Int32Array {
  const out = new Int32Array(inner.length);
  for (let d = 0; d < inner.length; d++) out[d] = outer[inner[d]];
  return out;
}

// ─── tide station choice per (state, md) — replicate-dependent (§3/§7) ──────────
// Station = the gauge with the most residual_ft days in the −3..+10 window
// across ALL years (the spot's tidePool window), argmax with ties by station
// id asc (stations pre-sorted; strict > keeps the smaller id). Under rotation
// the whole tide store (values, coverage, station choice) reads through the
// remap (§7).
export interface TideChoice {
  st: Int16Array; // [mdCount] chosen station index, −1 = none
  cnt: Int32Array; // [mdCount] the chosen station's window day count (the useTide floor input)
}

export function tideChoiceFor(env: Env, si: number, remap: Int32Array | null): TideChoice | null {
  const S = env.st[si];
  if (S.stations.length === 0) return null;
  const { mdCount, mdBase, cal, T } = env;
  const ys = cal.yearSpan;
  const st = new Int16Array(mdCount).fill(-1);
  const cnt = new Int32Array(mdCount);
  for (let q = 0; q < mdCount; q++) {
    let bestJ = -1, bestC = 0;
    for (let j = 0; j < S.stations.length; j++) {
      const res = S.stations[j].res;
      let c = 0;
      for (let y = 0; y < ys; y++) {
        const b = mdBase[q * ys + y];
        if (b < 0) continue;
        for (let off = -WINDOW_DAYS; off <= WINDOW_AFTER; off++) {
          const p = b + off;
          if (p < 0 || p >= T) continue;
          if (Number.isFinite(res[remap ? remap[p] : p])) c++;
        }
      }
      if (c > bestC) { bestC = c; bestJ = j; }
    }
    st[q] = bestJ;
    cnt[q] = bestC;
  }
  return { st, cnt };
}

// ─── fnv (seed derivation — same idiom as the fusion sibling) ───────────────────
export function fnv(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ─── McNemar (DESCRIPTIVE ONLY, §7/§8) ──────────────────────────────────────────
// One-sided normal approximation on the discordant pairs: z = (b−c)/√(b+c),
// p = P(Z ≥ z). Serial correlation across index days makes this
// anti-conservative — it NEVER gates the primary; G0 uses it as a bar on a
// signal (regression to the mean) that should crush 1e-6 by orders of
// magnitude. Deterministic: erfc via Abramowitz–Stegun 7.1.26 + asymptotic
// tail for large z.
export function mcnemarOneSided(b: number, c: number): number {
  const n = b + c;
  if (n === 0) return 1;
  const z = (b - c) / Math.sqrt(n);
  return normalUpperTail(z);
}

export function normalUpperTail(z: number): number {
  if (z < 0) return 1 - normalUpperTail(-z);
  if (z > 6) {
    // asymptotic: φ(z)/z · (1 − 1/z²)
    const phi = Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
    return (phi / z) * (1 - 1 / (z * z));
  }
  // erfc(x) for x ≥ 0, A&S 7.1.26 (|err| ≤ 1.5e-7)
  const x = z / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 - erf);
}

// ─── replicate evaluation (§3–§6; the hot path) ─────────────────────────────────

export interface SubAcc {
  n: number;
  sum: number; // Σ (Hit_L − Hit_N) over paired days in the subgroup
}

export interface Funnel {
  indexDays: number;
  withHigh: number;
  withBaseline: number; // offMean(0) computable (LOYO ≥ 5 years)
  lEmpty: number;
  nEmpty: number;
  bothArms: number;
  lNoClaim: number; // L precedent thin/unparseable (the NO_CLAIM path)
  nNoClaim: number;
  claimsParsed: number;
  ungradeable: number; // either arm's grade UNGRADEABLE → pair dropped
  paired: number;
}

export interface RepStats {
  paired: number;
  delta: number | null; // Δ = mean(Hit_L − Hit_N)
  hitL: number;
  hitN: number;
  disc: { b: number; c: number }; // discordant pairs: b = (1,0), c = (0,1)
  funnel: Funnel;
  perState: SubAcc[];
  perMode: SubAcc[]; // [moon_tide_temp, moon_temp]
  perVerb: SubAcc[]; // [cooled, warmed, held] — stratified by the L-arm's (quoted) verb
  perEpoch: SubAcc[]; // [<1988, ≥1988]
  s1: SubAcc; // argmax-|z| subpopulation
  s6: { lN: number; lCooled: number; nN: number; nCooled: number }; // member-level pooled 2×2
  detail?: {
    verbMixL: number[]; // paired-day counts by L verb [cooled, warmed, held]
    verbMixN: number[];
    distinctPrecedentsL: number;
    distinctPrecedentsN: number;
    vintageMedianYearL: number | null;
    vintageMedianYearN: number | null;
    ungradeableL: number;
    ungradeableN: number;
    modePaired: number[]; // paired days per mode
  };
}

export interface EvalOpts {
  predicate: "lineup" | "g0";
  guardDays: number; // ±calendar-day anti-leakage guard (10 primary, 0 = S7 verbatim, 7/14 = S8)
  detail?: boolean;
  only?: { state: number; day: number }; // test-only: evaluate a single (state, index day)
}

/**
 * One full pass of the as-implemented rule over every (state, index day):
 * pool → A(d)/L(d)/N(d) → each arm's most-recent precedent (matches[0]
 * verbatim: date desc) → parse → grade → paired Δ. `remap` rotates the
 * moon+tide world against the fixed temperature ground (§7; null = observed).
 *
 * predicate "g0" (§8 positive control): identical machinery, one swap —
 * treatment = most-recent A(d) member, control = most-recent member of
 * pool \ A(d) (season-matched only).
 */
export function evalReplicate(env: Env, remap: Int32Array | null, opts: EvalOpts): RepStats {
  const { cal, T, mdOfDay, mdBase, moonAge, st, s1State } = env;
  const ys = cal.yearSpan;
  const g0 = opts.predicate === "g0";
  const guard = opts.guardDays;
  const detail = !!opts.detail;

  const funnel: Funnel = {
    indexDays: 0, withHigh: 0, withBaseline: 0, lEmpty: 0, nEmpty: 0,
    bothArms: 0, lNoClaim: 0, nNoClaim: 0, claimsParsed: 0, ungradeable: 0, paired: 0,
  };
  const mkAcc = (): SubAcc => ({ n: 0, sum: 0 });
  const perState = st.map(mkAcc);
  const perMode = [mkAcc(), mkAcc()];
  const perVerb = [mkAcc(), mkAcc(), mkAcc()];
  const perEpoch = [mkAcc(), mkAcc()];
  const s1 = mkAcc();
  const s6 = { lN: 0, lCooled: 0, nN: 0, nCooled: 0 };
  let paired = 0, sumDiff = 0, hitL = 0, hitN = 0, db = 0, dc = 0;
  let ungradeableL = 0, ungradeableN = 0;
  const verbMixL = [0, 0, 0], verbMixN = [0, 0, 0];
  const modePaired = [0, 0];
  const precSetL = detail ? new Set<number>() : null;
  const precSetN = detail ? new Set<number>() : null;
  const vintHistL = detail ? new Int32Array(ys) : null;
  const vintHistN = detail ? new Int32Array(ys) : null;

  const means = new Float64Array(7);

  for (let si = 0; si < st.length; si++) {
    if (opts.only && si !== opts.only.state) continue;
    const S = st[si];
    const tide = tideChoiceFor(env, si, remap);
    for (let d = 0; d < T; d++) {
      if (opts.only && d !== opts.only.day) continue;
      funnel.indexDays++;
      const h0 = S.high[d];
      if (!Number.isFinite(h0)) continue;
      funnel.withHigh++;

      const q = mdOfDay[d];
      const yi = cal.year[d] - cal.year0;

      // LOYO per-offset baselines (D2): total-minus-index-year
      for (let off = 0; off < 7; off++) {
        let sum = S.offSum[q * 7 + off];
        let cnt = S.offCnt[q * 7 + off];
        const p = d + off - WINDOW_DAYS;
        if (p >= 0 && p < T) {
          const v = S.high[p];
          if (Number.isFinite(v)) { sum -= v; cnt--; }
        }
        means[off] = cnt >= MIN_YEARS ? sum / cnt : NaN;
      }
      const m0 = means[WINDOW_DAYS];
      if (!Number.isFinite(m0)) continue;
      funnel.withBaseline++;
      const anomToday = h0 - m0;
      const nearNormal = Math.abs(anomToday) < TEMP_NEAR_F;
      const signToday = Math.sign(anomToday);

      // tide (§3): chosen gauge for this md; tide_today = residual on d, else
      // the most recent reading in [d−3, d]; useTide = window days ≥ 60 AND
      // tide_today ≠ null. The whole tide store reads through the remap (§7).
      let useTide = false;
      let tideToday = 0;
      let resArr: Float64Array | null = null;
      if (tide !== null) {
        const j = tide.st[q];
        if (j >= 0 && tide.cnt[q] >= LINEUP_MIN_TIDE_DAYS) {
          const res = S.stations[j].res;
          for (let dd = d; dd >= d - WINDOW_DAYS && dd >= 0; dd--) {
            const v = res[remap ? remap[dd] : dd];
            if (Number.isFinite(v)) { tideToday = v; useTide = true; break; }
          }
          if (useTide) resArr = res;
        }
      }
      const mode = useTide ? 0 : 1; // moon_tide_temp | moon_temp — the product's fallback
      const tideNear = Math.abs(tideToday) < TIDE_ELEV_FT;
      const tideSign = Math.sign(tideToday);
      const ageToday = moonAge[remap ? remap[d] : d];

      // candidate scan, date-DESC (years desc, offsets +3→−3): the first
      // member found per arm IS matches[0] (most-recent precedent, verbatim)
      let lIdx = -1, nIdx = -1;
      for (let yy = ys - 1; yy >= 0; yy--) {
        if (yy === yi) continue;
        const b = mdBase[q * ys + yy];
        if (b < 0) continue;
        for (let off = 6; off >= 0; off--) {
          const p = b + off - WINDOW_DAYS;
          if (p < 0 || p >= T) continue;
          const v = S.high[p];
          if (!Number.isFinite(v)) continue;
          const me = means[off];
          if (!Number.isFinite(me)) continue;
          if (guard > 0 && Math.abs(p - d) <= guard) continue; // D4 anti-leakage
          let r = 0;
          if (useTide) {
            r = resArr![remap ? remap[p] : p];
            if (!Number.isFinite(r)) continue; // pool requires a reading at the chosen station
          }
          const anom = v - me;
          const tempOk = nearNormal
            ? Math.abs(anom) < TEMP_NEAR_F
            : Math.sign(anom) === signToday && Math.abs(anom - anomToday) <= TEMP_TOL_F;

          let inL: boolean;
          if (g0) {
            inL = tempOk; // treatment = A(d); control = pool \ A(d)
          } else {
            if (!tempOk) continue; // outside A(d): neither arm
            const moonOk = moonAgeDist(moonAge[remap ? remap[p] : p], ageToday) <= MOON_TOL_DAYS;
            inL = moonOk && (!useTide || (tideNear
              ? Math.abs(r) < TIDE_ELEV_FT
              : Math.sign(r) === tideSign && Math.abs(r) >= TIDE_ELEV_FT));
          }
          if (inL) {
            if (lIdx < 0) lIdx = p;
            s6.lN++;
            s6.lCooled += S.cooled[p];
          } else {
            if (nIdx < 0) nIdx = p;
            s6.nN++;
            s6.nCooled += S.cooled[p];
          }
        }
      }

      if (lIdx < 0) { funnel.lEmpty++; continue; }
      if (nIdx < 0) { funnel.nEmpty++; continue; }
      funnel.bothArms++;

      const vL = S.verb[lIdx];
      const vN = S.verb[nIdx];
      if (vL === 0) funnel.lNoClaim++;
      if (vN === 0) funnel.nNoClaim++;
      if (vL === 0 || vN === 0) continue; // NO_CLAIM path: that arm makes no claim → not pair-eligible
      funnel.claimsParsed++;

      const gL = gradeClaim(S, d, vL, S.win[lIdx]);
      const gN = gradeClaim(S, d, vN, S.win[nIdx]);
      if (gL === 2 || gN === 2) {
        funnel.ungradeable++;
        if (gL === 2) ungradeableL++;
        if (gN === 2) ungradeableN++;
        continue;
      }

      paired++;
      funnel.paired++;
      const diff = gL - gN;
      sumDiff += diff;
      hitL += gL;
      hitN += gN;
      if (gL === 1 && gN === 0) db++;
      else if (gL === 0 && gN === 1) dc++;

      perState[si].n++; perState[si].sum += diff;
      perMode[mode].n++; perMode[mode].sum += diff;
      perVerb[vL - 1].n++; perVerb[vL - 1].sum += diff;
      const ep = cal.year[d] < EPOCH_SPLIT_YEAR ? 0 : 1;
      perEpoch[ep].n++; perEpoch[ep].sum += diff;
      if (s1State[d] === si) { s1.n++; s1.sum += diff; }

      if (detail) {
        verbMixL[vL - 1]++;
        verbMixN[vN - 1]++;
        modePaired[mode]++;
        precSetL!.add(si * T + lIdx);
        precSetN!.add(si * T + nIdx);
        vintHistL![cal.year[lIdx] - cal.year0]++;
        vintHistN![cal.year[nIdx] - cal.year0]++;
      }
    }
  }

  const medianOfHist = (h: Int32Array | null): number | null => {
    if (!h) return null;
    let total = 0;
    for (let i = 0; i < h.length; i++) total += h[i];
    if (total === 0) return null;
    let acc = 0;
    for (let i = 0; i < h.length; i++) {
      acc += h[i];
      if (acc * 2 >= total) return cal.year0 + i;
    }
    return null;
  };

  return {
    paired,
    delta: paired > 0 ? sumDiff / paired : null,
    hitL, hitN,
    disc: { b: db, c: dc },
    funnel,
    perState, perMode, perVerb, perEpoch, s1, s6,
    detail: detail
      ? {
          verbMixL, verbMixN,
          distinctPrecedentsL: precSetL!.size,
          distinctPrecedentsN: precSetN!.size,
          vintageMedianYearL: medianOfHist(vintHistL),
          vintageMedianYearN: medianOfHist(vintHistN),
          ungradeableL, ungradeableN,
          modePaired,
        }
      : undefined,
  };
}

// ─── spot-live parity evaluator (parity gate (b), §8) ───────────────────────────
// Reproduces the DEPLOYED hunt-atlas-spot lineup + control bookkeeping on a
// CURRENT date — NOT the registered retro semantics. The live quirks are kept
// on purpose (they are what the gate compares against):
//   - defendant = the most recent recorded year for the target month-day;
//   - the pool excludes the defendant YEAR but the per-offset baseline keeps
//     it (edge-of-archive bookkeeping — the thing D2 symmetrizes in the retro);
//   - NO ±10d anti-leakage guard (the thing D4 adds in the retro);
//   - tide_today = the most recent reading anywhere in the tidePool window
//     (not the retro's [d−3, d]);
//   - day-0 temperature basis is fed from the spot's own response
//     (anomaly.value — live feed for current dates), never recomputed here.
// Years beyond the store (e.g. 2026) contribute nothing — the archive edge is
// 2025-12; if the deployed spot ever sees rows this engine did not load, the
// EXACT-match comparison fails and stops the run (an honest code gate).

export interface SpotLiveResult {
  computable: boolean;
  reason: string | null;
  mode: string | null; // moon_tide_temp | moon_temp
  n_matches: number | null;
  last_date: string | null;
  n_days_searched: number | null;
  n_years: number | null;
  all_n: number | null;
  all_outcome_n: number | null;
  moon_age_today: number | null;
  tide_station_id: string | null;
}

export function spotLiveLineup(
  env: Env,
  si: number,
  targetIso: string,
  day0High: number | null, // the spot's own day-0 basis (response anomaly.value)
): SpotLiveResult {
  const { cal, T, moonAge } = env;
  const S = env.st[si];
  const ys = cal.yearSpan;
  const m = Number(targetIso.slice(5, 7));
  const dd = Number(targetIso.slice(8, 10));
  const none: SpotLiveResult = {
    computable: false, reason: null, mode: null, n_matches: null, last_date: null,
    n_days_searched: null, n_years: null, all_n: null, all_outcome_n: null,
    moon_age_today: null, tide_station_id: null,
  };

  // base index per store year for the target month-day (Date.UTC rollover,
  // exactly the spot's dateList construction)
  const base = new Int32Array(ys).fill(-1);
  for (let y = 0; y < ys; y++) {
    const idx = Math.round((Date.UTC(cal.year0 + y, m - 1, dd) - cal.ts0) / DAY_MS);
    if (idx >= 0 && idx < T) base[y] = idx;
  }

  // per-offset means over ALL years (spot's offSum — defendant year INCLUDED)
  const sums = new Float64Array(7);
  const cnts = new Int32Array(7);
  for (let y = 0; y < ys; y++) {
    if (base[y] < 0) continue;
    for (let off = 0; off < 7; off++) {
      const p = base[y] + off - WINDOW_DAYS;
      if (p < 0 || p >= T) continue;
      const v = S.high[p];
      if (Number.isFinite(v)) { sums[off] += v; cnts[off]++; }
    }
  }
  const offMean = (off: number): number =>
    cnts[off + WINDOW_DAYS] >= MIN_YEARS ? sums[off + WINDOW_DAYS] / cnts[off + WINDOW_DAYS] : NaN;

  // defendant = most recent year with an offset-0 high
  let defYi = -1;
  for (let y = ys - 1; y >= 0; y--) {
    if (base[y] >= 0 && Number.isFinite(S.high[base[y]])) { defYi = y; break; }
  }
  if (defYi < 0) return { ...none, reason: "no defendant (no recorded month-day on file)" };

  const meanAtZero = offMean(0);
  if (!Number.isFinite(meanAtZero)) return { ...none, reason: "offMean(0) below the 5-year floor" };
  if (day0High === null) return { ...none, reason: "no day-0 basis in the spot response" };
  const tempAnomToday = day0High - meanAtZero;

  // tide: argmax station over the −3..+10 window across ALL years, ties by
  // station id asc; tideToday = the most recent reading in the whole window.
  let tideStation: TideStationData | null = null;
  let tidePoolSize = 0;
  for (const stn of S.stations) {
    let c = 0;
    for (let y = 0; y < ys; y++) {
      if (base[y] < 0) continue;
      for (let off = -WINDOW_DAYS; off <= WINDOW_AFTER; off++) {
        const p = base[y] + off;
        if (p >= 0 && p < T && Number.isFinite(stn.res[p])) c++;
      }
    }
    if (c > tidePoolSize) { tidePoolSize = c; tideStation = stn; }
  }
  let tideToday: number | null = null;
  if (tideStation) {
    for (let y = ys - 1; y >= 0 && tideToday === null; y--) {
      if (base[y] < 0) continue;
      for (let off = WINDOW_AFTER; off >= -WINDOW_DAYS; off--) {
        const p = base[y] + off;
        if (p >= 0 && p < T && Number.isFinite(tideStation.res[p])) { tideToday = tideStation.res[p]; break; }
      }
    }
  }
  const useTide = tidePoolSize >= LINEUP_MIN_TIDE_DAYS && tideToday !== null;

  const moonToday = moonAgeOnDate(targetIso); // pure math on the target date itself
  const nearNormal = Math.abs(tempAnomToday) < TEMP_NEAR_F;
  const signToday = Math.sign(tempAnomToday);
  const tideNear = useTide ? Math.abs(tideToday!) < TIDE_ELEV_FT : false;
  const tideSign = useTide ? Math.sign(tideToday!) : 0;

  // matches loop (spot verbatim: no guard, searched counted before tempMatch)
  let searched = 0;
  const years = new Set<number>();
  let nMatches = 0;
  let lastIdx = -1;
  for (let y = 0; y < ys; y++) {
    if (y === defYi || base[y] < 0) continue;
    for (let off = -WINDOW_DAYS; off <= WINDOW_DAYS; off++) {
      const p = base[y] + off;
      if (p < 0 || p >= T) continue;
      const v = S.high[p];
      if (!Number.isFinite(v)) continue;
      const me = offMean(off);
      if (!Number.isFinite(me)) continue;
      let r = 0;
      if (useTide) {
        r = tideStation!.res[p];
        if (!Number.isFinite(r)) continue;
      }
      searched++;
      years.add(cal.year0 + y);
      const anom = v - me;
      const tempOk = nearNormal
        ? Math.abs(anom) < TEMP_NEAR_F
        : Math.sign(anom) === signToday && Math.abs(anom - tempAnomToday) <= TEMP_TOL_F;
      if (!tempOk) continue;
      if (useTide && !(tideNear
        ? Math.abs(r) < TIDE_ELEV_FT
        : Math.sign(r) === tideSign && Math.abs(r) >= TIDE_ELEV_FT)) continue;
      if (moonAgeDist(moonAge[p], moonToday) > MOON_TOL_DAYS) continue;
      nMatches++;
      if (p > lastIdx) lastIdx = p;
    }
  }

  // control line (spot verbatim): exact-day years ≠ defendant year with a
  // comparable aftermath (n ≥ 3); outcome = cooled ≥ 5°F in the next 7
  // recorded days (max_drop_f alone — the spot's cooled() helper).
  let allN = 0, allOutcomeN = 0;
  for (let y = 0; y < ys; y++) {
    if (y === defYi || base[y] < 0) continue;
    const p = base[y];
    if (!Number.isFinite(S.high[p])) continue;
    const nRecorded = 7 - popcount7(S.holeBits[p]);
    if (nRecorded < 3) continue;
    allN++;
    if (S.cooled[p] === 1) allOutcomeN++;
  }

  return {
    computable: true,
    reason: null,
    mode: useTide ? "moon_tide_temp" : "moon_temp",
    n_matches: nMatches,
    last_date: lastIdx >= 0 ? cal.iso[lastIdx] : null,
    n_days_searched: searched,
    n_years: years.size,
    all_n: allN,
    all_outcome_n: allOutcomeN,
    moon_age_today: moonToday,
    tide_station_id: useTide ? tideStation!.id : null,
  };
}

function popcount7(x: number): number {
  let c = 0;
  for (let k = 0; k < 7; k++) if (x & (1 << k)) c++;
  return c;
}
