import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as tideFetch from "./tideFetch";
import { buildCoopsUrl, fetchTideDay, fetchTideRange } from "./tideFetch";
import { unpackTideEvents, type TideRefusalReason, type TideResult } from "./tide";

/**
 * tideFetch.ts — the WIRE half. Offline test suite.
 *
 * THIS FILE NEVER OPENS A SOCKET EITHER. Every CO-OPS response it exercises was
 * captured once from the live service on 2026-08-01 and committed to
 * `__fixtures__/tide-coops-captures.json` and
 * `__fixtures__/tide-bishops-head-season.json`, and is replayed through the
 * module's `fetchImpl` injection seam. CO-OPS will not stay reachable from CI
 * forever, and a test that needs the network cannot guard a module whose whole
 * job is to survive the network being unreliable.
 *
 * The synthetic corruptions live in `__fixtures__/tide-synthetic.json`, named so
 * that nobody mistakes them for recordings. Read that file's `_readme`.
 *
 * The pure half has its own suite in `tide.test.ts`. This file covers what only
 * exists on this side of the boundary: URL construction, the retry policy, the
 * abort/timeout wrapper, the response parser, and the classification of a
 * subordinate station's missing curve.
 *
 * Stations are the two nearest Blackwater NWR:
 *   8571421  Bishops Head            — harmonic station, hi/lo AND curve
 *   8571807  Woolford, Church Creek  — SUBORDINATE station, hi/lo ONLY
 */

/* ─────────────────────────── fixture plumbing ─────────────────────────── */

const FIXTURES = path.join(__dirname, "__fixtures__");

const readFixture = <T,>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) as T;

interface Capture {
  url: string;
  httpStatus: number;
  body: string;
}

const captures = readFixture<{ capturedAt: string; scenarios: Record<string, Capture> }>(
  "tide-coops-captures.json",
);
const seasonCapture = readFixture<Capture & { capturedAt: string }>(
  "tide-bishops-head-season.json",
);
const synthetic = readFixture<{ cases: Record<string, { why: string; body: unknown }> }>(
  "tide-synthetic.json",
);

/** A Response-shaped stand-in. We only ever read `.ok`, `.status` and `.text()`. */
const fakeResponse = (status: number, body: string): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }) as unknown as Response;

const paramsOf = (url: string) => Object.fromEntries(new URL(url).searchParams.entries());

/**
 * A fetch that answers from the committed captures by matching on the request's
 * meaningful parameters rather than on the literal URL string, so param ORDER is
 * free to change without silently un-testing the module.
 */
function captureFetch(): typeof fetch & { calls: string[] } {
  const table = [
    ...Object.values(captures.scenarios).map((c) => ({ ...c, p: paramsOf(c.url) })),
    { ...seasonCapture, p: paramsOf(seasonCapture.url) },
  ];
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const p = paramsOf(url);
    const hit = table.find(
      (c) =>
        c.p.station === p.station &&
        c.p.interval === p.interval &&
        c.p.begin_date === p.begin_date &&
        c.p.end_date === p.end_date &&
        c.p.time_zone === p.time_zone,
    );
    if (!hit) throw new Error(`no fixture captured for ${url}`);
    return fakeResponse(hit.httpStatus, hit.body);
  }) as typeof fetch & { calls: string[] };
  impl.calls = calls;
  return impl;
}

/** A fetch that always answers with the same body/status. Counts its calls. */
function constantFetch(status: number, body: string) {
  const calls: string[] = [];
  const impl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return fakeResponse(status, body);
  }) as typeof fetch;
  return { impl, calls };
}

const expectOk = <T,>(r: TideResult<T>): T => {
  if (r.status !== "ok") {
    throw new Error(`expected ok, got refusal ${r.reason}: ${r.message}`);
  }
  return r.value;
};

const SEP1 = new Date("2026-09-01T00:00:00Z");
const OCT17 = new Date("2026-10-17T00:00:00Z");
const BISHOPS_HEAD = "8571421";
const WOOLFORD = "8571807";

/* ══════════════════════════════════════════════════════════════════════════
   1. THE WIRE FENCE — the other half of the structural boundary.
   ══════════════════════════════════════════════════════════════════════════ */

describe("the wire half is clearly marked as such", () => {
  it("both fetchers are async — the sync/async fence cuts both ways", () => {
    // `tide.test.ts` asserts nothing over there is an AsyncFunction. This
    // asserts everything that reaches the network here IS one. Together they
    // make "is this a network call?" answerable from the signature alone.
    for (const name of ["fetchTideDay", "fetchTideRange"] as const) {
      const fn = (tideFetch as unknown as Record<string, unknown>)[name];
      expect((fn as { constructor: { name: string } }).constructor.name, name).toBe(
        "AsyncFunction",
      );
    }
  });

  it("exports exactly two fetchers and no more", () => {
    // Every new export starting with `fetch` widens the network surface. If one
    // appears, it should be a deliberate decision that updates this list.
    expect(Object.keys(tideFetch).filter((n) => /^fetch/.test(n)).sort()).toEqual([
      "fetchTideDay",
      "fetchTideRange",
    ]);
  });

  it("imports the vocabulary from tide.ts rather than redefining it", () => {
    // The dependency arrow: tideFetch → tide, never the reverse. If this file
    // ever declares its own TideResult or its own refusal reasons, callers get
    // two vocabularies to narrow on and eventually stop narrowing.
    const src = fs.readFileSync(path.join(__dirname, "tideFetch.ts"), "utf8");
    expect(src).toMatch(/from\s+["']\.\/tide["']/);
    expect(src).not.toMatch(/export\s+type\s+TideResult/);
    expect(src).not.toMatch(/export\s+type\s+TideRefusalReason/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2. URL CONSTRUCTION — the two silent-corruption guards.
   ══════════════════════════════════════════════════════════════════════════ */

describe("buildCoopsUrl", () => {
  const url = buildCoopsUrl({
    stationId: BISHOPS_HEAD,
    beginDate: "20261001",
    endDate: "20270131",
    interval: "hilo",
    datum: "MLLW",
    units: "english",
  });
  const p = paramsOf(url);

  it("requests time_zone=gmt, never lst_ldt", () => {
    // LOAD-BEARING. lst_ldt returns bare local wall-clock strings: 2026-03-08
    // has no 02:00 row, and 2026-11-01 — inside duck season — returns 24 hourly
    // rows for a 25-hour local day with an ambiguous 01:00. Those strings cannot
    // honestly become instants. Both DST days are captured below as evidence.
    expect(p.time_zone).toBe("gmt");
  });

  it("pins the datum it was asked for", () => {
    // A wrong datum is accepted SILENTLY by CO-OPS and returns a full, plausible
    // prediction set at a different vertical reference — Bishops Head's
    // 2026-09-01 high reads 2.351 ft at MLLW and 1.137 ft at NAVD, and nothing
    // in the response says which you got.
    expect(p.datum).toBe("MLLW");
  });

  it("asks for JSON predictions at the requested interval", () => {
    expect(p.product).toBe("predictions");
    expect(p.format).toBe("json");
    expect(p.interval).toBe("hilo");
    expect(p.station).toBe(BISHOPS_HEAD);
    expect(p.begin_date).toBe("20261001");
    expect(p.end_date).toBe("20270131");
  });

  it("is the only place the CO-OPS endpoint is named", () => {
    expect(url.startsWith("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?")).toBe(true);
  });
});

describe("the DST evidence behind time_zone=gmt", () => {
  const rowsOf = (body: string) =>
    (JSON.parse(body) as { predictions: { t: string }[] }).predictions;

  it("lst_ldt loses an hour on the 2026-11-01 fall-back, gmt does not", () => {
    const lst = rowsOf(captures.scenarios.dstFallBackLstLdt.body);
    const gmt = rowsOf(captures.scenarios.dstFallBackGmt.body);

    // 2026-11-01 is 25 hours long in local time. lst_ldt returns 24 labels for
    // it, and 01:00 appears exactly once for two different real hours.
    expect(lst).toHaveLength(24);
    expect(lst.filter((r) => r.t.endsWith(" 01:00"))).toHaveLength(1);

    // gmt returns a uniform 24-hour day with no ambiguity and no hole.
    expect(gmt).toHaveLength(24);
    const spans = gmt
      .slice(1)
      .map(
        (r, i) =>
          Date.parse(`${r.t.replace(" ", "T")}:00Z`) -
          Date.parse(`${gmt[i].t.replace(" ", "T")}:00Z`),
      );
    expect(new Set(spans)).toEqual(new Set([3_600_000]));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3. FETCH against the real captured bytes.
   ══════════════════════════════════════════════════════════════════════════ */

describe("fetchTideDay — Bishops Head 8571421 (harmonic station)", () => {
  it("reads 2026-09-01's four highs and lows exactly as CO-OPS published them", async () => {
    const day = expectOk(await fetchTideDay(BISHOPS_HEAD, SEP1, { fetchImpl: captureFetch() }));

    expect(day.events.map((e) => [e.at.toISOString(), e.height, e.kind])).toEqual([
      ["2026-09-01T03:09:00.000Z", 0.447, "low"],
      ["2026-09-01T08:38:00.000Z", 2.19, "high"],
      ["2026-09-01T15:11:00.000Z", 0.279, "low"],
      ["2026-09-01T21:01:00.000Z", 2.351, "high"],
    ]);
    expect(day.dayStartUTC.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("returns a 24-sample hourly curve on the hour", async () => {
    const day = expectOk(await fetchTideDay(BISHOPS_HEAD, SEP1, { fetchImpl: captureFetch() }));
    const curve = expectOk(day.curve);

    expect(curve.samples).toHaveLength(24);
    expect(curve.stepMinutes).toBe(60);
    expect(curve.samples[0].at.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(curve.samples[23].at.toISOString()).toBe("2026-09-01T23:00:00.000Z");
    expect(curve.samples.every((s) => Number.isFinite(s.height))).toBe(true);
  });

  it("labels itself a prediction and carries the disclaimer", async () => {
    const day = expectOk(await fetchTideDay(BISHOPS_HEAD, SEP1, { fetchImpl: captureFetch() }));
    expect(day.provenance.kind).toBe("prediction");
    expect(day.provenance.source).toBe("NOAA CO-OPS");
    expect(day.provenance.datum).toBe("MLLW");
    expect(day.provenance.timeFrame).toBe("utc");
    expect(day.provenance.disclaimer).toMatch(/PREDICTION, not an observed water level/);
  });

  it("reads an October duck-season day the same way", async () => {
    const day = expectOk(await fetchTideDay(BISHOPS_HEAD, OCT17, { fetchImpl: captureFetch() }));
    expect(day.events.length).toBeGreaterThanOrEqual(3);
    expect(expectOk(day.curve).samples).toHaveLength(24);
    expect(day.events.every((e) => e.at.getUTCDate() === 17)).toBe(true);
  });
});

describe("fetchTideDay — Woolford/Church Creek 8571807 (SUBORDINATE station)", () => {
  // The single most product-shaping fact CO-OPS taught us. 8571807 is `type: "S"`
  // in the metadata API — published as offsets against reference station 8574680,
  // not as its own harmonic constituents. It serves hi/lo happily and errors on
  // interval=60, interval=6, and no interval at all.

  it("still returns the highs and lows — the headline is real", async () => {
    const day = expectOk(await fetchTideDay(WOOLFORD, SEP1, { fetchImpl: captureFetch() }));
    expect(day.events.map((e) => [e.at.toISOString(), e.height, e.kind])).toEqual([
      ["2026-09-01T05:57:00.000Z", 1.131, "low"],
      ["2026-09-01T10:36:00.000Z", 1.97, "high"],
      ["2026-09-01T17:12:00.000Z", 0.612, "low"],
      ["2026-09-01T23:31:00.000Z", 2.518, "high"],
    ]);
  });

  it("refuses the curve as `no-curve` rather than handing back a null to plot", async () => {
    const day = expectOk(await fetchTideDay(WOOLFORD, SEP1, { fetchImpl: captureFetch() }));
    expect(day.curve.status).toBe("refused");
    if (day.curve.status !== "refused") throw new Error("unreachable");
    expect(day.curve.reason).toBe("no-curve");
    expect(day.curve.message).toMatch(/only high and low tide times/);
    // The refusal branch has no `value`. Nothing can be plotted by accident.
    expect("value" in day.curve).toBe(false);
  });

  it("never synthesizes a curve out of the hi/lo pairs", async () => {
    // A rule-of-twelfths curve fitted to four points is an invented reading
    // wearing three decimal places. If someone adds one, this test says so.
    const day = expectOk(await fetchTideDay(WOOLFORD, SEP1, { fetchImpl: captureFetch() }));
    expect(day.curve.status).not.toBe("ok");
  });

  it("classifies no-curve only because hi/lo succeeded in the same breath", async () => {
    // The distinction between "this station has no curve" and "this station does
    // not exist" is only available because both answers are in hand at once. An
    // unknown station gets `no-data` on the day itself, not `no-curve`.
    const bad = await fetchTideDay("9999999", SEP1, { fetchImpl: captureFetch() });
    expect(bad.status).toBe("refused");
    if (bad.status !== "refused") throw new Error("unreachable");
    expect(bad.reason).toBe("no-data");
  });
});

describe("fetchTideDay / fetchTideRange refusals", () => {
  it("refuses an unknown station — CO-OPS answers HTTP 200 with an error body", async () => {
    const r = await fetchTideDay("9999999", SEP1, { fetchImpl: captureFetch() });
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("no-data");
    expect(r.detail).toMatch(/No Predictions data was found/);
    expect("value" in r).toBe(false);
  });

  it("refuses a malformed station id without leaving the device", async () => {
    const { impl, calls } = constantFetch(200, "{}");
    const r = await fetchTideDay("bishops head", SEP1, { fetchImpl: impl });
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("bad-request");
    expect(calls).toHaveLength(0);
  });

  it("refuses a reversed date range without leaving the device", async () => {
    const { impl, calls } = constantFetch(200, "{}");
    const r = await fetchTideRange(BISHOPS_HEAD, OCT17, SEP1, { fetchImpl: impl });
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("bad-request");
    expect(calls).toHaveLength(0);
  });

  it("refuses a non-JSON body as malformed rather than guessing", async () => {
    const { impl } = constantFetch(200, "<html>502 Bad Gateway</html>");
    const r = await fetchTideRange(BISHOPS_HEAD, SEP1, SEP1, { fetchImpl: impl, retries: 0 });
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("malformed-response");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4. RETRY POLICY — project law: never 4xx.
   ══════════════════════════════════════════════════════════════════════════ */

describe("retry policy", () => {
  it("NEVER retries a 4xx — one call, then a refusal", async () => {
    const { impl, calls } = constantFetch(400, captures.scenarios.badDateRange.body);
    const r = await fetchTideRange(BISHOPS_HEAD, SEP1, OCT17, { fetchImpl: impl, retries: 3 });
    expect(calls).toHaveLength(1);
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("bad-request");
    expect(r.detail).toMatch(/Wrong Date/);
  });

  it("never retries a 200-with-error-body — that is an answer, not a fault", async () => {
    const { impl, calls } = constantFetch(200, captures.scenarios.unknownStationHilo.body);
    const r = await fetchTideRange(BISHOPS_HEAD, SEP1, OCT17, { fetchImpl: impl, retries: 3 });
    expect(calls).toHaveLength(1);
    expect(r.status).toBe("refused");
  });

  it("DOES retry a 5xx, then refuses upstream-error", async () => {
    const { impl, calls } = constantFetch(503, "upstream down");
    const r = await fetchTideRange(BISHOPS_HEAD, SEP1, OCT17, { fetchImpl: impl, retries: 1 });
    expect(calls).toHaveLength(2);
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("upstream-error");
  });

  it("times out with an AbortController and reports it as a timeout", async () => {
    let sawSignal = false;
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sawSignal = init?.signal instanceof AbortSignal;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as typeof fetch;

    const r = await fetchTideRange(BISHOPS_HEAD, SEP1, OCT17, {
      fetchImpl: impl,
      timeoutMs: 20,
      retries: 0,
    });
    expect(sawSignal).toBe(true);
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("timeout");
  });

  it("honours a caller's abort signal and does not retry past it", async () => {
    const outer = new AbortController();
    const { impl, calls } = constantFetch(503, "down");
    outer.abort();
    const r = await fetchTideRange(BISHOPS_HEAD, SEP1, OCT17, {
      fetchImpl: impl,
      signal: outer.signal,
      retries: 3,
    });
    expect(calls).toHaveLength(0);
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("network");
  });

  it("refuses instead of throwing when fetch itself blows up", async () => {
    const impl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const r = await fetchTideRange(BISHOPS_HEAD, SEP1, OCT17, { fetchImpl: impl, retries: 0 });
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("network");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5. THE NO-`?? 0` LAW, on the network parse path.
   ══════════════════════════════════════════════════════════════════════════

   The pack write and cache read halves of this law live in `tide.test.ts`. This
   is the path where a corrupt reading first enters the app.                   */

describe("a missing tide reading is NOT a 0.0 ft tide", () => {
  const bodyFor = (name: string) => JSON.stringify(synthetic.cases[name].body);

  const fetchWith = (name: string) =>
    fetchTideRange(BISHOPS_HEAD, SEP1, OCT17, {
      fetchImpl: constantFetch(200, bodyFor(name)).impl,
      retries: 0,
    });

  it("REFUSES a null height instead of returning 0 — the load-bearing case", async () => {
    // `Number(null) === 0`. At MLLW, 0.0 ft is an ordinary, believable tide, so
    // this fabrication is invisible on screen. `parseHeight` kills `null` on the
    // `typeof raw !== "string"` guard, BEFORE `Number` is ever reached.
    const r = await fetchWith("nullHeight");

    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("a null height produced a value");
    expect(r.reason).toBe("unparsable-value");
    expect(r.message).toMatch(/A missing reading is not a low tide/);
    expect(r.detail).toMatch(/v=null/);

    // No zero escaped anywhere: the refusal branch has no `value` at all, and
    // the whole serialized result contains no encoded height column.
    expect("value" in r).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/"mv"/);
  });

  it('REFUSES an empty-string height — Number("") is also 0', async () => {
    const r = await fetchWith("emptyStringHeight");
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("unparsable-value");
    expect("value" in r).toBe(false);
  });

  it("REFUSES a missing height key", async () => {
    const r = await fetchWith("missingHeightKey");
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("unparsable-value");
  });

  it("REFUSES a non-numeric height", async () => {
    const r = await fetchWith("nonNumericHeight");
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe("unparsable-value");
  });

  it('ACCEPTS a real "0.000" reading — which is why the null case is invisible', async () => {
    // The contrast that makes the law meaningful. A genuine 0.0 ft at MLLW is
    // ordinary data and must pass; the refusal above is about ABSENCE, not about
    // the number zero.
    const pack = expectOk(await fetchWith("numericZeroHeight"));
    const events = expectOk(unpackTideEvents(pack));
    expect(events[0].height).toBe(0);
    expect(events[0].kind).toBe("low");
  });

  it("refuses ONE bad row by refusing the WHOLE response, never by skipping it", async () => {
    // The null-height fixture has two perfectly good rows around the bad one.
    // Dropping the bad row would leave a curve that still renders and just draws
    // a straight line across the missing water — the same fabrication in nicer
    // clothes.
    const r = await fetchWith("nullHeight");
    expect(r.status).toBe("refused");
  });
});

describe("other malformed responses", () => {
  const cases: [string, TideRefusalReason][] = [
    ["badTimestamp", "unparsable-value"],
    ["impossibleDate", "unparsable-value"],
    ["missingType", "unparsable-value"],
    ["outOfOrder", "malformed-response"],
    ["emptyPredictions", "no-data"],
    ["predictionsNotArray", "malformed-response"],
    ["noPredictionsKey", "malformed-response"],
    ["notAnObject", "malformed-response"],
  ];

  it.each(cases)("refuses %s with reason %s", async (name, reason) => {
    const r = await fetchTideRange(BISHOPS_HEAD, SEP1, OCT17, {
      fetchImpl: constantFetch(200, JSON.stringify(synthetic.cases[name].body)).impl,
      retries: 0,
    });
    expect(r.status).toBe("refused");
    if (r.status !== "refused") throw new Error("unreachable");
    expect(r.reason).toBe(reason);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6. THE SEASON PACK, end to end over the wire.
   ══════════════════════════════════════════════════════════════════════════

   The encoding itself is `packTideEvents`, tested in `tide.test.ts` where it
   lives. This only proves the fetcher hands it the right 475 events.          */

describe("fetchTideRange — Bishops Head, 2026-10-01 → 2027-01-31", () => {
  it("packs the whole season's highs and lows from one call", async () => {
    const seasonFetch = (async () =>
      fakeResponse(seasonCapture.httpStatus, seasonCapture.body)) as typeof fetch;

    const pack = expectOk(
      await fetchTideRange(
        BISHOPS_HEAD,
        new Date("2026-10-01T00:00:00Z"),
        new Date("2027-01-31T00:00:00Z"),
        { fetchImpl: seasonFetch },
      ),
    );

    expect(pack.dm).toHaveLength(475);
    expect(pack.mv).toHaveLength(475);
    expect(pack.kinds).toHaveLength(475);
    expect(pack.stationId).toBe(BISHOPS_HEAD);
    expect(pack.kind).toBe("prediction");
    expect(pack.epochUTC).toBe("2026-10-01T03:51:00.000Z");
    expect(expectOk(unpackTideEvents(pack))).toHaveLength(475);
  });
});
