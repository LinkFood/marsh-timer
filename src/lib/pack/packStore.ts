/**
 * packStore.ts — where the pack survives a reboot.
 *
 * IndexedDB, hand-rolled, no Dexie and no `idb`. The whole wrapper is below and
 * it is short enough to read in one sitting, which is the argument for not
 * carrying a library to do it: this store has one object store, one index, three
 * operations and a version number, and a dependency would be more code than the
 * thing it replaces plus a supply chain.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THIS FILE IS ON THE OFFLINE SIDE OF THE LINE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * It does I/O, but not NETWORK I/O, and those are different things. Reading
 * IndexedDB at a boat ramp works; reading a socket does not. `eslint.config.js`
 * covers `src/lib/pack/**` with the offline glob and exempts only
 * `packFetch.ts`, so this file cannot acquire a `fetch` without the linter
 * failing.
 *
 *      packFetch.ts  ──imports──▶  packStore.ts  ──imports──▶  readPack.ts
 *      packStore.ts  ──imports──▶  NOTHING from packFetch.ts. Ever.
 *
 * The one thing this file is allowed to be that `readPack.ts` is not is ASYNC.
 * IndexedDB has no synchronous API and never will. That is why the split is
 * three files rather than two: the store does ONE await at mount and hands back
 * a materialized `PocketPack`, and every reader in `readPack.ts` is then
 * synchronous over it. A field rail awaits once and never again — the difference
 * between a rail that renders and a rail that shows a spinner while legal light
 * comes and goes.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE BACKEND SEAM, AND WHY IT IS NOT A TESTING CONVENIENCE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `PackBackend` has two implementations: IndexedDB, and memory. That is not an
 * abstraction laid down for elegance — it is the honest shape of the problem.
 * MEASURED: jsdom 20, which is what `vitest.config.ts` runs the suite in, has NO
 * `indexedDB` and no `navigator.storage` at all (both `undefined`). Safari
 * private mode throws on `indexedDB.open`. iOS evicts the whole database after
 * ~7 days of not visiting unless storage is persisted. A store that assumes
 * IndexedDB exists is a store that throws on three real platforms.
 *
 * So the absence of a database is a FIRST-CLASS ANSWER — `storage-unavailable`,
 * with a sentence — rather than an exception, and the memory backend is the
 * degraded mode as much as it is the test seam.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT IS NOT IN HERE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * No migrations framework, no query language, no observers. `PACK_DB_VERSION`
 * bumps, `onupgradeneeded` drops and recreates, and every record carries a
 * `recordVersion` that `parsePackRecord` REFUSES rather than reinterprets. A
 * pack is a cache of things that can be downloaded again in ninety seconds on
 * wifi; the correct migration for a schema change is to throw it away and pack
 * the truck again, and the correct thing to do with a record we half understand
 * is nothing at all.
 */

import {
  emptyPocket,
  packKey,
  packOk,
  packRefuse,
  parsePackRecord,
  PACK_RECORD_VERSION,
  type DamagedRecord,
  type PackResult,
  type PackShardName,
  type PackShardRecord,
  type PocketPack,
} from "./readPack";

/* ───────────────────────────── constants ───────────────────────────── */

export const PACK_DB_NAME = "dcd-pack";

/**
 * Bumping this DROPS AND RECREATES the store. See the header — a pack is a
 * cache, and re-downloading it is ninety seconds on wifi.
 */
export const PACK_DB_VERSION = 1;

export const PACK_STORE_NAME = "shards";

/** Index on `scope`, so one spot's shards come back in a single range query. */
const SCOPE_INDEX = "by-scope";

/**
 * Deadline on any single IndexedDB operation.
 *
 * NOT DECORATION. `indexedDB.open` fires neither `onsuccess` nor `onerror` when
 * another tab holds an older version open — it fires `onblocked` and then waits
 * forever. Safari in private mode has historically hung rather than thrown. A
 * store with no deadline turns both of those into the exact failure this whole
 * product exists to prevent: a spinner at 05:15 that never resolves.
 */
const DEFAULT_OP_TIMEOUT_MS = 5_000;

/* ────────────────────────── scopes and slots ────────────────────────── */

/**
 * The scope for a tide shard: the NOAA station, not the spot.
 *
 * Tide predictions belong to a station and several spots can share one. Keying
 * them by spot would download and store the same 475 events once per blind, and
 * — worse — would let two spots on the same creek hold two copies that disagree
 * because they were fetched on different days.
 */
export function stationScope(stationId: string): string {
  return `station:${stationId}`;
}

/**
 * The scope for a weather shard: the spot, to four decimal places (~11 m).
 *
 * DERIVED FROM THE COORDINATE RATHER THAN FROM A SPOT ID because `Spot` in
 * `src/lib/spot.ts` has no id field — it is a single frozen record in
 * `localStorage` keyed by nothing. Deriving the scope means this store needs no
 * change to `spot.ts` (which is not mine to change) and stays correct when
 * multiple saved spots land in October: two blinds 11 m apart share a forecast,
 * which is true, and two blinds a mile apart do not, which is also true.
 *
 * Four decimals, not full precision, so a re-saved spot whose GPS jittered in
 * the ninth decimal reads its own pack instead of silently missing it.
 */
export function spotScope(lat: number, lng: number): PackResult<string> {
  if (typeof lat !== "number" || typeof lng !== "number") {
    return packRefuse("bad-request", null, "That spot has no coordinate, so nothing can be packed.");
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return packRefuse("bad-request", null, "That spot has no coordinate, so nothing can be packed.");
  }
  return packOk(`spot:${lat.toFixed(4)},${lng.toFixed(4)}`);
}

/**
 * The slot for a tide shard: the SEASON, named by the year it opens in.
 *
 * A duck season straddles New Year, so `2026-2027` rather than a calendar year.
 * Anything from August onward belongs to the season opening that year; January
 * belongs to the season that opened the previous year. Getting this wrong on
 * January 3rd would look for a `2027-2028` pack that nobody has downloaded and
 * refuse a pack sitting right there on the disk.
 */
export function seasonSlot(date: Date): string {
  const y = date.getUTCFullYear();
  // Aug 1 is the boundary: the pack window is Oct 1 → Jan 31, and August is when
  // a hunter starts packing for it.
  const openYear = date.getUTCMonth() >= 7 ? y : y - 1;
  return `${openYear}-${openYear + 1}`;
}

/** The slot for a weather shard: the UTC date it was downloaded on. */
export function wxSlot(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * PURE. Build a record ready to store. The only constructor — nothing else in
 * the codebase assembles this shape by hand, so `recordVersion` and `fetchedAt`
 * cannot be forgotten on one write path and present on another.
 */
export function buildShardRecord(args: {
  readonly scope: string;
  readonly shard: PackShardName;
  readonly slot: string;
  readonly fetchedAt: string;
  readonly payload: unknown;
}): PackResult<PackShardRecord> {
  const key = packKey(args.scope, args.shard, args.slot);
  if (key.status !== "ok") return key;

  // `fetchedAt` is the age the whole product is built on. A record without one
  // is refused at write time, not discovered at read time in a marsh.
  if (typeof args.fetchedAt !== "string" || !Number.isFinite(Date.parse(args.fetchedAt))) {
    return packRefuse(
      "bad-request",
      args.shard,
      "That download has no timestamp on it, so it is not saved. A reading with no " +
        "age is a reading you cannot judge.",
    );
  }
  if (args.payload === null || args.payload === undefined) {
    return packRefuse("bad-request", args.shard, "There is nothing to save for that shard.");
  }

  return packOk({
    key: key.value,
    recordVersion: PACK_RECORD_VERSION,
    scope: args.scope,
    shard: args.shard,
    slot: args.slot,
    fetchedAt: args.fetchedAt,
    payload: args.payload,
  });
}

/* ────────────────────────────── the backend ────────────────────────────── */

/**
 * The four operations a pack needs. Anything wider than this is a query language
 * we do not have a use for.
 *
 * Every method resolves rather than rejects: a backend that throws forces every
 * call site to remember a try/catch, and the one that forgets is the one that
 * white-screens the field page. Failures come back as refusals.
 */
export interface PackBackend {
  readonly kind: "indexeddb" | "memory";
  readAll(scope: string): Promise<PackResult<readonly unknown[]>>;
  write(record: PackShardRecord): Promise<PackResult<PackShardRecord>>;
  removeScope(scope: string): Promise<PackResult<number>>;
  close(): void;
}

/**
 * The memory backend.
 *
 * The degraded mode when a browser will not give us a database — and the seam
 * the offline gate test runs through, since jsdom has no IndexedDB. It is a Map
 * with the same contract, so anything proved against it about the READ path is
 * proved about the read path, full stop; what it cannot prove is that the bytes
 * survive a reboot, which is what the real-browser check is for.
 */
export function memoryPackBackend(seed: readonly PackShardRecord[] = []): PackBackend {
  const rows = new Map<string, PackShardRecord>();
  for (const r of seed) rows.set(r.key, r);

  return {
    kind: "memory",
    readAll(scope) {
      const out: unknown[] = [];
      for (const r of rows.values()) if (r.scope === scope) out.push(r);
      return Promise.resolve(packOk(out));
    },
    write(record) {
      rows.set(record.key, record);
      return Promise.resolve(packOk(record));
    },
    removeScope(scope) {
      let n = 0;
      for (const [k, r] of rows) {
        if (r.scope === scope) {
          rows.delete(k);
          n++;
        }
      }
      return Promise.resolve(packOk(n));
    },
    close() {
      /* nothing to release */
    },
  };
}

/** Wrap one IDB request with a deadline. See `DEFAULT_OP_TIMEOUT_MS`. */
function idbRequest<T>(req: IDBRequest<T>, timeoutMs: number): Promise<PackResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(
        packRefuse(
          "storage-error",
          null,
          "This phone's storage did not answer, so the saved pack could not be read.",
          `${timeoutMs} ms`,
        ),
      );
    }, timeoutMs);

    req.onsuccess = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(packOk(req.result));
    };
    req.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(
        packRefuse(
          "storage-error",
          null,
          "This phone's storage refused the pack.",
          req.error?.message ?? "unknown",
        ),
      );
    };
  });
}

/**
 * The IndexedDB backend, or `null` when this browser has no IndexedDB.
 *
 * Returns `null` rather than throwing so `openPackStore` can turn the absence
 * into a refusal with a sentence a hunter can read.
 */
export function indexedDbPackBackend(
  factory?: IDBFactory,
  timeoutMs: number = DEFAULT_OP_TIMEOUT_MS,
): PackBackend | null {
  let idb: IDBFactory | undefined;
  try {
    idb = factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  } catch {
    // Safari private mode throws on the property access itself.
    return null;
  }
  if (!idb || typeof idb.open !== "function") return null;

  let dbPromise: Promise<PackResult<IDBDatabase>> | null = null;

  const open = (): Promise<PackResult<IDBDatabase>> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<PackResult<IDBDatabase>>((resolve) => {
      let req: IDBOpenDBRequest;
      try {
        req = idb.open(PACK_DB_NAME, PACK_DB_VERSION);
      } catch (e) {
        resolve(
          packRefuse(
            "storage-unavailable",
            null,
            "This browser will not let the app store anything, so nothing can be packed " +
              "for the field. Private browsing blocks it.",
            e instanceof Error ? e.message : String(e),
          ),
        );
        return;
      }

      let settled = false;
      const finish = (r: PackResult<IDBDatabase>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(r);
      };
      const timer = setTimeout(
        () =>
          finish(
            packRefuse(
              "storage-error",
              null,
              "This phone's storage did not open. Another tab of this app may be holding " +
                "an older version of it — close the others and try again.",
              `${timeoutMs} ms`,
            ),
          ),
        timeoutMs,
      );

      req.onupgradeneeded = () => {
        const db = req.result;
        // Drop and recreate. A pack is a cache; see the header.
        if (db.objectStoreNames.contains(PACK_STORE_NAME)) {
          db.deleteObjectStore(PACK_STORE_NAME);
        }
        const store = db.createObjectStore(PACK_STORE_NAME, { keyPath: "key" });
        store.createIndex(SCOPE_INDEX, "scope", { unique: false });
      };
      req.onsuccess = () => finish(packOk(req.result));
      req.onerror = () =>
        finish(
          packRefuse(
            "storage-unavailable",
            null,
            "This browser will not let the app store anything, so nothing can be packed " +
              "for the field. Private browsing blocks it.",
            req.error?.message ?? "unknown",
          ),
        );
      req.onblocked = () =>
        finish(
          packRefuse(
            "storage-error",
            null,
            "Another tab of this app is holding the storage open. Close the other tabs " +
              "and try again.",
          ),
        );
    });
    return dbPromise;
  };

  const withStore = async <T,>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<PackResult<T>>,
  ): Promise<PackResult<T>> => {
    const db = await open();
    if (db.status !== "ok") return db;
    try {
      const tx = db.value.transaction(PACK_STORE_NAME, mode);
      return await run(tx.objectStore(PACK_STORE_NAME));
    } catch (e) {
      return packRefuse(
        "storage-error",
        null,
        "This phone's storage could not be read, so no saved pack is shown.",
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  return {
    kind: "indexeddb",
    readAll(scope) {
      return withStore<readonly unknown[]>("readonly", async (store) => {
        const got = await idbRequest(store.index(SCOPE_INDEX).getAll(scope), timeoutMs);
        if (got.status !== "ok") return got;
        return packOk(Array.isArray(got.value) ? (got.value as unknown[]) : []);
      });
    },
    write(record) {
      return withStore<PackShardRecord>("readwrite", async (store) => {
        const put = await idbRequest(store.put(record), timeoutMs);
        if (put.status !== "ok") return put;
        return packOk(record);
      });
    },
    removeScope(scope) {
      return withStore<number>("readwrite", async (store) => {
        const keys = await idbRequest(store.index(SCOPE_INDEX).getAllKeys(scope), timeoutMs);
        if (keys.status !== "ok") return keys;
        const list = Array.isArray(keys.value) ? keys.value : [];
        for (const k of list) {
          const del = await idbRequest(store.delete(k as IDBValidKey), timeoutMs);
          if (del.status !== "ok") return del;
        }
        return packOk(list.length);
      });
    },
    close() {
      if (!dbPromise) return;
      void dbPromise.then((r) => {
        if (r.status === "ok") r.value.close();
      });
      dbPromise = null;
    },
  };
}

/* ────────────────────────────── the store ────────────────────────────── */

export interface PackStore {
  /** Which backend actually answered. Surface it — "memory" means nothing survives a reboot. */
  readonly backend: "indexeddb" | "memory";
  /** Read every shard for a scope into memory. ONE trip; the readers are sync after this. */
  load(scope: string): Promise<PackResult<PocketPack>>;
  save(record: PackShardRecord): Promise<PackResult<PackShardRecord>>;
  /** Throw away everything for a scope. Returns how many records went. */
  clear(scope: string): Promise<PackResult<number>>;
  close(): void;
}

export interface OpenPackStoreOptions {
  /** Inject a backend. The offline gate test passes `memoryPackBackend()`. */
  readonly backend?: PackBackend;
  /** Inject an `IDBFactory`. */
  readonly indexedDB?: IDBFactory;
  /** Clock injection. Stamps `PocketPack.readAt`. */
  readonly now?: () => Date;
  /**
   * Fall back to an in-memory store when this browser has no IndexedDB, instead
   * of refusing. DEFAULT FALSE, deliberately: a store that silently degrades to
   * memory tells a hunter he packed the truck and then loses it on the drive
   * out. He is entitled to find that out in the driveway.
   */
  readonly allowMemoryFallback?: boolean;
}

/**
 * Open the store. The one entry point.
 *
 * REFUSES when the browser has no IndexedDB rather than quietly degrading. See
 * `allowMemoryFallback` — the refusal is the feature.
 */
export function openPackStore(opts: OpenPackStoreOptions = {}): PackResult<PackStore> {
  const backend =
    opts.backend ??
    indexedDbPackBackend(opts.indexedDB) ??
    (opts.allowMemoryFallback === true ? memoryPackBackend() : null);

  if (backend === null) {
    return packRefuse(
      "storage-unavailable",
      null,
      "This browser will not let the app save anything, so the pack cannot be kept for " +
        "the field. Private browsing blocks it — open the app in a normal window, or add " +
        "it to your home screen.",
    );
  }

  const now = opts.now ?? (() => new Date());

  return packOk({
    backend: backend.kind,

    async load(scope: string): Promise<PackResult<PocketPack>> {
      const readAt = now().toISOString();
      if (typeof scope !== "string" || scope.trim() === "") {
        return packRefuse("bad-request", null, "No spot was given, so no pack was read.");
      }

      const raw = await backend.readAll(scope);
      if (raw.status !== "ok") return raw;

      // A record that fails validation is DAMAGED, not absent, and the two make
      // different sentences downstream — "pack the truck again" versus "you
      // never packed the truck". `selectShard` in readPack.ts reads this list.
      const records: PackShardRecord[] = [];
      const damaged: DamagedRecord[] = [];
      for (const row of raw.value) {
        const parsed = parsePackRecord(row);
        if (parsed.status === "ok") {
          records.push(parsed.value);
        } else {
          damaged.push({
            key:
              row !== null && typeof row === "object" && typeof (row as { key?: unknown }).key === "string"
                ? (row as { key: string }).key
                : "(unkeyed)",
            reason: parsed.reason,
            message: parsed.message,
          });
        }
      }

      // An empty result is OK, not a refusal. "Nothing is packed" is discovered
      // per shard by the readers, each of which names the shard it wanted.
      // Refusing the whole load here would collapse four different answers into
      // one and cost the hunter the only information he can act on.
      if (records.length === 0 && damaged.length === 0) {
        return packOk(emptyPocket(scope, readAt));
      }

      return packOk({ scope, readAt, records, damaged });
    },

    save(record: PackShardRecord): Promise<PackResult<PackShardRecord>> {
      const check = parsePackRecord(record);
      if (check.status !== "ok") return Promise.resolve(check);
      return backend.write(check.value);
    },

    clear(scope: string): Promise<PackResult<number>> {
      return backend.removeScope(scope);
    },

    close(): void {
      backend.close();
    },
  });
}

/* ──────────────────────────── the field pocket ──────────────────────────── */

/**
 * Everything one blind needs, read in ONE pass, in TWO scopes.
 *
 * TWO POCKETS AND NOT ONE, BECAUSE THERE ARE GENUINELY TWO SCOPES. Tide belongs
 * to a NOAA station and several blinds can share it; weather belongs to a
 * coordinate and two blinds a mile apart do not share it. Flattening them into
 * one bag would mean stamping the tide record with a spot it does not belong to,
 * and the first time a hunter saved a second blind on the same creek the app
 * would either re-download the same 475 events or quietly show him the other
 * marsh's water. The seam is real, so it is visible in the type.
 */
export interface FieldPocket {
  /** Station-scoped. Feed this to `readTideEvents` / `readTideEventsBetween`. */
  readonly tide: PocketPack;
  /** Spot-scoped. Feed this to `readWxAt` / `readWxVarAt`. */
  readonly wx: PocketPack;
}

/** The spot to read for. Structurally a subset of `Spot` in `src/lib/spot.ts`. */
export interface FieldPocketTarget {
  readonly lat: number;
  readonly lng: number;
  readonly coops_station_id: string | null;
}

/**
 * Read both scopes. THE ONE AWAIT a field surface performs at mount.
 *
 * A spot with no bound station is a real and supported state, not an error — the
 * tide pocket comes back EMPTY rather than refused, so `readTideEvents` produces
 * its own `not-packed` refusal naming the tide, which is the sentence the rail
 * should render. Refusing the whole load here would take the weather down with
 * it for a reason that has nothing to do with the weather.
 */
export async function loadFieldPocket(
  store: PackStore,
  target: FieldPocketTarget,
  now: () => Date = () => new Date(),
): Promise<PackResult<FieldPocket>> {
  const spot = spotScope(target?.lat as number, target?.lng as number);
  if (spot.status !== "ok") return spot;

  const wx = await store.load(spot.value);
  if (wx.status !== "ok") return wx;

  if (target.coops_station_id === null) {
    return packOk({
      tide: emptyPocket("station:(none)", now().toISOString()),
      wx: wx.value,
    });
  }

  const tide = await store.load(stationScope(target.coops_station_id));
  if (tide.status !== "ok") return tide;

  return packOk({ tide: tide.value, wx: wx.value });
}
