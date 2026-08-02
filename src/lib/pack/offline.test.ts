/**
 * offline.test.ts — THE GATE.
 *
 * This file is the deliverable. Everything else in `src/lib/pack/` is the code
 * that makes it pass.
 *
 * ONE CLAIM, PROVED TWO WAYS:
 *
 *   1. With a pack on the device and `globalThis.fetch` replaced by a stub that
 *      COUNTS every call and THROWS on every call, every read still resolves
 *      with the correct value — and the counter reads ZERO. Not "the tests
 *      passed offline"; the network was made impossible and nothing reached for
 *      it. A stub that only counts would let a swallowed `catch` hide a real
 *      network dependency behind a fallback; a stub that only throws would let a
 *      successful-but-unnecessary call pass unnoticed. It does both.
 *
 *   2. With NOTHING on the device, every read returns a TYPED REFUSAL naming
 *      the shard — never `null`, never `0`, never an empty array that a rail
 *      would render as a flat calm morning.
 *
 * `Number(null)`, `Number("")` and `Number([])` are all a finite `0`, so
 * `Number.isFinite` alone does not save anybody — the `typeof` guard has to fire
 * first. Those three values are asserted by name below, on the real read path,
 * because this project has already fabricated 1,095 high-severity weather events
 * from exactly that bug.
 *
 * NOTE ON THE BACKEND: jsdom has no `indexedDB` (measured — `typeof
 * globalThis.indexedDB` is `"undefined"` under `vitest.config.ts`'s jsdom
 * environment), so the gate runs through `memoryPackBackend`, which implements
 * the same `PackBackend` contract. What that proves is the whole READ path —
 * key selection, validation, decoding, freshness, refusals — with no network.
 * What it cannot prove is that bytes survive a reboot, which is IndexedDB's job
 * and is verified in a real browser instead.
 */

import { beforeEach, afterEach, describe, expect, it } from "vitest";
import zlib from "node:zlib";

import { packTideEvents, type TideEvent } from "@/lib/tide";
import {
  emptyPocket,
  formatAge,
  packManifest,
  packReadiness,
  readTideEvents,
  readTideEventsBetween,
  readWxAt,
  readWxPack,
  readWxVarAt,
  WX_VARS,
  type PackShardRecord,
  type PocketPack,
} from "./readPack";
import {
  buildShardRecord,
  loadFieldPocket,
  memoryPackBackend,
  openPackStore,
  seasonSlot,
  spotScope,
  stationScope,
  wxSlot,
} from "./packStore";
import { buildWxPack, buildOpenMeteoUrl } from "./packFetch";

/* ════════════════════════ the counted throwing stub ════════════════════════ */

let fetchCalls: number;
let fetchTargets: string[];
const realFetch = globalThis.fetch;

/**
 * Counts AND throws. See the header for why it must do both.
 *
 * Installed for the whole file, not just the gate, so that even the fixture
 * construction below is proved to be network-free — `buildWxPack` and
 * `packTideEvents` are pure and would fail loudly here if they were not.
 */
function installCountedThrowingFetch(): void {
  fetchCalls = 0;
  fetchTargets = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    fetchCalls += 1;
    fetchTargets.push(String(input));
    throw new Error(
      `OFFLINE GATE VIOLATED: the field path reached for the network (${String(input)}). ` +
        `There is no signal in a marsh.`,
    );
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  installCountedThrowingFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/* ═════════════════════════════ the fixtures ═════════════════════════════ */

const SPOT = { lat: 38.4436, lng: -76.0722, coops_station_id: "8571807" } as const;

/** 2026-10-01T06:54Z — the real first high/low of the reference season. */
const SEASON_START_MS = Date.UTC(2026, 9, 1, 6, 54);

/** Fixed clock so freshness assertions are arithmetic, not luck. */
const NOW = new Date(Date.UTC(2026, 9, 15, 10, 40));

const PACKED_AT = new Date(Date.UTC(2026, 9, 15, 8, 40)); // two hours before NOW

/**
 * A deterministic PRNG, so the fixtures below carry REALISTIC ENTROPY.
 *
 * THIS IS NOT A DETAIL. The first version of these fixtures used two repeating
 * heights and a cyclic weather column; the season gzipped to 390 bytes against a
 * 3,794-byte budget, and the wx pack to 700 against 2,649. Both "passed" by a
 * factor of nine — which means the assertion could not have caught a real
 * encoding regression, because DEFLATE was compressing the fixture's own
 * repetition rather than measuring the encoding. A budget test that cannot fail
 * is not a budget test.
 *
 * Seeded so the numbers are identical on every run and in CI.
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/**
 * A whole season of highs and lows, generated rather than captured.
 *
 * 475 events at ~370 min apart is the measured shape of Oct 1 → Jan 31 at
 * station 8571807 (Woolford / Church Creek, the station bound to Blackwater
 * NWR). Heights spread across the ranges CO-OPS actually publishes there —
 * lows roughly 0.1–0.8 ft and highs roughly 1.4–2.6 ft at MLLW, to three
 * decimals — so the packed columns have the same digit entropy as the real
 * thing and the gzip figure means something.
 */
function seasonEvents(): TideEvent[] {
  const rand = lcg(20261001);
  const out: TideEvent[] = [];
  let ms = SEASON_START_MS;
  for (let i = 0; i < 475; i++) {
    const low = i % 2 === 0;
    out.push({
      at: new Date(ms),
      height: low
        ? Number((0.1 + rand() * 0.7).toFixed(3))
        : Number((1.4 + rand() * 1.2).toFixed(3)),
      kind: low ? "low" : "high",
    });
    // Real consecutive tides sit 340–420 minutes apart, not on a fixed step.
    ms += (340 + Math.floor(rand() * 80)) * 60_000;
  }
  return out;
}

/**
 * The two events the value assertions read, written in explicitly.
 *
 * The generator gives entropy; these give exactness. Index 0 and 1 are
 * overwritten with values this test knows to the thousandth, so the round trip
 * through integer thousandths is checked against a number rather than against
 * whatever the PRNG happened to produce.
 */
const KNOWN_LOW = 0.279;
const KNOWN_HIGH = 2.351;

function seasonEventsWithKnownHead(): TideEvent[] {
  const events = seasonEvents();
  events[0] = { ...events[0], height: KNOWN_LOW };
  events[1] = { ...events[1], height: KNOWN_HIGH };
  return events;
}

/** An Open-Meteo body in exactly the shape the live API returns. */
function openMeteoBody(overrides: { nullAt?: number; hours?: number } = {}) {
  const hours = overrides.hours ?? 168;
  const time: string[] = [];
  const startMs = Date.UTC(2026, 9, 15, 0, 0);
  for (let i = 0; i < hours; i++) {
    const d = new Date(startMs + i * 3_600_000);
    time.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-` +
        `${String(d.getUTCDate()).padStart(2, "0")}T${String(d.getUTCHours()).padStart(2, "0")}:00`,
    );
  }
  // Same reason as the tide fixture: real model output wanders, and a column
  // that repeats compresses to nothing and measures nothing.
  const rand = lcg(20261015);
  const col = (base: number, spread: number) =>
    time.map((_, i) =>
      overrides.nullAt === i ? null : Number((base + (rand() - 0.5) * spread).toFixed(1)),
    );

  const intCol = (base: number, spread: number) =>
    time.map((_, i) =>
      overrides.nullAt === i ? null : Math.round(base + (rand() - 0.5) * spread),
    );

  const hourly: Record<string, unknown[]> = {
    time,
    wind_speed_10m: col(11, 16),
    wind_direction_10m: intCol(180, 300),
    wind_gusts_10m: col(19, 22),
    temperature_2m: col(48, 26),
    pressure_msl: col(1015, 22),
    // Real precipitation is mostly exact zeros with occasional hundredths —
    // which is honest AND is the column that compresses, same as in production.
    precipitation: time.map((_, i) =>
      overrides.nullAt === i ? null : rand() > 0.85 ? Number((rand() * 0.12).toFixed(2)) : 0,
    ),
    cloud_cover: intCol(55, 100).map((v) =>
      v === null ? null : Math.min(100, Math.max(0, v as number)),
    ),
    weather_code: time.map((_, i) =>
      overrides.nullAt === i ? null : [0, 1, 2, 3, 45, 51, 61, 63, 80][Math.floor(rand() * 9)],
    ),
  };

  // Hour 0 is written in exactly, so the value assertions in THE GATE check
  // against known numbers rather than against whatever the PRNG produced.
  if (overrides.nullAt !== 0) {
    hourly.wind_speed_10m[0] = 7.3;
    hourly.wind_direction_10m[0] = 130;
    hourly.wind_gusts_10m[0] = 16.6;
    hourly.temperature_2m[0] = 52.1;
    hourly.pressure_msl[0] = 1012.5;
    hourly.precipitation[0] = 0;
    hourly.cloud_cover[0] = 99;
    hourly.weather_code[0] = 3;
  }

  return {
    hourly_units: {
      time: "iso8601",
      wind_speed_10m: "mp/h",
      wind_direction_10m: "°",
      wind_gusts_10m: "mp/h",
      temperature_2m: "°F",
      pressure_msl: "hPa",
      precipitation: "inch",
      cloud_cover: "%",
      weather_code: "wmo code",
    },
    hourly,
  };
}

/** Seed a store with a real tide shard and a real weather shard. */
async function seedPackedTruck(opts: { nullAt?: number; packedAt?: Date } = {}) {
  const packedAt = opts.packedAt ?? PACKED_AT;
  const store = openPackStore({ backend: memoryPackBackend(), now: () => NOW });
  expect(store.status).toBe("ok");
  if (store.status !== "ok") throw new Error("unreachable");

  const tidePack = packTideEvents(seasonEventsWithKnownHead(), {
    stationId: SPOT.coops_station_id,
    datum: "MLLW",
    units: "english",
    fetchedAt: packedAt.toISOString(),
  });
  expect(tidePack.status).toBe("ok");
  if (tidePack.status !== "ok") throw new Error("unreachable");

  const wxPack = buildWxPack(openMeteoBody({ nullAt: opts.nullAt }), {
    lat: SPOT.lat,
    lng: SPOT.lng,
    fetchedAt: packedAt.toISOString(),
  });
  expect(wxPack.status).toBe("ok");
  if (wxPack.status !== "ok") throw new Error("unreachable");

  const tideRec = buildShardRecord({
    scope: stationScope(SPOT.coops_station_id),
    shard: "tide.hilo",
    slot: seasonSlot(NOW),
    fetchedAt: packedAt.toISOString(),
    payload: tidePack.value,
  });
  const spot = spotScope(SPOT.lat, SPOT.lng);
  if (spot.status !== "ok") throw new Error("unreachable");
  const wxRec = buildShardRecord({
    scope: spot.value,
    shard: "wx",
    slot: wxSlot(packedAt),
    fetchedAt: packedAt.toISOString(),
    payload: wxPack.value,
  });
  expect(tideRec.status).toBe("ok");
  expect(wxRec.status).toBe("ok");
  if (tideRec.status !== "ok" || wxRec.status !== "ok") throw new Error("unreachable");

  expect((await store.value.save(tideRec.value)).status).toBe("ok");
  expect((await store.value.save(wxRec.value)).status).toBe("ok");

  return { store: store.value, tidePack: tidePack.value, wxPack: wxPack.value };
}

/* ══════════════════════════════ 1. THE GATE ══════════════════════════════ */

describe("THE GATE: a packed truck, a dead network", () => {
  it("answers every read with the correct value and makes ZERO fetch calls", async () => {
    const { store } = await seedPackedTruck();

    const field = await loadFieldPocket(store, SPOT, () => NOW);
    expect(field.status).toBe("ok");
    if (field.status !== "ok") throw new Error("unreachable");

    /* ── tide: the whole season, decoded from the pocket encoding ── */

    const events = readTideEvents(field.value.tide, { now: NOW.getTime() });
    expect(events.status).toBe("ok");
    if (events.status !== "ok") throw new Error("unreachable");

    expect(events.value.data).toHaveLength(475);
    expect(events.value.data[0].at.toISOString()).toBe(new Date(SEASON_START_MS).toISOString());
    expect(events.value.data[0].kind).toBe("low");
    expect(events.value.data[0].height).toBeCloseTo(KNOWN_LOW, 6);
    expect(events.value.data[1].kind).toBe("high");
    expect(events.value.data[1].height).toBeCloseTo(KNOWN_HIGH, 6);
    expect(events.value.shard).toBe("tide.hilo");
    expect(events.value.scope).toBe("station:8571807");

    /* ── tide: a window inside the season ── */

    const dayStart = new Date(Date.UTC(2026, 9, 2, 0, 0));
    const dayEnd = new Date(Date.UTC(2026, 9, 3, 0, 0));
    const window = readTideEventsBetween(field.value.tide, dayStart, dayEnd, {
      now: NOW.getTime(),
    });
    expect(window.status).toBe("ok");
    if (window.status !== "ok") throw new Error("unreachable");
    expect(window.value.data.length).toBeGreaterThan(0);
    for (const e of window.value.data) {
      expect(e.at.getTime()).toBeGreaterThanOrEqual(dayStart.getTime());
      expect(e.at.getTime()).toBeLessThanOrEqual(dayEnd.getTime());
    }

    /* ── weather: all eight variables at a known hour ── */

    const hour = new Date(Date.UTC(2026, 9, 15, 0, 0));
    const wx = readWxAt(field.value.wx, hour, { now: NOW.getTime() });
    expect(wx.status).toBe("ok");
    if (wx.status !== "ok") throw new Error("unreachable");

    expect(wx.value.data.at.toISOString()).toBe(hour.toISOString());
    expect(wx.value.data.windMph).toBeCloseTo(7.3, 6);
    expect(wx.value.data.windFromDeg).toBe(130);
    expect(wx.value.data.gustMph).toBeCloseTo(16.6, 6);
    expect(wx.value.data.tempF).toBeCloseTo(52.1, 6);
    expect(wx.value.data.pressureHpa).toBeCloseTo(1012.5, 6);
    expect(wx.value.data.precipIn).toBe(0);
    expect(wx.value.data.cloudPct).toBe(99);
    expect(wx.value.data.weatherCode).toBe(3);
    // Units ride with the reading. `windMph` is only an honest name because the
    // wire half refused anything that did not come back in `mp/h`.
    expect(wx.value.data.units.wind).toBe("mp/h");
    expect(wx.value.data.units.temp).toBe("°F");

    /* ── weather: one variable, the narrow reader ── */

    const gust = readWxVarAt(field.value.wx, "wind_gusts_10m", hour, { now: NOW.getTime() });
    expect(gust.status).toBe("ok");
    if (gust.status !== "ok") throw new Error("unreachable");
    expect(gust.value.data.value).toBeCloseTo(16.6, 6);
    expect(gust.value.data.unit).toBe("mp/h");

    /* ── FRESHNESS: the age comes back with the data, every time ── */

    const twoHours = 2 * 3_600_000;
    expect(wx.value.freshness.ageMs).toBe(twoHours);
    expect(wx.value.freshness.stale).toBe(false); // TTL is 3 h
    expect(formatAge(wx.value.freshness.ageMs)).toBe("2 h old");
    // Tide predictions are harmonic. They have an age, and they never go stale.
    expect(events.value.freshness.ttlMs).toBeNull();
    expect(events.value.freshness.stale).toBe(false);
    expect(events.value.freshness.ageMs).toBe(twoHours);

    /* ── the manifest and the readiness check ── */

    const manifest = packManifest(field.value.wx, { now: NOW.getTime() });
    expect(manifest).toHaveLength(4);
    expect(manifest.map((r) => r.shard)).toEqual(["sky", "tide.hilo", "wx", "season"]);
    // sky and season are present because they are compiled into the app.
    expect(manifest.find((r) => r.shard === "sky")?.present).toBe(true);
    expect(manifest.find((r) => r.shard === "sky")?.stored).toBe(false);
    expect(manifest.find((r) => r.shard === "season")?.present).toBe(true);
    expect(manifest.find((r) => r.shard === "wx")?.present).toBe(true);

    expect(packReadiness(field.value.tide, { now: NOW.getTime() }).ready).toBe(false);
    expect(
      packReadiness(field.value.tide, { now: NOW.getTime() }).missing.map((m) => m.shard),
    ).toEqual(["wx"]);

    /* ══════════════════ THE ASSERTION THIS FILE EXISTS FOR ══════════════════ */

    expect(fetchTargets).toEqual([]);
    expect(fetchCalls).toBe(0);
  });

  it("the stub really is armed — a deliberate call both counts and throws", async () => {
    expect(fetchCalls).toBe(0);
    expect(() => void globalThis.fetch("https://api.tidesandcurrents.noaa.gov/")).toThrow(
      /OFFLINE GATE VIOLATED/,
    );
    expect(fetchCalls).toBe(1);
  });
});

/* ═══════════════ 2. NOTHING PACKED — A REFUSAL, NOT A ZERO ═══════════════ */

describe("an unpacked truck refuses out loud", () => {
  it("returns a typed refusal naming the shard, never a plausible zero", async () => {
    const store = openPackStore({ backend: memoryPackBackend(), now: () => NOW });
    if (store.status !== "ok") throw new Error("unreachable");

    const field = await loadFieldPocket(store.value, SPOT, () => NOW);
    if (field.status !== "ok") throw new Error("unreachable");

    const tide = readTideEvents(field.value.tide, { now: NOW.getTime() });
    expect(tide.status).toBe("refused");
    if (tide.status !== "refused") throw new Error("unreachable");
    expect(tide.reason).toBe("not-packed");
    expect(tide.shard).toBe("tide.hilo"); // WHAT is missing
    expect(tide.message).toMatch(/never downloaded/i);
    expect(tide.message).toMatch(/will not invent it/i);
    // THE POINT: there is no `value` on the refusal branch to read a 0 out of.
    expect("value" in tide).toBe(false);

    const wx = readWxAt(field.value.wx, NOW, { now: NOW.getTime() });
    expect(wx.status).toBe("refused");
    if (wx.status !== "refused") throw new Error("unreachable");
    expect(wx.reason).toBe("not-packed");
    expect(wx.shard).toBe("wx");
    expect("value" in wx).toBe(false);

    const gust = readWxVarAt(field.value.wx, "wind_gusts_10m", NOW, { now: NOW.getTime() });
    expect(gust.status).toBe("refused");

    const readiness = packReadiness(field.value.wx, { now: NOW.getTime() });
    expect(readiness.ready).toBe(false);
    expect(readiness.missing.map((m) => m.shard)).toEqual(["tide.hilo", "wx"]);

    expect(fetchCalls).toBe(0);
  });

  it("does not fabricate a calm morning from a missing hour", async () => {
    // Hour 3 of the forecast has no reading at all — the shape Open-Meteo
    // actually uses for a gap. A rail must not draw 0 mph there.
    const { store } = await seedPackedTruck({ nullAt: 3 });
    const field = await loadFieldPocket(store, SPOT, () => NOW);
    if (field.status !== "ok") throw new Error("unreachable");

    const hole = new Date(Date.UTC(2026, 9, 15, 3, 0));
    const wx = readWxAt(field.value.wx, hole, { now: NOW.getTime() });
    expect(wx.status).toBe("refused");
    if (wx.status !== "refused") throw new Error("unreachable");
    expect(wx.reason).toBe("unparsable-value");
    expect(wx.message).toMatch(/missing reading is not a calm morning/i);

    // The hours either side are still perfectly readable. One hole does not
    // take the day down.
    const before = readWxAt(field.value.wx, new Date(Date.UTC(2026, 9, 15, 2, 0)), {
      now: NOW.getTime(),
    });
    expect(before.status).toBe("ok");

    expect(fetchCalls).toBe(0);
  });

  it("refuses a day outside the packed season instead of returning an empty array", async () => {
    const { store } = await seedPackedTruck();
    const field = await loadFieldPocket(store, SPOT, () => NOW);
    if (field.status !== "ok") throw new Error("unreachable");

    const march = new Date(Date.UTC(2027, 2, 14, 0, 0));
    const out = readTideEventsBetween(field.value.tide, march, new Date(march.getTime() + 86_400_000), {
      now: NOW.getTime(),
    });
    expect(out.status).toBe("refused");
    if (out.status !== "refused") throw new Error("unreachable");
    expect(out.reason).toBe("out-of-range");
    // An empty array would read as "the water does nothing today", which is a
    // lie about a marsh.
    expect("value" in out).toBe(false);

    expect(fetchCalls).toBe(0);
  });
});

/* ══════════ 3. THE `?? 0` LAW: typeof BEFORE Number, on the read path ══════════ */

describe("Number(null), Number('') and Number([]) are all a finite 0", () => {
  it("all three are refused rather than read as a value", () => {
    // The premise, asserted so nobody has to take it on faith.
    expect(Number(null)).toBe(0);
    expect(Number("")).toBe(0);
    expect(Number([])).toBe(0);
    expect(Number.isFinite(Number(null))).toBe(true);
    expect(Number.isFinite(Number(""))).toBe(true);
    expect(Number.isFinite(Number([]))).toBe(true);

    for (const poison of [null, "", [], "0", false, undefined] as unknown[]) {
      const body = openMeteoBody({ hours: 4 }) as unknown as {
        hourly: Record<string, unknown[]>;
      };
      body.hourly.wind_speed_10m[1] = poison;

      const packed = buildWxPack(body, {
        lat: SPOT.lat,
        lng: SPOT.lng,
        fetchedAt: PACKED_AT.toISOString(),
      });

      if (poison === null) {
        // `null` is an HONESTLY missing hour: it packs, and the READ refuses.
        expect(packed.status).toBe("ok");
        continue;
      }
      // Everything else is a shape we do not understand, and a value we do not
      // understand never becomes a number.
      expect(packed.status).toBe("refused");
      if (packed.status !== "refused") throw new Error("unreachable");
      expect(packed.reason).toBe("unparsable-value");
      expect(packed.message).toMatch(/not a calm morning/i);
    }

    expect(fetchCalls).toBe(0);
  });

  it("a record with no fetchedAt is refused at write time, not discovered in a marsh", () => {
    for (const poison of [null, "", 0, [], undefined, "not a date"] as unknown[]) {
      const rec = buildShardRecord({
        scope: "spot:38.4436,-76.0722",
        shard: "wx",
        slot: "2026-10-15",
        fetchedAt: poison as string,
        payload: { anything: true },
      });
      expect(rec.status).toBe("refused");
      if (rec.status !== "refused") throw new Error("unreachable");
      expect(rec.message).toMatch(/age is a reading you cannot judge/i);
    }
  });

  it("a stored record whose age went missing is damaged, not current", async () => {
    // The record bypasses `buildShardRecord` — this is what a corrupted row or a
    // hand-edited database looks like on the way back out.
    const rotten = {
      key: "spot:38.4436,-76.0722 wx 2026-10-15",
      recordVersion: 1,
      scope: "spot:38.4436,-76.0722",
      shard: "wx",
      slot: "2026-10-15",
      fetchedAt: null,
      payload: { packVersion: 1 },
    } as unknown as PackShardRecord;

    const store = openPackStore({
      backend: memoryPackBackend([rotten]),
      now: () => NOW,
    });
    if (store.status !== "ok") throw new Error("unreachable");

    const pocket = await store.value.load("spot:38.4436,-76.0722");
    expect(pocket.status).toBe("ok");
    if (pocket.status !== "ok") throw new Error("unreachable");
    expect(pocket.value.records).toHaveLength(0);
    expect(pocket.value.damaged).toHaveLength(1);

    // DAMAGED, not "never packed". The hunter DID pack the truck, and telling
    // him he did not sends him looking for the wrong problem.
    const wx = readWxAt(pocket.value, NOW, { now: NOW.getTime() });
    expect(wx.status).toBe("refused");
    if (wx.status !== "refused") throw new Error("unreachable");
    expect(wx.reason).toBe("damaged");
    expect(wx.shard).toBe("wx");

    expect(fetchCalls).toBe(0);
  });
});

/* ═════════════════════════ 4. FRESHNESS IS A VALUE ═════════════════════════ */

describe("freshness", () => {
  it("carries the age on every read and only refuses when a caller demands current", async () => {
    const packedAt = new Date(NOW.getTime() - 4 * 3_600_000); // four hours ago
    const { store } = await seedPackedTruck({ packedAt });
    const field = await loadFieldPocket(store, SPOT, () => NOW);
    if (field.status !== "ok") throw new Error("unreachable");

    const hour = new Date(Date.UTC(2026, 9, 15, 0, 0));

    // Default: a four-hour-old forecast is SHOWN, with its age. A hunter with a
    // four-hour-old wind is better served than a hunter with a blank rail.
    const lax = readWxAt(field.value.wx, hour, { now: NOW.getTime() });
    expect(lax.status).toBe("ok");
    if (lax.status !== "ok") throw new Error("unreachable");
    expect(lax.value.freshness.ageMs).toBe(4 * 3_600_000);
    expect(lax.value.freshness.ttlMs).toBe(3 * 3_600_000);
    expect(lax.value.freshness.stale).toBe(true);
    expect(formatAge(lax.value.freshness.ageMs)).toBe("4 h old");

    // Opt in, and the same read refuses.
    const strict = readWxAt(field.value.wx, hour, { now: NOW.getTime(), requireFresh: true });
    expect(strict.status).toBe("refused");
    if (strict.status !== "refused") throw new Error("unreachable");
    expect(strict.reason).toBe("stale");
    expect(strict.shard).toBe("wx");
    expect(strict.message).toMatch(/4 h old/);

    // The tide is harmonic: four hours old, and still exact.
    const tide = readTideEvents(field.value.tide, {
      now: NOW.getTime(),
      requireFresh: true,
    });
    expect(tide.status).toBe("ok");

    expect(fetchCalls).toBe(0);
  });

  it("formats an age the way a hunter says it, and refuses to format a non-age", () => {
    expect(formatAge(0)).toBe("just now");
    expect(formatAge(59_000)).toBe("just now");
    expect(formatAge(60_000)).toBe("1 min old");
    expect(formatAge(90 * 60_000)).toBe("1 h old");
    expect(formatAge(50 * 3_600_000)).toBe("2 d old");
    // There is no fallback string that reads like a duration.
    expect(formatAge(Number.NaN)).toBeNull();
    expect(formatAge(-1)).toBeNull();
    expect(formatAge(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

/* ═════════════════ 5. THE BYTE BUDGET, RE-MEASURED EVERY RUN ═════════════════ */

describe("the pack fits in a pocket", () => {
  it("a 475-event season is under the 3,794-byte gzipped budget", () => {
    const packed = packTideEvents(seasonEvents(), {
      stationId: "8571807",
      datum: "MLLW",
      units: "english",
      fetchedAt: PACKED_AT.toISOString(),
    });
    if (packed.status !== "ok") throw new Error("unreachable");

    const json = JSON.stringify(packed.value);
    const gz = zlib.gzipSync(Buffer.from(json), { level: 9 }).length;

    // MEASURED LIVE 2026-08-01 against the real CO-OPS response for station
    // 8571807, Oct 1 2026 → Jan 31 2027: 475 events, 4,988 B of JSON, 2,195 B
    // gzipped. This generated season is the same shape and lands in the same
    // place; the assertion is the budget, not the fixture.
    expect(gz).toBeLessThan(3794);
    console.log(`  tide.hilo: ${json.length} B json, ${gz} B gzip, 475 events`);
  });

  it("168 hours of eight weather variables is under the 2,649-byte gzipped budget", () => {
    const packed = buildWxPack(openMeteoBody(), {
      lat: SPOT.lat,
      lng: SPOT.lng,
      fetchedAt: PACKED_AT.toISOString(),
    });
    if (packed.status !== "ok") throw new Error("unreachable");

    expect(WX_VARS).toHaveLength(8);
    expect(packed.value.cols.wind_speed_10m).toHaveLength(168);

    const json = JSON.stringify(packed.value);
    const gz = zlib.gzipSync(Buffer.from(json), { level: 9 }).length;

    // MEASURED LIVE 2026-08-01 at 38.4436,-76.0722: raw Open-Meteo JSON 9,876 B
    // / 2,477 gzipped; packed 5,342 B / 1,910 gzipped.
    expect(gz).toBeLessThan(2649);
    console.log(`  wx: ${json.length} B json, ${gz} B gzip, 168 h x 8 vars`);
  });
});

/* ══════════════════ 6. THE BOUNDARY ITSELF ══════════════════ */

describe("the offline boundary", () => {
  it("refuses to open a store on a browser with no IndexedDB rather than pretending", () => {
    // jsdom has none. This is the Safari-private-mode path, and the honest
    // answer is a refusal in the driveway, not a silent memory store that loses
    // the pack on the drive out.
    const store = openPackStore();
    expect(store.status).toBe("refused");
    if (store.status !== "refused") throw new Error("unreachable");
    expect(store.reason).toBe("storage-unavailable");
    expect(store.message).toMatch(/home screen/i);

    // Opt in explicitly and it degrades, saying which backend answered.
    const fallback = openPackStore({ allowMemoryFallback: true });
    expect(fallback.status).toBe("ok");
    if (fallback.status !== "ok") throw new Error("unreachable");
    expect(fallback.value.backend).toBe("memory");
  });

  it("the wire half asks for GMT and for the units the reader expects", () => {
    const url = buildOpenMeteoUrl(38.4436, -76.0722);
    // Bare local wall-clock strings are ambiguous or missing across a DST
    // transition — 2026-11-01 is inside duck season.
    expect(url).toContain("timezone=GMT");
    expect(url).toContain("wind_speed_unit=mph");
    expect(url).toContain("temperature_unit=fahrenheit");
    expect(url).toContain("precipitation_unit=inch");
    expect(url).toContain("forecast_days=7");
    for (const v of WX_VARS) expect(url).toContain(v);
  });

  it("an empty pocket is a real, readable object — not null", () => {
    const pocket: PocketPack = emptyPocket("station:8571807", NOW.toISOString());
    expect(pocket.records).toEqual([]);
    expect(pocket.damaged).toEqual([]);
    const read = readWxPack(pocket, { now: NOW.getTime() });
    expect(read.status).toBe("refused");
  });
});
