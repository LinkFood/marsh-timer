/**
 * tailDepth.ts — the percentile that swells an ember (spine §2).
 *
 * Generalizes Rung 1's coldPct / highPct / stateBaseline into ONE direction-aware
 * rule so a single registry tells every story: a February freeze and a July heat
 * wave swell the same state dot; Uri's arctic ridge and Sandy's storm low light
 * the same buoy (opposite slots). No per-story hardcoding.
 *
 * A metric declares a `direction`:
 *   'low'       — deeper = smaller value  (tide setdown residual_min, storm min_pressure)
 *   'high'      — deeper = larger value   (surge residual_max, arctic ridge pressure)
 *   'two-sided' — either tail is unusual  (state avg_high_f: cold snap AND heat wave)
 *
 * The pool is same-day-of-year ±N across all recorded years (spine §2.1). The
 * honesty floor (§2.5): ≥10 distinct years → full swell; 1–9 → renders but clamps
 * to a faint cap, flagged low-confidence; 0 → absent.
 */

export type Direction = "low" | "high" | "two-sided";

export const FULL_SWELL_MIN_YEARS = 10; // spine §2.5, matches morning-line n_years≥10
const LOW_CONFIDENCE_CAP = 0.6; // a thin baseline may never claim "deepest in history"

/** Calendar-day distance ignoring year, with Dec/Jan wrap (Rung 1's doyOffset). */
export function doyOffset(aIso: string, bIso: string): number {
  const md = (s: string) => {
    const [, m, dd] = s.split("-").map(Number);
    return { m, dd };
  };
  const A = md(aIso), B = md(bIso);
  const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const ord = (m: number, dd: number) => cum[m - 1] + dd;
  let diff = Math.abs(ord(A.m, A.dd) - ord(B.m, B.dd));
  if (diff > 182) diff = 365 - diff;
  return diff;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** One-sided rank of `v` within `pool` on the LOW tail: extreme-small → 1.0.
 *  (Rung 1 coldPct: below = count strictly less than v; return 1 − below/n.) */
function lowRank(v: number, pool: number[]): number {
  if (pool.length === 0) return 0;
  let below = 0;
  for (const p of pool) if (p < v) below++;
  return 1 - below / pool.length;
}
/** One-sided rank of `v` within `pool` on the HIGH tail: extreme-large → 1.0.
 *  (Rung 1 highPct: below = count strictly less than v; return below/n.) */
function highRank(v: number, pool: number[]): number {
  if (pool.length === 0) return 0;
  let below = 0;
  for (const p of pool) if (p < v) below++;
  return below / pool.length;
}

export interface TailResult {
  pct: number | null; // 0..1 depth into the danger tail; null = no usable pool
  won: "low" | "high" | null; // which tail won (two-sided coloring: blue cold / red hot)
  lowConfidence: boolean; // pool had 1–9 years — rendered but clamped
}

/**
 * Depth of `value` into its metric's danger tail vs a same-doy pool.
 * A two-sided metric renders the LARGER of its two tails and reports which won,
 * so the spine's "one stored slot is one-sided" packing needs no sign byte —
 * a two-sided instrument simply occupies two slots (low, high) and the board
 * renders max(). This function computes ONE slot's pct for a given direction;
 * for 'two-sided' it evaluates both tails and returns the winner.
 */
export function tailDepth(
  value: number,
  pool: number[],
  direction: Direction,
  years: number,
): TailResult {
  if (pool.length === 0) return { pct: null, won: null, lowConfidence: false };

  let pct: number, won: "low" | "high";
  if (direction === "low") {
    pct = lowRank(value, pool);
    won = "low";
  } else if (direction === "high") {
    pct = highRank(value, pool);
    won = "high";
  } else {
    const lo = lowRank(value, pool), hi = highRank(value, pool);
    if (lo >= hi) { pct = lo; won = "low"; } else { pct = hi; won = "high"; }
  }

  const lowConfidence = years < FULL_SWELL_MIN_YEARS;
  if (lowConfidence) pct = Math.min(pct, LOW_CONFIDENCE_CAP);
  return { pct: round3(pct), won, lowConfidence };
}

/** Number of distinct calendar years represented in a set of ISO dates. */
export function distinctYears(dates: string[]): number {
  const s = new Set<string>();
  for (const d of dates) s.add(d.slice(0, 4));
  return s.size;
}

/**
 * Slice a same-doy ±N pool out of an instrument's full series, in memory
 * (spine §4.2: load-all-once, slide the window). `series` maps ISO date → value.
 * Returns the pool values and the distinct-year count for the honesty floor.
 */
export function poolForDay(
  series: Map<string, number>,
  day: string,
  nDays: number,
): { pool: number[]; years: number } {
  const pool: number[] = [];
  const dates: string[] = [];
  for (const [d, v] of series) {
    if (doyOffset(d, day) <= nDays && Number.isFinite(v)) {
      pool.push(v);
      dates.push(d);
    }
  }
  return { pool, years: distinctYears(dates) };
}
