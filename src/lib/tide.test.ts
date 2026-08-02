import { describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import * as tide from "./tide";
import {
  formatTideHeight,
  packTideEvents,
  tideAt,
  tideCurveSlice,
  tideDirection,
  unpackTideEvents,
  type TideCurve,
  type TideEvent,
  type TidePack,
  type TideProvenance,
  type TideResult,
} from "./tide";

/**
 * tide.ts — the PURE half. Offline test suite.
 *
 * THIS FILE IMPORTS `./tide` AND NOTHING ELSE FROM THE MODULE PAIR. It does not
 * import `./tideFetch`, not even for a convenience helper, because the thing
 * under test is precisely the claim that the pure half stands alone. Where a
 * test needs real NOAA numbers it parses the committed capture inline — see
 * `eventsFromCapture` below, a dozen lines that keep this file honest.
 *
 * The wire half has its own suite in `tideFetch.test.ts`. Between them they hold
 * every guarantee: the sync-vs-async structural fence (both sides), the
 * throwing-fetch-stub sweep (here), the `TideResult` refusal branch with no
 * `value` (both), and the null-height refusal (here on the pack write and cache
 * read paths, there on the network parse path).
 *
 * Fixtures are verbatim recordings from the live CO-OPS service on 2026-08-01.
 * Stations are the two nearest Blackwater NWR:
 *   8571421  Bishops Head            — harmonic station
 *   8571807  Woolford, Church Creek  — SUBORDINATE station, hi/lo only
 */

/* ─────────────────────────── fixture plumbing ─────────────────────────── */

const FIXTURES = path.join(__dirname, "__fixtures__");

const readFixture = <T,>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) as T;

const captures = readFixture<{
  scenarios: Record<string, { url: string; httpStatus: number; body: string }>;
}>("tide-coops-captures.json");

const seasonCapture = readFixture<{ url: string; httpStatus: number; body: string }>(
  "tide-bishops-head-season.json",
);

interface RawRow {
  t: string;
  v: string;
  type?: string;
}

const rawRows = (body: string): RawRow[] =>
  (JSON.parse(body) as { predictions: RawRow[] }).predictions;

/** CO-OPS `"YYYY-MM-DD HH:MM"` (requested in GMT) → a real UTC instant. */
const rawInstant = (t: string): Date => new Date(`${t.replace(" ", "T")}:00.000Z`);

const provenance: TideProvenance = {
  kind: "prediction",
  source: "NOAA CO-OPS",
  stationId: "8571421",
  datum: "MLLW",
  units: "english",
  timeFrame: "utc",
  fetchedAt: "2026-08-01T00:00:00.000Z",
  disclaimer: tide.PREDICTION_DISCLAIMER,
};

/** Real NOAA hi/lo events, parsed here rather than fetched. */
const eventsFromCapture = (body: string): TideEvent[] =>
  rawRows(body).map((r) => ({
    at: rawInstant(r.t),
    height: Number(r.v),
    kind: r.type === "H" ? "high" : "low",
  }));

/** Real NOAA hourly curve, parsed here rather than fetched. */
const curveFromCapture = (body: string): TideCurve => ({
  provenance,
  stepMinutes: 60,
  samples: rawRows(body).map((r) => ({ at: rawInstant(r.t), height: Number(r.v) })),
});

/** Build a curve by hand for the edge cases. */
const curveOf = (
  points: readonly (readonly [string, number])[],
  stepMinutes = 60,
): TideCurve => ({
  provenance,
  stepMinutes,
  samples: points.map(([iso, height]) => ({ at: new Date(iso), height })),
});

const expectOk = <T,>(r: TideResult<T>): T => {
  if (r.status !== "ok") {
    throw new Error(`expected ok, got refusal ${r.reason}: ${r.message}`);
  }
  return r.value;
};

const BISHOPS_HEAD = "8571421";

const META = {
  stationId: BISHOPS_HEAD,
  datum: "MLLW" as const,
  units: "english" as const,
  fetchedAt: "2026-08-01T00:00:00.000Z",
};

/* ══════════════════════════════════════════════════════════════════════════
   1. THE PURE FENCE — why this file can be trusted in airplane mode.
   ══════════════════════════════════════════════════════════════════════════ */

describe("the pure half stands alone", () => {
  const PURE = [
    "tideAt",
    "tideDirection",
    "tideCurveSlice",
    "packTideEvents",
    "unpackTideEvents",
    "formatTideHeight",
    "resultOk",
    "refuse",
  ] as const;

  it("every export is a synchronous function — not one is an AsyncFunction", () => {
    // A sync function cannot `await fetch(...)` and return the result, so this
    // makes an accidental network call in this module a signature change, which
    // is a loud reviewable diff at every call site.
    for (const name of PURE) {
      const fn = (tide as unknown as Record<string, unknown>)[name];
      expect(typeof fn, name).toBe("function");
      expect((fn as { constructor: { name: string } }).constructor.name, name).toBe("Function");
    }
  });

  it("exports no fetcher at all — the wire half is a different module", () => {
    const names = Object.keys(tide);
    expect(names.filter((n) => /^fetch/.test(n))).toEqual([]);
    expect(names).not.toContain("buildCoopsUrl");
  });

  it("names no network endpoint anywhere in its source", () => {
    // The greppable half of the boundary: after the split, `tide.ts` does not
    // contain a single character of the CO-OPS endpoint. A reviewer can check
    // this with one command instead of by reading two files.
    const src = fs.readFileSync(path.join(__dirname, "tide.ts"), "utf8");
    expect(src).not.toMatch(/tidesandcurrents/);
  });

  it("never imports the wire half — the dependency arrow points one way", () => {
    // An import pointing the other way would reintroduce the coupling the split
    // exists to remove, and would let the eslint offline tripwire be routed
    // around through a re-export.
    const src = fs.readFileSync(path.join(__dirname, "tide.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["'][^"']*tideFetch/);
    expect(src).not.toMatch(/import\s*\(\s*["'][^"']*tideFetch/);
    expect(src).not.toMatch(/require\s*\(\s*["'][^"']*tideFetch/);
  });

  it("runs its ENTIRE surface with globalThis.fetch removed", () => {
    // The strongest available proof: rip the network out from under the module
    // and drive every export. Anything that reached for a socket throws.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("a pure tide function reached for the network");
    }) as unknown as typeof fetch;

    try {
      const curve = curveOf([
        ["2026-09-01T08:00:00Z", 2.133],
        ["2026-09-01T09:00:00Z", 2.172],
        ["2026-09-01T10:00:00Z", 1.964],
      ]);
      expect(expectOk(tideAt(curve, new Date("2026-09-01T08:30:00Z"))).height).toBeCloseTo(
        2.1525,
        6,
      );
      expect(expectOk(tideDirection(curve, new Date("2026-09-01T09:45:00Z"))).direction).toBe(
        "falling",
      );
      expect(
        expectOk(
          tideCurveSlice(
            curve,
            new Date("2026-09-01T08:30:00Z"),
            new Date("2026-09-01T09:30:00Z"),
          ),
        ).samples,
      ).toHaveLength(3);

      const pack = expectOk(
        packTideEvents(eventsFromCapture(captures.scenarios.bishopsHeadHiloSep1.body), META),
      );
      expect(expectOk(unpackTideEvents(pack))).toHaveLength(4);
      expect(formatTideHeight(2.19, "english")).toBe("2.2 ft");
      expect(tide.resultOk(1).status).toBe("ok");
      expect(tide.refuse("no-data", "x").status).toBe("refused");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("takes no fetch implementation, timeout or signal anywhere", () => {
    // `TideFetchOptions` lives in the other module. Nothing here has anywhere to
    // put a socket even if a caller tried to hand it one.
    expect(tideAt.length).toBe(2);
    expect(tideDirection.length).toBe(2);
    expect(tideCurveSlice.length).toBe(3);
    expect(packTideEvents.length).toBe(2);
    expect(unpackTideEvents.length).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2. tideAt.
   ══════════════════════════════════════════════════════════════════════════ */

describe("tideAt", () => {
  const curve = curveOf([
    ["2026-09-01T08:00:00Z", 2.0],
    ["2026-09-01T09:00:00Z", 3.0],
    ["2026-09-01T10:00:00Z", 1.0],
  ]);

  it("returns the exact sample, uninterpolated, when the instant lands on one", () => {
    const h = expectOk(tideAt(curve, new Date("2026-09-01T09:00:00Z")));
    expect(h.height).toBe(3.0);
    expect(h.interpolated).toBe(false);
    expect(h.units).toBe("english");
    expect(h.datum).toBe("MLLW");
  });

  it("interpolates linearly between two samples", () => {
    expect(expectOk(tideAt(curve, new Date("2026-09-01T08:30:00Z"))).height).toBeCloseTo(2.5, 10);
    expect(expectOk(tideAt(curve, new Date("2026-09-01T08:15:00Z"))).height).toBeCloseTo(2.25, 10);
    expect(expectOk(tideAt(curve, new Date("2026-09-01T09:45:00Z"))).height).toBeCloseTo(1.5, 10);
    expect(expectOk(tideAt(curve, new Date("2026-09-01T08:30:00Z"))).interpolated).toBe(true);
  });

  it("hits both endpoints exactly", () => {
    expect(expectOk(tideAt(curve, new Date("2026-09-01T08:00:00Z"))).height).toBe(2.0);
    expect(expectOk(tideAt(curve, new Date("2026-09-01T10:00:00Z"))).height).toBe(1.0);
  });

  it("REFUSES before the curve starts rather than extrapolating", () => {
    const r = tideAt(curve, new Date("2026-09-01T07:59:00Z"));
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("out-of-range");
    expect("value" in r).toBe(false);
  });

  it("REFUSES after the curve ends rather than extrapolating", () => {
    const r = tideAt(curve, new Date("2026-09-01T10:01:00Z"));
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("out-of-range");
  });

  it("REFUSES on an empty curve", () => {
    const r = tideAt(curveOf([]), new Date("2026-09-01T09:00:00Z"));
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("no-data");
  });

  it("answers a single-point curve at its own instant and refuses everywhere else", () => {
    const single = curveOf([["2026-09-01T09:00:00Z", 2.172]]);
    const hit = expectOk(tideAt(single, new Date("2026-09-01T09:00:00Z")));
    expect(hit.height).toBe(2.172);
    expect(hit.interpolated).toBe(false);

    for (const t of ["2026-09-01T08:59:59Z", "2026-09-01T09:00:01Z"]) {
      const r = tideAt(single, new Date(t));
      expect(r.status).toBe("refused");
      if (r.status !== "refused") throw new Error("unreachable");
      expect(r.reason).toBe("out-of-range");
    }
  });

  it("REFUSES to draw across a hole wider than two steps", () => {
    const holed = curveOf([
      ["2026-09-01T08:00:00Z", 2.0],
      ["2026-09-01T11:00:00Z", 1.0], // three hours on a 60-minute curve
    ]);
    const r = tideAt(holed, new Date("2026-09-01T09:30:00Z"));
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("gap");
    // but the samples themselves are still readable
    expect(expectOk(tideAt(holed, new Date("2026-09-01T08:00:00Z"))).height).toBe(2.0);
  });

  it("REFUSES an invalid instant", () => {
    const r = tideAt(curve, new Date("not a date"));
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("bad-request");
  });

  it("reads the real Bishops Head curve at a shooting-light moment", () => {
    // 2026-09-01, roughly 05:40 EDT = 09:40Z — the hunter's actual question.
    const c = curveFromCapture(captures.scenarios.bishopsHeadCurveSep1.body);
    const h = expectOk(tideAt(c, new Date("2026-09-01T09:40:00Z")));

    const at09 = c.samples.find((s) => s.at.toISOString() === "2026-09-01T09:00:00.000Z")!;
    const at10 = c.samples.find((s) => s.at.toISOString() === "2026-09-01T10:00:00.000Z")!;
    expect(h.height).toBeCloseTo(at09.height + (at10.height - at09.height) * (40 / 60), 10);
    expect(h.height).toBeGreaterThan(Math.min(at09.height, at10.height));
    expect(h.height).toBeLessThan(Math.max(at09.height, at10.height));
    expect(h.provenance.kind).toBe("prediction");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3. tideDirection.
   ══════════════════════════════════════════════════════════════════════════ */

describe("tideDirection", () => {
  // A clean synthetic peak at 09:00 so the turning point is unambiguous.
  const peak = curveOf([
    ["2026-09-01T07:00:00Z", 1.0],
    ["2026-09-01T08:00:00Z", 2.0],
    ["2026-09-01T09:00:00Z", 2.5],
    ["2026-09-01T10:00:00Z", 2.0],
    ["2026-09-01T11:00:00Z", 1.0],
  ]);

  it("calls the flood rising, with a positive rate", () => {
    const m = expectOk(tideDirection(peak, new Date("2026-09-01T07:30:00Z")));
    expect(m.direction).toBe("rising");
    expect(m.ratePerHour).toBeGreaterThan(0);
  });

  it("calls the ebb falling, with a negative rate", () => {
    const m = expectOk(tideDirection(peak, new Date("2026-09-01T10:30:00Z")));
    expect(m.direction).toBe("falling");
    expect(m.ratePerHour).toBeLessThan(0);
  });

  it("calls SLACK at the turning point, which a segment slope never could", () => {
    // The centred ±15 min window straddles the peak: the half hour before rises
    // as much as the half hour after falls, so the differenced rate passes
    // through zero. Reading the slope of the segment the instant sits in would
    // report a confident +0.5 ft/h two seconds before high water.
    const m = expectOk(tideDirection(peak, new Date("2026-09-01T09:00:00Z")));
    expect(m.direction).toBe("slack");
    expect(Math.abs(m.ratePerHour)).toBeLessThan(m.slackThresholdPerHour);
  });

  it("states the slack threshold it judged against instead of hiding it", () => {
    const m = expectOk(tideDirection(peak, new Date("2026-09-01T09:00:00Z")));
    expect(m.slackThresholdPerHour).toBe(0.05);
  });

  it("REFUSES on a single-point curve — one reading cannot show motion", () => {
    const r = tideDirection(
      curveOf([["2026-09-01T09:00:00Z", 2.1]]),
      new Date("2026-09-01T09:00:00Z"),
    );
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("out-of-range");
  });

  it("REFUSES on an empty curve", () => {
    const r = tideDirection(curveOf([]), new Date("2026-09-01T09:00:00Z"));
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("no-data");
  });

  it("REFUSES outside the curve", () => {
    const r = tideDirection(peak, new Date("2026-09-01T12:00:00Z"));
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("out-of-range");
  });

  it("works at the very edges by clamping the probe window inward", () => {
    expect(expectOk(tideDirection(peak, new Date("2026-09-01T07:00:00Z"))).direction).toBe(
      "rising",
    );
    expect(expectOk(tideDirection(peak, new Date("2026-09-01T11:00:00Z"))).direction).toBe(
      "falling",
    );
  });

  it("agrees with the real Bishops Head hi/lo events on 2026-09-01", () => {
    // Cross-check the curve against the independently published hi/lo list:
    // low 03:09Z, high 08:38Z, low 15:11Z, high 21:01Z. The curve must be rising
    // between a low and the next high and falling between a high and the next
    // low. Two different CO-OPS products have to agree with each other.
    const c = curveFromCapture(captures.scenarios.bishopsHeadCurveSep1.body);
    const events = eventsFromCapture(captures.scenarios.bishopsHeadHiloSep1.body);
    expect(events.map((e) => e.kind)).toEqual(["low", "high", "low", "high"]);

    expect(expectOk(tideDirection(c, new Date("2026-09-01T06:00:00Z"))).direction).toBe("rising");
    expect(expectOk(tideDirection(c, new Date("2026-09-01T12:00:00Z"))).direction).toBe("falling");
    expect(expectOk(tideDirection(c, new Date("2026-09-01T18:00:00Z"))).direction).toBe("rising");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4. The shaded window and formatting.
   ══════════════════════════════════════════════════════════════════════════ */

describe("tideCurveSlice — the shaded shooting window", () => {
  const curve = curveOf([
    ["2026-09-01T08:00:00Z", 2.0],
    ["2026-09-01T09:00:00Z", 3.0],
    ["2026-09-01T10:00:00Z", 1.0],
    ["2026-09-01T11:00:00Z", 0.0],
  ]);

  it("starts and ends exactly at the window, not at the nearest hour", () => {
    const s = expectOk(
      tideCurveSlice(curve, new Date("2026-09-01T08:30:00Z"), new Date("2026-09-01T10:30:00Z")),
    );
    expect(s.samples[0].at.toISOString()).toBe("2026-09-01T08:30:00.000Z");
    expect(s.samples[0].height).toBeCloseTo(2.5, 10);
    expect(s.samples[s.samples.length - 1].at.toISOString()).toBe("2026-09-01T10:30:00.000Z");
    expect(s.samples[s.samples.length - 1].height).toBeCloseTo(0.5, 10);
    expect(s.samples).toHaveLength(4); // 08:30, 09:00, 10:00, 10:30
  });

  it("REFUSES a window that runs past the data rather than drawing half a band", () => {
    const r = tideCurveSlice(
      curve,
      new Date("2026-09-01T10:00:00Z"),
      new Date("2026-09-01T12:00:00Z"),
    );
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("out-of-range");
  });

  it("REFUSES a backwards window", () => {
    const r = tideCurveSlice(
      curve,
      new Date("2026-09-01T10:00:00Z"),
      new Date("2026-09-01T09:00:00Z"),
    );
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("bad-request");
  });

  it("carries the provenance into the slice", () => {
    const s = expectOk(
      tideCurveSlice(curve, new Date("2026-09-01T08:30:00Z"), new Date("2026-09-01T09:30:00Z")),
    );
    expect(s.provenance.kind).toBe("prediction");
  });
});

describe("formatTideHeight", () => {
  it("prints one decimal, not CO-OPS' three", () => {
    // The third decimal is thousandths of a foot on a number wind moves by a
    // foot. Printing it claims precision the prediction does not have.
    expect(formatTideHeight(2.351, "english")).toBe("2.4 ft");
    expect(formatTideHeight(0.279, "english")).toBe("0.3 ft");
    expect(formatTideHeight(-0.935, "english")).toBe("-0.9 ft");
    expect(formatTideHeight(0.717, "metric")).toBe("0.7 m");
  });

  it("returns null rather than a string that reads like a number", () => {
    expect(formatTideHeight(NaN, "english")).toBeNull();
    expect(formatTideHeight(Infinity, "english")).toBeNull();
    expect(formatTideHeight(undefined as unknown as number, "english")).toBeNull();
  });

  it("prints a real 0.0 ft reading as 0.0 ft", () => {
    expect(formatTideHeight(0, "english")).toBe("0.0 ft");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5. THE SEASON PACK — round trip and the byte budget.
   ══════════════════════════════════════════════════════════════════════════ */

describe("the season pack — Bishops Head, 2026-10-01 → 2027-01-31", () => {
  const load = () => expectOk(packTideEvents(eventsFromCapture(seasonCapture.body), META));

  it("packs the whole season's 475 highs and lows", () => {
    const pack = load();
    expect(pack.dm).toHaveLength(475);
    expect(pack.mv).toHaveLength(475);
    expect(pack.kinds).toHaveLength(475);
    expect(pack.packVersion).toBe(1);
    expect(pack.kind).toBe("prediction");
    expect(pack.datum).toBe("MLLW");
    expect(pack.epochUTC).toBe("2026-10-01T03:51:00.000Z");
  });

  it("round-trips every event back to CO-OPS' published value exactly", () => {
    const events = expectOk(unpackTideEvents(load()));
    const raw = rawRows(seasonCapture.body);

    expect(events).toHaveLength(raw.length);
    for (let i = 0; i < raw.length; i++) {
      // CO-OPS publishes three decimals; the pack stores integer thousandths, so
      // the round trip is exact, not merely close.
      expect(events[i].height).toBeCloseTo(Number(raw[i].v), 10);
      expect(events[i].kind).toBe(raw[i].type === "H" ? "high" : "low");
      expect(events[i].at.toISOString()).toBe(`${raw[i].t.replace(" ", "T")}:00.000Z`);
    }
  });

  it("fits the pocket: under the 3,794-byte gzipped budget", () => {
    const json = JSON.stringify(load());
    const gz = zlib.gzipSync(Buffer.from(json), { level: 9 }).length;

    // Measured 2026-08-01: 5,045 bytes of JSON, 2,120 gzipped, against raw
    // CO-OPS' 22,896 / 3,809. Delta-encoded minutes are what buy it — absolute
    // minute offsets gzip to 2,527 because consecutive tides sit ~370 minutes
    // apart and the delta column is three repeating digits DEFLATE eats alive.
    expect(gz).toBeLessThan(3794);
    expect(gz).toBeLessThan(zlib.gzipSync(Buffer.from(seasonCapture.body), { level: 9 }).length);

    // Printed so a change that quietly doubles the pack is visible in CI output.
    console.log(`  season pack: ${json.length} B json, ${gz} B gzip, 475 events`);
  });

  it("keeps the disclaimer in the packed bytes — it rides to the marsh too", () => {
    const pack = load();
    expect(pack.disclaimer).toMatch(/PREDICTION, not an observed water level/);
    expect(pack.timeFrame).toBe("utc");
    expect(pack.source).toBe("NOAA CO-OPS");
  });

  it("refuses a pack from a different version", () => {
    const r = unpackTideEvents({ packVersion: 2 } as unknown as TidePack);
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("malformed-response");
  });

  it("refuses a pack whose columns have drifted out of step", () => {
    const r = unpackTideEvents({
      packVersion: 1,
      dm: [0, 320],
      mv: [447],
      kinds: "LH",
    } as unknown as TidePack);
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("malformed-response");
  });

  it("refuses to pack nothing", () => {
    const r = packTideEvents([], META);
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("no-data");
  });

  it("refuses events that arrive out of order", () => {
    const r = packTideEvents(
      [
        { at: new Date("2026-09-01T15:11:00Z"), height: 0.279, kind: "low" },
        { at: new Date("2026-09-01T08:38:00Z"), height: 2.19, kind: "high" },
      ],
      META,
    );
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("unparsable-value");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6. THE NO-`?? 0` LAW, on the two paths this module owns.
   ══════════════════════════════════════════════════════════════════════════

   The network parse path is the other module's, and its half of this law lives
   in `tideFetch.test.ts`. These two are the paths that survive a plane trip:
   what gets written into the pocket, and what gets read back out of it. A lie
   that reaches disk outlives the session that made it.                        */

describe("a missing tide reading is NOT a 0.0 ft tide", () => {
  it("REFUSES to pack a non-finite height instead of writing a 0", () => {
    const r = packTideEvents(
      [
        { at: new Date("2026-09-01T03:09:00Z"), height: 0.447, kind: "low" },
        { at: new Date("2026-09-01T08:38:00Z"), height: NaN, kind: "high" },
      ],
      META,
    );
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("a NaN height produced a pack");
    expect(r.reason).toBe("unparsable-value");
    expect(r.message).toMatch(/A missing reading is not a low tide/);

    // No zero escaped: the refusal branch has no `value` at all, and nothing
    // resembling an encoded height column made it into the result.
    expect("value" in r).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/"mv"/);
  });

  it("REFUSES to pack a height that is missing entirely", () => {
    const r = packTideEvents(
      [{ at: new Date("2026-09-01T03:09:00Z"), kind: "low" } as unknown as TideEvent],
      META,
    );
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("unparsable-value");
  });

  it("REFUSES a cached pack that lost a height in storage", () => {
    // `undefined / 1000` is NaN, and a `?? 0` anywhere on this path would render
    // it as a 0.0 ft tide — a reading that looks completely ordinary at MLLW.
    const good = expectOk(
      packTideEvents(
        [
          { at: new Date("2026-09-01T03:09:00Z"), height: 0.447, kind: "low" },
          { at: new Date("2026-09-01T08:38:00Z"), height: 2.19, kind: "high" },
        ],
        META,
      ),
    );
    const damaged = { ...good, mv: [447, null as unknown as number] } as TidePack;
    const r = unpackTideEvents(damaged);

    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("a null height produced a value");
    expect(r.reason).toBe("unparsable-value");
    expect(r.message).toMatch(/A missing reading is not a low tide/);
    expect("value" in r).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/"height"/);
  });

  it("REFUSES a cached pack that lost a timestamp delta", () => {
    const good = expectOk(
      packTideEvents([{ at: new Date("2026-09-01T03:09:00Z"), height: 0.447, kind: "low" }], META),
    );
    const r = unpackTideEvents({ ...good, dm: [undefined as unknown as number] } as TidePack);
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("unparsable-value");
  });

  it("ACCEPTS a real 0.0 ft reading — which is why the missing case is invisible", () => {
    // The contrast that makes the law meaningful. A genuine 0.0 ft at MLLW is
    // ordinary data and must pass; the refusals above are about ABSENCE, not
    // about the number zero. Without this test someone "fixes" a failure by
    // rejecting real zeros and the water gate goes quiet at dead low tide.
    const pack = expectOk(
      packTideEvents(
        [
          { at: new Date("2026-09-01T03:09:00Z"), height: 0, kind: "low" },
          { at: new Date("2026-09-01T08:38:00Z"), height: 2.19, kind: "high" },
        ],
        META,
      ),
    );
    const events = expectOk(unpackTideEvents(pack));
    expect(events[0].height).toBe(0);
    expect(events[0].kind).toBe("low");
    expect(formatTideHeight(events[0].height, "english")).toBe("0.0 ft");
  });

  it("reads a real 0.0 ft sample off a curve rather than calling it missing", () => {
    const curve = curveOf([
      ["2026-09-01T08:00:00Z", 0.0],
      ["2026-09-01T09:00:00Z", 1.0],
    ]);
    expect(expectOk(tideAt(curve, new Date("2026-09-01T08:00:00Z"))).height).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7. Determinism — total functions of their arguments.
   ══════════════════════════════════════════════════════════════════════════ */

describe("the pure side is deterministic", () => {
  it("gives the same answer regardless of the machine clock", () => {
    const curve = curveOf([
      ["2026-11-01T05:00:00Z", 1.4],
      ["2026-11-01T06:00:00Z", 1.9],
      ["2026-11-01T07:00:00Z", 1.6],
    ]);
    const t = new Date("2026-11-01T05:30:00Z");

    const first = expectOk(tideAt(curve, t));
    vi.setSystemTime(new Date("2031-04-04T04:04:04Z"));
    const second = expectOk(tideAt(curve, t));
    vi.useRealTimers();

    expect(second.height).toBe(first.height);
    expect(second.instant.toISOString()).toBe(first.instant.toISOString());
  });

  it("does not mutate the curve it is handed", () => {
    const curve = curveOf([
      ["2026-09-01T08:00:00Z", 2.0],
      ["2026-09-01T09:00:00Z", 3.0],
    ]);
    const before = JSON.stringify(curve);
    tideAt(curve, new Date("2026-09-01T08:30:00Z"));
    tideDirection(curve, new Date("2026-09-01T08:30:00Z"));
    tideCurveSlice(curve, new Date("2026-09-01T08:10:00Z"), new Date("2026-09-01T08:50:00Z"));
    expect(JSON.stringify(curve)).toBe(before);
  });
});
