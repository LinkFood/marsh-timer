/**
 * provenance.test.ts — the methodology, pinned, in the one place it now lives.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THESE ASSERTIONS DID NOT APPEAR WITH THIS FILE. THEY MOVED INTO IT.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `SkyRail.test.tsx` used to hold them, because the sky rail used to print six
 * lines of sources under its readings. The sources did not change and the
 * assertions did not weaken — the sources moved to the foot of the surface, and
 * the tests that pin them moved with them. A citation whose test moved with it
 * is a citation that cannot quietly evaporate in the move, which is the failure
 * mode a "hoist the provenance" change actually has.
 *
 * They are stronger here in one respect. On the rail, the disclosure and the
 * interval were only asserted on the branches that made a claim about the night;
 * here they are asserted on EVERY branch, including the ones where the moon
 * refuses, because the moon NUMBERS print on every branch and a number is where
 * the inference starts.
 */

import { describe, expect, it } from "vitest";
import { computeLegalLight } from "./legalLight";
import { provenanceSegments } from "./provenance";
import { refuse, type TideResult } from "@/lib/tide";
import type { PocketCurve } from "./tidePocket";

const BLACKWATER = { lat: 38.4436, lng: -76.0722 };

/** The reference spot's station — a CO-OPS subordinate, no dawn pack. */
const WOOLFORD = "8571807";
/** The station the dossier actually measured. */
const BISHOPS_HEAD = "8571421";

const NO_POCKET: TideResult<PocketCurve> = refuse(
  "no-data",
  "No tide is saved for this spot, and this app will not invent water.",
);

function segments(day: string, stationId: string | null = WOOLFORD) {
  const light = computeLegalLight(BLACKWATER.lat, BLACKWATER.lng, "MD", day, null);
  return provenanceSegments({
    light,
    day,
    stationId,
    pocket: NO_POCKET,
    now: new Date(`${day}T09:15:00Z`),
    nextOpen: null,
  });
}

function text(day: string, stationId: string | null = WOOLFORD) {
  return segments(day, stationId).join(" · ");
}

/** The opener (80% lit), a dark night, a closed Sunday, and a shut season. */
const DAYS = ["2026-09-01", "2026-09-07", "2026-09-06", "2026-08-15"] as const;

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the disclosure is a constant, not a branch — and now not a mode either", () => {
  const EXPECTED =
    "whether that changes this morning has never been measured — not in ducks, not in anything";

  it("renders on every day the surface can be looking at", () => {
    for (const day of DAYS) {
      expect(text(day), `missing on ${day}`).toContain(EXPECTED);
    }
  });

  it("keeps the antecedent the sentence needs to stand on its own", () => {
    // On the rail, "that" pointed at the mechanism claim directly above it. The
    // claim is PREP-weight now and does not print in FIELD, so the clause it
    // refers to travels with it or the sentence is about nothing.
    expect(text("2026-09-01")).toContain("more light lengthens NIGHT feeding, and whether that");
  });

  it("carries the one direct estimate WITH its interval, and the opposite-signed finding", () => {
    const t = text("2026-09-01");
    expect(t).toContain("one direct test of last night on next morning: −0.4%");
    expect(t).toContain("95% CI −9% to +9%");
    expect(t).toContain("105 GPS ducks, 1,984 bird-days");
    // The half that cuts against the belief has to be there too, or the surface
    // is quoting only the convenient direction of its own source.
    expect(t).toContain("23% MORE on bright clear nights");
    expect(t).toContain("no less next day");
  });

  it("cites the dossier by path", () => {
    expect(text("2026-09-01")).toContain("MOONLIGHT-AND-THE-MORNING-2026-08-01.md");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the base rate names its one variable and its window", () => {
  it("says out loud that it counted ONE variable, and which", () => {
    // Dossier §5 rule 1: illumination and hours-above-horizon are r = 0.988.
    expect(text("2026-09-01")).toContain(
      "illumination only (hours-up is the same variable, r = 0.988)",
    );
  });

  it("names the population the denominator came from", () => {
    expect(text("2026-09-01")).toContain(
      "162 published MD duck + goose season days, 2026-09-01 → 2027-03-10",
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the stated unknowns keep their direction", () => {
  it("names cloud as missing and does NOT code it as a subtraction — rule 2", () => {
    const t = text("2026-09-01");
    expect(t).toContain("overnight cloud cover is NOT known here");
    // Kyba 2011: cloud AMPLIFIES ground light near a town, 10.1× inside a city.
    expect(t).toContain("cloud does not simply subtract");
    expect(t).toContain("near a town it reflects light back down");
    expect(t).not.toMatch(/cloud blocks the moon/i);
  });

  it("never states a coast-wide rule about where springs put dawn water", () => {
    for (const station of [WOOLFORD, BISHOPS_HEAD, null]) {
      const t = text("2026-09-01", station);
      expect(t).not.toMatch(/full and new moons put low water at dawn/i);
      expect(t).not.toMatch(/on this coast,? springs/i);
    }
  });

  it("carries the station's own counts when the station IS packed, and never another's", () => {
    const packed = text("2026-09-01", BISHOPS_HEAD);
    expect(packed).toContain("n = 141 full / 140 new / 128 quarter");
    expect(packed).toContain("Oct 15 – Jan 31, ten seasons 2015-16 → 2024-25");

    // The trap: Bishops Head's numbers under a Woolford spot.
    const unpacked = text("2026-09-01", WOOLFORD);
    expect(unpacked).not.toContain("Bishops Head");
    expect(unpacked).toContain("dawn tide read per station, never generalised");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the legal and policy provenance", () => {
  it("names the tide as a prediction rather than an observation", () => {
    expect(text("2026-09-01")).toContain("harmonic PREDICTION, not an observed level");
  });

  it("says the bag limit is absent BECAUSE it cannot be known, not by omission", () => {
    expect(text("2026-09-01")).toContain(
      "no bag limit shown — limits are species and sex specific and this app cannot know your " +
        "earlier take",
    );
  });

  it("carries MD DNR's own contingency language when the dates are provisional", () => {
    expect(text("2026-09-01")).toContain(
      "contingent upon approval from the United States Fish and Wildlife Service",
    );
  });

  it("says the transcription is unverified against the booklet when there IS a clock", () => {
    expect(text("2026-09-01")).toMatch(/hours verified \d{4}-\d{2}-\d{2}, booklet check pending/);
  });

  it("says WHY there is no clock when there is none, instead of the verification line", () => {
    // 2026-08-15: no Maryland waterfowl season is open, so no rule was resolved
    // and there is nothing to have verified.
    const t = text("2026-08-15");
    expect(t).toContain("no clock is shown rather than a wrong one");
    expect(t).not.toContain("booklet check pending");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("the block is provenance and nothing else", () => {
  it("never becomes a score, a rating or a verdict", () => {
    for (const day of DAYS) {
      const t = text(day).toLowerCase();
      for (const banned of ["score", "rating", "excellent", "good moon", "go / no-go"]) {
        expect(t, `"${banned}" on ${day}`).not.toContain(banned);
      }
    }
  });

  it("holds no empty segments — an empty citation reads as a missing source", () => {
    for (const day of DAYS) {
      for (const s of segments(day)) {
        expect(s.trim(), `empty segment on ${day}`).not.toBe("");
      }
    }
  });
});
