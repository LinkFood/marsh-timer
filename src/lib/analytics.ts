/**
 * Gate-3 instrumentation — docs/POSTING-PLAN-2026-07.md §0.
 *
 * Two custom Vercel Web Analytics events, nothing else:
 *
 *  - `date_lookup { door: 'date'|'atlas'|'born'|'morning' }` — fired on
 *    SUCCESSFUL DATA RENDER (the archive answered), never on route mount.
 *  - `return_visit { days_since_first }` — localStorage first-seen stamp;
 *    fires once per day when 1 ≤ days_since_first ≤ 7.
 *
 * No fingerprinting, no cookies — localStorage only.
 *
 * OWNER EXCLUSION (so the gate counts external visitors only). On any of
 * James's devices, run once in the console:
 *
 *     localStorage.setItem('dc_owner', '1')
 *
 * or just visit any page with `?owner=1` appended (`?owner=0` clears it).
 * With the flag set, neither event ever fires from that device.
 *
 * UTM pass-through needs no code: Vercel Web Analytics surfaces
 * utm_source/utm_medium/... natively — posted links just carry the params.
 */
import { track } from "@vercel/analytics";

const OWNER_KEY = "dc_owner";
const FIRST_SEEN_KEY = "dc_first_seen";
const RETURN_SENT_KEY = "dc_return_sent";
const BORN_DOOR_KEY = "dc_door_born";

export type LookupDoor = "date" | "atlas" | "born" | "morning";

/**
 * The official @vercel/analytics `track()` silently drops events until the
 * <Analytics /> component's inject() defines window.va. Arm the exact same
 * queue shim (idempotent — inject's own initQueue checks window.va first) so
 * an event fired before inject lands in window.vaq and is drained by the
 * script instead of vanishing.
 */
function armQueue(): void {
  const w = window as unknown as { va?: (...p: unknown[]) => void; vaq?: unknown[] };
  if (w.va) return;
  w.va = function a(...params: unknown[]) {
    if (!w.vaq) w.vaq = [];
    w.vaq.push(params);
  };
}

export function isOwner(): boolean {
  try {
    return localStorage.getItem(OWNER_KEY) === "1";
  } catch {
    return false;
  }
}

/** `?owner=1` sets the exclusion flag on this device; `?owner=0` clears it. */
export function applyOwnerParam(): void {
  try {
    const v = new URLSearchParams(window.location.search).get("owner");
    if (v === "1") localStorage.setItem(OWNER_KEY, "1");
    else if (v === "0") localStorage.removeItem(OWNER_KEY);
  } catch {
    /* storage unavailable — nothing to do */
  }
}

/** A date lookup COMPLETED — the archive answered and the data rendered. */
export function trackDateLookup(door: LookupDoor): void {
  if (isOwner()) return;
  armQueue();
  track("date_lookup", { door });
}

/**
 * Call once per page load (main.tsx). First load stamps dc_first_seen;
 * later loads fire return_visit at most once per calendar day while
 * 1 ≤ days_since_first ≤ 7.
 */
export function recordVisit(): void {
  if (isOwner()) return;
  try {
    const now = Date.now();
    const raw = localStorage.getItem(FIRST_SEEN_KEY);
    if (!raw) {
      localStorage.setItem(FIRST_SEEN_KEY, String(now));
      return;
    }
    const first = Number(raw);
    if (!Number.isFinite(first) || first <= 0) return;
    const days = Math.floor((now - first) / 86_400_000);
    if (days < 1 || days > 7) return;
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem(RETURN_SENT_KEY) === today) return;
    localStorage.setItem(RETURN_SENT_KEY, today);
    armQueue();
    track("return_visit", { days_since_first: days });
  } catch {
    /* storage unavailable — no stamp, no event */
  }
}

/**
 * The Born flow renders its data in the atlas dossier, not on /born itself.
 * BornPage marks the handoff before navigating; the dated dossier render
 * consumes it so that one completion is attributed door:'born'.
 */
export function markBornDoor(): void {
  try {
    sessionStorage.setItem(BORN_DOOR_KEY, "1");
  } catch {
    /* attribution falls back to 'atlas' */
  }
}

export function consumeBornDoor(): boolean {
  try {
    const v = sessionStorage.getItem(BORN_DOOR_KEY) === "1";
    sessionStorage.removeItem(BORN_DOOR_KEY);
    return v;
  } catch {
    return false;
  }
}
