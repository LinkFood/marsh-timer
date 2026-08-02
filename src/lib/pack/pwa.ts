/**
 * pwa.ts — is this phone actually going to keep the pack?
 *
 * Three questions a field app has no right to guess the answer to:
 *
 *   1. Is the storage DURABLE, or is the browser free to throw it away?
 *   2. Did the offline shell actually install, and did all of it install?
 *   3. Is this running as an installed app or as a tab?
 *
 * All three are booleans the platform will tell us if we ask, and all three are
 * surfaced rather than assumed. A "PACK THE TRUCK" button that reports success
 * while the browser is quietly planning to evict the database in seven days is
 * lying to a man who is about to drive two hours in the dark.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY `navigator.storage.persist()` IS LOAD-BEARING AND NOT A NICETY.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * iOS/WebKit EVICTS ALL SITE DATA — IndexedDB included — after roughly SEVEN
 * DAYS without a visit. A hunter who packs the truck on the 1st and hunts on the
 * 12th opens an empty database. HOME-SCREEN-INSTALLED WEB APPS ARE EXEMPT from
 * that sweep.
 *
 * That single fact is what turns the install prompt from decoration into the
 * mechanism, and it is why this module returns a SENTENCE with every boolean
 * rather than just the boolean: when persistence is denied, the correct thing to
 * tell the hunter is not "storage not persisted" — it is "add this to your home
 * screen or the phone may throw your pack away."
 *
 * Note that `persist()` is not a promise from the browser that it will comply.
 * Chrome grants it silently on engagement heuristics; Firefox may prompt; Safari
 * resolves `false` and relies on the home-screen exemption instead. So the
 * boolean is REPORTED, never asserted — and never cached, because it can change
 * after an install.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THIS FILE IS ON THE OFFLINE SIDE OF THE LINE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * It reads `navigator.storage`, `navigator.serviceWorker` and the Cache API. It
 * does not call `fetch`, and `eslint.config.js` covers `src/lib/pack/**` so it
 * cannot start. Registering a service worker downloads a script, but that is the
 * browser's request against its own update policy, not a data read this app
 * depends on — and it is a no-op offline, where the already-installed worker
 * keeps serving.
 */

import { packOk, packRefuse, type PackResult } from "./readPack";

/** Where `sw.js` writes what it could not precache. Must match `public/sw.js`. */
const PRECACHE_STATUS_URL = "/__precache-status";

/** The worker script. Root scope, so it can serve `/hunt`. */
const WORKER_URL = "/sw.js";

/* ─────────────────────────────── persistence ─────────────────────────────── */

/**
 * The answer to "will this phone keep the pack?"
 *
 * THREE MEMBERS, NOT A BOOLEAN, because "the browser said no" and "the browser
 * has no opinion" call for different sentences and a boolean cannot hold the
 * difference. Every member carries `message` — text written to be shown to a
 * hunter verbatim, not a log line.
 */
export type PersistenceResult =
  | {
      readonly status: "persisted";
      readonly granted: true;
      readonly installed: boolean;
      readonly message: string;
    }
  | {
      readonly status: "not-persisted";
      readonly granted: false;
      readonly installed: boolean;
      readonly message: string;
    }
  | {
      readonly status: "unsupported";
      readonly granted: false;
      readonly installed: boolean;
      readonly message: string;
    };

/**
 * Is this running as an installed app rather than a browser tab?
 *
 * Two probes because the platforms disagree: `display-mode: standalone` is the
 * standard and works in Chrome and on Android; iOS Safari answers
 * `navigator.standalone` and, historically, has not answered the media query
 * reliably. Both are checked, and neither is trusted alone.
 */
export function isInstalledApp(): boolean {
  if (typeof navigator !== "undefined") {
    const legacy = (navigator as { standalone?: unknown }).standalone;
    if (legacy === true) return true;
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    try {
      if (window.matchMedia("(display-mode: standalone)").matches) return true;
    } catch {
      // matchMedia can throw on an unsupported query string in old engines.
    }
  }
  return false;
}

/**
 * Ask the browser to make this site's storage durable, and REPORT WHAT IT SAID.
 *
 * Never cached — the answer changes when a user adds the app to their home
 * screen, which is exactly the moment we most want to re-ask.
 */
export async function requestPersistentStorage(): Promise<PersistenceResult> {
  const installed = isInstalledApp();

  const storage =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as { storage?: StorageManager }).storage;

  if (!storage || typeof storage.persist !== "function") {
    return {
      status: "unsupported",
      granted: false,
      installed,
      message:
        "This browser will not say whether it keeps saved data, so there is no promise " +
        "the pack survives. Add Duck Countdown to your home screen and open it from " +
        "there — installed apps are not swept.",
    };
  }

  let granted = false;
  try {
    granted = (await storage.persist()) === true;
  } catch {
    granted = false;
  }

  if (granted) {
    return {
      status: "persisted",
      granted: true,
      installed,
      message:
        "This phone will keep your pack. It will not be cleared on its own, and it is " +
        "there whether or not you have signal.",
    };
  }

  return {
    status: "not-persisted",
    granted: false,
    installed,
    message: installed
      ? "The browser did not promise to keep your pack, but this is running as an " +
        "installed app, which is not swept for inactivity. Pack the truck again if you " +
        "have not opened it in a while."
      : "The browser did NOT promise to keep your pack. On an iPhone, site data is " +
        "thrown away after about a week of not opening the site — so a pack saved today " +
        "may be gone on opening day. Add Duck Countdown to your home screen and open it " +
        "from there; installed apps are exempt.",
  };
}

/** What the browser says it is holding, and what it will let us hold. */
export interface StorageReport {
  readonly usageBytes: number;
  readonly quotaBytes: number;
  /** 0–1. `null` when the quota is not reported, which is common on iOS. */
  readonly usedFraction: number | null;
}

/**
 * How much room the pack is using.
 *
 * Guarded with `typeof` before any arithmetic — `usage` and `quota` are both
 * OPTIONAL in the spec and browsers really do omit them. `Number(undefined)` is
 * `NaN`, but `Number(null)` is `0`, and a quota that reads as zero bytes would
 * make a full disk and an unreported quota look identical.
 */
export async function storageEstimate(): Promise<PackResult<StorageReport>> {
  const storage =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as { storage?: StorageManager }).storage;

  if (!storage || typeof storage.estimate !== "function") {
    return packRefuse(
      "storage-unavailable",
      null,
      "This browser does not report how much room the pack is using.",
    );
  }

  let est: StorageEstimate;
  try {
    est = await storage.estimate();
  } catch (e) {
    return packRefuse(
      "storage-error",
      null,
      "This browser would not say how much room the pack is using.",
      e instanceof Error ? e.message : String(e),
    );
  }

  const usage = est.usage;
  const quota = est.quota;
  if (typeof usage !== "number" || !Number.isFinite(usage)) {
    return packRefuse(
      "storage-unavailable",
      null,
      "This browser does not report how much room the pack is using.",
    );
  }
  const quotaOk = typeof quota === "number" && Number.isFinite(quota) && quota > 0;

  return packOk({
    usageBytes: usage,
    quotaBytes: quotaOk ? (quota as number) : 0,
    usedFraction: quotaOk ? usage / (quota as number) : null,
  });
}

/* ────────────────────────── the service worker ────────────────────────── */

export interface WorkerRegistration {
  readonly scope: string;
  /** True when a NEW worker was found and is taking over. */
  readonly updating: boolean;
}

/**
 * Register the field worker.
 *
 * NOT CALLED FROM THIS MODULE'S IMPORT SIDE EFFECTS, and not wired into any
 * page here on purpose. A service worker changes how every request on the origin
 * behaves, so switching it on is a deliberate act at a call site somebody owns —
 * one line in the field page — rather than something that happens because a
 * module got imported. `public/sw.js` is written so that a request it does not
 * recognise is not intercepted at all, but the registration itself still belongs
 * in the open.
 */
export async function registerFieldWorker(): Promise<PackResult<WorkerRegistration>> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return packRefuse(
      "storage-unavailable",
      null,
      "This browser cannot keep the app itself available offline. The tide and weather " +
        "you have already packed will still be read, but the page needs signal to open.",
    );
  }

  try {
    const reg = await navigator.serviceWorker.register(WORKER_URL, { scope: "/" });
    return packOk({
      scope: reg.scope,
      updating: reg.installing !== null || reg.waiting !== null,
    });
  } catch (e) {
    return packRefuse(
      "storage-error",
      null,
      "The offline copy of the app could not be installed, so the page will need signal " +
        "to open. What you have already packed is unaffected.",
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** What `sw.js` managed to precache, and what it did not. */
export interface PrecacheStatus {
  readonly buildId: string;
  readonly installedAt: string;
  readonly wanted: number;
  readonly cached: number;
  readonly missing: readonly { readonly url: string; readonly why: string }[];
  /** True only when every wanted asset is on the device. */
  readonly complete: boolean;
}

/**
 * Read the precache report the worker wrote at install.
 *
 * THE POINT OF THIS FUNCTION: without it, "offline works" is a belief. The
 * install caches each asset individually and records its failures precisely so
 * this can be read back and shown — a shell that is missing one chunk still
 * boots online and fails only at the ramp, which is the failure mode that costs
 * a hunt.
 */
export async function readPrecacheStatus(): Promise<PackResult<PrecacheStatus>> {
  if (typeof caches === "undefined") {
    return packRefuse(
      "storage-unavailable",
      null,
      "This browser cannot store the app for offline use.",
    );
  }

  let res: Response | undefined;
  try {
    res = await caches.match(PRECACHE_STATUS_URL);
  } catch (e) {
    return packRefuse(
      "storage-error",
      null,
      "The offline copy of the app could not be checked.",
      e instanceof Error ? e.message : String(e),
    );
  }

  if (!res) {
    return packRefuse(
      "not-packed",
      null,
      "The app has not been stored for offline use yet. Open it once with signal so it " +
        "can save a copy of itself.",
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return packRefuse("damaged", null, "The offline install report could not be read.");
  }

  if (body === null || typeof body !== "object") {
    return packRefuse("damaged", null, "The offline install report could not be read.");
  }
  const b = body as Record<string, unknown>;

  // `typeof` BEFORE any coercion, every time. `Number(null)` is 0, and a
  // `cached: 0` that actually means "the field is missing" would read as a
  // complete failure rather than an unreadable report.
  if (typeof b.wanted !== "number" || typeof b.cached !== "number") {
    return packRefuse("damaged", null, "The offline install report is missing its counts.");
  }

  const missing = Array.isArray(b.missing)
    ? b.missing.flatMap((m) =>
        m !== null && typeof m === "object" && typeof (m as { url?: unknown }).url === "string"
          ? [
              {
                url: (m as { url: string }).url,
                why:
                  typeof (m as { why?: unknown }).why === "string"
                    ? (m as { why: string }).why
                    : "unknown",
              },
            ]
          : [],
      )
    : [];

  return packOk({
    buildId: typeof b.buildId === "string" ? b.buildId : "unknown",
    installedAt: typeof b.installedAt === "string" ? b.installedAt : "unknown",
    wanted: b.wanted,
    cached: b.cached,
    missing,
    complete: b.cached === b.wanted && missing.length === 0,
  });
}
