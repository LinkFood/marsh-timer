/**
 * episodes.ts — "times", not days (Amendment 1.3 Ruling 2).
 *
 * The card says *"has happened 34 times."* Every human reader takes "times" to mean
 * occasions, not calendar days. A four-day cold snap is ONE time. This module is the
 * single definition of that merge, and of the decade distribution built on top of it
 * (Ruling 10.4), so the bake and the browser card can never disagree about what a
 * "time" is — the same class of defect as the ±10/±15 window split Ruling 1 closed.
 *
 * PURE: zero imports, no fs, no fetch, no Node globals. Runs unmodified in tsx, Deno
 * and the browser (plan §3's "thin service layer" rule).
 *
 * DAY REPRESENTATION: an epoch day — whole days since 1970-01-01 UTC, so the gap
 * between two days is a subtraction and no timezone can move a date. Negative before
 * 1970 (the archive starts 1950); that is fine and intentional.
 */

/**
 * Non-matched days tolerated INSIDE one episode. 0 = only strictly consecutive
 * matched days merge; 1 = one missed day still counts as the same occasion.
 *
 * PROVISIONAL. Ruling 2: "report sensitivity at 0-day, 1-day and 2-day gap tolerance
 * before fixing it. Pick from the data, not from taste." The value is picked once the
 * ERA5 pressure delta lands; until then every baked row carries the gap it was
 * computed at (`board_pool_luts.episode_gap_days`) so two gaps can never be silently
 * compared — the same discipline Ruling 10.3 imposes on the ERA5 sampling scheme.
 */
export const DEFAULT_EPISODE_GAP_DAYS = 1;

const MS_PER_DAY = 86400000;

/** ISO 'YYYY-MM-DD' → whole days since 1970-01-01 UTC. */
export function epochDay(iso: string): number {
  return Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / MS_PER_DAY);
}
/** Whole days since 1970-01-01 UTC → ISO 'YYYY-MM-DD'. */
export function isoOfEpochDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}
/** Calendar year of an epoch day. */
export function yearOfEpochDay(day: number): number {
  return new Date(day * MS_PER_DAY).getUTCFullYear();
}

export type Episode = { startDay: number; endDay: number; matchedDays: number };

/**
 * Merge matched days into occasions. Two matched days join the same episode when at
 * most `gapDays` non-matched days sit between them (so `d` and `d + gapDays + 1` are
 * still one episode). Input order does not matter; a copy is sorted.
 */
export function mergeEpisodes(days: readonly number[], gapDays: number): Episode[] {
  if (days.length === 0) return [];
  const sorted = [...days].sort((a, b) => a - b);
  const out: Episode[] = [];
  let startDay = sorted[0], endDay = sorted[0], matchedDays = 1;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i];
    if (d === endDay) continue; // same calendar day twice — still one day
    if (d - endDay <= gapDays + 1) { endDay = d; matchedDays++; }
    else { out.push({ startDay, endDay, matchedDays }); startDay = d; endDay = d; matchedDays = 1; }
  }
  out.push({ startDay, endDay, matchedDays });
  return out;
}

/** Distinct calendar years present in a set of epoch days, ascending. */
export function distinctYears(days: readonly number[]): number[] {
  const s = new Set<number>();
  for (const d of days) s.add(yearOfEpochDay(d));
  return [...s].sort((a, b) => a - b);
}

export type DecadeBar = {
  decade: number;        // 1980, 1990, … — the bar's label
  count: number;         // episodes whose START falls in this decade (census, no smoothing)
  yearsOfRecord: number; // years of this decade present in the pool — the denominator
  perYear: number;       // count / yearsOfRecord — what the bar's height IS (Ruling 10.4)
  partial: boolean;      // fewer than 10 years of record — the 2020s bar, and any gap
};

export type DecadeDistribution = {
  bars: DecadeBar[];
  /** Occurrences before the first bar decade (1979). In the headline count. Not a bar. */
  preBarCount: number;
  /** Years of record before the first bar decade (1979). In the denominator. Not a bar. */
  preBarYears: number;
  /** Every occurrence, including preBarCount — the card's headline number. */
  total: number;
  /** Every year of record, including preBarYears — the card's "since 1979". */
  totalYearsOfRecord: number;
};

/**
 * Ruling 10.4 — per-year normalized, 1980s forward. 1979 is counted in the headline
 * and in the denominator but is NOT given its own bar: a one-year bar normalized per
 * year swings on n=0-to-3 and reads as a spurious spike at the left edge where it
 * anchors the eye. The 2020s bar is marked partial for the same honesty.
 *
 * @param episodeStartDays start day of each matched episode (Ruling 2: episodes, not days)
 * @param poolYears        every calendar year the pool draws from — `board_pool_luts.years_list`
 */
export function decadeDistribution(
  episodeStartDays: readonly number[],
  poolYears: readonly number[],
  firstBarDecade = 1980,
): DecadeDistribution {
  const decadeOf = (y: number) => Math.floor(y / 10) * 10;
  const counts = new Map<number, number>();
  for (const d of episodeStartDays) {
    const k = decadeOf(yearOfEpochDay(d));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const denom = new Map<number, number>();
  for (const y of poolYears) {
    const k = decadeOf(y);
    denom.set(k, (denom.get(k) ?? 0) + 1);
  }

  const bars: DecadeBar[] = [];
  let preBarCount = 0, preBarYears = 0;
  for (const [decade, yearsOfRecord] of [...denom.entries()].sort((a, b) => a[0] - b[0])) {
    const count = counts.get(decade) ?? 0;
    if (decade < firstBarDecade) { preBarCount += count; preBarYears += yearsOfRecord; continue; }
    bars.push({ decade, count, yearsOfRecord, perYear: count / yearsOfRecord, partial: yearsOfRecord < 10 });
  }
  // An episode can only start in a year the pool contains, so `counts` never carries a
  // decade `denom` lacks; total is therefore every episode.
  return {
    bars,
    preBarCount,
    preBarYears,
    total: episodeStartDays.length,
    totalYearsOfRecord: poolYears.length,
  };
}

/**
 * §6 floors as they stand for v1 (Amendment 1.3 Ruling 4b: floors 1 and 4 in force,
 * floors 2 and 3 — the ≥20-occurrence floor and the Wilson interval — SUSPENDED,
 * because a census takes no confidence interval and there is no rate left to bound).
 * Floors are refusals, not targets (Ruling 6).
 */
export const MIN_DISTINCT_YEARS = 10; // floor 1 — fewer than this and we do not state a frequency
export const MIN_MATCHES = 5;         // floor 4 — under this we refuse outright

export function refusalReason(matchCount: number, distinctYearCount: number): string | null {
  if (matchCount < MIN_MATCHES) return `only ${matchCount} match(es) — under the ${MIN_MATCHES}-match floor`;
  if (distinctYearCount < MIN_DISTINCT_YEARS) return `only ${distinctYearCount} distinct year(s) — under the ${MIN_DISTINCT_YEARS}-year floor`;
  return null;
}
