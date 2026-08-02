/**
 * readPack.ts — the pocket, read with no signal.
 *
 * This is the half of the offline pack a hunter runs standing in water at 05:40
 * with the phone in airplane mode. Every exported function here is SYNCHRONOUS,
 * total, and operates on records that are already in memory. THERE IS NO NETWORK
 * IN THIS FILE, and there is no way to add one quietly: `eslint.config.js` names
 * `src/lib/pack/**` in its offline `files:` glob and bans bare `fetch`,
 * `window.fetch` and `globalThis.fetch` there. If you are editing this file and
 * reaching for a request, you are in the wrong file — the wire lives in
 * `src/lib/pack/packFetch.ts`, which that glob names as its ONE exemption.
 *
 * That split is a FILE boundary and not a comment inside one module on purpose,
 * for exactly the reason `src/lib/tide.ts` gives for its own split: a rule that
 * cannot be violated beats a rule that must be remembered.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE DEPENDENCY DIRECTION IS ONE-WAY.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *      packFetch.ts  ──imports──▶  readPack.ts
 *      packStore.ts  ──imports──▶  readPack.ts
 *      readPack.ts   ──imports──▶  src/lib/tide.ts   (types + the tide decoder)
 *      readPack.ts   ──imports──▶  NOTHING from packFetch.ts. Ever.
 *
 * This module owns the vocabulary: the shard catalog, the refusal, freshness,
 * and the pure readers. `packFetch.ts` owns exactly one thing on top of that —
 * how a shard is obtained over a network. `packStore.ts` owns one other — how a
 * shard survives a reboot. An import pointing the other way would reintroduce the
 * coupling the split exists to remove and would let the eslint tripwire be routed
 * around through a re-export.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT IS IN THE PACK, AND WHAT IS DELIBERATELY NOT.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *   sky        NOT STORED. Sun and moon are pure math over a coordinate and a
 *              clock; `src/lib/sky.ts` already computes them on device. Storing
 *              them would be caching what the device derives, and — worse — the
 *              cache would go stale in a way the computation cannot. A pack that
 *              can be wrong about sunrise is worse than no pack.
 *
 *   tide.hilo  STORED. NOAA harmonic predictions, Oct 1 → Jan 31, encoded by
 *              `packTideEvents` in `src/lib/tide.ts`. MEASURED 2026-08-01 for
 *              station 8571807 (Woolford / Church Creek, the station bound to
 *              Blackwater NWR): 475 events, 4,988 bytes of JSON, 2,195 bytes
 *              gzipped, against a 3,794-byte budget. Harmonic predictions are
 *              deterministic, so this shard is IMMUTABLE for the season — a pack
 *              fetched in August is still exact in January and has no TTL.
 *
 *   wx         STORED. Open-Meteo point forecast, 8 variables × 168 hours.
 *              MEASURED 2026-08-01 at 38.4436,-76.0722: 5,342 bytes of JSON,
 *              1,910 bytes gzipped, against a 2,649-byte budget. A FORECAST, not
 *              a reading, and it decays — TTL 3 h. See the freshness section.
 *
 *   season     NOT STORED. Season dates and the cited shooting-hours rule are a
 *              committed constant in `src/data/regs/**` and ship inside the
 *              JavaScript bundle. The service worker precaches that bundle. There
 *              is nothing to fetch and nothing to keep in sync.
 *
 * `PACK_SHARDS` below carries all four rows as data — including the two that are
 * never stored, and the reason — so a "PACK THE TRUCK" surface renders the truth
 * instead of inventing its own table.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE HONESTY RULES. These are the product, not decoration.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * A. A MISS IS A TYPED REFUSAL, NEVER `null` AND NEVER AN EMPTY OBJECT. Every
 *    read returns `PackResult<T>` — a closed discriminated union with NO `value`
 *    property on the refusal branch, so TypeScript will not let a caller read
 *    `.value` without narrowing on `status === "ok"` first. Same shape, same
 *    reason, same discipline as `TideResult` in `src/lib/tide.ts` and
 *    `ShootingHoursLookup` in `src/data/regs/shootingHours.ts`. The refusal also
 *    carries `shard` — WHAT is missing — alongside `reason` and `message`, which
 *    are WHY. "Nothing is packed for this spot" and "the wind shard is damaged"
 *    are different sentences and a hunter can act on the difference.
 *
 * B. NO `?? 0`. NOT ONCE. `Number(null)`, `Number("")` and `Number([])` are all a
 *    finite `0`, so `Number.isFinite` ALONE does not save you — the `typeof`
 *    guard has to fire FIRST. Read `finiteNumber` below and note the order. A
 *    missing wind speed is not a calm morning and a missing tide is not a 0.0 ft
 *    tide; at MLLW 0.0 ft is a real and ordinary water level, which is precisely
 *    what makes that fabrication invisible on screen. This project has already
 *    fabricated 1,095 high-severity weather events from exactly this bug.
 *
 * C. FRESHNESS IS A VALUE, NOT A FOOTNOTE. Every stored shard carries `fetchedAt`
 *    and every successful read returns a `Freshness` beside the data, so a
 *    surface can print "wind, 4 h old" without asking a second question. A stale
 *    reading rendered as current is the same class of lie as a fabricated one.
 *    Staleness does NOT refuse by default: an old forecast with its age on the
 *    screen is honest, and a hunter with a four-hour-old wind is better served
 *    than a hunter with a blank rail. Pass `requireFresh: true` when a caller
 *    genuinely cannot use an old number.
 *
 * D. EVERY INSTANT IS AN HONEST UTC INSTANT. Same frame as `sky.ts` and
 *    `tide.ts` — "localizing to the spot's timezone is the caller's job" — so a
 *    packed wind hour, a tide and a sunrise compare with no conversion between
 *    them, which is the entire point of the shaded shooting window.
 */

import {
  unpackTideEvents,
  type TideEvent,
  type TidePack,
} from "@/lib/tide";

/* ───────────────────────────── constants ───────────────────────────── */

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;

/**
 * Envelope version for a stored record. Bumping this REFUSES an old record
 * rather than misreading it, exactly as `SPOT_SCHEMA_VERSION` does in
 * `src/lib/spot.ts` and `POCKET_VERSION` in `src/components/field/tidePocket.ts`.
 * A half-understood pack is worse than no pack: it puts confident wrong water on
 * the screen.
 */
export const PACK_RECORD_VERSION = 1;

/**
 * The separator inside a store key. A NUL (`\u0000`) rather than `|` or `:` because a
 * station id, a spot scope and a season slot are all caller-supplied strings and
 * a separator that can appear inside a component lets two different keys collide
 * into one. NUL cannot appear in any of them, and `packKey` refuses if it somehow
 * does rather than writing an ambiguous key.
 */
const KEY_SEP = "\u0000";

/* ───────────────────────────── vocabulary ───────────────────────────── */

/** A shard that is actually written to storage. */
export type PackShardName = "tide.hilo" | "wx";

/** A shard the pack deliberately does NOT store. See the header. */
export type PackVirtualShardName = "sky" | "season";

export type PackAnyShardName = PackShardName | PackVirtualShardName;

/**
 * The shard table, as data.
 *
 * Exported so a status surface can render what a pack contains — and what it
 * deliberately does not — without transcribing this list into a component and
 * letting the two drift. `ttlMs: null` means the shard never goes stale.
 */
export interface PackShardSpec {
  readonly shard: PackAnyShardName;
  readonly label: string;
  /** False for `sky` and `season`. Read `why` for the reason. */
  readonly stored: boolean;
  /** Milliseconds before this shard is considered stale, or `null` for never. */
  readonly ttlMs: number | null;
  /** Measured gzipped size at the reference spot, bytes. 0 for unstored shards. */
  readonly measuredGzipBytes: number;
  /** The sentence explaining the row. Show it verbatim. */
  readonly why: string;
}

export const PACK_SHARDS: readonly PackShardSpec[] = [
  {
    shard: "sky",
    label: "Sun & moon",
    stored: false,
    ttlMs: null,
    measuredGzipBytes: 0,
    why:
      "Computed on this device from your coordinates and the clock. Nothing is " +
      "downloaded and nothing can go stale.",
  },
  {
    shard: "tide.hilo",
    label: "Tide highs & lows",
    stored: true,
    ttlMs: null,
    measuredGzipBytes: 2195,
    why:
      "NOAA harmonic predictions for the whole season, Oct 1 through Jan 31. " +
      "Predictions are deterministic, so a pack downloaded in August is still " +
      "exact in January.",
  },
  {
    shard: "wx",
    label: "Wind & weather",
    stored: true,
    ttlMs: 3 * MS_PER_HOUR,
    measuredGzipBytes: 1910,
    why:
      "Open-Meteo point forecast, seven days ahead, hourly. A forecast ages — " +
      "every reading is shown with how old it is.",
  },
  {
    shard: "season",
    label: "Season dates & shooting hours",
    stored: false,
    ttlMs: null,
    measuredGzipBytes: 0,
    why:
      "Transcribed from the published regulation and shipped inside the app " +
      "itself. There is nothing to download.",
  },
] as const;

const SHARD_SPEC: Readonly<Record<PackAnyShardName, PackShardSpec>> = Object.freeze(
  PACK_SHARDS.reduce<Record<string, PackShardSpec>>((acc, s) => {
    acc[s.shard] = s;
    return acc;
  }, {}),
) as Readonly<Record<PackAnyShardName, PackShardSpec>>;

export function packShardSpec(shard: PackAnyShardName): PackShardSpec {
  return SHARD_SPEC[shard];
}

/* ──────────────────────────── the refusal ──────────────────────────── */

/**
 * Why a read refused. A CLOSED UNION so a caller branches on cause without
 * string-matching a message, exactly as `TideRefusalReason` does in `tide.ts`.
 *
 * This is deliberately NOT `TideRefusalReason` re-used. A pack can fail in ways
 * a tide curve cannot — nothing was ever downloaded, the browser refuses to
 * store anything, the saved record belongs to a different marsh — and folding
 * those into `"no-data"` would erase the only distinction that tells a hunter
 * what to DO about it. The SHAPE is identical on purpose (`status` / `reason` /
 * `message` / `detail`), so a component that renders a tide refusal renders a
 * pack refusal with no new code.
 */
export type PackRefusalReason =
  /** Nothing was ever downloaded for this spot and shard. The canonical miss. */
  | "not-packed"
  /** The record is for a different station or spot than the one asked about. */
  | "wrong-spot"
  /** Present, but older than the caller's freshness requirement. */
  | "stale"
  /** The stored record is not shaped like a pack record. */
  | "damaged"
  /** Written by a different version of this app. */
  | "version-mismatch"
  /** A value inside the record could not be read. See rule B. */
  | "unparsable-value"
  /** The instant asked about lies outside the data in hand. */
  | "out-of-range"
  /** Caller's arguments are wrong. Never fetched, never retried. */
  | "bad-request"
  /** This browser will not let the app store anything. Private browsing. */
  | "storage-unavailable"
  /** Reading or writing storage threw. */
  | "storage-error"
  /** fetch threw, or the caller aborted. Produced by `packFetch.ts`. */
  | "network"
  /** Our own deadline elapsed. Produced by `packFetch.ts`. */
  | "timeout"
  /** 5xx after retries. Produced by `packFetch.ts`. */
  | "upstream-error"
  /** The upstream answered, and its answer is "there is nothing here". */
  | "no-data";

/**
 * Every entry point in the pack returns one of these.
 *
 * NOTE WHAT IS ABSENT FROM THE REFUSAL BRANCH: there is no `value`. TypeScript
 * refuses property access on a union unless the property exists on every member,
 * so `readWx(pocket).value` does not compile. The only way to a value is to
 * narrow on `status === "ok"`, which is the check that keeps a fabricated 0 mph
 * off the screen.
 *
 * `shard` on the refusal branch is WHAT is missing. It is `null` only when the
 * refusal is not about a particular shard (a bad argument, or storage itself
 * being unavailable).
 */
export type PackResult<T> =
  | { readonly status: "ok"; readonly value: T }
  | {
      readonly status: "refused";
      readonly reason: PackRefusalReason;
      /** WHAT is missing. `null` when the refusal is not shard-specific. */
      readonly shard: PackAnyShardName | null;
      /** A sentence that can be shown to the hunter verbatim. */
      readonly message: string;
      /** Diagnostics. Never displayed alone. */
      readonly detail?: string;
    };

/**
 * The two constructors. Exported so `packFetch.ts` and `packStore.ts` build
 * refusals in the same shape — the whole reason they are public. If the wire or
 * the store handed back a differently shaped result, a caller would have three
 * refusal vocabularies to narrow on and would eventually stop narrowing.
 *
 * `packOk`, not `ok`, because a bare `ok` in an importing module reads like a
 * boolean.
 */
export const packOk = <T,>(value: T): PackResult<T> => ({ status: "ok", value });

export const packRefuse = <T,>(
  reason: PackRefusalReason,
  shard: PackAnyShardName | null,
  message: string,
  detail?: string,
): PackResult<T> =>
  detail === undefined
    ? { status: "refused", reason, shard, message }
    : { status: "refused", reason, shard, message, detail };

/* ─────────────────────────── guarded parsing ─────────────────────────── */

/**
 * A finite number, or `null`.
 *
 * READ THE ORDER OF THE GUARDS. `typeof value !== "number"` fires FIRST, and it
 * is what kills `null`. If it did not, `Number(null)` would return `0` — a
 * finite number that sails through `Number.isFinite` and lands on screen as a
 * dead-calm morning or a 0.0 ft tide. `""` (`Number("")` is `0`), `[]`
 * (`Number([])` is `0`), `false` and `undefined` all die here too.
 *
 * Deliberately stricter than `finiteOrNull` in `src/lib/spot.ts`, which accepts
 * numeric strings because it parses a hand-entered coordinate. Nothing in a pack
 * is hand-entered; every number in one was written by this app as a number, so a
 * string here means the record is damaged and the honest answer is to say so.
 */
function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** An ISO instant string that actually parses, or `null`. */
function isoInstant(value: unknown): string | null {
  const s = nonEmptyString(value);
  if (s === null) return null;
  return Number.isFinite(Date.parse(s)) ? s : null;
}

/**
 * Milliseconds out of something that claims to be a `Date`, or `NaN`.
 *
 * DUCK-TYPED ON `getTime`, NOT `instanceof Date`, for the reason `tide.ts`
 * records: `instanceof` compares against the `Date` binding in THIS realm, so it
 * returns false for a perfectly good Date that arrived from an iframe, a worker,
 * a structured clone — which is exactly how a Date comes back out of IndexedDB —
 * or a test that installed fake timers.
 */
function instantMs(value: unknown): number {
  if (value === null || typeof value !== "object") return NaN;
  const getTime = (value as { getTime?: unknown }).getTime;
  if (typeof getTime !== "function") return NaN;
  const ms = (getTime as () => unknown).call(value);
  return typeof ms === "number" ? ms : NaN;
}

/* ──────────────────────────── the stored record ──────────────────────────── */

/**
 * The envelope every shard is stored in. One IndexedDB object store holds these,
 * keyed on `key`.
 *
 * `scope` is the thing the shard belongs to — `station:8571807` for a tide shard,
 * `spot:38.4436,-76.0722` for a weather shard. `slot` is the season or date the
 * shard covers. Together with `shard` they are the key, which is the
 * `(stationId | spotId, shard, seasonOrDate)` triple the pack is specified on.
 */
export interface PackShardRecord {
  readonly key: string;
  readonly recordVersion: number;
  readonly scope: string;
  readonly shard: PackShardName;
  readonly slot: string;
  /** ISO instant this shard came off the wire. THE age, and it is never absent. */
  readonly fetchedAt: string;
  /** The shard body. `TidePack` for `tide.hilo`, `WxPack` for `wx`. */
  readonly payload: unknown;
}

/** A record that came out of storage unreadable, and why. */
export interface DamagedRecord {
  readonly key: string;
  readonly reason: PackRefusalReason;
  readonly message: string;
}

/**
 * Everything the store found for one scope, already in memory.
 *
 * THIS IS WHAT MAKES THE PURE READERS POSSIBLE. The store does one async trip to
 * IndexedDB and materializes this; every reader below is then synchronous over
 * it. A field component awaits once at mount and never again, which is the
 * difference between a rail that renders and a rail that shows a spinner while
 * legal light comes and goes.
 *
 * `damaged` is carried rather than dropped so a read can say "the wind shard is
 * damaged" instead of the much weaker and slightly false "nothing is packed".
 */
export interface PocketPack {
  readonly scope: string;
  /** ISO instant the store was read. */
  readonly readAt: string;
  readonly records: readonly PackShardRecord[];
  readonly damaged: readonly DamagedRecord[];
}

/**
 * PURE. Build a store key. Refuses rather than writing an ambiguous one.
 *
 * Exported because `packStore.ts` writes with it and the tests read with it, and
 * because a key format invented in two places is a key format that drifts.
 */
export function packKey(
  scope: string,
  shard: PackShardName,
  slot: string,
): PackResult<string> {
  const s = nonEmptyString(scope);
  const sl = nonEmptyString(slot);
  if (s === null || sl === null) {
    return packRefuse("bad-request", shard, "A pack key needs both a spot and a season.");
  }
  if (s.includes(KEY_SEP) || sl.includes(KEY_SEP)) {
    return packRefuse(
      "bad-request",
      shard,
      "That spot or season name cannot be used as a storage key.",
    );
  }
  return packOk(`${s}${KEY_SEP}${shard}${KEY_SEP}${sl}`);
}

function isShardName(value: unknown): value is PackShardName {
  return value === "tide.hilo" || value === "wx";
}

/**
 * PURE. Validate one record read back out of storage.
 *
 * Every field is guarded before it is trusted. A record that fails here is
 * DAMAGED, not absent, and the two produce different sentences downstream.
 */
export function parsePackRecord(raw: unknown): PackResult<PackShardRecord> {
  if (raw === null || typeof raw !== "object") {
    return packRefuse("damaged", null, "A saved pack record could not be read.");
  }
  const rec = raw as Record<string, unknown>;

  const key = nonEmptyString(rec.key);
  if (key === null) {
    return packRefuse("damaged", null, "A saved pack record has no key on it.");
  }

  if (finiteNumber(rec.recordVersion) !== PACK_RECORD_VERSION) {
    return packRefuse(
      "version-mismatch",
      isShardName(rec.shard) ? rec.shard : null,
      "Part of this pack was saved by a different version of the app, so it is not " +
        "read. Pack the truck again while you have signal.",
      `${key}: recordVersion ${String(rec.recordVersion)}`,
    );
  }

  const scope = nonEmptyString(rec.scope);
  const slot = nonEmptyString(rec.slot);
  if (scope === null || slot === null || !isShardName(rec.shard)) {
    return packRefuse("damaged", null, "A saved pack record is missing its labels.", key);
  }

  const fetchedAt = isoInstant(rec.fetchedAt);
  if (fetchedAt === null) {
    // Rule C. A reading with no age is a reading nobody can judge, and the
    // honest answer is to refuse it rather than to render it as current.
    return packRefuse(
      "damaged",
      rec.shard,
      "Part of this pack does not say when it was downloaded, so it is not shown. " +
        "A reading with no age is a reading you cannot judge.",
      key,
    );
  }

  if (rec.payload === null || rec.payload === undefined) {
    return packRefuse("damaged", rec.shard, "Part of this pack is empty.", key);
  }

  return packOk({
    key,
    recordVersion: PACK_RECORD_VERSION,
    scope,
    shard: rec.shard,
    slot,
    fetchedAt,
    payload: rec.payload,
  });
}

/* ───────────────────────────── freshness ───────────────────────────── */

/**
 * How old a shard is, and whether that matters. Returned alongside EVERY value.
 *
 * `ttlMs === null` means the shard cannot go stale — tide predictions are
 * harmonic and a pack fetched in August is exact in January. `stale` is then
 * always false, and a surface can still print the age if it wants to.
 */
export interface Freshness {
  readonly fetchedAt: string;
  readonly ageMs: number;
  readonly ttlMs: number | null;
  readonly stale: boolean;
}

/** PURE. Freshness of a shard as of `nowMs`. */
export function freshnessOf(
  fetchedAt: string,
  ttlMs: number | null,
  nowMs: number,
): Freshness {
  const fetchedMs = Date.parse(fetchedAt);
  // `fetchedAt` is guaranteed parseable by `parsePackRecord`; this guard is for
  // callers holding a record from somewhere else. A negative age (clock skew,
  // or a device whose time was wrong when it packed) clamps to 0 rather than
  // reporting a reading from the future.
  const ageMs = Number.isFinite(fetchedMs) ? Math.max(0, nowMs - fetchedMs) : Number.POSITIVE_INFINITY;
  return {
    fetchedAt,
    ageMs,
    ttlMs,
    stale: ttlMs !== null && ageMs > ttlMs,
  };
}

/**
 * PURE. The age as a hunter says it. Returns `null` for an age that is not a
 * real number — there is no fallback string that reads like a duration.
 */
export function formatAge(ageMs: number): string | null {
  if (!Number.isFinite(ageMs) || ageMs < 0) return null;
  const min = Math.floor(ageMs / MS_PER_MINUTE);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min old`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h old`;
  return `${Math.floor(h / 24)} d old`;
}

/** The value side of every successful read: the data AND how old it is. */
export interface PackRead<T> {
  readonly data: T;
  readonly freshness: Freshness;
  readonly shard: PackShardName;
  readonly scope: string;
  readonly slot: string;
}

export interface PackReadOptions {
  /** Clock injection. Defaults to `Date.now()`. */
  readonly now?: number;
  /**
   * Refuse when the shard is older than its TTL. DEFAULT FALSE, deliberately —
   * an old forecast with its age printed beside it is honest, and a hunter with
   * a four-hour-old wind is better served than a hunter with a blank rail. Pass
   * true only when a caller genuinely cannot use an old number.
   */
  readonly requireFresh?: boolean;
  /** Override the shard's TTL for this read, milliseconds. */
  readonly maxAgeMs?: number;
  /** Read a specific season/date slot instead of the newest one. */
  readonly slot?: string;
}

/* ────────────────────── selecting a record from the pocket ────────────────────── */

/**
 * PURE. The record for a shard, newest first, with the refusal already shaped.
 *
 * NEWEST-WINS RATHER THAN A KNOWN SLOT, unless a caller names one. A hunter who
 * packed the truck on Friday and drove out Saturday has one weather shard on
 * disk with Friday's slot; demanding today's slot would refuse a perfectly usable
 * forecast rather than showing it with its age. The tide shard is keyed by
 * season and there is only ever one.
 */
export function selectShard(
  pocket: PocketPack,
  shard: PackShardName,
  opts: PackReadOptions = {},
): PackResult<PackRead<unknown>> {
  const spec = packShardSpec(shard);
  const wantSlot = opts.slot === undefined ? null : nonEmptyString(opts.slot);

  const damaged = pocket.damaged.find((d) => d.key.includes(`${KEY_SEP}${shard}${KEY_SEP}`));

  let best: PackShardRecord | null = null;
  for (const r of pocket.records) {
    if (r.shard !== shard) continue;
    if (wantSlot !== null && r.slot !== wantSlot) continue;
    if (r.scope !== pocket.scope) continue;
    if (best === null || Date.parse(r.fetchedAt) > Date.parse(best.fetchedAt)) best = r;
  }

  if (best === null) {
    // A damaged record is a truer answer than "nothing is packed": the hunter
    // DID pack the truck, and telling him he did not sends him looking for the
    // wrong problem.
    if (damaged) {
      return packRefuse("damaged", shard, damaged.message, damaged.key);
    }
    return packRefuse(
      "not-packed",
      shard,
      `${spec.label} was never downloaded for this spot, so none is shown. ` +
        `Pack the truck while you have signal — this app will not invent it.`,
    );
  }

  const ttlMs = opts.maxAgeMs !== undefined ? opts.maxAgeMs : spec.ttlMs;
  const nowMs = opts.now ?? Date.now();
  const freshness = freshnessOf(best.fetchedAt, ttlMs, nowMs);

  if (opts.requireFresh === true && freshness.stale) {
    return packRefuse(
      "stale",
      shard,
      `${spec.label} in this pack is ${formatAge(freshness.ageMs) ?? "too old"} and this ` +
        `reading needs a current one, so none is shown.`,
      `age ${freshness.ageMs} ms, ttl ${String(ttlMs)} ms`,
    );
  }

  return packOk({
    data: best.payload,
    freshness,
    shard,
    scope: best.scope,
    slot: best.slot,
  });
}

/* ══════════════════════════════ TIDE READS ══════════════════════════════ */

/**
 * PURE. The season's packed tide, as `TidePack`.
 *
 * The payload is validated by round-tripping it through `unpackTideEvents` from
 * `src/lib/tide.ts` — the committed decoder that already enforces the parallel
 * column lengths, the `?? 0` law and the `H`/`L` kinds. Re-validating here in a
 * second place would be a second implementation of the same rules, and the two
 * would drift.
 */
export function readTidePack(
  pocket: PocketPack,
  opts: PackReadOptions = {},
): PackResult<PackRead<TidePack>> {
  const sel = selectShard(pocket, "tide.hilo", opts);
  if (sel.status !== "ok") return sel;

  const pack = sel.value.data;
  if (pack === null || typeof pack !== "object") {
    return packRefuse("damaged", "tide.hilo", "The saved tide is damaged, so no water is shown.");
  }

  const decoded = unpackTideEvents(pack as TidePack);
  if (decoded.status !== "ok") {
    // Translate the tide vocabulary into the pack vocabulary, keeping the
    // sentence `tide.ts` wrote — it is already the right sentence.
    return packRefuse(
      decoded.reason === "unparsable-value" ? "unparsable-value" : "damaged",
      "tide.hilo",
      decoded.message,
      decoded.detail,
    );
  }

  return packOk({ ...sel.value, data: pack as TidePack });
}

/** PURE. The season's highs and lows, decoded. */
export function readTideEvents(
  pocket: PocketPack,
  opts: PackReadOptions = {},
): PackResult<PackRead<readonly TideEvent[]>> {
  const packed = readTidePack(pocket, opts);
  if (packed.status !== "ok") return packed;

  const decoded = unpackTideEvents(packed.value.data);
  if (decoded.status !== "ok") {
    return packRefuse("unparsable-value", "tide.hilo", decoded.message, decoded.detail);
  }
  return packOk({ ...packed.value, data: decoded.value });
}

/**
 * PURE. The highs and lows inside a window.
 *
 * REFUSES rather than returning an empty array when the window falls outside the
 * packed season. An empty array reads as "the water does nothing today", which is
 * a lie about a marsh; "this pack covers Oct 1 through Jan 31 and you asked about
 * March" is the truth and tells the hunter what to fix.
 */
export function readTideEventsBetween(
  pocket: PocketPack,
  from: Date,
  to: Date,
  opts: PackReadOptions = {},
): PackResult<PackRead<readonly TideEvent[]>> {
  const fromMs = instantMs(from);
  const toMs = instantMs(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return packRefuse("bad-request", "tide.hilo", "No valid window was given, so no tide is shown.");
  }
  if (toMs < fromMs) {
    return packRefuse("bad-request", "tide.hilo", "That tide window ends before it begins.");
  }

  const all = readTideEvents(pocket, opts);
  if (all.status !== "ok") return all;

  const events = all.value.data;
  const firstMs = events[0].at.getTime();
  const lastMs = events[events.length - 1].at.getTime();
  if (fromMs < firstMs || toMs > lastMs) {
    return packRefuse(
      "out-of-range",
      "tide.hilo",
      "That day is outside the tide season saved on this phone, so no water is shown.",
      `${new Date(fromMs).toISOString()}…${new Date(toMs).toISOString()} not in ` +
        `${events[0].at.toISOString()}…${events[events.length - 1].at.toISOString()}`,
    );
  }

  return packOk({
    ...all.value,
    data: events.filter((e) => {
      const t = e.at.getTime();
      return t >= fromMs && t <= toMs;
    }),
  });
}

/* ══════════════════════════════ WEATHER ══════════════════════════════ */

/**
 * The eight variables. A CLOSED UNION, and the order is the storage order.
 *
 * Eight because that is what the shard budget measured at: 8 × 168 h packs to
 * 1,910 gzipped bytes. Adding a ninth is not free and is not a footnote — it is
 * a budget change and a `packVersion` bump.
 */
export type WxVar =
  | "wind_speed_10m"
  | "wind_direction_10m"
  | "wind_gusts_10m"
  | "temperature_2m"
  | "pressure_msl"
  | "precipitation"
  | "cloud_cover"
  | "weather_code";

export const WX_VARS: readonly WxVar[] = [
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "temperature_2m",
  "pressure_msl",
  "precipitation",
  "cloud_cover",
  "weather_code",
] as const;

/**
 * What each column is measured in. Stored IN the pack, not assumed from code.
 *
 * `tideFetch.ts` finding 5 is the reason: CO-OPS serves a full, plausible,
 * well-formed prediction set at a datum you did not ask for and nothing in the
 * response says which one you got. Open-Meteo has the same property — ask for
 * metric and get a well-formed 4 m/s where you expected 9 mph. A unit carried
 * beside the number is the only thing that makes the number mean anything, and a
 * reader that assumed units from a code constant would silently misread every
 * pack written before someone changed the constant.
 */
export interface WxUnits {
  readonly wind: string;
  readonly temp: string;
  readonly pressure: string;
  readonly precip: string;
}

/**
 * A packed point forecast: parallel integer columns over a uniform hourly grid.
 *
 * MEASURED 2026-08-01 at 38.4436,-76.0722 (Blackwater NWR): 168 hours × 8 vars,
 * 5,342 bytes of JSON, 1,910 gzipped, against a 2,649-byte budget. Raw
 * Open-Meteo JSON for the same request is 9,876 bytes / 2,477 gzipped.
 *
 * Values are INTEGERS, scaled by `scale[v]` — no float noise, no
 * `7.300000000000001`, and a column of small integers is something DEFLATE eats
 * alive. A `null` in a column is an HONESTLY MISSING HOUR and stays null all the
 * way to the reader, which refuses it. It is never a zero: 0 mph is a dead calm
 * and 0.00 in is a dry hour, and both are perfectly ordinary readings, which is
 * exactly what would make the substitution invisible.
 */
export interface WxPack {
  readonly packVersion: 1;
  readonly kind: "forecast";
  readonly source: "Open-Meteo";
  readonly timeFrame: "utc";
  /** Show this. Verbatim. */
  readonly disclaimer: string;
  readonly lat: number;
  readonly lng: number;
  readonly fetchedAt: string;
  /** ISO instant of column index 0. */
  readonly startUTC: string;
  readonly stepMinutes: number;
  readonly units: WxUnits;
  /** Divisor to turn a stored integer back into a real value. */
  readonly scale: Readonly<Record<string, number>>;
  readonly cols: Readonly<Record<string, readonly (number | null)[]>>;
}

/**
 * The sentence every weather surface must be able to show.
 *
 * A forecast is not a measurement. This is the same distinction `tide.ts` draws
 * between a harmonic prediction and a gauge reading, and it matters more here
 * because a wind forecast at hour 140 is a very different object from a wind
 * forecast at hour 2, and nothing in the number says which one you are looking
 * at. The age is printed beside it for the same reason.
 */
export const WX_DISCLAIMER =
  "Open-Meteo model FORECAST, not an observed reading. It was downloaded at the " +
  "time shown and has not been checked since. Wind at a blind is local; treat " +
  "this as the shape of the day, not the reading at your feet.";

/** One hour of weather, every field a real number. No nulls, by construction. */
export interface WxReading {
  readonly at: Date;
  readonly windMph: number;
  readonly windFromDeg: number;
  readonly gustMph: number;
  readonly tempF: number;
  readonly pressureHpa: number;
  readonly precipIn: number;
  readonly cloudPct: number;
  readonly weatherCode: number;
  readonly units: WxUnits;
  /** True when the instant asked about fell between two hourly columns. */
  readonly snappedToHour: boolean;
}

/** One variable at one hour. */
export interface WxSample {
  readonly at: Date;
  readonly variable: WxVar;
  readonly value: number;
  readonly unit: string;
  readonly snappedToHour: boolean;
}

function isWxVar(value: unknown): value is WxVar {
  return typeof value === "string" && (WX_VARS as readonly string[]).includes(value);
}

/** PURE. Validate a `WxPack` payload out of storage. */
export function parseWxPack(raw: unknown): PackResult<WxPack> {
  if (raw === null || typeof raw !== "object") {
    return packRefuse("damaged", "wx", "The saved weather is damaged, so none is shown.");
  }
  const p = raw as Record<string, unknown>;

  if (finiteNumber(p.packVersion) !== 1) {
    return packRefuse(
      "version-mismatch",
      "wx",
      "The saved weather was written by a different version of the app, so none is shown.",
      `packVersion ${String(p.packVersion)}`,
    );
  }
  if (p.source !== "Open-Meteo" || p.kind !== "forecast" || p.timeFrame !== "utc") {
    return packRefuse("damaged", "wx", "The saved weather does not say where it came from.");
  }

  const lat = finiteNumber(p.lat);
  const lng = finiteNumber(p.lng);
  if (lat === null || lng === null) {
    return packRefuse("damaged", "wx", "The saved weather has no coordinate on it.");
  }

  const fetchedAt = isoInstant(p.fetchedAt);
  if (fetchedAt === null) {
    return packRefuse(
      "damaged",
      "wx",
      "The saved weather does not say when it was downloaded, so none is shown. A " +
        "forecast with no age is a forecast you cannot judge.",
    );
  }

  const startMs = Date.parse(nonEmptyString(p.startUTC) ?? "");
  if (!Number.isFinite(startMs)) {
    return packRefuse("damaged", "wx", "The saved weather has no valid start time.");
  }

  const stepMinutes = finiteNumber(p.stepMinutes);
  if (stepMinutes === null || stepMinutes <= 0) {
    return packRefuse("damaged", "wx", "The saved weather does not say how far apart its hours are.");
  }

  const u = p.units;
  if (u === null || typeof u !== "object") {
    return packRefuse("damaged", "wx", "The saved weather has no units on it, so none is shown.");
  }
  const units = u as Record<string, unknown>;
  const wind = nonEmptyString(units.wind);
  const temp = nonEmptyString(units.temp);
  const pressure = nonEmptyString(units.pressure);
  const precip = nonEmptyString(units.precip);
  if (wind === null || temp === null || pressure === null || precip === null) {
    // A number with no unit is not a reading. See the `WxUnits` note.
    return packRefuse(
      "damaged",
      "wx",
      "The saved weather is missing its units, so none is shown. A wind speed with no " +
        "unit is a number, not a reading.",
    );
  }

  const scaleRaw = p.scale;
  const colsRaw = p.cols;
  if (
    scaleRaw === null ||
    typeof scaleRaw !== "object" ||
    colsRaw === null ||
    typeof colsRaw !== "object"
  ) {
    return packRefuse("damaged", "wx", "The saved weather has no readings in it.");
  }
  const scaleObj = scaleRaw as Record<string, unknown>;
  const colsObj = colsRaw as Record<string, unknown>;

  const scale: Record<string, number> = {};
  const cols: Record<string, readonly (number | null)[]> = {};
  let length: number | null = null;

  for (const v of WX_VARS) {
    const s = finiteNumber(scaleObj[v]);
    if (s === null || s <= 0) {
      return packRefuse(
        "damaged",
        "wx",
        "The saved weather does not say how one of its readings is scaled, so none is shown.",
        `scale.${v} = ${String(scaleObj[v])}`,
      );
    }
    const col = colsObj[v];
    if (!Array.isArray(col)) {
      return packRefuse("damaged", "wx", "The saved weather is missing a reading column.", v);
    }
    if (length === null) length = col.length;
    else if (col.length !== length) {
      // Parallel columns of different lengths hand back `undefined` heights,
      // which is the `?? 0` bug arriving through the cache instead of the wire.
      return packRefuse(
        "damaged",
        "wx",
        "The saved weather is damaged — its hours and readings do not line up — so none is shown.",
        `${v} has ${col.length}, expected ${length}`,
      );
    }
    const clean: (number | null)[] = new Array(col.length);
    for (let i = 0; i < col.length; i++) {
      const raw = col[i];
      if (raw === null) {
        // An honestly missing hour. Preserved, never substituted.
        clean[i] = null;
        continue;
      }
      const n = finiteNumber(raw);
      if (n === null) {
        return packRefuse(
          "unparsable-value",
          "wx",
          "A saved weather reading could not be read, so none is shown. A missing " +
            "reading is not a calm morning.",
          `${v}[${i}] = ${JSON.stringify(raw)}`,
        );
      }
      clean[i] = n;
    }
    scale[v] = s;
    cols[v] = clean;
  }

  if (length === null || length === 0) {
    return packRefuse("no-data", "wx", "The saved weather has no hours in it.");
  }

  return packOk({
    packVersion: 1,
    kind: "forecast",
    source: "Open-Meteo",
    timeFrame: "utc",
    disclaimer: nonEmptyString(p.disclaimer) ?? WX_DISCLAIMER,
    lat,
    lng,
    fetchedAt,
    startUTC: new Date(startMs).toISOString(),
    stepMinutes,
    units: { wind, temp, pressure, precip },
    scale,
    cols,
  });
}

/** PURE. The packed forecast for this spot. */
export function readWxPack(
  pocket: PocketPack,
  opts: PackReadOptions = {},
): PackResult<PackRead<WxPack>> {
  const sel = selectShard(pocket, "wx", opts);
  if (sel.status !== "ok") return sel;
  const parsed = parseWxPack(sel.value.data);
  if (parsed.status !== "ok") return parsed;
  return packOk({ ...sel.value, data: parsed.value });
}

/**
 * Index of the hourly column covering `ms`, or a refusal.
 *
 * SNAPS TO THE NEAREST HOUR, and says so in `snappedToHour`. It does NOT
 * interpolate: hourly wind is not linear between samples, and an interpolated
 * gust is an invented gust wearing a decimal point. It refuses past either end
 * rather than extrapolating, same rule `tideAt` follows.
 */
function hourIndex(pack: WxPack, ms: number): PackResult<{ i: number; snapped: boolean }> {
  const startMs = Date.parse(pack.startUTC);
  const stepMs = pack.stepMinutes * MS_PER_MINUTE;
  const n = pack.cols[WX_VARS[0]].length;
  const endMs = startMs + (n - 1) * stepMs;

  if (ms < startMs - stepMs / 2 || ms > endMs + stepMs / 2) {
    return packRefuse(
      "out-of-range",
      "wx",
      "That hour is outside the forecast saved on this phone, so no weather is shown.",
      `${new Date(ms).toISOString()} not in ${pack.startUTC}…${new Date(endMs).toISOString()}`,
    );
  }

  const raw = (ms - startMs) / stepMs;
  const i = Math.min(n - 1, Math.max(0, Math.round(raw)));
  return packOk({ i, snapped: Math.abs(raw - i) > 1e-9 });
}

function columnValue(pack: WxPack, v: WxVar, i: number): PackResult<number> {
  const raw = pack.cols[v][i];
  if (raw === null || raw === undefined) {
    // THE LAW. The forecast simply has no value for this hour. It is not a zero.
    return packRefuse(
      "unparsable-value",
      "wx",
      "The forecast has no reading for that hour, so none is shown. A missing " +
        "reading is not a calm morning.",
      `${v}[${i}]`,
    );
  }
  const scaled = raw / pack.scale[v];
  if (!Number.isFinite(scaled)) {
    return packRefuse("unparsable-value", "wx", "A forecast reading could not be read.", `${v}[${i}]`);
  }
  return packOk(scaled);
}

const UNIT_FOR: Readonly<Record<WxVar, keyof WxUnits | null>> = {
  wind_speed_10m: "wind",
  wind_direction_10m: null,
  wind_gusts_10m: "wind",
  temperature_2m: "temp",
  pressure_msl: "pressure",
  precipitation: "precip",
  cloud_cover: null,
  weather_code: null,
};

const BARE_UNIT: Readonly<Record<WxVar, string>> = {
  wind_speed_10m: "",
  wind_direction_10m: "°",
  wind_gusts_10m: "",
  temperature_2m: "",
  pressure_msl: "",
  precipitation: "",
  cloud_cover: "%",
  weather_code: "WMO code",
};

/**
 * PURE. ONE variable at one instant.
 *
 * The narrow reader, and the one to use when a rail needs wind and does not care
 * that the cloud column has a hole in it. `readWxAt` refuses the whole hour if
 * ANY of the eight is missing, which is right for a full instrument panel and
 * wrong for a wind arrow.
 */
export function readWxVarAt(
  pocket: PocketPack,
  variable: WxVar,
  instant: Date,
  opts: PackReadOptions = {},
): PackResult<PackRead<WxSample>> {
  if (!isWxVar(variable)) {
    return packRefuse("bad-request", "wx", "That is not a weather reading this app stores.");
  }
  const ms = instantMs(instant);
  if (!Number.isFinite(ms)) {
    return packRefuse("bad-request", "wx", "No valid time was given, so no weather is shown.");
  }

  const read = readWxPack(pocket, opts);
  if (read.status !== "ok") return read;
  const pack = read.value.data;

  const idx = hourIndex(pack, ms);
  if (idx.status !== "ok") return idx;

  const value = columnValue(pack, variable, idx.value.i);
  if (value.status !== "ok") return value;

  const unitKey = UNIT_FOR[variable];
  const startMs = Date.parse(pack.startUTC);
  return packOk({
    ...read.value,
    data: {
      at: new Date(startMs + idx.value.i * pack.stepMinutes * MS_PER_MINUTE),
      variable,
      value: value.value,
      unit: unitKey === null ? BARE_UNIT[variable] : pack.units[unitKey],
      snappedToHour: idx.value.snapped,
    },
  });
}

/**
 * PURE. All eight variables at one instant.
 *
 * REFUSES the whole hour if any one of the eight is missing, naming which. That
 * is stricter than it needs to be for most rails and it is the right default:
 * this returns a struct of plain `number`s with no optionals anywhere, so no
 * caller can render an absent gust as a zero. A caller that only needs one
 * variable asks for that one with `readWxVarAt` and is not blocked by a hole in
 * a column it never reads.
 */
export function readWxAt(
  pocket: PocketPack,
  instant: Date,
  opts: PackReadOptions = {},
): PackResult<PackRead<WxReading>> {
  const ms = instantMs(instant);
  if (!Number.isFinite(ms)) {
    return packRefuse("bad-request", "wx", "No valid time was given, so no weather is shown.");
  }

  const read = readWxPack(pocket, opts);
  if (read.status !== "ok") return read;
  const pack = read.value.data;

  const idx = hourIndex(pack, ms);
  if (idx.status !== "ok") return idx;
  const i = idx.value.i;

  const values: number[] = [];
  for (const v of WX_VARS) {
    const got = columnValue(pack, v, i);
    if (got.status !== "ok") return got;
    values.push(got.value);
  }

  const startMs = Date.parse(pack.startUTC);
  return packOk({
    ...read.value,
    data: {
      at: new Date(startMs + i * pack.stepMinutes * MS_PER_MINUTE),
      windMph: values[0],
      windFromDeg: values[1],
      gustMph: values[2],
      tempF: values[3],
      pressureHpa: values[4],
      precipIn: values[5],
      cloudPct: values[6],
      weatherCode: values[7],
      units: pack.units,
      snappedToHour: idx.value.snapped,
    },
  });
}

/* ═══════════════════════════ THE PACK MANIFEST ═══════════════════════════ */

/** One row of "what is on this phone". */
export interface PackManifestRow {
  readonly shard: PackAnyShardName;
  readonly label: string;
  readonly stored: boolean;
  /** True when the shard is on this device, or when it never needed to be. */
  readonly present: boolean;
  /** Null for shards that are not stored, and for shards that are missing. */
  readonly freshness: Freshness | null;
  /** A sentence to show. Either the shard's `why`, or the refusal's message. */
  readonly note: string;
}

/**
 * PURE. What this phone actually has, shard by shard, with ages.
 *
 * This is the honest status surface for "PACK THE TRUCK": it lists all four
 * rows, including the two that are never stored, so a hunter reading it sees the
 * whole architecture rather than a suspicious two-item list. `sky` and `season`
 * report `present: true` because they genuinely are present — they are compiled
 * into the app he is looking at.
 */
export function packManifest(
  pocket: PocketPack,
  opts: PackReadOptions = {},
): readonly PackManifestRow[] {
  return PACK_SHARDS.map((spec) => {
    if (!spec.stored) {
      return {
        shard: spec.shard,
        label: spec.label,
        stored: false,
        present: true,
        freshness: null,
        note: spec.why,
      };
    }
    const sel = selectShard(pocket, spec.shard as PackShardName, opts);
    if (sel.status !== "ok") {
      return {
        shard: spec.shard,
        label: spec.label,
        stored: true,
        present: false,
        freshness: null,
        note: sel.message,
      };
    }
    return {
      shard: spec.shard,
      label: spec.label,
      stored: true,
      present: true,
      freshness: sel.value.freshness,
      note: spec.why,
    };
  });
}

/**
 * PURE. Is this pack good enough to hunt on?
 *
 * Deliberately NOT a score. It answers one yes/no — is every STORED shard on the
 * device — and hands back the list of what is missing so the surface names them.
 * A pack that is 50% complete is not "half ready"; it is missing the tide, or it
 * is missing the wind, and those are different mornings.
 */
export function packReadiness(
  pocket: PocketPack,
  opts: PackReadOptions = {},
): { readonly ready: boolean; readonly missing: readonly PackManifestRow[] } {
  const rows = packManifest(pocket, opts);
  const missing = rows.filter((r) => r.stored && !r.present);
  return { ready: missing.length === 0, missing };
}

/** PURE. An empty pocket for a scope — what a device with nothing packed has. */
export function emptyPocket(scope: string, readAt: string): PocketPack {
  return { scope, readAt, records: [], damaged: [] };
}
