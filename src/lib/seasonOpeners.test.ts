import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { deriveOpeners, type CaptureRecord } from "./seasonOpeners";

/**
 * The selection rule is the only place where 357 verified records become 100
 * published facts, so every edge case it decides is pinned here. The last block
 * runs the rule over the REAL capture file: if the file changes, the counts and
 * the named openers have to change with it deliberately, not silently.
 */

const base: CaptureRecord = {
  state_abbr: "XX",
  species: "duck",
  season_year: "2026-2027",
  zone: "Statewide",
  dates: [{ open: "2026-10-10", close: "2026-11-10" }],
  status: "ok",
  bag_limit: 6,
  provisional: false,
  provisional_note: null,
  source_url: "https://example.state/regs",
  fetched_at: "2026-07-25T01:00:00Z",
  confidence: "high",
  notes: null,
};

const rec = (over: Partial<CaptureRecord>): CaptureRecord => ({ ...base, ...over });

describe("deriveOpeners — the selection rule", () => {
  it("takes the earliest open across zones and carries that zone's label", () => {
    const { openers } = deriveOpeners([
      rec({ zone: "South Zone", dates: [{ open: "2026-11-14", close: "2027-01-30" }] }),
      rec({ zone: "North Zone", dates: [{ open: "2026-10-03", close: "2026-12-01" }] }),
    ]);
    expect(openers).toHaveLength(1);
    expect(openers[0].opensOn).toBe("2026-10-03");
    expect(openers[0].zone).toBe("North Zone");
    expect(openers[0].laterOpeners).toBe(1);
    expect(openers[0].sourceRecords).toBe(2);
  });

  it("takes the earliest open across SPLITS inside one record", () => {
    const { openers } = deriveOpeners([
      rec({
        dates: [
          { open: "2026-12-15", close: "2027-01-30" },
          { open: "2026-10-10", close: "2026-10-17" },
        ],
      }),
    ]);
    expect(openers[0].opensOn).toBe("2026-10-10");
  });

  it("lets an early special season win, and names it", () => {
    const { openers } = deriveOpeners([
      rec({
        species: "goose",
        zone: "Early Resident Canada Goose - Eastern Zone",
        dates: [{ open: "2026-09-01", close: "2026-09-25" }],
      }),
      rec({
        species: "goose",
        zone: "Atlantic Population Hunt Zone",
        dates: [{ open: "2026-11-20", close: "2027-01-30" }],
      }),
    ]);
    expect(openers[0].opensOn).toBe("2026-09-01");
    expect(openers[0].zone).toBe("Early Resident Canada Goose - Eastern Zone");
  });

  it("breaks a same-day tie alphabetically and counts the tie", () => {
    const { openers } = deriveOpeners([
      rec({ zone: "Zone B", dates: [{ open: "2026-10-03", close: "2026-12-01" }] }),
      rec({ zone: "Zone A", dates: [{ open: "2026-10-03", close: "2026-12-01" }] }),
    ]);
    expect(openers[0].zone).toBe("Zone A");
    expect(openers[0].sameDayOpeners).toBe(1);
    expect(openers[0].laterOpeners).toBe(0);
  });

  it("takes provisional from the WINNING record, not an OR across the pair", () => {
    const { openers } = deriveOpeners([
      rec({ zone: "Early", dates: [{ open: "2026-09-01", close: "2026-09-25" }], provisional: false }),
      rec({
        zone: "Regular",
        dates: [{ open: "2026-11-20", close: "2027-01-30" }],
        provisional: true,
        provisional_note: "pending federal frameworks",
      }),
    ]);
    expect(openers[0].provisional).toBe(false);
    expect(openers[0].provisionalNote).toBeNull();
  });
});

describe("deriveOpeners — what must NOT produce a countdown", () => {
  it.each(["not_published", "no_season", "closed", "conflicted"])(
    "%s produces an absence carrying the state's own reason",
    (status) => {
      const { openers, absences } = deriveOpeners([
        rec({ status, dates: [], notes: "the state's own reason", recheck_after: "2026-08-01" }),
      ]);
      expect(openers).toHaveLength(0);
      expect(absences).toHaveLength(1);
      expect(absences[0].status).toBe(status);
      expect(absences[0].reason).toBe("the state's own reason");
      expect(absences[0].recheckAfter).toBe("2026-08-01");
      expect(absences[0].sourceUrl).toBe("https://example.state/regs");
    },
  );

  it("excludes a non-ok record that still carries dates, and warns", () => {
    const { openers, absences, warnings } = deriveOpeners([
      rec({ status: "conflicted", dates: [{ open: "2026-10-24", close: "2026-11-20" }] }),
    ]);
    expect(openers).toHaveLength(0);
    expect(absences).toHaveLength(1);
    expect(warnings.join(" ")).toMatch(/status=conflicted/);
  });

  it("excludes an ok record whose date falls outside the season year, and warns", () => {
    const { openers, warnings } = deriveOpeners([
      rec({ dates: [{ open: "2026-04-01", close: "2026-05-01" }] }),
    ]);
    expect(openers).toHaveLength(0);
    expect(warnings.join(" ")).toMatch(/outside season year/);
  });

  it("excludes an ok record with no usable date, and warns", () => {
    const { openers, warnings } = deriveOpeners([rec({ dates: [] })]);
    expect(openers).toHaveLength(0);
    expect(warnings.join(" ")).toMatch(/no usable open date/);
  });

  it("still publishes an opener when only SOME of the pair's records are ok", () => {
    const { openers, absences } = deriveOpeners([
      rec({ zone: "Early", dates: [{ open: "2026-09-01", close: "2026-09-25" }] }),
      rec({ zone: "Regular", status: "not_published", dates: [], notes: "not out yet" }),
    ]);
    expect(openers).toHaveLength(1);
    expect(openers[0].opensOn).toBe("2026-09-01");
    expect(absences).toHaveLength(0);
  });

  it("prefers a Statewide record's reason when an absence has several", () => {
    const { absences, warnings } = deriveOpeners([
      rec({ zone: "North Unit", status: "not_published", dates: [], notes: "north reason" }),
      rec({ zone: "Statewide", status: "not_published", dates: [], notes: "statewide reason" }),
    ]);
    expect(absences[0].reason).toBe("statewide reason");
    expect(absences[0].sourceRecords).toBe(2);
    expect(warnings).toHaveLength(0);
  });

  it("names a disagreement when an absent pair's statuses do not match", () => {
    const { absences, warnings } = deriveOpeners([
      rec({ zone: "A", status: "not_published", dates: [], notes: "a" }),
      rec({ zone: "B", status: "closed", dates: [], notes: "b" }),
    ]);
    expect(absences).toHaveLength(1);
    expect(warnings.join(" ")).toMatch(/mixed statuses/);
  });
});

describe("deriveOpeners — over the real 2026-27 capture", () => {
  const file = path.resolve(__dirname, "..", "..", "data", "seasons", "2026-27.json");
  const records = JSON.parse(fs.readFileSync(file, "utf-8")) as CaptureRecord[];
  const { openers, absences, warnings } = deriveOpeners(records);

  it("collapses 357 records into 100 state-species pairs", () => {
    expect(records).toHaveLength(357);
    expect(openers.length + absences.length).toBe(100);
  });

  it("produces 90 countdowns and 10 honest absences", () => {
    expect(openers).toHaveLength(90);
    expect(absences).toHaveLength(10);
    expect(absences.filter((a) => a.status === "no_season").map((a) => a.stateAbbr)).toEqual([
      "HI",
      "HI",
    ]);
    expect([...new Set(absences.filter((a) => a.status === "not_published").map((a) => a.stateAbbr))]
      .sort()).toEqual(["MN", "ND", "SC", "WV"]);
  });

  it("every opener carries a date inside its own season year and a link", () => {
    for (const o of openers) {
      expect(o.opensOn >= "2026-07-01" && o.opensOn <= "2027-06-30").toBe(true);
      expect(o.sourceUrl).toBeTruthy();
    }
  });

  it("pins the openers that decide the rule", () => {
    const find = (s: string, sp: string) =>
      openers.find((o) => o.stateAbbr === s && o.species === sp)!;
    // Zones: Maryland's earliest duck zone, not a statewide invention.
    expect(find("MD", "duck").opensOn).toBe("2026-10-03");
    expect(find("MD", "duck").zone).toBe("Western Zone");
    // Early resident goose IS the goose opener, and says which season it is.
    expect(find("MD", "goose").opensOn).toBe("2026-09-01");
    expect(find("MD", "goose").zone).toBe("Early Resident Canada Goose - Eastern Zone");
    // September teal is the duck opener in North Carolina.
    expect(find("NC", "duck").opensOn).toBe("2026-09-10");
    // The earliest waterfowl date in the country: South Dakota's August take.
    expect(find("SD", "goose").opensOn).toBe("2026-08-15");
  });

  it("reports the one contradiction in the capture rather than smoothing it", () => {
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/NY\|goose/);
    expect(warnings[0]).toMatch(/status=conflicted/);
  });

  it("marks ten openers provisional — the states pending federal frameworks", () => {
    const prov = openers.filter((o) => o.provisional).map((o) => o.stateAbbr);
    expect([...new Set(prov)].sort()).toEqual(["AL", "DE", "MD", "NJ", "NV"]);
    for (const o of openers.filter((o) => o.provisional)) {
      expect(o.provisionalNote).toBeTruthy();
    }
  });
});
