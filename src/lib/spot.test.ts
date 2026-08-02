/**
 * Tests for the two new offline-first modules.
 *
 * Two things are being pinned here, and only two:
 *
 *   1. The shooting-hours table REFUSES rather than guesses. This is a legal
 *      surface — a regression that turns a refusal into a default is the exact
 *      failure mode that hands a hunter a citation, so it gets a test.
 *   2. Nothing in `spot.ts` turns a missing number into 0. `?? 0` on a
 *      coordinate puts the hunter in the Atlantic.
 */
import { describe, expect, it, beforeEach } from "vitest";
import {
  lookupShootingHours,
  resolveShootingWindow,
  parseSolarOffset,
  isTranscribedState,
  TRANSCRIBED_STATES,
} from "@/data/regs/shootingHours";
import {
  finiteOrNull,
  haversineKm,
  kmToMiles,
  isValidLatLng,
  nearestStation,
  parseCoopsStations,
  parseStoredSpot,
  saveSpot,
  loadSpot,
  clearSpot,
  createSpot,
  type CoopsStation,
  type Spot,
} from "@/lib/spot";

/** The regular duck season, which is the general rule's own season. */
const REGULAR = { species: "duck", date: "2026-10-10" } as const;

describe("shootingHours — the table", () => {
  it("holds Maryland and nothing else", () => {
    expect(TRANSCRIBED_STATES).toEqual(["MD"]);
  });

  it("ends Maryland REGULAR-season legal light at sunset, not sunset+30", () => {
    const l = lookupShootingHours("MD", REGULAR);
    expect(l.status).toBe("transcribed");
    if (l.status !== "transcribed") return;
    expect(l.rule.start).toBe("sunrise-30");
    expect(l.rule.end).toBe("sunset+0");
    expect(l.rule.cite).toMatch(/^https:\/\//);
    expect(l.rule.verified).toBe("2026-08-01");
  });

  it("accepts lowercase and normalises", () => {
    const l = lookupShootingHours("md", REGULAR);
    expect(l.status).toBe("transcribed");
    if (l.status === "transcribed") expect(l.state).toBe("MD");
  });

  it("APPLIES the September carve-out instead of leaving it inert", () => {
    // The whole point of the season-aware chain: on the September resident
    // Canada goose opener the answer is sunset+30, and it is cited to the
    // regulation that grants it.
    const l = lookupShootingHours("MD", { species: "goose", date: "2026-09-01" });
    expect(l.status).toBe("transcribed");
    if (l.status !== "transcribed") return;
    expect(l.rule.end).toBe("sunset+30");
    expect(l.rule.cite).toBe("https://regs.maryland.gov/us/md/exec/comar/08.03.07.13");
  });

  it("still lists the two COMAR sunset+30 carve-outs on the general rule", () => {
    const l = lookupShootingHours("MD", REGULAR);
    if (l.status !== "transcribed") throw new Error("MD must be transcribed");
    expect(l.rule.exceptions).toHaveLength(2);
    for (const e of l.rule.exceptions) expect(e.cite).toMatch(/^https:\/\//);
  });

  it("will not hand out a rule when the season is unknown", () => {
    const l = lookupShootingHours("MD");
    expect(l.status).not.toBe("transcribed");
    if (l.status !== "narrowed") throw new Error("expected a narrowed answer");
    expect(l.rule.end).toBe("sunset+0"); // the SHORTER window, never sunset+30
  });
});

describe("shootingHours — the refusal", () => {
  it.each(["DE", "VA", "NC", "TX", "ZZ"])("refuses %s rather than guessing", (st) => {
    const l = lookupShootingHours(st);
    expect(l.status).toBe("refused");
    if (l.status !== "refused") return;
    expect(l.reason).toBe("not-transcribed");
    expect(l.message).toContain(st);
    // The safety property: no rule is reachable on a refusal.
    expect("rule" in l).toBe(false);
  });

  it.each([undefined, null, "", "M", "MARYLAND", 42])(
    "refuses malformed input %p",
    (bad) => {
      const l = lookupShootingHours(bad);
      expect(l.status).toBe("refused");
    },
  );

  it("never yields a window for a non-transcribed state", () => {
    const w = resolveShootingWindow(lookupShootingHours("DE"), {
      sunriseMin: 400,
      sunsetMin: 1100,
    });
    expect(w.status).toBe("refused");
    expect("openMin" in w).toBe(false);
    expect("closeMin" in w).toBe(false);
  });

  it("isTranscribedState is the only affirmative gate", () => {
    expect(isTranscribedState("MD")).toBe(true);
    expect(isTranscribedState("DE")).toBe(false);
    expect(isTranscribedState(null)).toBe(false);
  });
});

describe("shootingHours — the window", () => {
  it("opens 30 minutes before sunrise and closes AT sunset in the regular season", () => {
    const w = resolveShootingWindow(lookupShootingHours("MD", REGULAR), {
      sunriseMin: 400,
      sunsetMin: 1100,
    });
    expect(w.status).toBe("ok");
    if (w.status !== "ok") return;
    expect(w.openMin).toBe(370);
    expect(w.closeMin).toBe(1100); // NOT 1130
  });

  it("closes 30 minutes AFTER sunset in the September resident goose season", () => {
    const w = resolveShootingWindow(
      lookupShootingHours("MD", { species: "goose", date: "2026-09-01" }),
      { sunriseMin: 400, sunsetMin: 1100 },
    );
    expect(w.status).toBe("ok");
    if (w.status !== "ok") return;
    expect(w.openMin).toBe(370);
    expect(w.closeMin).toBe(1130);
  });

  it("refuses when sun times are missing or non-finite — never treats them as 0", () => {
    const md = lookupShootingHours("MD", REGULAR);
    for (const sun of [
      null,
      undefined,
      { sunriseMin: NaN, sunsetMin: 1100 },
      { sunriseMin: 400, sunsetMin: Infinity },
    ]) {
      const w = resolveShootingWindow(md, sun as never);
      expect(w.status).toBe("refused");
      if (w.status === "refused") expect(w.reason).toBe("no-sun-times");
    }
  });

  it("parses offsets strictly", () => {
    expect(parseSolarOffset("sunrise-30")).toEqual({ anchor: "sunrise", minutes: -30 });
    expect(parseSolarOffset("sunset+0")).toEqual({ anchor: "sunset", minutes: 0 });
    expect(parseSolarOffset("sunset")).toBeNull();
    expect(parseSolarOffset("dawn-30")).toBeNull();
    expect(parseSolarOffset("")).toBeNull();
  });
});

describe("spot — numeric guards", () => {
  it("finiteOrNull never invents a zero", () => {
    expect(finiteOrNull(0)).toBe(0);
    expect(finiteOrNull("38.4436")).toBe(38.4436);
    expect(finiteOrNull(null)).toBeNull();
    expect(finiteOrNull(undefined)).toBeNull();
    expect(finiteOrNull("")).toBeNull();
    expect(finiteOrNull("abc")).toBeNull();
    expect(finiteOrNull(NaN)).toBeNull();
    expect(finiteOrNull(Infinity)).toBeNull();
  });

  it("isValidLatLng rejects out-of-range and absent coordinates", () => {
    expect(isValidLatLng(38.4436, -76.0722)).toBe(true);
    expect(isValidLatLng(0, 0)).toBe(true); // real, if unlikely — range check only
    expect(isValidLatLng(null, -76)).toBe(false);
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
  });

  it("haversineKm returns null on a bad point rather than 0", () => {
    expect(haversineKm(null, -76, 38, -76)).toBeNull();
    expect(haversineKm(38, -76, 38, undefined)).toBeNull();
    expect(kmToMiles(null)).toBeNull();
  });
});

describe("spot — nearest CO-OPS station", () => {
  // Real coordinates for the three nearest prediction stations to Blackwater
  // NWR, taken from the live NOAA metadata payload on 2026-08-01.
  const stations: CoopsStation[] = [
    { id: "8571807", name: "Woolford, Church Creek", state: "MD", lat: 38.5067, lng: -76.1733 },
    { id: "8571892", name: "Cambridge", state: "MD", lat: 38.5725, lng: -76.0616667 },
    { id: "8575512", name: "Annapolis (US Naval Academy)", state: "MD", lat: 38.983882904052734, lng: -76.48003387451172 },
  ];

  it("binds Blackwater NWR to 8571807 Woolford, Church Creek", () => {
    const near = nearestStation(38.4436, -76.0722, stations);
    expect(near).not.toBeNull();
    expect(near?.station.id).toBe("8571807");
    expect(near?.km).toBeGreaterThan(9);
    expect(near?.km).toBeLessThan(13);
    expect(near?.miles).toBeGreaterThan(5);
    expect(near?.miles).toBeLessThan(9);
  });

  it("returns null rather than a fabricated nearest", () => {
    expect(nearestStation(38.4436, -76.0722, [])).toBeNull();
    expect(nearestStation(null, -76.0722, stations)).toBeNull();
  });

  it("drops stations whose coordinates do not parse instead of placing them at 0,0", () => {
    const parsed = parseCoopsStations({
      stations: [
        { id: "1", name: "good", state: "MD", lat: 38.5, lng: -76.1 },
        { id: "2", name: "no lat", state: "MD", lng: -76.1 },
        { id: "3", name: "junk lat", state: "MD", lat: "n/a", lng: -76.1 },
        { name: "no id", lat: 38.5, lng: -76.1 },
      ],
    });
    expect(parsed.map((s) => s.id)).toEqual(["1"]);
    expect(parseCoopsStations(null)).toEqual([]);
    expect(parseCoopsStations({ stations: "nope" })).toEqual([]);
  });
});

describe("spot — persistence is frozen, not re-resolved", () => {
  beforeEach(() => {
    clearSpot();
  });

  const blackwater: Spot = {
    name: "Blackwater",
    lat: 38.4436,
    lng: -76.0722,
    county_fips: "24019",
    county_name: "Dorchester",
    state: "MD",
    coops_station_id: "8571807",
    station_miles: 7.0,
    saved_at: "2026-08-01T10:00:00.000Z",
  };

  it("round-trips through localStorage unchanged", () => {
    expect(saveSpot(blackwater)).toBe(true);
    expect(loadSpot()).toEqual(blackwater);
  });

  it("refuses a record from a different schema version", () => {
    expect(parseStoredSpot({ ...blackwater, v: 2 })).toBeNull();
    expect(parseStoredSpot({ ...blackwater })).toBeNull(); // no v at all
  });

  it("refuses a record with no real coordinate", () => {
    expect(parseStoredSpot({ ...blackwater, v: 1, lat: null })).toBeNull();
    expect(parseStoredSpot({ ...blackwater, v: 1, lat: "n/a" })).toBeNull();
  });

  it("keeps a spot with no bound station rather than dropping it", () => {
    const s = parseStoredSpot({
      ...blackwater,
      v: 1,
      coops_station_id: null,
      station_miles: null,
    });
    expect(s).not.toBeNull();
    expect(s?.coops_station_id).toBeNull();
    expect(s?.station_miles).toBeNull(); // not 0
  });

  it("createSpot refuses a bad coordinate instead of saving 0,0", async () => {
    const r = await createSpot({ name: "bad", lat: undefined, lng: -76.0722 });
    expect(r.status).toBe("refused");
    expect(loadSpot()).toBeNull();
  });

  it("createSpot takes an explicit station override without touching the network", async () => {
    const r = await createSpot({
      name: "Blackwater",
      lat: 38.4436,
      lng: -76.0722,
      state: "md",
      coops_station_id: "8571807",
      station_miles: 7.0,
    });
    expect(r.status).toBe("saved");
    if (r.status !== "saved") return;
    expect(r.spot.coops_station_id).toBe("8571807");
    expect(r.spot.state).toBe("MD");
    expect(loadSpot()?.name).toBe("Blackwater");
  });
});
