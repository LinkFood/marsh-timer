/**
 * moonBaseRate.test.ts
 *
 * The load-bearing test in this file is not any of the unit assertions — it is
 * `reproduces the dossier's own published base rates on the dossier's own
 * population`. The shipped number is computed over a DIFFERENT window than the
 * dossier's and therefore differs from it, which is exactly the situation where
 * a reader is entitled to ask whether the arithmetic is wrong or the window is.
 * That test answers it: point the same engine at the dossier's population and
 * the dossier's numbers come back.
 */

import { describe, expect, it } from "vitest";
import { moonState } from "@/lib/sky";
import { MD_SEASONS } from "@/data/regs/mdSeasons";
import {
  formatBaseRatePercent,
  moonBaseRate,
  seasonDays,
  seasonIllumination,
} from "./moonBaseRate";

const DAY_MS = 86_400_000;

/** Illuminated fraction on every day in a set of inclusive ISO windows. */
function illuminationOver(windows: readonly (readonly [string, string])[]): number[] {
  const out: number[] = [];
  for (const [from, to] of windows) {
    const end = Date.parse(`${to}T00:00:00Z`);
    for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += DAY_MS) {
      out.push(moonState(new Date(t)).illumination);
    }
  }
  return out;
}

const pct = (values: readonly number[], test: (v: number) => boolean): number =>
  (100 * values.filter(test).length) / values.length;

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the engine agrees with the dossier where the dossier measured", () => {
  /**
   * `docs/MOONLIGHT-AND-THE-MORNING-2026-08-01.md` §4.2 states, for Blackwater:
   * illumination >0.96 on 12.7% of season days, >0.90 on 20.3%, <0.10 on 20.4%.
   * §3 names the population: 1,090 Blackwater season-nights, Oct 15 – Jan 31.
   */
  it("reproduces the dossier's own published base rates on the dossier's own population", () => {
    const ten: [string, string][] = [];
    for (let y = 2015; y <= 2024; y++) ten.push([`${y}-10-15`, `${y + 1}-01-31`]);
    const lit = illuminationOver(ten);

    // The dossier's stated n, exactly. If this drifts, the window drifted.
    expect(lit.length).toBe(1090);

    // Half a point of tolerance, which is a third of one day in this sample.
    expect(pct(lit, (v) => v > 0.96)).toBeCloseTo(12.7, 0);
    expect(pct(lit, (v) => v > 0.9)).toBeCloseTo(20.3, 0);
    expect(pct(lit, (v) => v < 0.1)).toBeCloseTo(20.4, 0);
  });

  it("reproduces them again on the 26-season ERA5 window, whose n the dossier also states", () => {
    const many: [string, string][] = [];
    for (let y = 2000; y <= 2025; y++) many.push([`${y}-10-15`, `${y + 1}-01-31`]);
    const lit = illuminationOver(many);

    expect(lit.length).toBe(2834); // §9: "n = 2,834 days"
    expect(pct(lit, (v) => v > 0.96)).toBeCloseTo(12.7, 0);
    expect(pct(lit, (v) => v > 0.9)).toBeCloseTo(20.3, 0);
    expect(pct(lit, (v) => v < 0.1)).toBeCloseTo(20.4, 0);
  });

  it("differs from the dossier on the SHIPPED population, and the reason is the window", () => {
    // Maryland's published 2026-27 seasons reach into September and run to
    // March 10 — months the dossier's Oct 15 – Jan 31 window excludes — and one
    // season is 5.5 lunations rather than 37. So the shipped rate is genuinely
    // lower for the bright tail, and that is a difference of population, not of
    // method. This test exists so nobody "fixes" the shipped number to match a
    // figure measured somewhere else.
    const lit = seasonIllumination();
    expect(pct(lit, (v) => v > 0.9)).toBeLessThan(20.3);
    expect(pct(lit, (v) => v < 0.1)).toBeGreaterThan(20.4);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the population is Maryland's published season, de-duplicated", () => {
  it("unions the overlapping duck and goose seasons rather than concatenating them", () => {
    const days = seasonDays(MD_SEASONS);
    expect(new Set(days).size).toBe(days.length);

    // December 20 is inside four published segments at once. It must appear
    // once, or the rate would be weighted toward whatever the moon did in
    // whichever month the most seasons overlap.
    expect(days.filter((d) => d === "2026-12-20")).toHaveLength(1);
  });

  it("is sorted, and spans the published table end to end", () => {
    const days = seasonDays(MD_SEASONS);
    expect([...days].sort()).toEqual(days);
    expect(days[0]).toBe("2026-09-01"); // early resident goose opener
    expect(days[days.length - 1]).toBe("2027-03-10"); // late resident goose close
    expect(days.length).toBe(162);
  });

  it("contributes NO days from a season whose bounds Maryland has not published", () => {
    // The Light Goose Conservation Order carries `segments: null` — "To Be
    // Determined". A season with unknown bounds cannot supply days to a
    // denominator, and inventing an end date for it here would be the defect
    // `mdSeasons.ts` refuses in the legal path, committed one file over.
    const withOrder = seasonDays(MD_SEASONS);
    const withoutOrder = seasonDays(MD_SEASONS.filter((s) => s.segments !== null));
    expect(withOrder).toEqual(withoutOrder);
  });

  it("excludes the gaps between segments — a closed week is not a season day", () => {
    const days = new Set(seasonDays(MD_SEASONS));
    expect(days.has("2026-09-26")).toBe(false); // after the early goose close
    expect(days.has("2026-10-25")).toBe(false); // between October and November
    expect(days.has("2026-11-28")).toBe(false); // the two-day gap before Nov 30
    expect(days.has("2026-11-27")).toBe(true);
    expect(days.has("2026-11-30")).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the rate counts the tail a hunter is actually asking about", () => {
  it("counts UPWARD on a bright moon and prints the denominator it used", () => {
    const rate = moonBaseRate(0.95);
    expect(rate.status).toBe("ok");
    if (rate.status !== "ok") return;
    expect(rate.tail).toBe("lit");
    expect(rate.n).toBe(162);
    expect(rate.firstDay).toBe("2026-09-01");
    expect(rate.lastDay).toBe("2027-03-10");
    expect(rate.count).toBe(Math.round((rate.percent / 100) * rate.n));
  });

  it("counts DOWNWARD on a dark moon, because 96%-of-nights-are-brighter answers nothing", () => {
    const dark = moonBaseRate(0.04);
    expect(dark.status).toBe("ok");
    if (dark.status !== "ok") return;
    expect(dark.tail).toBe("dark");
    // The bright-tail framing would have returned a near-total here. The
    // dark-tail framing returns the fraction of nights this dark or darker.
    expect(dark.percent).toBeLessThan(50);
  });

  it("flips tails at the printed half, and nowhere else", () => {
    const under = moonBaseRate(0.4999);
    const over = moonBaseRate(0.5);
    expect(under.status === "ok" && under.tail).toBe("dark");
    expect(over.status === "ok" && over.tail).toBe("lit");
  });

  it("is monotone: a brighter moon is never more common than a dimmer one", () => {
    const a = moonBaseRate(0.8);
    const b = moonBaseRate(0.95);
    if (a.status !== "ok" || b.status !== "ok") throw new Error("expected both to compute");
    expect(b.count).toBeLessThanOrEqual(a.count);
  });

  it("includes the reading's own night in its own count — the rate is inclusive", () => {
    const lit = seasonIllumination();
    const someSeasonNight = lit[lit.length - 1]; // the brightest published night
    const rate = moonBaseRate(someSeasonNight);
    expect(rate.status === "ok" && rate.count).toBeGreaterThanOrEqual(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("it refuses rather than fabricating a denominator", () => {
  it("returns a sentence, not a zero, for an unreadable illumination", () => {
    for (const bad of [NaN, Infinity, undefined as unknown as number, null as unknown as number]) {
      const rate = moonBaseRate(bad);
      expect(rate.status).toBe("unknown");
      if (rate.status === "unknown") expect(rate.message).toMatch(/could not be computed/i);
    }
  });

  it("never prints 0% for a night that did happen", () => {
    // A count that merely ROUNDS to zero is not zero. "0% of season mornings
    // are this lit", said about a morning that is this lit, is a false
    // sentence on the one surface built to refuse exactly that.
    expect(formatBaseRatePercent({ ...OK, count: 1, n: 1000, percent: 0.1 })).toBe("<1%");
    expect(formatBaseRatePercent({ ...OK, count: 0, n: 1000, percent: 0 })).toBe("0%");
    expect(formatBaseRatePercent({ ...OK, count: 34, n: 162, percent: 20.98 })).toBe("21%");
  });
});

const OK = {
  status: "ok",
  tail: "lit",
  illumination: 0.9,
  count: 1,
  n: 1,
  percent: 100,
  firstDay: "2026-09-01",
  lastDay: "2027-03-10",
} as const;
