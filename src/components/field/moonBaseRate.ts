/**
 * moonBaseRate.ts — the denominator under the moon reading.
 *
 * PURE. Consumes `moonState` from `src/lib/sky.ts` and the committed season
 * windows in `src/data/regs/mdSeasons.ts`. No network, no storage, no React.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY A COUNT AND NOT A CLAIM.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * "80% lit" is a number with no scale attached. It tells a hunter nothing about
 * whether tonight is ordinary or the brightest week of his season, and a number
 * he cannot place is a number he fills in from memory — which is exactly the
 * mechanism the moon superstition runs on. The dossier names it directly
 * (§4.2): the full moon is "moderately frequent, highly salient, non-culpable",
 * and the missing ingredient in every practitioner report it quotes is a
 * denominator. *"Every one of our bad hunts this year has come on a full moon"*
 * — out of how many full moons, and how many bad hunts?
 *
 * So this module supplies the denominator, and it is the only thing it supplies.
 * It counts how many of Maryland's own published season days carry a moon at
 * least this lit. It does not say whether that is good. There is nothing here
 * that can become a score.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ONE VARIABLE. NOT TWO.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The base rate is computed on ILLUMINATION ALONE and it must stay that way.
 * The dossier measured the correlation between illuminated fraction and hours
 * above the horizon across 1,090 Blackwater season-nights at **r = 0.988**
 * (§3): at mid-latitudes in winter they are the same variable measured twice,
 * and a rate built on both would be one fact double-counted and dressed as two.
 * The hours-above-horizon reading stays on the rail as a READING — it is what
 * turns "94% lit" into a fact about the night — but it never enters this count.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE POPULATION IS MARYLAND'S OWN PUBLISHED SEASON, AND IT IS NAMED ON GLASS.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Every day inside every segment of `MD_SEASONS` that Maryland has actually
 * published, de-duplicated across the overlapping duck and goose seasons. That
 * is 162 days spanning 2026-09-01 → 2027-03-10 for the transcribed 2026-27
 * table, and both the count and the span are printed in the receipt, because a
 * rate without its denominator is the thing this module exists to prevent.
 *
 * IT IS DELIBERATELY NOT THE DOSSIER'S POPULATION AND THE NUMBERS DIFFER.
 * The dossier measured Blackwater over Oct 15 – Jan 31 across ten seasons
 * (n = 1,090) and reports illumination >0.90 on 20.3% of days. This module,
 * run over Maryland's published 2026-27 windows, returns 14.8% for the same
 * threshold. Both are correct and they are not the same question: the published
 * season reaches into September and runs to March 10 for the resident goose and
 * light goose seasons, months the dossier's window excludes entirely, and one
 * season is 5.5 lunations rather than 37.
 *
 * The engine was checked against the dossier on the dossier's own population
 * before this file was written: `moonState` over Oct 15 – Jan 31, ten seasons
 * 2015-16 → 2024-25, returns n = 1,090 and 12.8% / 20.5% / 20.0% against the
 * dossier's 12.7% / 20.3% / 20.4%, and over 2000–2025 returns n = 2,834 —
 * matching the dossier's stated n exactly — at 12.6% / 20.2% / 20.4%. The
 * arithmetic agrees to a few tenths of a point. The difference in the shipped
 * number is a difference of window, not of method, and the window is on screen.
 *
 * A hunter's own season is also the more useful denominator: he wants to know
 * how tonight ranks among the mornings he can actually hunt, not among a
 * twenty-six-year average of a window he was never in.
 */

import { moonState } from "@/lib/sky";
import { MD_SEASONS, type MdSeason } from "@/data/regs/mdSeasons";
import { skyDayFor } from "./fieldTime";

/**
 * The illuminated fraction at or above which the rate is counted upward rather
 * than downward. Half — the same half `SkyRail` already prints beside the
 * reading it gates.
 *
 * This picks WHICH TAIL is counted and nothing else. Above it the question is
 * "how many season nights are at least this bright", below it "how many are
 * this dark or darker". Counting the bright tail on a 4% moon would answer
 * "96% of nights are at least this lit", which is true, useless, and the kind
 * of technically-correct sentence that teaches a hunter to stop reading.
 */
const TAIL_PIVOT = 0.5;

export type MoonBaseRate =
  | {
      readonly status: "ok";
      /** Which side of the distribution was counted. */
      readonly tail: "lit" | "dark";
      /** The illuminated fraction the count was taken at, 0..1. */
      readonly illumination: number;
      /** Season days at least this lit (or this dark), inclusive. */
      readonly count: number;
      /** Season days in the population. The denominator. */
      readonly n: number;
      /** `count / n` as a percent, 0..100, unrounded. */
      readonly percent: number;
      /** First and last calendar day of the population, `YYYY-MM-DD`. */
      readonly firstDay: string;
      readonly lastDay: string;
    }
  | {
      readonly status: "unknown";
      /** A sentence the hunter can read verbatim. States what is missing. */
      readonly message: string;
    };

const DAY_MS = 86_400_000;
const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/**
 * Every published season day, de-duplicated and sorted.
 *
 * Maryland's duck and goose seasons OVERLAP and use different zone boundaries —
 * `mdSeasons.ts` says so in as many words and warns that the table must never be
 * read as a partition. So this is a set union, not a concatenation, or December
 * would be counted four times over and weight the rate toward whatever the moon
 * happened to be doing that month.
 *
 * Seasons with `segments: null` contribute nothing. Those are the ones Maryland
 * has not published (the Light Goose Conservation Order, "To Be Determined"),
 * and a season whose bounds are unknown cannot contribute days to a denominator.
 * Inventing an end date for it here would be the same defect `mdSeasons.ts`
 * refuses in the legal path, committed one file over for a softer reason.
 */
export function seasonDays(seasons: readonly MdSeason[]): string[] {
  const days = new Set<string>();
  for (const season of seasons) {
    if (season.segments === null) continue;
    for (const seg of season.segments) {
      const from = skyDayFor(seg.open);
      const to = skyDayFor(seg.close);
      if (from === null || to === null) continue;
      const endMs = to.getTime();
      // Both ends inclusive, which is how the digest prints its windows and how
      // `segmentContains` in `mdSeasons.ts` already reads them.
      for (let t = from.getTime(); t <= endMs; t += DAY_MS) {
        const d = new Date(t);
        days.add(`${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`);
      }
    }
  }
  return [...days].sort();
}

/**
 * The illuminated fraction on each published season day, ascending.
 *
 * Built ONCE and cached, because it is a pure function of a committed table and
 * because `FieldPage` re-renders every second — recomputing 162 lunar positions
 * per tick would be a measurable amount of a cold hunter's battery spent
 * arriving at the same array.
 */
let cached: readonly number[] | null = null;

export function seasonIllumination(): readonly number[] {
  if (cached === null) {
    const days = seasonDays(MD_SEASONS);
    const out: number[] = [];
    for (const day of days) {
      const at = skyDayFor(day);
      if (at === null) continue;
      const lit = moonState(at).illumination;
      // No `?? 0`. An unreadable illumination is not a new moon — it is a day
      // that leaves the population, and the denominator printed on the glass
      // shrinks to match.
      if (Number.isFinite(lit)) out.push(lit);
    }
    cached = out.sort((a, b) => a - b);
  }
  return cached;
}

/** Test seam. The cache is a memo of a constant, so clearing it is safe. */
export function resetSeasonIlluminationCache(): void {
  cached = null;
}

/**
 * How many Maryland season mornings carry a moon at least this lit.
 *
 * Returns the raw count and the raw denominator alongside the percent, so the
 * caller prints the fraction the number came from rather than trusting it.
 */
export function moonBaseRate(illumination: number): MoonBaseRate {
  if (typeof illumination !== "number" || !Number.isFinite(illumination)) {
    return {
      status: "unknown",
      message:
        "The moon's illuminated fraction could not be computed for this date, so there is " +
        "nothing to count it against.",
    };
  }

  const days = seasonDays(MD_SEASONS);
  const lit = seasonIllumination();
  const n = lit.length;
  if (n === 0 || days.length === 0) {
    return {
      status: "unknown",
      message:
        "No Maryland season days are published for this app to count against, so this reading " +
        "has no denominator.",
    };
  }

  const tail: "lit" | "dark" = illumination >= TAIL_PIVOT ? "lit" : "dark";
  let count = 0;
  for (const value of lit) {
    if (tail === "lit" ? value >= illumination : value <= illumination) count += 1;
  }

  return {
    status: "ok",
    tail,
    illumination,
    count,
    n,
    percent: (count / n) * 100,
    firstDay: days[0],
    lastDay: days[days.length - 1],
  };
}

/**
 * The percent, as it is printed.
 *
 * A count of zero prints as zero and a count that merely ROUNDS to zero prints
 * as `<1%`, because "0% of season mornings are this lit" said about a morning
 * that is this lit is a false sentence, and the surface it would be false on is
 * the one built to refuse exactly that.
 */
export function formatBaseRatePercent(rate: Extract<MoonBaseRate, { status: "ok" }>): string {
  if (rate.count === 0) return "0%";
  const rounded = Math.round(rate.percent);
  return rounded === 0 ? "<1%" : `${rounded}%`;
}
