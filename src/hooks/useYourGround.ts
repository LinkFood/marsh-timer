import { useCallback, useEffect, useState } from "react";
import { stateFullName } from "@/lib/board/frameStore";

/**
 * useYourGround — ONE state choice, made once, following the visitor everywhere
 * (docs/SITE-BLUEPRINT-2026-07-17.md §2e — the 1950 key-letter lesson made
 * software: every fitted number arrives pre-corrected to your ground).
 *
 * The law:
 *  - localStorage `dcd-ground` holds the choice; every wired room reads it
 *    (TODAY's fitted block, /plant, /atlas descent, /morning your-state line,
 *    /date state chip, /ask context).
 *  - A valid `?state=XX` URL param passed into the hook OVERRIDES the stored
 *    choice and then persists it — share links stay faithful AND the choice
 *    follows. The atlas is the one exception by design: its `?state` is a
 *    camera target (the Born flow, the Morning Line's "fall into"), so
 *    AtlasPage reads the ground but never passes its param here.
 *  - Graceful default: Maryland (the archive's deepest ground — Baltimore
 *    hourly tide to 1902) with `chosen: false` until the visitor actually
 *    picks. Rooms that would presume (atlas auto-descent, morning your-state
 *    line) act only when `chosen` is true.
 *
 * No geolocation — the ground is chosen, never guessed from a permission
 * prompt on the front door.
 */

const STORAGE_KEY = "dcd-ground";
/** The pre-blueprint key (useUserLocation) — adopted once, then retired. */
const LEGACY_KEY = "dcd-user-state";
const DEFAULT_GROUND = "MD";

const STATE_ABBRS = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

export const US_STATES = STATE_ABBRS.map((abbr) => ({ abbr, name: stateFullName(abbr) }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function getStateName(abbr: string): string {
  return stateFullName(abbr);
}

export function isGroundState(abbr: string | null | undefined): abbr is string {
  return !!abbr && STATE_ABBRS.includes(abbr);
}

function readStored(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (isGroundState(v)) return v;
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (isGroundState(legacy)) {
      localStorage.setItem(STORAGE_KEY, legacy);
      localStorage.removeItem(LEGACY_KEY);
      return legacy;
    }
  } catch {
    /* storage unavailable → session-only default */
  }
  return null;
}

function writeStored(abbr: string) {
  try {
    localStorage.setItem(STORAGE_KEY, abbr);
  } catch {
    /* storage unavailable → the choice lives for this render tree only */
  }
}

// Module-level pub/sub so every mounted instance (picker on TODAY, chip on
// /date, select on /plant) speaks with one voice within the tab.
type Listener = (abbr: string) => void;
const listeners = new Set<Listener>();

function broadcast(abbr: string) {
  for (const l of listeners) l(abbr);
}

export interface YourGround {
  /** The ground, always a valid abbr (default MD until chosen). */
  ground: string;
  /** Full state name for the ground. */
  groundName: string;
  /** True once the visitor has actually made (or carried in) a choice. */
  chosen: boolean;
  /** Persist a new choice — it follows the visitor from here on. */
  setGround: (abbr: string) => void;
}

/**
 * @param urlState the page's `?state=` param (raw, may be junk) — pass it and
 * a valid value overrides + persists (share links stay faithful); omit it on
 * pages whose param is a navigation target, not a ground claim (the atlas).
 */
export function useYourGround(urlState?: string | null): YourGround {
  const urlGround = isGroundState(urlState?.toUpperCase()) ? urlState!.toUpperCase() : null;
  const [stored, setStored] = useState<string | null>(() => readStored());

  // Cross-instance + cross-tab sync.
  useEffect(() => {
    const onLocal: Listener = (abbr) => setStored(abbr);
    listeners.add(onLocal);
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && isGroundState(e.newValue)) setStored(e.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(onLocal);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // A URL-carried ground overrides and then persists.
  useEffect(() => {
    if (urlGround && urlGround !== stored) {
      writeStored(urlGround);
      setStored(urlGround);
      broadcast(urlGround);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlGround]);

  const setGround = useCallback((abbr: string) => {
    if (!isGroundState(abbr)) return;
    writeStored(abbr);
    setStored(abbr);
    broadcast(abbr);
  }, []);

  const ground = urlGround ?? stored ?? DEFAULT_GROUND;
  return {
    ground,
    groundName: stateFullName(ground),
    chosen: urlGround !== null || stored !== null,
    setGround,
  };
}
