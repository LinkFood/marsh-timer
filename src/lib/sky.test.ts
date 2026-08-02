import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as sky from "./sky";
import { moonEvents, moonState, solunarWindows, sunTimes } from "./sky";

/**
 * GOLDEN-FILE PARITY: src/lib/sky.ts vs the deployed hunt-atlas-solunar.
 *
 * sky.ts is the offline foundation of the hunter's tool — the sunrise a hunter
 * reads in a marsh with no bars. It was ported by hand out of the edge function
 * `supabase/functions/hunt-atlas-solunar/index.ts`, and a hand port of 300 lines
 * of orbital mechanics is exactly the kind of thing that is silently wrong by
 * four minutes in November. This file is what stops that.
 *
 * The oracle's answers for 366 dates × 6 spots were captured ONCE by
 * `scripts/fetch-sky-fixtures.ts` and committed to `__fixtures__/sky-oracle.json`.
 * The test reads the file. IT NEVER OPENS A SOCKET — a module whose entire
 * promise is "works in airplane mode" cannot be guarded by a test that needs
 * the network, and the oracle will not be deployed forever.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THREE FIELDS ARE DELIBERATELY EXCLUDED FROM THE COMPARISON. DO NOT ADD THEM.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `shooting_light_end` — THE ORACLE IS WRONG ON THIS FIELD. It returns
 *   sunset + 30 minutes. The federal migratory-bird framework, and Maryland
 *   under it, ends legal shooting light at SUNSET. Asserting parity here would
 *   pin our code to the oracle's bug and make the bug a requirement: every
 *   future attempt to fix it would show up as a red test, and the "fix" would
 *   be to restore the half hour. That half hour is a hunter shooting into a
 *   federal violation with our running clock telling him he is fine. So the
 *   field is not compared, and sky.ts does not compute it at all.
 *
 * `shooting_light_start` — the oracle's sunrise − 30 happens to match the
 *   current federal framework, but it is a REGULATION, not astronomy: it is
 *   per-state, it changes when a state changes it, and it needs a citation and
 *   an effective date. It belongs in `src/data/regs/shootingHours.ts` with its
 *   source, not in an astronomy module with neither. Not compared.
 *
 * `rating` / `score` — the oracle grades the day `excellent|good|fair|poor`
 *   with a 1–4 score off the moon's age alone. That is a prediction wearing a
 *   number, and this product counts and never predicts (CLAUDE.md, "Show don't
 *   predict"). Stripped from sky.ts, so not compared.
 *
 * The fixture file still CONTAINS all four fields, because it is an honest
 * record of what the deployed function actually said. The refusal lives here,
 * where it is legible, not by quietly editing the evidence.
 *
 * ─────────────────────────────── TOLERANCE ───────────────────────────────
 * TOLERANCE_MS = 1000 (one second) on every instant compared.
 *
 * WHY THIS NUMBER, from both ends:
 *
 *   Why not tighter than 1s: the port is arithmetically identical to the
 *   oracle — same formulae, same constants, same IEEE-754 doubles, both run on
 *   V8 — so the honest expectation is ZERO drift, and the last test in the
 *   parity block asserts exactly that: worst observed deviation === 0 ms. The
 *   1s band exists only so that a last-ulp change in a V8 `Math.sin` between
 *   the Deno build that produced the fixture and whatever Node runs this suite
 *   cannot turn a non-event into a red build. A one-ulp perturbation matters
 *   most at an interpolated moonrise where the altitude curve grazes the
 *   horizon nearly flat, and even there it stays far under a second.
 *
 *   Why not looser than 1s: moon events are interpolated between samples 5
 *   minutes apart, so a genuine porting error in the crossing logic lands in
 *   the minutes, not the seconds. A 1s band is 300× tighter than the smallest
 *   real bug this test is built to catch, while still being 1000× looser than
 *   the noise floor. And one second is invisible to a hunter: legal light is
 *   published to the minute.
 *
 * The zero-drift assertion is the real regression signal; the 1s band is the
 * anti-flake floor under it. If they ever disagree, read the number printed by
 * the zero-drift test — it names the exact spot, date and field.
 */

/** See the TOLERANCE block above. */
const TOLERANCE_MS = 1000;

interface OracleWindow {
  start: string;
  end: string;
}

interface OracleRow {
  moon: {
    phase: string;
    illum: number;
    age: number;
    days_to_full: number;
    rise: string | null;
    set: string | null;
  };
  sun: {
    sunrise: string | null;
    sunset: string | null;
    solar_noon: string;
    // shooting_light_start / shooting_light_end are present in the fixture and
    // are NEVER read. See the exclusion block above.
  };
  solunar: {
    major: OracleWindow[];
    minor: OracleWindow[];
    // rating / score are present in the fixture and are NEVER read.
  };
}

interface Fixture {
  oracle: string;
  captured_at: string;
  year: number;
  spots: { id: string; name: string; lat: number; lng: number }[];
  dates: string[];
  rows: Record<string, Record<string, OracleRow>>;
}

const FIXTURE: Fixture = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "__fixtures__", "sky-oracle.json"), "utf-8"),
);

/** Every (spot, date) pair, flattened once so each test can walk it. */
const PAIRS = FIXTURE.spots.flatMap((spot) =>
  FIXTURE.dates.map((date) => ({
    spot,
    date,
    utc: new Date(`${date}T00:00:00Z`),
    row: FIXTURE.rows[spot.id][date],
  })),
);

/**
 * One instant comparison. Returns the deviation in ms, or null when both sides
 * agree that there is no such instant. Throws on a null/non-null disagreement,
 * because "the sun did not rise" vs "the sun rose at 09:12" is not a tolerance
 * question — it is a different fact.
 */
function deviation(ours: Date | null, theirs: string | null, what: string): number | null {
  if (ours === null && theirs === null) return null;
  if (ours === null || theirs === null) {
    throw new Error(`${what}: presence disagrees — ours=${ours?.toISOString() ?? "null"} oracle=${theirs ?? "null"}`);
  }
  const delta = Math.abs(ours.getTime() - new Date(theirs).getTime());
  if (delta > TOLERANCE_MS) {
    throw new Error(`${what}: ${delta}ms apart — ours=${ours.toISOString()} oracle=${theirs}`);
  }
  return delta;
}

describe("sky.ts — golden-file parity with the deployed solunar oracle", () => {
  it("walks the spread it claims to: 366 dates × 6 spots, arctic to southern ocean", () => {
    expect(FIXTURE.dates).toHaveLength(366); // 2028 is a leap year — Feb 29 included
    expect(FIXTURE.spots).toHaveLength(6);
    expect(PAIRS).toHaveLength(2196);

    const ids = FIXTURE.spots.map((s) => s.id);
    expect(ids).toContain("blackwater"); // the reference marsh, 38.44N
    expect(ids).toContain("utqiagvik"); // 71.29N — midnight sun and polar night
    expect(ids).toContain("adak"); // 176.66W — UTC day and local day disagree
    expect(ids).toContain("ushuaia"); // 54.80S — every seasonal sign flipped

    // Every pair actually carries a captured row; a hole would silently shrink
    // the comparison to whatever happened to download.
    for (const { spot, date, row } of PAIRS) {
      expect(row, `${spot.id} ${date} missing from fixture`).toBeTruthy();
    }
  });

  it("matches the oracle on sunrise, sunset and solar noon", () => {
    let compared = 0;
    for (const { spot, date, utc, row } of PAIRS) {
      const s = sunTimes(spot.lat, spot.lng, utc);
      // NOTE: row.sun.shooting_light_start and .shooting_light_end are NOT read
      // here, on purpose. See the exclusion block at the top of this file.
      if (deviation(s.sunrise, row.sun.sunrise, `${spot.id} ${date} sunrise`) !== null) compared++;
      if (deviation(s.sunset, row.sun.sunset, `${spot.id} ${date} sunset`) !== null) compared++;
      deviation(s.solarNoon, row.sun.solar_noon, `${spot.id} ${date} solar noon`);
      compared++;
    }
    expect(compared).toBeGreaterThan(6000);
  });

  it("matches the oracle on moon phase, illumination, age and days-to-full", () => {
    for (const { spot, date, utc, row } of PAIRS) {
      const m = moonState(utc);
      const where = `${spot.id} ${date}`;
      expect(m.phase, `${where} phase`).toBe(row.moon.phase);
      // The oracle rounds on the way out; round the same way to compare.
      expect(Math.round(m.illumination * 1000) / 10, `${where} illum`).toBe(row.moon.illum);
      expect(Math.round(m.age * 100) / 100, `${where} age`).toBe(row.moon.age);
      expect(Math.round(m.daysToFull * 100) / 100, `${where} days_to_full`).toBe(row.moon.days_to_full);
    }
  });

  it("matches the oracle on moonrise and moonset, including the days with neither", () => {
    let nullPairs = 0;
    for (const { spot, date, utc, row } of PAIRS) {
      const ev = moonEvents(spot.lat, spot.lng, utc);
      if (deviation(ev.rise, row.moon.rise, `${spot.id} ${date} moonrise`) === null) nullPairs++;
      if (deviation(ev.set, row.moon.set, `${spot.id} ${date} moonset`) === null) nullPairs++;
    }
    // The moon genuinely fails to rise or set on some UTC days at every
    // latitude — if this ever hits zero the null branch stopped being exercised.
    expect(nullPairs).toBeGreaterThan(0);
  });

  it("matches the oracle on the solunar windows, count and instants", () => {
    for (const { spot, date, utc, row } of PAIRS) {
      const w = solunarWindows(spot.lat, spot.lng, utc);
      const where = `${spot.id} ${date}`;
      expect(w.major.length, `${where} major count`).toBe(row.solunar.major.length);
      expect(w.minor.length, `${where} minor count`).toBe(row.solunar.minor.length);
      // NOTE: row.solunar.rating and .score are NOT read here, on purpose.
      w.major.forEach((win, i) => {
        deviation(win.start, row.solunar.major[i].start, `${where} major[${i}].start`);
        deviation(win.end, row.solunar.major[i].end, `${where} major[${i}].end`);
      });
      w.minor.forEach((win, i) => {
        deviation(win.start, row.solunar.minor[i].start, `${where} minor[${i}].start`);
        deviation(win.end, row.solunar.minor[i].end, `${where} minor[${i}].end`);
      });
    }
  });

  it("drifts from the oracle by exactly zero milliseconds", () => {
    // The real regression signal. The port is the same arithmetic on the same
    // doubles, so anything above zero means someone changed the math — the 1s
    // tolerance above would swallow a small change, this will not.
    let worst = 0;
    let worstWhat = "";
    const note = (d: number | null, what: string) => {
      if (d !== null && d > worst) {
        worst = d;
        worstWhat = what;
      }
    };

    for (const { spot, date, utc, row } of PAIRS) {
      const where = `${spot.id} ${date}`;
      const s = sunTimes(spot.lat, spot.lng, utc);
      note(deviation(s.sunrise, row.sun.sunrise, `${where} sunrise`), `${where} sunrise`);
      note(deviation(s.sunset, row.sun.sunset, `${where} sunset`), `${where} sunset`);
      note(deviation(s.solarNoon, row.sun.solar_noon, `${where} solar noon`), `${where} solar noon`);

      const ev = moonEvents(spot.lat, spot.lng, utc);
      note(deviation(ev.rise, row.moon.rise, `${where} moonrise`), `${where} moonrise`);
      note(deviation(ev.set, row.moon.set, `${where} moonset`), `${where} moonset`);

      const w = solunarWindows(spot.lat, spot.lng, utc);
      w.major.forEach((win, i) => {
        note(deviation(win.start, row.solunar.major[i].start, `${where} major[${i}].start`), `${where} major[${i}].start`);
        note(deviation(win.end, row.solunar.major[i].end, `${where} major[${i}].end`), `${where} major[${i}].end`);
      });
      w.minor.forEach((win, i) => {
        note(deviation(win.start, row.solunar.minor[i].start, `${where} minor[${i}].start`), `${where} minor[${i}].start`);
        note(deviation(win.end, row.solunar.minor[i].end, `${where} minor[${i}].end`), `${where} minor[${i}].end`);
      });
    }

    expect(worst, `worst deviation was at ${worstWhat}`).toBe(0);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Source text, with comments stripped. The doc comments in sky.ts and in this
 * file DISCUSS shooting light and ratings at length — that is the point of them
 * — so a naive grep over the raw file would match its own warning. Strip the
 * prose, then search what actually executes.
 */
const SKY_CODE: string = fs
  .readFileSync(path.resolve(__dirname, "sky.ts"), "utf-8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

describe("the three things sky.ts refuses to carry", () => {
  it("computes no shooting light — not the end, not the start", () => {
    // THE TRAP. The oracle ends shooting light at sunset + 30 min; federal and
    // Maryland law end it at SUNSET. An app that runs that clock walks a hunter
    // into a violation. Legal hours are cited state law and live in
    // src/data/regs/shootingHours.ts, which consumes sunTimes() from here.
    expect(SKY_CODE).not.toMatch(/shooting/i);
    expect(SKY_CODE).not.toMatch(/legal[_ ]?light/i);
    // No time offset is applied to a solar event anywhere in this module.
    expect(SKY_CODE).not.toMatch(/sun(rise|set)Min\w*\s*[+-]\s*\d/);
  });

  it("grades nothing — no rating, no score", () => {
    expect(SKY_CODE).not.toMatch(/\brating\b/i);
    expect(SKY_CODE).not.toMatch(/\bscore\b/i);
    expect(SKY_CODE).not.toMatch(/excellent|\bpoor\b/i);
  });

  it("opens no socket — the whole promise of the module is airplane mode", () => {
    expect(SKY_CODE).not.toMatch(/\bfetch\s*\(/);
    expect(SKY_CODE).not.toMatch(/XMLHttpRequest|navigator\.|WebSocket|EventSource/);
    expect(SKY_CODE).not.toMatch(/from\s+["'][^"']*supabase/);
    expect(SKY_CODE).not.toMatch(/^\s*import\s/m); // sky.ts imports nothing at all
  });

  it("exports the astronomy and nothing that grades it", () => {
    const exported = Object.keys(sky).sort();
    expect(exported).toEqual(["moonEvents", "moonState", "solunarWindows", "sunTimes", "utcDayStart"]);

    const s = sunTimes(38.4436, -76.0722, new Date("2026-09-01T00:00:00Z"));
    const w = solunarWindows(38.4436, -76.0722, new Date("2026-09-01T00:00:00Z"));
    const surface = [
      ...Object.keys(s),
      ...Object.keys(moonState(new Date("2026-09-01T00:00:00Z"))),
      ...Object.keys(w),
      ...Object.keys(w.major[0] ?? {}),
    ].join(" ");
    expect(surface).not.toMatch(/shooting|rating|score/i);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe("sky.ts — determinism and the edges the oracle papers over", () => {
  const BLACKWATER = { lat: 38.4436, lng: -76.0722 };
  const UTQIAGVIK = { lat: 71.2906, lng: -156.7887 };

  it("is a pure function of its arguments — same day in, same instants out", () => {
    const a = sunTimes(BLACKWATER.lat, BLACKWATER.lng, new Date("2026-11-14T00:00:00Z"));
    const b = sunTimes(BLACKWATER.lat, BLACKWATER.lng, new Date("2026-11-14T00:00:00Z"));
    expect(a.sunrise?.toISOString()).toBe(b.sunrise?.toISOString());
    expect(a.sunset?.toISOString()).toBe(b.sunset?.toISOString());
  });

  it("reads the UTC calendar day, so the time of day handed in cannot move it", () => {
    // The oracle was only ever handed a T00:00:00Z instant parsed from a
    // YYYY-MM-DD param, so this never came up for it. A browser caller holds a
    // live `new Date()` — 3 p.m. on the 14th must be the same sky as midnight
    // on the 14th, or the page changes its answer as the afternoon wears on.
    const midnight = sunTimes(BLACKWATER.lat, BLACKWATER.lng, new Date("2026-11-14T00:00:00Z"));
    const afternoon = sunTimes(BLACKWATER.lat, BLACKWATER.lng, new Date("2026-11-14T15:47:12.345Z"));
    expect(afternoon.sunrise?.toISOString()).toBe(midnight.sunrise?.toISOString());
    expect(afternoon.sunset?.toISOString()).toBe(midnight.sunset?.toISOString());

    const m1 = moonState(new Date("2026-11-14T00:00:00Z"));
    const m2 = moonState(new Date("2026-11-14T23:59:59.999Z"));
    expect(m2).toEqual(m1);
  });

  it("names WHY there is no sunrise, which the oracle could not", () => {
    // The oracle returned a bare null for both polar cases. Above the Arctic
    // Circle those are opposite facts and both happen at the same spot, six
    // months apart. sky.ts reports which one, so the UI can say the true thing
    // instead of "sunrise: —".
    const june = sunTimes(UTQIAGVIK.lat, UTQIAGVIK.lng, new Date("2028-06-21T00:00:00Z"));
    expect(june.sunrise).toBeNull();
    expect(june.polar).toBe("midnight-sun");

    const december = sunTimes(UTQIAGVIK.lat, UTQIAGVIK.lng, new Date("2028-12-21T00:00:00Z"));
    expect(december.sunrise).toBeNull();
    expect(december.polar).toBe("polar-night");

    // Solar noon survives both — the sun has a highest point every day, even a
    // day it spends entirely underground.
    expect(june.solarNoon).toBeInstanceOf(Date);
    expect(december.solarNoon).toBeInstanceOf(Date);

    const blackwater = sunTimes(BLACKWATER.lat, BLACKWATER.lng, new Date("2028-06-21T00:00:00Z"));
    expect(blackwater.polar).toBe("none");
  });

  it("lets an instant roll into the neighbouring UTC day rather than clamping it", () => {
    // Adak sits 176.7°W: its solar noon is ~23:50Z and its sunset lands on the
    // NEXT UTC date. Clamping that into the requested day would be a four-hour
    // lie. It is reported as the honest instant; localizing is the caller's job.
    const adak = sunTimes(51.88, -176.6581, new Date("2028-01-01T00:00:00Z"));
    expect(adak.sunset?.toISOString().slice(0, 10)).toBe("2028-01-02");
    expect(adak.sunrise?.toISOString().slice(0, 10)).toBe("2028-01-01");
  });

  it("puts the moon's phase where the almanac does", () => {
    // Independent anchor, so the parity block is not the only thing standing
    // between us and a moon that is confidently wrong in both places at once:
    // the full moon of 2026-09-26 (USNO) and the new moon of 2026-09-11.
    const full = moonState(new Date("2026-09-26T00:00:00Z"));
    expect(full.illumination).toBeGreaterThan(0.97);
    expect(full.daysToFull).toBeLessThan(1.5);

    const newMoon = moonState(new Date("2026-09-11T00:00:00Z"));
    expect(newMoon.illumination).toBeLessThan(0.03);
    expect(newMoon.phase).toBe("New Moon");
  });
});
