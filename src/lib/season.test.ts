import { describe, expect, it } from "vitest";
import { buildSeasonModel, leadSentences, type SeasonRow } from "./season";

/**
 * The model's job is to refuse. These tests pin the refusals: a row from another
 * season year, a row the state has not published, and a season that has already
 * opened all have to come out as something other than a confident countdown.
 */

const row = (over: Partial<SeasonRow> & { id: string }): SeasonRow => ({
  species_id: "duck",
  state_abbr: "MD",
  season_type: "opener",
  zone: "Western Zone",
  dates: [{ open: "2026-10-03" }],
  notes: null,
  source_url: "https://example.state/regs",
  season_year: "2026-2027",
  status: "ok",
  provisional: false,
  ...over,
});

const TODAY = "2026-07-24";
const YEAR = "2026-2027";

describe("buildSeasonModel", () => {
  it("counts down to the opener and never claims a closing date", () => {
    const m = buildSeasonModel([row({ id: "a" })], TODAY, YEAR);
    expect(m.hero?.opensOn).toBe("2026-10-03");
    expect(m.hero?.status).toBe("upcoming");
    expect(m.hero?.daysOut).toBe(71);
    expect(m.hero?.daysSince).toBeNull();
    expect(m.hero?.zone).toBe("Western Zone");
  });

  it("refuses every row stamped with another season year, and names what it holds", () => {
    const m = buildSeasonModel(
      [
        row({ id: "a", season_year: "2025-2026", dates: [{ open: "2025-10-04", close: "2026-01-31" }] }),
        row({ id: "b", season_year: "2025-2026", species_id: "goose" }),
      ],
      TODAY,
      YEAR,
    );
    expect(m.hero).toBeNull();
    expect(m.openers).toHaveLength(0);
    expect(m.heldYear).toBe("2025-2026");
    expect(m.heldCount).toBe(2);
    expect(m.sourceUrl).toBeTruthy();
  });

  it("turns a non-ok row into an absence with the state's own reason, not a date", () => {
    const m = buildSeasonModel(
      [
        row({
          id: "a",
          state_abbr: "SC",
          status: "not_published",
          dates: [],
          notes: "2026-2027 NOT YET PUBLISHED. SCDNR's own season-dates PDF is still headed 2025-2026.",
          recheck_after: "2026-08-01",
        }),
      ],
      TODAY,
      YEAR,
    );
    expect(m.hero).toBeNull();
    expect(m.absences).toHaveLength(1);
    expect(m.absences[0].status).toBe("not_published");
    expect(m.absences[0].reason).toMatch(/NOT YET PUBLISHED/);
    expect(m.absences[0].recheckAfter).toBe("2026-08-01");
  });

  it("never lets a not-ok row with dates become a countdown", () => {
    const m = buildSeasonModel(
      [row({ id: "a", status: "conflicted", dates: [{ open: "2026-10-24" }], notes: "two sources disagree" })],
      TODAY,
      YEAR,
    );
    expect(m.hero).toBeNull();
    expect(m.absences[0].status).toBe("conflicted");
  });

  it("reports an already-open season by the day it opened, with no days-left", () => {
    const m = buildSeasonModel([row({ id: "a" })], "2026-10-15", YEAR);
    expect(m.hero?.status).toBe("opened");
    expect(m.hero?.daysSince).toBe(12);
    expect(m.hero?.daysOut).toBeNull();
  });

  it("heroes the soonest opener still ahead, duck breaking the tie", () => {
    const m = buildSeasonModel(
      [
        row({ id: "d", species_id: "duck", dates: [{ open: "2026-10-03" }] }),
        row({ id: "g", species_id: "goose", dates: [{ open: "2026-09-01" }], zone: "Early Resident" }),
      ],
      TODAY,
      YEAR,
    );
    expect(m.hero?.species).toBe("goose");
    expect(m.openers.map((o) => o.species)).toEqual(["duck", "goose"]);
  });

  it("falls back to the most recent opener when everything has opened", () => {
    const m = buildSeasonModel(
      [
        row({ id: "d", species_id: "duck", dates: [{ open: "2026-10-03" }] }),
        row({ id: "g", species_id: "goose", dates: [{ open: "2026-09-01" }] }),
      ],
      "2026-11-01",
      YEAR,
    );
    expect(m.hero?.species).toBe("duck");
    expect(m.hero?.status).toBe("opened");
  });

  it("carries one species' date alongside the other species' absence", () => {
    const m = buildSeasonModel(
      [
        row({ id: "d", species_id: "duck" }),
        row({ id: "g", species_id: "goose", status: "no_season", dates: [], notes: "no goose season exists here" }),
      ],
      TODAY,
      YEAR,
    );
    expect(m.openers).toHaveLength(1);
    expect(m.absences).toHaveLength(1);
    expect(m.absences[0].speciesLabel).toBe("Goose");
  });

  it("takes the earliest current row per species when more than one is held", () => {
    const m = buildSeasonModel(
      [
        row({ id: "late", zone: "South Zone", dates: [{ open: "2026-11-14" }] }),
        row({ id: "early", zone: "North Zone", dates: [{ open: "2026-10-03" }] }),
      ],
      TODAY,
      YEAR,
    );
    expect(m.openers).toHaveLength(1);
    expect(m.openers[0].key).toBe("early");
  });

  it("reads a missing provisional label as unknown, never as final", () => {
    const m = buildSeasonModel([row({ id: "a", provisional: undefined })], TODAY, YEAR);
    expect(m.hero?.provisional).toBeNull();
  });

  it("hides a placeholder zone label but keeps a real one", () => {
    expect(buildSeasonModel([row({ id: "a", zone: "Statewide" })], TODAY, YEAR).hero?.zone).toBeNull();
    expect(buildSeasonModel([row({ id: "a", zone: "opener" })], TODAY, YEAR).hero?.zone).toBeNull();
    expect(buildSeasonModel([row({ id: "a", zone: "North Zone" })], TODAY, YEAR).hero?.zone).toBe(
      "North Zone",
    );
  });
});

describe("leadSentences", () => {
  it("passes a short reason through untouched", () => {
    expect(leadSentences("Not published yet.")).toEqual({ text: "Not published yet.", trimmed: false });
  });

  it("cuts at a sentence boundary and flags the cut", () => {
    const long = `${"A".repeat(200)}. ${"B".repeat(200)}. ${"C".repeat(200)}.`;
    const out = leadSentences(long, 320);
    expect(out.trimmed).toBe(true);
    expect(out.text!.endsWith(".")).toBe(true);
    expect(out.text!.length).toBeLessThanOrEqual(320);
  });

  it("never returns half a word when one sentence is longer than the budget", () => {
    const out = leadSentences(`${"word ".repeat(200)}end.`, 100);
    expect(out.trimmed).toBe(true);
    expect(out.text!.endsWith("word")).toBe(true);
  });

  it("treats no reason as no reason", () => {
    expect(leadSentences(null)).toEqual({ text: null, trimmed: false });
  });
});
