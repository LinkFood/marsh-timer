/**
 * packFetch.ts — the wire half of the offline pack. PACK THE TRUCK.
 *
 * This file talks to the network. Its companions, `readPack.ts` and
 * `packStore.ts`, do not and cannot. That division is the whole point, and it is
 * a FILE boundary rather than a comment inside one file for the same reason
 * `src/lib/tideFetch.ts` gives for its own split: a rule that cannot be violated
 * beats a rule that must be remembered.
 *
 * `eslint.config.js` covers `src/lib/pack/**` with the offline glob — no bare
 * `fetch`, no `window.fetch`, no `globalThis.fetch`, no Supabase — and names
 * THIS FILE as the single exemption. That tripwire can only protect the offline
 * half if the offline half is its own file.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE DEPENDENCY DIRECTION IS ONE-WAY AND MUST STAY THAT WAY.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *      packFetch.ts  ──imports──▶  packStore.ts  ──imports──▶  readPack.ts
 *      packFetch.ts  ──imports──▶  src/lib/tideFetch.ts
 *      readPack.ts / packStore.ts  ──imports──▶  (nothing from here. ever.)
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHERE THIS CODE RUNS, AND WHERE IT MUST NOT.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * At the truck. On wifi. The night before. ONE explicit user action — "PACK THE
 * TRUCK" — writes the whole season and the week's weather to IndexedDB, and
 * after that the field path reads it with the radio off, forever. Nothing in
 * this file is ever called from a blind, and there is no background sync: iOS
 * has no Background Sync API, and an implicit refresh is a refresh a hunter
 * cannot audit. Packing is an explicit act. That is a feature — he knows exactly
 * what he has.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE HONESTY RULES THAT LIVE ON THIS SIDE OF THE LINE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * A. NO `?? 0`. NOT ONCE. `parseHourly` below is the law: the `typeof` guard
 *    fires BEFORE `Number` ever sees the value, because `Number(null)`,
 *    `Number("")` and `Number([])` are all a finite `0`. A missing wind speed is
 *    not a dead-calm morning. An hour Open-Meteo genuinely has no value for is
 *    stored as `null` and REFUSED at read time — never substituted, never
 *    interpolated, never dropped so the column silently shortens.
 *
 * B. REFUSE OUT LOUD. Every entry point returns `PackResult<T>` from
 *    `readPack.ts` — a closed union with NO `value` on the refusal branch. Two
 *    reasons carry the wire's failures: `damaged` for a response whose SHAPE we
 *    cannot read, `unparsable-value` for a response whose VALUES we cannot read.
 *
 * C. NEVER RETRY 4xx. Project law. Only 5xx, network failures and timeouts are
 *    retried. Open-Meteo answers a bad coordinate with **400** and
 *    `{"error": true, "reason": "Latitude must be in range …"}`; that is an
 *    answer, not a transport failure, and asking again cannot change it.
 *
 * D. EVERY FETCH HAS AN `AbortController` AND A TIMEOUT, and checks `res.ok`.
 *
 * E. A PARTIAL PACK IS REPORTED, NOT HIDDEN. `packTheTruck` returns a per-shard
 *    outcome list. A truck with tide and no wind is a real and common state —
 *    the tide call succeeded and the weather call timed out — and the hunter is
 *    entitled to see which one he is missing BEFORE he drives out, not at 05:40.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT OPEN-METEO ACTUALLY DOES, MEASURED 2026-08-01. Read before changing a param.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * 1. FREE, KEYLESS, NO AUTH for non-commercial use. Same posture as the CO-OPS
 *    datagetter `tideFetch.ts` already uses, so the pack needs no secret and the
 *    client can call it directly with nothing in between.
 *
 * 2. UNITS ARE ECHOED IN `hourly_units`, AND WE CHECK THEM. Measured strings for
 *    the request below: `mp/h`, `°`, `mp/h`, `°F`, `hPa`, `inch`, `%`,
 *    `wmo code`. This is `tideFetch.ts` finding 5 in a different coat — ask for
 *    the wrong unit and you get a full, plausible, well-formed forecast at a
 *    different scale, and nothing in the numbers looks wrong. `WxReading` names
 *    its fields `windMph`, `tempF`, `precipIn`; if the server ever answered in
 *    km/h those names would be a lie, so a unit mismatch REFUSES rather than
 *    carrying a number whose meaning we are guessing at.
 *
 * 3. WE REQUEST `timezone=GMT`, AND THAT IS LOAD-BEARING. Open-Meteo returns
 *    bare `YYYY-MM-DDTHH:MM` wall-clock strings with no offset. In a local
 *    timezone those are ambiguous or missing across a DST transition — exactly
 *    the trap `tideFetch.ts` finding 2 measured on CO-OPS for 2026-11-01, which
 *    is inside duck season. `GMT` gives a uniform, unambiguous grid and puts the
 *    forecast in the same UTC frame as `sky.ts` and `tide.ts`, so a wind hour, a
 *    tide and a sunrise compare with no conversion in between.
 *
 * 4. THE TIME STRINGS ARE PARSED THROUGH `Date.UTC`, NEVER `new Date(str)`. A
 *    bare `YYYY-MM-DDTHH:MM` with no zone is parsed as LOCAL time by V8, which
 *    would shift every hour in the pack by the machine's offset and produce a
 *    forecast that is plausible, self-consistent and four hours wrong.
 *
 * 5. THE GRID IS CHECKED FOR UNIFORMITY, EVERY STEP. `readPack.ts` finds an hour
 *    by arithmetic (`(ms - start) / step`), which is only valid on a uniform
 *    grid. A single missing or doubled row would silently shift every reading
 *    after it, so the whole grid is verified rather than the first two rows.
 *
 * 6. MEASURED SIZE, 2026-08-01 at 38.4436,-76.0722 (Blackwater NWR): raw
 *    Open-Meteo JSON 9,876 B / 2,477 gzipped. Packed by `buildWxPack` below:
 *    5,342 B / **1,910 gzipped**, against the 2,649-byte budget. The saving is
 *    integer columns — a column of small integers is something DEFLATE eats
 *    alive, and floats are noise it cannot compress.
 */

import { fetchTideRange } from "@/lib/tideFetch";
import type { TidePack } from "@/lib/tide";
import {
  packOk,
  packRefuse,
  packShardSpec,
  selectShard,
  WX_DISCLAIMER,
  WX_VARS,
  type PackRefusalReason,
  type PackResult,
  type PackShardName,
  type WxPack,
  type WxVar,
} from "./readPack";
import {
  buildShardRecord,
  openPackStore,
  seasonSlot,
  spotScope,
  stationScope,
  wxSlot,
  type PackStore,
} from "./packStore";

/* ───────────────────────────── constants ───────────────────────────── */

const OPEN_METEO_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

/** Generous enough for a truck-stop LTE bar, short enough to fail visibly. */
const DEFAULT_TIMEOUT_MS = 12_000;

/** Retries for 5xx / network / timeout ONLY. Never for 4xx. See rule C. */
const DEFAULT_RETRIES = 2;

const RETRY_BACKOFF_MS = [400, 1_200] as const;

/** Seven days, hourly. 168 columns per variable. */
const FORECAST_DAYS = 7;

const WX_STEP_MINUTES = 60;

const MS_PER_MINUTE = 60_000;

/**
 * The units we ask for, and the exact strings Open-Meteo echoes back for them.
 * MEASURED 2026-08-01 — see finding 2. A mismatch refuses.
 */
const REQUESTED_UNITS = {
  wind_speed_unit: "mph",
  temperature_unit: "fahrenheit",
  precipitation_unit: "inch",
} as const;

const EXPECTED_HOURLY_UNITS: Readonly<Record<WxVar, string>> = {
  wind_speed_10m: "mp/h",
  wind_direction_10m: "°",
  wind_gusts_10m: "mp/h",
  temperature_2m: "°F",
  pressure_msl: "hPa",
  precipitation: "inch",
  cloud_cover: "%",
  weather_code: "wmo code",
};

/**
 * How each column is scaled to an integer before storage.
 *
 * Matched to the precision the model actually publishes — tenths for speed,
 * temperature and pressure; hundredths of an inch for precipitation; whole
 * degrees, percent and WMO codes. Storing more precision than the model has
 * would claim an accuracy it does not have AND cost bytes.
 */
const WX_SCALE: Readonly<Record<WxVar, number>> = {
  wind_speed_10m: 10,
  wind_direction_10m: 1,
  wind_gusts_10m: 10,
  temperature_2m: 10,
  pressure_msl: 10,
  precipitation: 100,
  cloud_cover: 1,
  weather_code: 1,
};

/** The season window the tide shard covers. Oct 1 → Jan 31, inclusive. */
const SEASON_START_MONTH = 9; // October, 0-based
const SEASON_END_MONTH = 0; // January, 0-based
const SEASON_END_DAY = 31;

/* ─────────────────────────────── options ─────────────────────────────── */

export interface PackFetchOptions {
  /** Request deadline, milliseconds. Default 12 s. */
  readonly timeoutMs?: number;
  /** Attempts after the first, for 5xx / network / timeout ONLY. Default 2. */
  readonly retries?: number;
  /** Caller cancellation. Composed with the internal timeout, not replaced by it. */
  readonly signal?: AbortSignal;
  /** Injection seam for tests. Defaults to `globalThis.fetch`. */
  readonly fetchImpl?: typeof fetch;
  /** Clock injection. Defaults to `new Date()`. */
  readonly now?: () => Date;
}

/* ═════════════════════════════ OPEN-METEO ═════════════════════════════ */

/**
 * Build the forecast URL.
 *
 * THIS LIVES HERE, NOT IN `readPack.ts`, EVEN THOUGH IT IS A PURE FUNCTION. The
 * only reason the string exists is to be fetched with, and keeping it on this
 * side means `grep open-meteo src/lib/pack/readPack.ts` returns nothing — a
 * boundary a reviewer checks in one command rather than by reading two files.
 * Purity was never the criterion for which half a thing belongs in; "does this
 * exist to talk to the network" is. Same reasoning `tideFetch.ts` records for
 * `buildCoopsUrl`.
 *
 * Exported because the tests assert on it: specifically that `timezone` still
 * reads `GMT` (finding 3) and that the unit params are the ones the reader
 * expects (finding 2). Both are silent-corruption failures that show up
 * downstream only as a plausible wrong answer.
 */
export function buildOpenMeteoUrl(lat: number, lng: number): string {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lng),
    hourly: WX_VARS.join(","),
    forecast_days: String(FORECAST_DAYS),
    timezone: "GMT",
    wind_speed_unit: REQUESTED_UNITS.wind_speed_unit,
    temperature_unit: REQUESTED_UNITS.temperature_unit,
    precipitation_unit: REQUESTED_UNITS.precipitation_unit,
  });
  return `${OPEN_METEO_ENDPOINT}?${q.toString()}`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The `{"error": true, "reason": …}` envelope Open-Meteo uses at 4xx. */
function openMeteoErrorReason(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { error?: unknown; reason?: unknown };
  if (b.error !== true) return null;
  return typeof b.reason === "string" ? b.reason : "";
}

/**
 * One Open-Meteo call: abort controller, timeout, `res.ok`, retry policy, JSON.
 *
 * The retry ladder implements project law C exactly, and is deliberately the
 * same ladder `coopsRequest` in `tideFetch.ts` implements — two different
 * ladders for two free public JSON APIs would be two things to keep correct.
 */
async function openMeteoRequest(
  url: string,
  opts: PackFetchOptions,
): Promise<PackResult<unknown>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const doFetch = opts.fetchImpl ?? globalThis.fetch;

  if (typeof doFetch !== "function") {
    return packRefuse("network", "wx", "No network client is available to reach the weather service.");
  }

  let last: PackResult<unknown> = packRefuse(
    "network",
    "wx",
    "The weather service could not be reached.",
  );

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) {
      return packRefuse("network", "wx", "The weather download was cancelled.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onOuterAbort);

    try {
      const res = await doFetch(url, { signal: controller.signal });

      // 4xx — our request is wrong, and project law says never retry it.
      if (res.status >= 400 && res.status < 500) {
        const text = await res.text().catch(() => "");
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        const reason = openMeteoErrorReason(parsed);
        return packRefuse(
          "bad-request",
          "wx",
          "The weather service rejected this request, so no weather is saved.",
          reason !== null && reason !== "" ? reason : `HTTP ${res.status}`,
        );
      }

      if (!res.ok) {
        last = packRefuse(
          "upstream-error",
          "wx",
          "The weather service is having trouble right now, so no weather is saved.",
          `HTTP ${res.status}`,
        );
      } else {
        const text = await res.text();
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return packRefuse(
            "damaged",
            "wx",
            "The weather service returned something that was not readable data.",
            text.slice(0, 200),
          );
        }
        const reason = openMeteoErrorReason(body);
        if (reason !== null) {
          return packRefuse(
            "no-data",
            "wx",
            "The weather service has no forecast for this spot.",
            reason,
          );
        }
        return packOk(body);
      }
    } catch (e) {
      if (opts.signal?.aborted) {
        return packRefuse("network", "wx", "The weather download was cancelled.");
      }
      last = controller.signal.aborted
        ? packRefuse(
            "timeout",
            "wx",
            "The weather service did not answer in time, so no weather is saved.",
            `${timeoutMs} ms`,
          )
        : packRefuse(
            "network",
            "wx",
            "The weather service could not be reached, so no weather is saved.",
            e instanceof Error ? e.message : String(e),
          );
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onOuterAbort);
    }

    if (attempt < retries) {
      await sleep(RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]);
    }
  }

  return last;
}

/**
 * Read an Open-Meteo `YYYY-MM-DDTHH:MM` timestamp as a UTC instant.
 *
 * Built from components through `Date.UTC`, NEVER `new Date(str)`. See finding 4
 * — the same trap `parseCoopsInstant` in `tideFetch.ts` exists to avoid.
 */
function parseOpenMeteoInstant(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (!Number.isFinite(ms)) return null;
  const date = new Date(ms);
  // Round-trip guard: rejects 2026-02-31, which Date.UTC rolls into March
  // silently rather than failing.
  if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
  return ms;
}

/**
 * PURE. Turn an Open-Meteo body into a `WxPack`.
 *
 * Exported so the packing arithmetic is testable without a socket, and so a
 * caller holding a body from anywhere — a fixture, a proxy, a previous
 * download — packs it through the same guards.
 */
export function buildWxPack(
  body: unknown,
  meta: { readonly lat: number; readonly lng: number; readonly fetchedAt: string },
): PackResult<WxPack> {
  if (typeof body !== "object" || body === null) {
    return packRefuse("damaged", "wx", "The weather service returned something unreadable.");
  }
  const b = body as { hourly?: unknown; hourly_units?: unknown };

  if (typeof b.hourly !== "object" || b.hourly === null) {
    return packRefuse("damaged", "wx", "The weather response had no hourly forecast in it.");
  }
  const hourly = b.hourly as Record<string, unknown>;

  // FINDING 2. Units are checked, not assumed. `WxReading` names its fields
  // `windMph` / `tempF` / `precipIn`; a silently different unit would make those
  // names lie, and nothing in the numbers would look wrong.
  if (typeof b.hourly_units !== "object" || b.hourly_units === null) {
    return packRefuse(
      "damaged",
      "wx",
      "The weather response did not say what units its readings are in, so none is saved. " +
        "A wind speed with no unit is a number, not a reading.",
    );
  }
  const units = b.hourly_units as Record<string, unknown>;
  for (const v of WX_VARS) {
    if (units[v] !== EXPECTED_HOURLY_UNITS[v]) {
      return packRefuse(
        "unparsable-value",
        "wx",
        "The weather service answered in different units than this app reads, so no " +
          "weather is saved rather than a number whose meaning is a guess.",
        `${v}: got ${JSON.stringify(units[v])}, expected ${JSON.stringify(EXPECTED_HOURLY_UNITS[v])}`,
      );
    }
  }

  const times = hourly.time;
  if (!Array.isArray(times) || times.length === 0) {
    return packRefuse("no-data", "wx", "The weather response had no hours in it.");
  }

  // FINDING 5. The reader locates an hour by arithmetic, which is only valid on
  // a uniform grid. Verify EVERY step, not just the first.
  const startMs = parseOpenMeteoInstant(times[0]);
  if (startMs === null) {
    return packRefuse("unparsable-value", "wx", "The weather response carried a time we could not read.", "time[0]");
  }
  const stepMs = WX_STEP_MINUTES * MS_PER_MINUTE;
  for (let i = 1; i < times.length; i++) {
    const t = parseOpenMeteoInstant(times[i]);
    if (t === null) {
      return packRefuse(
        "unparsable-value",
        "wx",
        "The weather response carried a time we could not read, so no weather is saved.",
        `time[${i}] = ${JSON.stringify(times[i])}`,
      );
    }
    if (t - startMs !== i * stepMs) {
      return packRefuse(
        "damaged",
        "wx",
        "The weather response has a gap in its hours, so no weather is saved. Reading " +
          "across a hole invents weather.",
        `time[${i}] = ${JSON.stringify(times[i])}`,
      );
    }
  }

  const cols: Record<string, (number | null)[]> = {};
  for (const v of WX_VARS) {
    const col = hourly[v];
    if (!Array.isArray(col)) {
      return packRefuse("damaged", "wx", "The weather response is missing a reading column.", v);
    }
    if (col.length !== times.length) {
      // Parallel columns of different lengths hand back `undefined` values,
      // which is the `?? 0` bug arriving one layer deeper.
      return packRefuse(
        "damaged",
        "wx",
        "The weather response is damaged — its hours and readings do not line up.",
        `${v} has ${col.length}, expected ${times.length}`,
      );
    }
    const out: (number | null)[] = new Array(col.length);
    for (let i = 0; i < col.length; i++) {
      const raw = col[i];
      if (raw === null) {
        // An honestly missing hour. Stored as null, refused at read time.
        // NEVER a zero: 0 mph is a dead calm and 0.00 in is a dry hour, and
        // both are perfectly ordinary readings — which is exactly what would
        // make the substitution invisible.
        out[i] = null;
        continue;
      }
      // THE LAW: `typeof` FIRST. `Number(null)`, `Number("")` and `Number([])`
      // are all a finite 0 and would sail straight through `Number.isFinite`.
      if (typeof raw !== "number" || !Number.isFinite(raw)) {
        return packRefuse(
          "unparsable-value",
          "wx",
          "A weather reading came back in a form this app cannot read, so no weather is " +
            "saved. A missing reading is not a calm morning.",
          `${v}[${i}] = ${JSON.stringify(raw)}`,
        );
      }
      out[i] = Math.round(raw * WX_SCALE[v]);
    }
    cols[v] = out;
  }

  return packOk({
    packVersion: 1,
    kind: "forecast",
    source: "Open-Meteo",
    timeFrame: "utc",
    disclaimer: WX_DISCLAIMER,
    lat: meta.lat,
    lng: meta.lng,
    fetchedAt: meta.fetchedAt,
    startUTC: new Date(startMs).toISOString(),
    stepMinutes: WX_STEP_MINUTES,
    units: {
      wind: EXPECTED_HOURLY_UNITS.wind_speed_10m,
      temp: EXPECTED_HOURLY_UNITS.temperature_2m,
      pressure: EXPECTED_HOURLY_UNITS.pressure_msl,
      precip: EXPECTED_HOURLY_UNITS.precipitation,
    },
    scale: { ...WX_SCALE },
    cols,
  });
}

/** FETCH. The point forecast for a spot, packed. */
export async function fetchWxPack(
  lat: number,
  lng: number,
  opts: PackFetchOptions = {},
): Promise<PackResult<WxPack>> {
  if (typeof lat !== "number" || typeof lng !== "number") {
    return packRefuse("bad-request", "wx", "That spot has no coordinate, so no weather is saved.");
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return packRefuse("bad-request", "wx", "That is not a real coordinate, so no weather is saved.");
  }

  const res = await openMeteoRequest(buildOpenMeteoUrl(lat, lng), opts);
  if (res.status !== "ok") return res;

  const fetchedAt = (opts.now ? opts.now() : new Date()).toISOString();
  return buildWxPack(res.value, { lat, lng, fetchedAt });
}

/* ═════════════════════════════ PACK THE TRUCK ═════════════════════════════ */

/** What happened to one shard. Rule E — a partial pack is reported, not hidden. */
export interface PackShardOutcome {
  readonly shard: PackShardName;
  readonly status: "packed" | "already-held" | "refused";
  readonly scope: string;
  readonly slot: string;
  readonly key: string | null;
  /** ISO instant this shard came off the wire, or the one already on disk. */
  readonly fetchedAt: string | null;
  /** Encoded size in bytes, uncompressed. `null` when nothing was written. */
  readonly bytes: number | null;
  /** A sentence to show. */
  readonly message: string;
  readonly reason: PackRefusalReason | null;
}

export interface PackTheTruckReport {
  readonly startedAt: string;
  readonly finishedAt: string;
  /** True only when every stored shard is now on the device. */
  readonly ready: boolean;
  readonly shards: readonly PackShardOutcome[];
  /** Total bytes written this run, uncompressed. */
  readonly bytesWritten: number;
  /** Which backend held it. `"memory"` means nothing survives a reboot. */
  readonly backend: "indexeddb" | "memory";
}

/** The spot to pack for. Structurally a subset of `Spot` in `src/lib/spot.ts`. */
export interface PackTarget {
  readonly lat: number;
  readonly lng: number;
  /** The frozen NOAA station. `null` is a real state — a spot with no station. */
  readonly coops_station_id: string | null;
}

export interface PackTheTruckOptions extends PackFetchOptions {
  /** Inject a store. Defaults to `openPackStore()`. */
  readonly store?: PackStore;
  /** Re-download shards already held and still valid. Default false. */
  readonly force?: boolean;
}

const byteLength = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).length;

/**
 * The window the tide shard covers: Oct 1 → Jan 31 of the season containing
 * `now`. `seasonSlot` in `packStore.ts` decides which season that is.
 */
export function seasonWindow(now: Date): { start: Date; end: Date; slot: string } {
  const slot = seasonSlot(now);
  const openYear = Number(slot.slice(0, 4));
  return {
    start: new Date(Date.UTC(openYear, SEASON_START_MONTH, 1)),
    end: new Date(Date.UTC(openYear + 1, SEASON_END_MONTH, SEASON_END_DAY)),
    slot,
  };
}

/**
 * FETCH. The one button. Downloads every stored shard and writes it to disk.
 *
 * SHARDS ARE INDEPENDENT AND FAILURES DO NOT CASCADE. The tide call and the
 * weather call go out together; either can fail without taking the other with
 * it, and the report names which. A truck with tide and no wind is a real state
 * a hunter can drive out on knowingly — collapsing it into a single boolean
 * would throw away the only thing he can act on.
 *
 * ALREADY-HELD SHARDS ARE NOT RE-DOWNLOADED unless `force` is set. Tide
 * predictions are harmonic and immutable for the season, so a second press of
 * the button on the same season is free; the weather is re-downloaded once it
 * is past its 3 h TTL. This is a hunter's cellular data at a boat ramp, not a
 * server's bandwidth.
 */
export async function packTheTruck(
  target: PackTarget,
  opts: PackTheTruckOptions = {},
): Promise<PackResult<PackTheTruckReport>> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now().toISOString();

  const spot = spotScope(target?.lat as number, target?.lng as number);
  if (spot.status !== "ok") return spot;

  let store = opts.store ?? null;
  if (store === null) {
    const opened = openPackStore({ now });
    if (opened.status !== "ok") return opened;
    store = opened.value;
  }

  const win = seasonWindow(now());
  const outcomes: PackShardOutcome[] = [];
  let bytesWritten = 0;

  /* ── what is already on the disk ── */

  const tideScope = target.coops_station_id === null ? null : stationScope(target.coops_station_id);

  const heldTide =
    tideScope === null ? null : await store.load(tideScope);
  const heldWx = await store.load(spot.value);

  const tideAlready =
    heldTide !== null && heldTide.status === "ok"
      ? selectShard(heldTide.value, "tide.hilo", { slot: win.slot, now: now().getTime() })
      : null;
  const wxAlready =
    heldWx.status === "ok"
      ? selectShard(heldWx.value, "wx", { now: now().getTime(), requireFresh: true })
      : null;

  /* ── the two wire calls, together ── */

  const wantTide =
    tideScope !== null && (opts.force === true || tideAlready === null || tideAlready.status !== "ok");
  const wantWx = opts.force === true || wxAlready === null || wxAlready.status !== "ok";

  const [tideRes, wxRes] = await Promise.all([
    wantTide && tideScope !== null
      ? fetchTideRange(target.coops_station_id as string, win.start, win.end, {
          timeoutMs: opts.timeoutMs,
          retries: opts.retries,
          signal: opts.signal,
          fetchImpl: opts.fetchImpl,
        })
      : Promise.resolve(null),
    wantWx
      ? fetchWxPack(target.lat, target.lng, opts)
      : Promise.resolve(null),
  ]);

  /* ── tide ── */

  if (tideScope === null) {
    outcomes.push({
      shard: "tide.hilo",
      status: "refused",
      scope: "(none)",
      slot: win.slot,
      key: null,
      fetchedAt: null,
      bytes: null,
      reason: "bad-request",
      message:
        "This spot is not bound to a NOAA tide station, so no tide can be downloaded. " +
        "Set the station on the spot while you have signal.",
    });
  } else if (tideRes === null && tideAlready !== null && tideAlready.status === "ok") {
    outcomes.push({
      shard: "tide.hilo",
      status: "already-held",
      scope: tideScope,
      slot: tideAlready.value.slot,
      key: null,
      fetchedAt: tideAlready.value.freshness.fetchedAt,
      bytes: null,
      reason: null,
      message:
        "The whole season's tide is already on this phone. Tide predictions are harmonic " +
        "and do not change, so there is nothing to download again.",
    });
  } else if (tideRes === null) {
    outcomes.push({
      shard: "tide.hilo",
      status: "refused",
      scope: tideScope,
      slot: win.slot,
      key: null,
      fetchedAt: null,
      bytes: null,
      reason: "not-packed",
      message: "The tide was not downloaded.",
    });
  } else if (tideRes.status !== "ok") {
    outcomes.push({
      shard: "tide.hilo",
      status: "refused",
      scope: tideScope,
      slot: win.slot,
      key: null,
      fetchedAt: null,
      bytes: null,
      // `tideFetch.ts` speaks `TideRefusalReason`; the pack speaks
      // `PackRefusalReason`. Only the four transport reasons overlap, and the
      // rest collapse to `no-data` — but the SENTENCE `tide.ts` wrote is kept
      // verbatim, because it is already the right sentence.
      reason: mapTideReason(tideRes.reason),
      message: tideRes.message,
    });
  } else {
    const written = await writeShard(store, {
      scope: tideScope,
      shard: "tide.hilo",
      slot: win.slot,
      fetchedAt: tideRes.value.fetchedAt,
      payload: tideRes.value as TidePack,
    });
    outcomes.push(written.outcome);
    bytesWritten += written.outcome.bytes ?? 0;
  }

  /* ── wx ── */

  if (wxRes === null && wxAlready !== null && wxAlready.status === "ok") {
    outcomes.push({
      shard: "wx",
      status: "already-held",
      scope: spot.value,
      slot: wxAlready.value.slot,
      key: null,
      fetchedAt: wxAlready.value.freshness.fetchedAt,
      bytes: null,
      reason: null,
      message: "The forecast on this phone is still current, so it was not downloaded again.",
    });
  } else if (wxRes === null) {
    outcomes.push({
      shard: "wx",
      status: "refused",
      scope: spot.value,
      slot: wxSlot(now()),
      key: null,
      fetchedAt: null,
      bytes: null,
      reason: "not-packed",
      message: "The weather was not downloaded.",
    });
  } else if (wxRes.status !== "ok") {
    outcomes.push({
      shard: "wx",
      status: "refused",
      scope: spot.value,
      slot: wxSlot(now()),
      key: null,
      fetchedAt: null,
      bytes: null,
      reason: wxRes.reason,
      message: wxRes.message,
    });
  } else {
    const written = await writeShard(store, {
      scope: spot.value,
      shard: "wx",
      slot: wxSlot(new Date(wxRes.value.fetchedAt)),
      fetchedAt: wxRes.value.fetchedAt,
      payload: wxRes.value,
    });
    outcomes.push(written.outcome);
    bytesWritten += written.outcome.bytes ?? 0;
  }

  return packOk({
    startedAt,
    finishedAt: now().toISOString(),
    ready: outcomes.every((o) => o.status !== "refused"),
    shards: outcomes,
    bytesWritten,
    backend: store.backend,
  });
}

/** Build the record, write it, and turn the result into an outcome row. */
async function writeShard(
  store: PackStore,
  args: {
    readonly scope: string;
    readonly shard: PackShardName;
    readonly slot: string;
    readonly fetchedAt: string;
    readonly payload: unknown;
  },
): Promise<{ outcome: PackShardOutcome }> {
  const spec = packShardSpec(args.shard);
  const record = buildShardRecord(args);
  if (record.status !== "ok") {
    return {
      outcome: {
        shard: args.shard,
        status: "refused",
        scope: args.scope,
        slot: args.slot,
        key: null,
        fetchedAt: null,
        bytes: null,
        reason: record.reason,
        message: record.message,
      },
    };
  }

  const saved = await store.save(record.value);
  if (saved.status !== "ok") {
    return {
      outcome: {
        shard: args.shard,
        status: "refused",
        scope: args.scope,
        slot: args.slot,
        key: record.value.key,
        fetchedAt: args.fetchedAt,
        bytes: null,
        reason: saved.reason,
        message: saved.message,
      },
    };
  }

  return {
    outcome: {
      shard: args.shard,
      status: "packed",
      scope: args.scope,
      slot: args.slot,
      key: record.value.key,
      fetchedAt: args.fetchedAt,
      bytes: byteLength(args.payload),
      reason: null,
      message: `${spec.label} saved to this phone.`,
    },
  };
}

/**
 * Translate a `TideRefusalReason` into a `PackRefusalReason`.
 *
 * Only the transport reasons map one-to-one. Everything else collapses to
 * `no-data`, which is honest — from the pack's point of view a subordinate
 * station with no curve and an empty date range are the same answer: there is
 * nothing to store. THE SENTENCE IS NEVER TRANSLATED; `tide.ts` already wrote
 * the right one and the caller shows that.
 */
function mapTideReason(reason: string): PackRefusalReason {
  switch (reason) {
    case "bad-request":
      return "bad-request";
    case "network":
      return "network";
    case "timeout":
      return "timeout";
    case "upstream-error":
      return "upstream-error";
    case "unparsable-value":
      return "unparsable-value";
    default:
      return "no-data";
  }
}
