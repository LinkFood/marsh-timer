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
  MAX_EDGE_TIE_FRACTION,
  MIN_DISTINCT_YEARS,
  MIN_MATCHES,
  decadeDistribution,
  epochDay,
  isoOfEpochDay,
  mergeEpisodes,
  refusalReason,
  type DecadeBar,
  type DecadeDistribution,
  type EdgeTies,
} from "./episodes.ts";

// Re-exported so a consumer needs ONE import for the whole engine and can never
// reach for a second definition of the window, the gap, or the floors.
export { DOY_HALF_WINDOW, DEFAULT_EPISODE_GAP_DAYS, MIN_MATCHES, MIN_DISTINCT_YEARS, MAX_EDGE_TIE_FRACTION };
export type { DecadeBar, DecadeDistribution, EdgeTies };

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
  /** How many days in the window share that edge value, and how many got in.
   *  `ties === tiesInBand` is a clean cut; a mass that straddles it is the tie
   *  floor's trigger and the reason a Louisiana snowfall card refuses itself. */
  edge: EdgeTies;
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

  // The band's edge: the warmest member of a cold tail, the coolest of a hot one.
  const threshold = slice.length ? (side === "low" ? slice[slice.length - 1].v : slice[0].v) : null;
  // …and how many days in the WHOLE window carry that same value. On a zero-inflated
  // series (precipitation, snow) this is most of the window, and it is the only thing
  // that tells the difference between a real 5% tail and a rank drawn through a pile
  // of identical zeros.
  let ties = 0, tiesInBand = 0;
  if (threshold !== null) {
    for (const m of pool) if (m.v === threshold) ties++;
    for (const m of slice) if (m.v === threshold) tiesInBand++;
  }
  const edge: EdgeTies = { ties, tiesInBand, take: slice.length };

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
    threshold,
    edge,
    dist: decadeDistribution(starts, poolYears),
    refusal: refusalReason(eps.length, years.length, edge),
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

/* ─────────────────────── the metrics this card can count ─────────────────── */

/**
 * ONE DICTIONARY FOR ONE METRIC. The bake reads it to know which fields to warm
 * and store, and the card reads it to know what to call them. Anything that
 * differs per metric — the tail, the units, the superlative, the sentence — lives
 * here and only here, because "78.9 °F or colder" does not translate to rain and a
 * card that reached for a generic phrase would say something false in a voice that
 * sounds careful.
 *
 * `side` IS A DECISION, not a default. A hunter asks the cold question of
 * temperature and the wet question of rain; the interesting tail is not the same
 * tail, and assuming one direction is how a "driest 1%" band gets shipped over a
 * pile of identical zeros. Each entry says which tail it counts and why.
 */
export interface CardMetric {
  metric: string;
  /** The chip's label — what a hunter would call it. */
  label: string;
  /** One line under the chip: what the number physically is. */
  note: string;
  /** THE TAIL THIS CARD COUNTS. */
  side: TailSide;
  /** Why that tail, in the reader's terms. Rendered in the receipts. */
  sideWhy: string;
  unit: string;
  decimals: number;
  /**
   * PHYSICALLY POSSIBLE RANGE, inclusive. Anything outside it is a sentinel, not a
   * reading, and is dropped at bake time as "no reading" rather than stored.
   *
   * This is not a smoothing rule and it is not an outlier filter — the bounds are
   * set outside the American record on purpose, so they can only ever catch a
   * marker. Measured across all 50 states, 1950–2025, 9.7M readings, exactly 19
   * values fall outside: CO's `min_temp_f` carries −474 °F on nine days (below
   * absolute zero), CA's `max_precip_in` carries 88.12 in twice (the US 24-hour
   * record is 43 in), MT carries −14.6 in of snowfall once and 9999/1000 in of
   * snow depth six times, NE once.
   *
   * Nineteen values in 9.7M sounds ignorable. It is not, and this is the reason
   * the filter is here rather than in a comment: the card counts the TAIL, and a
   * sentinel is by construction the most extreme member of it. Unfiltered, every
   * Colorado cold card within ten days of April 2 would have opened with "a
   * reading of −474 °F or colder somewhere in Colorado."
   */
  plausible: [number, number];
  /**
   * True where most days in the record hold the series' floor value (0.00 in).
   * The opposite tail of a zero-inflated series is not a tail at all — it is the
   * mass — so the card never offers it, and the tie floor refuses it anyway if
   * anyone ever wires it. Measured per metric, not assumed: see
   * `scripts/frames/measure-zero-fraction.ts`.
   */
  zeroInflated: boolean;
  superlative: { low: { sup: string; noun: string }; high: { sup: string; noun: string } };
}

/**
 * The seven GHCN state-day fields the archive already carries, in card order.
 * Six of these were sitting in `hunt_knowledge` unused while the card counted only
 * the first — no new ingest, no new content type, no board layout change.
 */
export const CARD_METRICS: CardMetric[] = [
  {
    metric: "avg_high_f",
    label: "daytime high",
    note: "the state's stations, averaged, at the day's warmest",
    side: "low", sideWhy: "the cold end — a hunter watches for the cold, not the heat",
    unit: "°F", decimals: 1, plausible: [-100, 150], zeroInflated: false,
    superlative: { low: { sup: "coldest", noun: "days" }, high: { sup: "warmest", noun: "days" } },
  },
  {
    metric: "avg_low_f",
    label: "overnight low",
    note: "the state's stations, averaged, at the night's coldest",
    side: "low", sideWhy: "the cold end — this is the freeze question",
    unit: "°F", decimals: 1, plausible: [-100, 150], zeroInflated: false,
    superlative: { low: { sup: "coldest", noun: "nights" }, high: { sup: "mildest", noun: "nights" } },
  },
  {
    metric: "min_temp_f",
    label: "coldest in the state",
    note: "the single coldest station reading anywhere in the state that day",
    side: "low", sideWhy: "the cold end — where the freeze arrives first",
    unit: "°F", decimals: 0, plausible: [-100, 150], zeroInflated: false,
    superlative: { low: { sup: "coldest", noun: "nights" }, high: { sup: "warmest", noun: "nights" } },
  },
  {
    metric: "avg_precip_in",
    label: "rain, statewide",
    note: "the state's stations, averaged — a soaking everywhere beats a cell somewhere",
    side: "high", sideWhy: "the wet end — the question is how often it has rained THIS much, not how often it was dry",
    unit: "in", decimals: 2, plausible: [0, 30], zeroInflated: true,
    superlative: { low: { sup: "driest", noun: "days" }, high: { sup: "wettest", noun: "days" } },
  },
  {
    metric: "max_precip_in",
    label: "rain, wettest station",
    note: "the single wettest station anywhere in the state that day",
    side: "high", sideWhy: "the wet end — this is the downpour, not the drizzle",
    unit: "in", decimals: 2, plausible: [0, 45], zeroInflated: true,
    superlative: { low: { sup: "driest", noun: "days" }, high: { sup: "wettest", noun: "days" } },
  },
  {
    metric: "snowfall_in",
    label: "snowfall",
    note: "the state's stations, averaged — new snow that fell that day",
    side: "high", sideWhy: "the snowy end — a dry day is the default here, not an event",
    unit: "in", decimals: 1, plausible: [0, 80], zeroInflated: true,
    superlative: { low: { sup: "least snowy", noun: "days" }, high: { sup: "snowiest", noun: "days" } },
  },
];

/**
 * `snow_depth_in` IS DELIBERATELY NOT HERE. It is the seventh `ghcn-daily` field
 * and it was measured, wired far enough to render, and then cut. Four independent
 * reasons, any one of which would have been enough:
 *
 *  1. IT CANNOT BE STORED EXACTLY. After the sentinels are dropped it still runs
 *     to 455 in at two decimals. `pickScale` needs ×100 for that precision, and
 *     455 × 100 = 45,500 overflows int16. The encoder throws rather than round, by
 *     design, so the bake would fail — and rounding it would be quietly changing a
 *     number to make a chart possible.
 *  2. IT IS THE MOST SENTINEL-INFECTED FIELD. Montana carries 9999 in and six
 *     days of 1000 in; Nebraska one more.
 *  3. IT IS THE MOST ZERO-INFLATED after snowfall — 61.8% nationally, 99.8% in
 *     Hawaii, 95%+ across the whole South.
 *  4. AND EVEN WHERE IT IS REAL IT REFUSES. Lying snow is not an event, it is a
 *     condition: it persists for weeks, so Ruling 2's episode merge collapses the
 *     deepest 5% of North Dakota's mid-January days into 8 occasions across 6
 *     years, which is under the 10-year floor at every band we offer.
 *
 * The fourth reason is the interesting one and it is not about data quality. A
 * frequency card asks "how often has this happened," and a persistent state does
 * not happen — it obtains. The card's grammar does not fit the variable.
 */

export const CARD_METRICS_ID = CARD_METRICS.map((m) => m.metric);

export const CARD_METRIC_BY_ID: Record<string, CardMetric> = Object.fromEntries(
  CARD_METRICS.map((m) => [m.metric, m]),
);

/**
 * Drop the sentinels, and SAY HOW MANY. A dropped day becomes no-reading, exactly
 * like a calendar gap — never zero, never interpolated, never carried forward.
 *
 * Returns the count so the bake can print it, because a filter that runs silently
 * is a filter nobody can audit. If this number ever grows, the archive's faucet
 * has a new defect and the bake log is where it surfaces.
 */
export function sanitizeSeries(
  metric: string,
  series: Map<string, number>,
): { clean: Map<string, number>; dropped: { iso: string; v: number }[] } {
  const cm = CARD_METRIC_BY_ID[metric];
  if (!cm) return { clean: series, dropped: [] };
  const [lo, hi] = cm.plausible;
  const clean = new Map<string, number>();
  const dropped: { iso: string; v: number }[] = [];
  for (const [iso, v] of series) {
    if (!Number.isFinite(v) || v < lo || v > hi) dropped.push({ iso, v });
    else clean.set(iso, v);
  }
  return { clean, dropped };
}

/* ────────────────────────── phrasing (honesty-critical) ──────────────────── */

/**
 * THE SENTENCE'S SUBJECT, whole — "a daytime high of 58.2 °F or colder over
 * Maryland", "2.20 in of rain or more somewhere in Maryland".
 *
 * The place belongs INSIDE this function, not glued on after it, because where the
 * reading was taken is part of what the number means and it differs per metric.
 * `avg_*` is an average ACROSS the state; `min_temp_f` and `max_precip_in` are the
 * single most extreme station SOMEWHERE in it. Appending a fixed "over Maryland"
 * to every metric produced "3.36 in of rain or more somewhere in the state over
 * Maryland" — two prepositional phrases fighting, and the wrong one load-bearing.
 *
 * Every case is written out rather than assembled from parts. A rain sentence and a
 * temperature sentence are different English, and a template that could produce
 * "a daytime rain of 0.43 in or colder" is exactly what this table exists to stop.
 */
export function subjectPhrase(
  metric: string,
  side: TailSide,
  threshold: number | null,
  place: string,
): string {
  if (threshold === null) {
    return side === "low" ? `a reading this low over ${place}` : `a reading this high over ${place}`;
  }
  const cm = CARD_METRIC_BY_ID[metric];
  if (cm) {
    const v = `${threshold.toFixed(cm.decimals)} ${cm.unit}`;
    switch (metric) {
      case "avg_high_f":
        return `a daytime high of ${v} ${side === "low" ? "or colder" : "or warmer"} over ${place}`;
      case "avg_low_f":
        return `an overnight low of ${v} ${side === "low" ? "or colder" : "or warmer"} over ${place}`;
      case "min_temp_f":
        return side === "low"
          ? `a reading of ${v} or colder somewhere in ${place}`
          : `nothing in ${place} colder than ${v}`;
      case "avg_precip_in":
        return side === "high"
          ? `${v} of rain or more, averaged across ${place}`
          : `${v} of rain or less, averaged across ${place}`;
      case "max_precip_in":
        return side === "high"
          ? `${v} of rain or more somewhere in ${place}`
          : `nothing in ${place} above ${v} of rain`;
      case "snowfall_in":
        return side === "high"
          ? `${v} of new snow or more, averaged across ${place}`
          : `${v} of new snow or less, averaged across ${place}`;
      case "snow_depth_in":
        return side === "high"
          ? `${v} of snow on the ground or more, averaged across ${place}`
          : `${v} of snow on the ground or less, averaged across ${place}`;
    }
  }
  switch (metric) {
    case "pressure_mb":
    case "min_pressure_mb":
      return `a surface pressure of ${threshold.toFixed(1)} mb ${side === "low" ? "or lower" : "or higher"} over ${place}`;
    case "residual_max_ft":
    case "residual_min_ft":
      return `a tide residual of ${threshold.toFixed(2)} ft ${side === "low" ? "or lower" : "or higher"} at ${place}`;
    default:
      return `a reading of ${threshold} ${side === "low" ? "or lower" : "or higher"} at ${place}`;
  }
}

/** "coldest 5%" / "wettest 5%" — the band's name, two words, for a chip. */
export function bandLabel(metric: string, band: number, side: TailSide): string {
  const pct = band < 0.01 ? (band * 100).toFixed(1) : String(Math.round(band * 1000) / 10);
  const sup = CARD_METRIC_BY_ID[metric]?.superlative[side].sup ?? (side === "low" ? "lowest" : "highest");
  return `${sup} ${pct}%`;
}

/** "the coldest 5% of days at this time of year" — what the band IS, in words. */
export function bandPhrase(metric: string, band: number, side: TailSide): string {
  const noun = CARD_METRIC_BY_ID[metric]?.superlative[side].noun ?? "days";
  return `the ${bandLabel(metric, band, side)} of ${noun} at this time of year`;
}
