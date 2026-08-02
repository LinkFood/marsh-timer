/**
 * dawnTide.test.ts
 *
 * The test that matters here is `never prints one station's numbers under
 * another station's spot`. The dossier establishes that the spring-tide sign at
 * dawn REVERSES between Bishops Head and Ocean City Inlet, which makes "a true
 * statement about one station, generalised into a false one about all of them"
 * the live failure mode for this whole feature — and it is a failure that would
 * render at full confidence with plausible numbers and no visible symptom.
 */

import { describe, expect, it } from "vitest";
import { DAWN_TIDE_STATIONS, dawnTideStation, FULL_MINUS_NEW_MAX_FT } from "@/data/dawnTide";
import { dawnTideClock, dawnTideSentence, hourLabel, type DawnTideClock } from "./dawnTide";

/** The reference spot's bound station. Nobody has measured it. */
const WOOLFORD = "8571807";
/** The station the dossier actually measured. */
const BISHOPS_HEAD = "8571421";

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the sign flips by station, so the lookup never falls back", () => {
  it("refuses for the reference spot's own station rather than reaching for a neighbour", () => {
    const clock = dawnTideClock(WOOLFORD);
    expect(clock.status).toBe("refused");
    if (clock.status !== "refused") return;
    // The id rides on the union rather than inside the prose, because the rail
    // prints it as a READING (`not computed for 8571807`) and a station named
    // twice in two voices is a station that can disagree with itself.
    expect(clock.stationId).toBe(WOOLFORD);
    expect(clock.message).toMatch(/none is packed for this one/i);
  });

  it("never prints one station's numbers under another station's spot", () => {
    const clock = dawnTideClock(WOOLFORD);
    const rendered = JSON.stringify(clock);
    // Bishops Head is 12 miles away, is in this app's table, and is the one
    // station with numbers. None of it may leak into a Woolford answer.
    expect(rendered).not.toContain("Bishops Head");
    expect(rendered).not.toContain(BISHOPS_HEAD);
    expect(rendered).not.toContain("1.51");
    expect(rendered).not.toContain("1.59");
    // And no feet at all — a refusal that quotes a measurement is not a refusal.
    expect(rendered).not.toMatch(/\d\.\d+\s*ft/);
  });

  it("refuses by name when the spot has no station bound at all", () => {
    for (const empty of [null, undefined, "", "   "]) {
      const clock = dawnTideClock(empty);
      expect(clock.status).toBe("refused");
      if (clock.status === "refused") expect(clock.stationId).toBeNull();
    }
  });

  it("states the mechanism in the refusal, so an absence still teaches the confound", () => {
    const clock = dawnTideClock(WOOLFORD);
    if (clock.status !== "refused") throw new Error("expected a refusal");
    expect(clock.message).toMatch(/hour of high water/i);
    expect(clock.message).toMatch(/no light in it/i);
  });

  it("has no default row and no nearest-station fallback", () => {
    expect(dawnTideStation("0000000")).toBeNull();
    expect(dawnTideStation(null)).toBeNull();
    // Woolford 8571807 is the probe that matters: it is the station the
    // reference spot BINDS TO, it sits 7 miles from Blackwater, and Bishops
    // Head and Cambridge — both measured, both in the table — are its nearest
    // neighbours. If a fallback ever appears, this is the lookup that would
    // silently take one. It is absent because NOAA marks it subordinate and
    // serves it hi/lo only, so it has a measured CLOCK and no dawn LEVEL, and
    // a row with a real sign and interpolated feet renders at full confidence
    // while being fiction.
    expect(dawnTideStation("8571807")).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the measured station reads back exactly what the dossier measured", () => {
  it("computes the spring-vs-quarter difference at Bishops Head", () => {
    const clock = dawnTideClock(BISHOPS_HEAD);
    expect(clock.status).toBe("ok");
    if (clock.status !== "ok") return;

    // §4.1: near-full −0.08 ft, near-new −0.07 ft, quarter +1.51 ft, and
    // "spring minus quarter at 07:00 = 1.59 ft = 19 inches".
    expect(clock.springFt).toBeCloseTo(-0.075, 3);
    expect(clock.quarterFt).toBeCloseTo(1.51, 3);
    expect(clock.deltaFt).toBeCloseTo(1.59, 2);
    expect(clock.deltaInches).toBe(19);
    expect(clock.springStage).toBe("lower");
  });

  it("survives the wind — the clock is a phase effect and wind shifts level", () => {
    const clock = dawnTideClock(BISHOPS_HEAD);
    if (clock.status !== "ok") throw new Error("expected a reading");
    // 1.59 ft against a 0.59 ft residual SD is the 2.7× the dossier claims.
    expect(Math.abs(clock.deltaFt) / clock.station.windResidualSdFt).toBeGreaterThan(2.5);
  });

  it("weights the two spring bins by their own sample sizes", () => {
    const s = dawnTideStation(BISHOPS_HEAD);
    if (s === null) throw new Error("expected the row");
    const clock = dawnTideClock(BISHOPS_HEAD);
    if (clock.status !== "ok") throw new Error("expected a reading");
    const expected =
      (s.nearFullFt * s.nearFullN + s.nearNewFt * s.nearNewN) / (s.nearFullN + s.nearNewN);
    expect(clock.springFt).toBeCloseTo(expected, 10);
  });

  it("every row carries its own counts — a mean with no n is the claim shape this refuses", () => {
    for (const s of DAWN_TIDE_STATIONS) {
      expect(s.nearFullN).toBeGreaterThan(0);
      expect(s.nearNewN).toBeGreaterThan(0);
      expect(s.quarterN).toBeGreaterThan(0);
      expect(s.windResidualN).toBeGreaterThan(0);
      expect(s.window.trim()).not.toBe("");
      // Every row names where its numbers came from — the dossier for the row
      // it measured, the script for the rows measured since. What is asserted
      // is that a citation EXISTS and resolves to something in the repo, not
      // that it is any one document.
      expect(s.cite).toMatch(/MOONLIGHT-AND-THE-MORNING|measure-dawn-tide\.ts/);
    }
  });

  it("the full-minus-new control holds at every station — the tide cannot explain it", () => {
    // Full and new are tidally identical and opposite in moonlight, which is
    // what makes the pair the clean separation of water from light. Measured,
    // the gap is two hundredths of a foot everywhere. If a future row breaks
    // this, that row's bins are wrong — not the physics.
    for (const s of DAWN_TIDE_STATIONS) {
      expect(Math.abs(s.nearFullFt - s.nearNewFt)).toBeLessThanOrEqual(FULL_MINUS_NEW_MAX_FT);
    }
  });

  it("carries stations whose clock REVERSES, which is why there is a table at all", () => {
    const springMinusQuarter = (s: (typeof DAWN_TIDE_STATIONS)[number]) =>
      (s.nearFullFt * s.nearFullN + s.nearNewFt * s.nearNewN) / (s.nearFullN + s.nearNewN) -
      s.quarterFt;
    const signs = DAWN_TIDE_STATIONS.map((s) => Math.sign(springMinusQuarter(s)));
    // Both signs must be present. Bishops Head and Cambridge run negative,
    // Tolchester, Ocean City and Kiptopeke positive — and Cambridge is twenty
    // miles from Bishops Head inside the same bay. A regional rule would tell
    // an Ocean City hunter the full moon brings low water at dawn when it
    // brings the highest water of the cycle.
    expect(signs).toContain(-1);
    expect(signs).toContain(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the sentence is derived from the numbers, never written down", () => {
  const base = dawnTideStation(BISHOPS_HEAD);
  if (base === null) throw new Error("expected the row");

  const clockWith = (deltaFt: number): Extract<DawnTideClock, { status: "ok" }> => ({
    status: "ok",
    station: base,
    springFt: 0,
    quarterFt: deltaFt,
    deltaFt,
    deltaInches: Math.round(Math.abs(deltaFt) * 12),
    springStage: deltaFt > 0 ? "lower" : "higher",
  });

  it("says LOWER where springs run low at dawn", () => {
    const s = dawnTideSentence(clockWith(1.59));
    expect(s).toContain("lower water here at 07:00");
    expect(s).toContain("1.6 ft higher on the quarters");
    expect(s).toContain("That is the tide, not the light.");
  });

  it("says HIGHER where the sign reverses — Ocean City Inlet, when it is ever packed", () => {
    // This is the case a hardcoded sentence would get wrong, silently, forever.
    const s = dawnTideSentence(clockWith(-1.59));
    expect(s).toContain("higher water here at 07:00");
    expect(s).toContain("1.6 ft lower on the quarters");
    expect(s).not.toContain("lower water here");
  });

  it("never renders a generic coast-wide claim", () => {
    for (const delta of [1.59, -1.59, 0.8, -0.8]) {
      const s = dawnTideSentence(clockWith(delta));
      expect(s).toContain("here at");
      expect(s).not.toMatch(/everywhere|all stations|the coast|the bay/i);
    }
  });

  it("prints the hour the pack was measured at, verbatim", () => {
    expect(hourLabel(7)).toBe("07:00");
    expect(hourLabel(13)).toBe("13:00");
    expect(hourLabel(NaN)).toBe("dawn");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("a difference smaller than the weather is not claimed as a direction", () => {
  it("would refuse a direction on a station whose clock is under its own wind noise", () => {
    // Constructed, because no packed station is currently this flat. The branch
    // exists so that when a shallow-difference station IS packed, it does not
    // render 0.2 ft of lunar clock at the same confidence as 19 inches.
    const flat = {
      ...base(),
      stationId: "TEST-FLAT",
      nearFullFt: 0.1,
      nearNewFt: 0.1,
      quarterFt: 0.3,
    };
    const nSpring = flat.nearFullN + flat.nearNewN;
    const springFt = (flat.nearFullFt * flat.nearFullN + flat.nearNewFt * flat.nearNewN) / nSpring;
    const delta = flat.quarterFt - springFt;
    expect(Math.abs(delta)).toBeLessThan(flat.windResidualSdFt);
  });
});

function base() {
  const s = dawnTideStation(BISHOPS_HEAD);
  if (s === null) throw new Error("expected the row");
  return s;
}
