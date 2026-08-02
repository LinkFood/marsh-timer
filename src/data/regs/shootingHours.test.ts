/**
 * Tests for the SEASON-AWARE shooting-hours table.
 *
 * The thing under test is not "does the lookup return a rule". It is: does the
 * resolution chain `state + species + date → season → rule` ever hand a hunter
 * a window WIDER than the law allows. That is the citation. Every other defect
 * here costs him thirty minutes of legal light, which is bad and is not the
 * same thing.
 *
 * So the load-bearing test in this file is not any single case — it is
 * `never widens`, which sweeps every calendar day of the 2026-27 season year
 * for both transcribed species and asserts that `sunset+30` comes back on
 * September goose dates and NOWHERE else.
 */
import { describe, expect, it } from "vitest";
import {
  NOT_IMPLEMENTED,
  TRANSCRIBED_SPECIES,
  TRANSCRIBED_STATES,
  isNoWiderThan,
  isTranscribedState,
  lookupShootingHours,
  narrowestRule,
  parseSolarOffset,
  resolveShootingWindow,
  type ShootingHoursRule,
} from "./shootingHours";
import { MD_SEASONS, isCalendarDay, segmentContains } from "./mdSeasons";

/** Blackwater NWR on 2026-09-01, near enough: sunrise 06:29, sunset 19:39. */
const SUN = { sunriseMin: 389, sunsetMin: 1179 };

const COMAR_13 = "https://regs.maryland.gov/us/md/exec/comar/08.03.07.13";

/* -------------------------------------------------------------------------- */
/*  THE DATE THIS APP IS BEING BUILT FOR                                      */
/* -------------------------------------------------------------------------- */

describe("MD + goose + 2026-09-01 — the September resident Canada goose opener", () => {
  const l = lookupShootingHours("MD", { species: "goose", date: "2026-09-01" });

  it("resolves to a season, not to the general rule", () => {
    expect(l.status).toBe("transcribed");
    if (l.status !== "transcribed") return;
    expect(l.season.species).toBe("goose");
    expect(l.season.date).toBe("2026-09-01");
    expect(l.season.zones).toContain("Early Resident Canada Goose - Eastern Zone");
    expect(l.season.zones).toContain("Early Resident Canada Goose - Western Zone");
  });

  it("runs one-half hour before sunrise to one-half hour AFTER sunset", () => {
    if (l.status !== "transcribed") throw new Error("must resolve");
    expect(l.rule.start).toBe("sunrise-30");
    expect(l.rule.end).toBe("sunset+30");
  });

  it("cites COMAR 08.03.07.13 for the extension", () => {
    if (l.status !== "transcribed") throw new Error("must resolve");
    expect(l.rule.id).toBe("md-september-resident-canada-goose");
    expect(l.rule.cite).toBe(COMAR_13);
    expect(l.rule.verified).toBe("2026-08-01");
  });

  it("carries MD DNR's own provisional language rather than hiding it", () => {
    if (l.status !== "transcribed") throw new Error("must resolve");
    expect(l.season.provisional).toBe(true);
    expect(l.season.provisionalNote).toMatch(/Fish and Wildlife Service/);
  });

  it("produces a window that closes 30 minutes after sunset", () => {
    const w = resolveShootingWindow(l, SUN);
    expect(w.status).toBe("ok");
    if (w.status !== "ok") return;
    expect(w.openMin).toBe(359);
    expect(w.closeMin).toBe(1209);
  });

  it("holds on every day of the September season, both zones", () => {
    for (const date of ["2026-09-01", "2026-09-08", "2026-09-15", "2026-09-25"]) {
      const r = lookupShootingHours("MD", { species: "goose", date });
      expect(r.status, date).toBe("transcribed");
      if (r.status !== "transcribed") continue;
      expect(r.rule.end, date).toBe("sunset+30");
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  THE REGULAR SEASON — THE RULE THAT MUST NOT BE WIDENED                    */
/* -------------------------------------------------------------------------- */

describe("MD + duck + 2026-10-10 — the Eastern Zone duck opener", () => {
  const l = lookupShootingHours("MD", { species: "duck", date: "2026-10-10" });

  it("ends legal light AT sunset, not sunset+30", () => {
    expect(l.status).toBe("transcribed");
    if (l.status !== "transcribed") return;
    expect(l.rule.start).toBe("sunrise-30");
    expect(l.rule.end).toBe("sunset+0");
    expect(l.rule.id).toBe("md-general");
  });

  it("names both duck zones open that day", () => {
    if (l.status !== "transcribed") throw new Error("must resolve");
    expect(l.season.zones.sort()).toEqual(["Eastern Zone", "Western Zone"]);
  });

  it("still lists the two COMAR carve-outs so a surface can name them", () => {
    if (l.status !== "transcribed") throw new Error("must resolve");
    expect(l.rule.exceptions).toHaveLength(2);
    for (const e of l.rule.exceptions) expect(e.cite).toMatch(/^https:\/\//);
  });

  it("produces a window that closes exactly at sunset", () => {
    const w = resolveShootingWindow(l, { sunriseMin: 400, sunsetMin: 1100 });
    expect(w.status).toBe("ok");
    if (w.status !== "ok") return;
    expect(w.openMin).toBe(370);
    expect(w.closeMin).toBe(1100);
  });

  it("gives the regular rule to late goose seasons too", () => {
    for (const date of ["2026-11-25", "2027-01-15", "2027-03-01"]) {
      const r = lookupShootingHours("MD", { species: "goose", date });
      expect(r.status, date).toBe("transcribed");
      if (r.status !== "transcribed") continue;
      expect(r.rule.end, date).toBe("sunset+0");
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  NO OPEN SEASON                                                            */
/* -------------------------------------------------------------------------- */

describe("a date in no open season is a typed refusal, not a rule", () => {
  it("refuses a duck date between segments", () => {
    const l = lookupShootingHours("MD", { species: "duck", date: "2026-11-01" });
    expect(l.status).toBe("refused");
    if (l.status !== "refused") return;
    expect(l.reason).toBe("no-open-season");
    expect("rule" in l).toBe(false);
    expect(l.message).toContain("2026-11-01");
  });

  it("refuses a duck date before the season year opens", () => {
    const l = lookupShootingHours("MD", { species: "duck", date: "2026-08-15" });
    expect(l.status).toBe("refused");
    if (l.status === "refused") expect(l.reason).toBe("no-open-season");
  });

  it("yields no window at all from that refusal", () => {
    const w = resolveShootingWindow(
      lookupShootingHours("MD", { species: "duck", date: "2026-08-15" }),
      SUN,
    );
    expect(w.status).toBe("refused");
    expect("openMin" in w).toBe(false);
    expect("closeMin" in w).toBe(false);
  });

  it("names the unpublished Conservation Order instead of pretending goose is simply closed", () => {
    // Goose has one season whose bounds Maryland has NOT published, so a goose
    // date with no match is "we cannot say", not "you are closed".
    const l = lookupShootingHours("MD", { species: "goose", date: "2027-04-15" });
    expect(l.status).toBe("refused");
    if (l.status !== "refused") return;
    expect(l.reason).toBe("season-bounds-unpublished");
    expect(l.message).toContain("Light Goose Conservation Order");
    expect(l.message).toMatch(/To Be Determined/i);
    expect("rule" in l).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*  THE UNTRANSCRIBED STATE — UNCHANGED                                       */
/* -------------------------------------------------------------------------- */

describe("an untranscribed state still refuses, season query or not", () => {
  it.each(["DE", "VA", "NC", "TX", "ZZ"])("refuses %s", (st) => {
    for (const q of [
      undefined,
      { species: "goose", date: "2026-09-01" },
      { species: "duck", date: "2026-10-10" },
    ]) {
      const l = lookupShootingHours(st, q);
      expect(l.status).toBe("refused");
      if (l.status !== "refused") continue;
      expect(l.reason).toBe("not-transcribed");
      expect(l.message).toContain(st);
      // The safety property: no rule is reachable on a refusal, and a season
      // query cannot smuggle one in.
      expect("rule" in l).toBe(false);
    }
  });

  it.each([undefined, null, "", "M", "MARYLAND", 42])("refuses malformed state %p", (bad) => {
    const l = lookupShootingHours(bad, { species: "goose", date: "2026-09-01" });
    expect(l.status).toBe("refused");
    if (l.status === "refused") expect(l.reason).toBe("malformed-state");
  });

  it("holds Maryland and nothing else", () => {
    expect(TRANSCRIBED_STATES).toEqual(["MD"]);
    expect(isTranscribedState("MD")).toBe(true);
    expect(isTranscribedState("DE")).toBe(false);
    expect(isTranscribedState(null)).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/*  THE AMBIGUOUS CASE — ERRS NARROW, ALWAYS                                  */
/* -------------------------------------------------------------------------- */

describe("when the season cannot be determined it errs narrow and says why", () => {
  it("does NOT return the general rule as a transcribed answer with no query", () => {
    const l = lookupShootingHours("MD");
    expect(l.status).not.toBe("transcribed");
    expect(l.status).toBe("narrowed");
  });

  it.each([
    ["no query at all", undefined],
    ["species only", { species: "goose" }],
    ["date only", { date: "2026-09-01" }],
    ["empty strings", { species: "", date: "" }],
  ])("narrows on %s, to the SHORTER window", (_label, q) => {
    const l = lookupShootingHours("MD", q);
    expect(l.status).toBe("narrowed");
    if (l.status !== "narrowed") return;
    expect(l.reason).toBe("season-undetermined");
    expect(l.rule.end).toBe("sunset+0"); // never sunset+30
    expect(l.message.length).toBeGreaterThan(40);
  });

  it("narrows rather than widens on the September opener when species is unknown", () => {
    // The dangerous inversion: the date IS the September opener, and the
    // September rule IS sunset+30, but without the species we cannot know the
    // hunter is after resident geese. He gets sunset.
    const l = lookupShootingHours("MD", { date: "2026-09-01" });
    expect(l.status).toBe("narrowed");
    if (l.status !== "narrowed") return;
    expect(l.rule.end).toBe("sunset+0");
  });

  it("carries the narrow window through resolveShootingWindow as narrowed, not ok", () => {
    const w = resolveShootingWindow(lookupShootingHours("MD"), SUN);
    expect(w.status).toBe("narrowed");
    if (w.status !== "narrowed") return;
    expect(w.openMin).toBe(359);
    expect(w.closeMin).toBe(1179); // sunset, NOT 1209
    expect(w.message).toBeTruthy();
    // A narrowed window is not a season answer, so it carries no season.
    expect("season" in w).toBe(false);
  });

  it("refuses a malformed date instead of narrowing — that is a bug, not an unknown", () => {
    for (const bad of ["09/01/2026", "2026-9-1", "2026-13-01", "tomorrow", 20260901]) {
      const l = lookupShootingHours("MD", { species: "goose", date: bad });
      expect(l.status, String(bad)).toBe("refused");
      if (l.status !== "refused") continue;
      expect(l.reason).toBe("season-undetermined");
      expect("rule" in l).toBe(false);
    }
  });

  it("refuses a species it has not transcribed rather than reusing the waterfowl clock", () => {
    const l = lookupShootingHours("MD", { species: "dove", date: "2026-09-01" });
    expect(l.status).toBe("refused");
    if (l.status !== "refused") return;
    expect(l.reason).toBe("species-not-transcribed");
    expect(l.message).toMatch(/12 noon to sunset/);
    expect("rule" in l).toBe(false);
  });

  it("accepts species and state in any case", () => {
    const l = lookupShootingHours("md", { species: "GOOSE", date: "2026-09-01" });
    expect(l.status).toBe("transcribed");
    if (l.status !== "transcribed") return;
    expect(l.state).toBe("MD");
    expect(l.rule.end).toBe("sunset+30");
  });
});

/* -------------------------------------------------------------------------- */
/*  ZONE                                                                      */
/* -------------------------------------------------------------------------- */

describe("an explicit zone narrows to that season", () => {
  it("answers the Eastern Zone September season alone", () => {
    const l = lookupShootingHours("MD", {
      species: "goose",
      date: "2026-09-10",
      zone: "Early Resident Canada Goose - Eastern Zone",
    });
    expect(l.status).toBe("transcribed");
    if (l.status !== "transcribed") return;
    expect(l.season.zones).toEqual(["Early Resident Canada Goose - Eastern Zone"]);
    expect(l.rule.end).toBe("sunset+30");
  });

  it("refuses once the Eastern Zone season has closed, though Western is still open", () => {
    const l = lookupShootingHours("MD", {
      species: "goose",
      date: "2026-09-20",
      zone: "Early Resident Canada Goose - Eastern Zone",
    });
    expect(l.status).toBe("refused");
    if (l.status === "refused") expect(l.reason).toBe("no-open-season");
  });

  it("refuses a zone Maryland does not publish", () => {
    const l = lookupShootingHours("MD", {
      species: "duck",
      date: "2026-10-10",
      zone: "Middle Zone",
    });
    expect(l.status).toBe("refused");
    if (l.status !== "refused") return;
    expect(l.reason).toBe("no-open-season");
    expect(l.message).toContain("Eastern Zone");
  });
});

/* -------------------------------------------------------------------------- */
/*  THE WARDEN — sunset+30 NEVER LEAKS                                        */
/* -------------------------------------------------------------------------- */

describe("the whole season year, day by day", () => {
  /** Every ISO day from 2026-07-01 to 2027-06-30 inclusive. */
  function seasonYearDays(): string[] {
    const out: string[] = [];
    const d = new Date(Date.UTC(2026, 6, 1));
    const end = Date.UTC(2027, 5, 30);
    while (d.getTime() <= end) {
      out.push(d.toISOString().slice(0, 10));
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  }

  const DAYS = seasonYearDays();

  it("covers a full year", () => {
    expect(DAYS).toHaveLength(365);
    expect(DAYS[0]).toBe("2026-07-01");
    expect(DAYS[DAYS.length - 1]).toBe("2027-06-30");
    for (const d of DAYS) expect(isCalendarDay(d)).toBe(true);
  });

  it("never widens: sunset+30 comes back ONLY for goose in September", () => {
    for (const species of TRANSCRIBED_SPECIES) {
      for (const date of DAYS) {
        const l = lookupShootingHours("MD", { species, date });
        if (l.status === "refused") continue;
        if (l.rule.end !== "sunset+30") continue;
        // The only way to a wider window than the general rule:
        expect(l.status, `${species} ${date}`).toBe("transcribed");
        expect(species, `${species} ${date}`).toBe("goose");
        expect(date.slice(0, 7), `${species} ${date}`).toBe("2026-09");
        expect(l.rule.id).toBe("md-september-resident-canada-goose");
      }
    }
  });

  it("returns sunset+30 on exactly the 25 published September goose days", () => {
    const wide = DAYS.filter((date) => {
      const l = lookupShootingHours("MD", { species: "goose", date });
      return l.status === "transcribed" && l.rule.end === "sunset+30";
    });
    expect(wide[0]).toBe("2026-09-01");
    expect(wide[wide.length - 1]).toBe("2026-09-25");
    expect(wide).toHaveLength(25);
  });

  it("never returns transcribed on a day no published season contains", () => {
    for (const species of TRANSCRIBED_SPECIES) {
      for (const date of DAYS) {
        const l = lookupShootingHours("MD", { species, date });
        if (l.status !== "transcribed") continue;
        const covered = MD_SEASONS.some(
          (s) =>
            s.species === species &&
            s.segments !== null &&
            s.segments.some((seg) => segmentContains(seg, date)),
        );
        expect(covered, `${species} ${date}`).toBe(true);
      }
    }
  });

  it("never selects the Light Goose Conservation Order rule — its dates are unpublished", () => {
    for (const species of TRANSCRIBED_SPECIES) {
      for (const date of DAYS) {
        const l = lookupShootingHours("MD", { species, date });
        if (l.status === "refused") continue;
        expect(l.rule.id, `${species} ${date}`).not.toBe("md-light-goose-conservation-order");
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  NARROWNESS ARITHMETIC                                                     */
/* -------------------------------------------------------------------------- */

describe("narrowness is computed, not asserted", () => {
  const mk = (start: string, end: string): ShootingHoursRule =>
    ({
      id: "md-general",
      season: "test",
      start,
      end,
      cite: "https://example.invalid",
      verified: "2026-08-01",
      note: "",
      corroboration: [],
      exceptions: [],
    }) as unknown as ShootingHoursRule;

  const general = mk("sunrise-30", "sunset+0");
  const september = mk("sunrise-30", "sunset+30");

  it("orders the two real Maryland rules correctly", () => {
    expect(isNoWiderThan(general, september)).toBe(true);
    expect(isNoWiderThan(september, general)).toBe(false);
    expect(narrowestRule([september, general])?.end).toBe("sunset+0");
    expect(narrowestRule([general, september])?.end).toBe("sunset+0");
  });

  it("picks the narrowest of three", () => {
    const tightest = mk("sunrise-0", "sunset-15");
    expect(narrowestRule([september, general, tightest])).toBe(tightest);
  });

  it("returns null rather than synthesising an intersection for crossed rules", () => {
    const a = mk("sunrise-30", "sunset-10"); // opens earlier, closes earlier
    const b = mk("sunrise-0", "sunset+30"); // opens later, closes later
    expect(narrowestRule([a, b])).toBeNull();
  });

  it("refuses to compare rules with mismatched anchors", () => {
    expect(isNoWiderThan(general, mk("sunset-30", "sunset+0"))).toBe(false);
    expect(isNoWiderThan(general, mk("sunrise-30", "junk"))).toBe(false);
  });

  it("parses offsets strictly", () => {
    expect(parseSolarOffset("sunrise-30")).toEqual({ anchor: "sunrise", minutes: -30 });
    expect(parseSolarOffset("sunset+30")).toEqual({ anchor: "sunset", minutes: 30 });
    expect(parseSolarOffset("sunset+0")).toEqual({ anchor: "sunset", minutes: 0 });
    expect(parseSolarOffset("sunset")).toBeNull();
    expect(parseSolarOffset("dawn-30")).toBeNull();
    expect(parseSolarOffset("")).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/*  SUN TIMES                                                                 */
/* -------------------------------------------------------------------------- */

describe("sun times are never coerced", () => {
  it("refuses when sunrise or sunset is missing or non-finite", () => {
    const l = lookupShootingHours("MD", { species: "goose", date: "2026-09-01" });
    for (const sun of [
      null,
      undefined,
      { sunriseMin: NaN, sunsetMin: 1100 },
      { sunriseMin: 400, sunsetMin: Infinity },
    ]) {
      const w = resolveShootingWindow(l, sun as never);
      expect(w.status).toBe("refused");
      if (w.status === "refused") expect(w.reason).toBe("no-sun-times");
    }
  });
});

/* -------------------------------------------------------------------------- */
/*  WHAT WAS FOUND AND NOT BUILT                                              */
/* -------------------------------------------------------------------------- */

describe("carve-outs found but not implemented are on the record", () => {
  it("names the dove, falconry, Sunday and youth-day carve-outs with cites", () => {
    expect(NOT_IMPLEMENTED.length).toBeGreaterThanOrEqual(4);
    for (const n of NOT_IMPLEMENTED) {
      expect(n.cite).toMatch(/^https:\/\//);
      expect(n.why.length).toBeGreaterThan(40);
    }
    expect(NOT_IMPLEMENTED.map((n) => n.what)).toContain("Mourning dove");
  });
});

/* -------------------------------------------------------------------------- */
/*  THE SEASON TABLE ITSELF                                                   */
/* -------------------------------------------------------------------------- */

describe("MD_SEASONS is well-formed and cited", () => {
  it("gives every published segment a real, ordered window", () => {
    for (const s of MD_SEASONS) {
      expect(s.cite, s.id).toMatch(/^https:\/\//);
      expect(s.verified, s.id).toBe("2026-08-01");
      if (s.segments === null) {
        expect(s.boundsNote, s.id).toBeTruthy();
        continue;
      }
      expect(s.segments.length, s.id).toBeGreaterThan(0);
      for (const seg of s.segments) {
        expect(isCalendarDay(seg.open), `${s.id} ${seg.open}`).toBe(true);
        expect(isCalendarDay(seg.close), `${s.id} ${seg.close}`).toBe(true);
        expect(seg.open <= seg.close, `${s.id} ${seg.open}..${seg.close}`).toBe(true);
      }
    }
  });

  it("puts every sunset+30 season inside September", () => {
    for (const s of MD_SEASONS) {
      if (s.hoursRuleId !== "md-september-resident-canada-goose") continue;
      expect(s.segments, s.id).not.toBeNull();
      for (const seg of s.segments ?? []) {
        expect(seg.open.slice(0, 7), s.id).toBe("2026-09");
        expect(seg.close.slice(0, 7), s.id).toBe("2026-09");
      }
    }
  });

  it("leaves the Light Goose Conservation Order bounds unset rather than guessed", () => {
    const co = MD_SEASONS.find((s) => s.id === "md-goose-light-conservation-order");
    expect(co).toBeDefined();
    expect(co?.segments).toBeNull();
    expect(co?.hoursRuleId).toBe("md-light-goose-conservation-order");
  });
});
