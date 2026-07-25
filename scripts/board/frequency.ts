/**
 * frequency.ts — THE COUNTING ENGINE behind the frequency card.
 *
 * One sentence is the whole product:
 *
 *   A daytime high of 58 °F or colder over Maryland, within ten days of
 *   October 10, has happened 46 times since 1950.
 *
 * This module turns one `board_series_columns` row into that sentence's numbers
 * and refuses to produce them when the floors say refuse. It is the query-time
 * half of scripts/frames/bake-series-columns.ts and it is byte-identical in
 * behaviour to scripts/frames/bake-luts.ts `bandFacts` — the committed
 * definition of a match — which `--verify` proves pool-for-pool.
 *
 * PURE: imports only ./episodes.ts and ./tailDepth.ts, both of which are
 * themselves import-free. No fs, no fetch, no Node globals. Runs unmodified in
 * tsx, in Deno and in the browser (plan §6's "thin service layer").
 *
 * ONE DEFINITION OF A "TIME": episodes.ts. Never a second one. The ±10-vs-±15
 * split that Ruling 1 closed is the reason this file imports rather than
 * reimplements — two subsystems holding two definitions of one concept is the
 * defect that invalidated a whole analysis once already.
 *
 * WHAT THIS DOES NOT DO, on purpose (Amendment 1.3 Ruling 4): no forward join,
 * no what-followed, no rate, no Wilson interval. A census is a complete
 * enumeration of the archive, not a sample, and takes no confidence interval
 * (Ruling 4b). There is nothing here to bound.
 */

import { DOY_HALF_WINDOW, doyOffset } from "./tailDepth.ts";
import {
  DEFAULT_EPISODE_GAP_DAYS,
  MIN_DISTINCT_YEARS,
  MIN_MATCHES,
  decadeDistribution,
  epochDay,
  isoOfEpochDay,
  mergeEpisodes,
  refusalReason,
  type DecadeBar,
  type DecadeDistribution,
} from "./episodes.ts";

// Re-exported so a consumer needs ONE import for the whole engine and can never
// reach for a second definition of the window, the gap, or the floors.
export { DOY_HALF_WINDOW, DEFAULT_EPISODE_GAP_DAYS, MIN_MATCHES, MIN_DISTINCT_YEARS };
export type { DecadeBar, DecadeDistribution };

/* ─────────────────────────── the column encoding ─────────────────────────── */

/** No reading. The int16 minimum, so no scaled value can ever collide with it. */
export const MISSING = -32768;
const INT16_MAX = 32767;
/** Candidate scales, ascending. The bake picks the smallest that is exact. */
export const SCALES = [1, 10, 100, 1000] as const;

/** A `board_series_columns` row exactly as PostgREST hands it back. */
export interface SeriesColumnRow {
  instrument_id: string;
  metric: string;
  first_day: string;
  n_days: number;
  scale: number;
  /** bytea over PostgREST: a `\x…` hex string. */
  readings: string;
  n_present: number;
  first_year: number;
  last_year: number;
  source: string;
}

/** The decoded column, ready to be sliced. */
export interface SeriesColumn {
  instrumentId: string;
  metric: string;
  /** Epoch day of byte offset 0. */
  firstDay: number;
  scale: number;
  /** One entry per contiguous day. MISSING where there is no reading. */
  raw: Int16Array;
  nPresent: number;
  firstYear: number;
  lastYear: number;
  source: string;
}

/** `\x48656c` → bytes. Throws on anything that is not clean hex — a truncated
 *  blob read at the wrong offset would silently count the wrong calendar. */
export function decodeHexBytea(hex: string): Uint8Array {
  const s = hex.startsWith("\\x") ? hex.slice(2) : hex.startsWith("\x00") ? hex.slice(1) : hex;
  if (s.length % 2 !== 0) throw new Error(`bytea hex has odd length ${s.length}`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(s.substr(i * 2, 2), 16);
    if (!Number.isFinite(b)) throw new Error(`bytea hex is not hex at byte ${i}`);
    out[i] = b;
  }
  return out;
}

export function decodeSeriesColumn(row: SeriesColumnRow): SeriesColumn {
  const bytes = decodeHexBytea(row.readings);
  if (bytes.length !== row.n_days * 2) {
    throw new Error(`board_series_columns ${row.instrument_id}:${row.metric} — ${bytes.length} bytes for ${row.n_days} days`);
  }
  const raw = new Int16Array(row.n_days);
  for (let i = 0; i < row.n_days; i++) {
    const u = (bytes[i * 2] << 8) | bytes[i * 2 + 1];
    raw[i] = u >= 0x8000 ? u - 0x10000 : u; // big-endian, signed
  }
  return {
    instrumentId: row.instrument_id,
    metric: row.metric,
    firstDay: epochDay(row.first_day),
    scale: row.scale,
    raw,
    nPresent: row.n_present,
    firstYear: row.first_year,
    lastYear: row.last_year,
    source: row.source,
  };
}

export interface EncodedColumn {
  firstDay: string;
  nDays: number;
  scale: number;
  bytes: Uint8Array;
  nPresent: number;
  firstYear: number;
  lastYear: number;
  minValue: number | null;
  maxValue: number | null;
}

/**
 * ISO-date → value series into the wire format. Lives beside the decoder so the
 * round trip can never drift; `--verify` asserts decode(encode(x)) === x on every
 * present day of every series.
 *
 * The scale is MEASURED, not assumed: the smallest power of ten that makes every
 * reading an exact integer inside int16. If none does, this throws rather than
 * quietly rounding a hunter's number.
 */
export function encodeSeriesColumn(series: Map<string, number>): EncodedColumn {
  const present: { day: number; v: number }[] = [];
  for (const [iso, v] of series) if (Number.isFinite(v)) present.push({ day: epochDay(iso), v });
  if (present.length === 0) throw new Error("encodeSeriesColumn: series holds no finite readings");
  present.sort((a, b) => a.day - b.day);

  const scale = pickScale(present.map((p) => p.v));
  const firstDay = present[0].day;
  const lastDay = present[present.length - 1].day;
  const nDays = lastDay - firstDay + 1;

  const bytes = new Uint8Array(nDays * 2);
  // Fill the whole column with the sentinel first: a calendar gap is stored, never
  // skipped, because the offset IS the date.
  for (let i = 0; i < nDays; i++) {
    bytes[i * 2] = 0x80;
    bytes[i * 2 + 1] = 0x00;
  }
  let minValue = Infinity, maxValue = -Infinity;
  for (const p of present) {
    const scaled = Math.round(p.v * scale);
    const i = p.day - firstDay;
    bytes[i * 2] = (scaled >> 8) & 0xff;
    bytes[i * 2 + 1] = scaled & 0xff;
    if (p.v < minValue) minValue = p.v;
    if (p.v > maxValue) maxValue = p.v;
  }

  return {
    firstDay: isoOfEpochDay(firstDay),
    nDays,
    scale,
    bytes,
    nPresent: present.length,
    firstYear: +isoOfEpochDay(firstDay).slice(0, 4),
    lastYear: +isoOfEpochDay(lastDay).slice(0, 4),
    minValue,
    maxValue,
  };
}

function pickScale(values: number[]): number {
  for (const scale of SCALES) {
    let ok = true;
    for (const v of values) {
      const scaled = v * scale;
      const r = Math.round(scaled);
      // exact at this scale, inside int16, and never the sentinel
      if (Math.abs(scaled - r) > 1e-9 || r > INT16_MAX || r <= MISSING) { ok = false; break; }
    }
    if (ok) return scale;
  }
  throw new Error("encodeSeriesColumn: no scale in {1,10,100,1000} represents this series exactly inside int16");
}

/** Uint8Array → the `\x…` literal PostgREST/Postgres accept for a bytea. */
export function toByteaHex(bytes: Uint8Array): string {
  let s = "\\x";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

/* ──────────────────────────────── the pool ───────────────────────────────── */

export interface PoolMember {
  /** Physical units — °F, ft, mb, index value. */
  v: number;
  /** Epoch day. */
  day: number;
  year: number;
}

/**
 * Every day within `halfWindow` calendar days of `targetMmdd`, in every year the
 * column covers, sorted ASCENDING BY VALUE with ties broken by day.
 *
 * Rank-ordered on purpose: a band is then a contiguous slice, which is exactly
 * how bake-luts.ts stores and slices its `days[]`. Membership uses the shared
 * `doyOffset`, so the pool is member-for-member the pool the bake builds.
 * (`doyOffset` runs a non-leap ordinal table: February 29 shares an ordinal with
 * March 1. That is the committed behaviour, not an approximation introduced here.)
 */
export function poolForDoy(
  col: SeriesColumn,
  targetMmdd: string,
  halfWindow: number = DOY_HALF_WINDOW,
  minYear = -Infinity,
): PoolMember[] {
  const target = `2000-${targetMmdd}`;
  const pool: PoolMember[] = [];
  for (let i = 0; i < col.raw.length; i++) {
    const r = col.raw[i];
    if (r === MISSING) continue;
    const iso = isoOfEpochDay(col.firstDay + i);
    const year = +iso.slice(0, 4);
    if (year < minYear) continue;
    if (doyOffset(iso, target) > halfWindow) continue;
    pool.push({ v: r / col.scale, day: col.firstDay + i, year });
  }
  pool.sort((a, b) => a.v - b.v || a.day - b.day);
  return pool;
}

/* ─────────────────────────────── the census ──────────────────────────────── */

export type TailSide = "low" | "high";

export interface BandCensus {
  side: TailSide;
  /** Fraction of the pool the band takes, e.g. 0.05. */
  band: number;
  gapDays: number;
  /** Every day in the doy window, across every year — the denominator. */
  poolN: number;
  /** Distinct calendar years the pool draws from. */
  poolYears: number[];
  /** Matched calendar days before episodes are merged. Diagnostic, never the headline. */
  matchedDays: number;
  /** Ruling 2's "times": occasions, not days. THE headline number. */
  count: number;
  /** Distinct calendar years the episodes START in. Floor 1 runs on this. */
  years: number[];
  /** START date of the most recent episode (Ruling 2), not the most recent day. */
  lastOccurrence: string | null;
  /** The band's edge in physical units — "this deep", made concrete. */
  threshold: number | null;
  dist: DecadeDistribution;
  /** Non-null means we do not state a frequency. Floors are refusals, not targets. */
  refusal: string | null;
}

/**
 * The band is a rank window over the pool; the pool is rank-ordered; so the band
 * is a contiguous slice, and the episodes, years, most-recent start and decade
 * shape all fall straight out of it.
 *
 * Slice arithmetic is bake-luts.ts `bandFacts` verbatim — `floor(lo·n)` to
 * `ceil(hi·n)` — so a low-tail band of `b` is `[0, ceil(b·n))` and a high-tail
 * band of `b` is `[n − ceil(b·n), n)`.
 */
export function bandCensus(
  pool: PoolMember[],
  band: number,
  side: TailSide = "low",
  gapDays: number = DEFAULT_EPISODE_GAP_DAYS,
): BandCensus {
  const n = pool.length;
  const poolYears = [...new Set(pool.map((m) => m.year))].sort((a, b) => a - b);
  const take = Math.min(n, Math.ceil(band * n));
  const lo = side === "low" ? 0 : n - take;
  const hi = side === "low" ? take : n;
  const slice = pool.slice(lo, hi);

  const eps = mergeEpisodes(slice.map((m) => m.day), gapDays);
  const starts = eps.map((e) => e.startDay);
  const years = [...new Set(starts.map((d) => +isoOfEpochDay(d).slice(0, 4)))].sort((a, b) => a - b);

  return {
    side,
    band,
    gapDays,
    poolN: n,
    poolYears,
    matchedDays: slice.length,
    count: eps.length,
    years,
    lastOccurrence: eps.length ? isoOfEpochDay(starts[starts.length - 1]) : null,
    // The band's edge: the warmest member of a cold tail, the coolest of a hot one.
    threshold: slice.length ? (side === "low" ? slice[slice.length - 1].v : slice[0].v) : null,
    dist: decadeDistribution(starts, poolYears),
    refusal: refusalReason(eps.length, years.length),
  };
}

/* ────────────────────────── phrasing (honesty-critical) ──────────────────── */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "October 10" from an `MM-DD`. */
export function mmddLabel(mmdd: string): string {
  const [m, d] = mmdd.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/**
 * The window, said out loud and said correctly.
 *
 * The plan's exemplar sentence calls a ±10-day window "the second week of
 * October". It is not: ±10 days around October 10 is September 30 through
 * October 20, three weeks. Naming a 21-day window as a 7-day one overclaims
 * precision in exactly the direction "Maryland statewide. Not your marsh."
 * exists to guard against, so the card says the window it actually used.
 */
export function windowPhrase(targetMmdd: string, halfWindow: number = DOY_HALF_WINDOW): {
  short: string;
  span: string;
} {
  const [m, d] = targetMmdd.split("-").map(Number);
  const anchor = Date.UTC(2001, m - 1, d); // non-leap anchor, matching doyOffset's ordinal table
  const at = (off: number) => {
    const t = new Date(anchor + off * 86400000);
    return `${MONTHS[t.getUTCMonth()]} ${t.getUTCDate()}`;
  };
  return {
    short: `within ${halfWindow} days of ${mmddLabel(targetMmdd)}`,
    span: `${at(-halfWindow)} – ${at(halfWindow)}`,
  };
}

/** "a daytime high of 58 °F or colder" — the band's edge in the reader's units. */
export function thresholdPhrase(metric: string, side: TailSide, threshold: number | null): string {
  if (threshold === null) return side === "low" ? "a reading this low" : "a reading this high";
  const dir = side === "low" ? "or colder" : "or warmer";
  switch (metric) {
    case "avg_high_f":
      return `a daytime high of ${threshold.toFixed(1)} °F ${dir}`;
    case "pressure_mb":
    case "min_pressure_mb":
      return `a surface pressure of ${threshold.toFixed(1)} mb ${side === "low" ? "or lower" : "or higher"}`;
    case "residual_max_ft":
    case "residual_min_ft":
      return `a tide residual of ${threshold.toFixed(2)} ft ${side === "low" ? "or lower" : "or higher"}`;
    default:
      return `a reading of ${threshold} ${side === "low" ? "or lower" : "or higher"}`;
  }
}

/** "the coldest 5% of days at this time of year" — what the band IS, in words. */
export function bandPhrase(band: number, side: TailSide): string {
  const pct = band < 0.01 ? (band * 100).toFixed(1) : String(Math.round(band * 1000) / 10);
  return `the ${side === "low" ? "coldest" : "warmest"} ${pct}% of days at this time of year`;
}
