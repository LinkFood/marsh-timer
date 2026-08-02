/**
 * fieldStore.ts — the two things the hunter himself puts into the app.
 *
 * `localStorage` only. No network, no React, no Supabase. Both records survive a
 * dead battery, an airplane-mode morning and a closed tab, because both are
 * written in a place with no signal and there is nowhere else to put them.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE BAG COUNTER COUNTS TAPS. IT DOES NOT COUNT BIRDS, AND IT NEVER SAYS LEGAL.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * There is no bag limit in this file and there must not be one. A limit on the
 * screen becomes a target, a target becomes a claim, and the claim — "you have
 * two more" — is one the app cannot make: it does not know what he shot before
 * this session, it does not know what the man forty yards down the bank shot
 * into the same spread, and Maryland's daily limits are species-and-sex specific
 * in ways a single integer cannot represent. So the counter counts. The legality
 * of the count is the hunter's, and it always was.
 *
 * WHY ABSENT IS ALLOWED TO RENDER AS 0, WHEN NOTHING ELSE IN THIS APP IS.
 * The `?? 0` ban exists because a missing MEASUREMENT is not a zero measurement:
 * a null river gauge is not a dry river, and this project once fabricated 1,095
 * high-severity weather events out of exactly that coercion. This number is not
 * a measurement. It is a TALLY THE HUNTER KEEPS, and a tally nobody has touched
 * today is genuinely zero taps — the app is not inferring a fact about the world
 * from an absence, it is reporting the count of an action it witnessed. The card
 * labels it as taps for that reason.
 *
 * A stored value that is present but UNREADABLE is a different thing entirely,
 * and it does NOT become zero. That is a corrupted record, the guard refuses it,
 * and the card says the tally could not be read rather than silently resetting a
 * morning's count to nothing.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE SPECIES OVERRIDE IS AN OVERRIDE, NOT A SETTING.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `resolveFieldSeason` in `./fieldSeason.ts` derives the species from which
 * seasons Maryland publishes as open on the date, and on every date in the
 * transcribed 2026-27 table that derivation is exact. This override exists for
 * the case where it is not, and it follows the same rule `setStation` follows in
 * `src/lib/spot.ts`: the hunter always wins.
 *
 * It is validated through `isTranscribedSpecies` on the way in AND on the way
 * out, so a hand-edited `localStorage` cannot inject a species the regs table
 * never transcribed and reach a rule with it.
 */

import { isTranscribedSpecies, type TranscribedSpecies } from "@/data/regs/shootingHours";

export const BAG_KEY = "dcd.hunt.bag.v1";
export const QUARRY_KEY = "dcd.hunt.quarry.v1";

const BAG_VERSION = 1;

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  THE BAG                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A day's tally.
 *
 * `"unreadable"` is a real state and it is separate from a count of zero. The
 * two look identical in any design that stores a bare number and reads it with
 * a fallback; keeping them apart is the whole reason this is a union.
 */
export type BagCount =
  | { readonly status: "counted"; readonly taps: number }
  | { readonly status: "unreadable"; readonly message: string };

interface BagRecord {
  v: number;
  days: Record<string, number>;
}

function readBagRecord(): BagRecord | "missing" | "corrupt" {
  const store = storage();
  if (!store) return "missing";
  let raw: string | null;
  try {
    raw = store.getItem(BAG_KEY);
  } catch {
    return "corrupt";
  }
  if (!raw) return "missing";
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return "corrupt";
    const rec = parsed as Record<string, unknown>;
    if (rec.v !== BAG_VERSION) return "corrupt";
    const days = rec.days;
    if (!days || typeof days !== "object") return "corrupt";
    return { v: BAG_VERSION, days: days as Record<string, number> };
  } catch {
    return "corrupt";
  }
}

/**
 * The tally for one calendar day.
 *
 * A day with no entry is zero taps — see the header for why that is honest here
 * and nowhere else. A day whose entry is present but is not a non-negative whole
 * number refuses, and the refusal carries a sentence.
 */
export function loadBag(day: string): BagCount {
  const rec = readBagRecord();
  if (rec === "corrupt") {
    return {
      status: "unreadable",
      message: "Today's tally could not be read from this browser, so it is not shown.",
    };
  }
  if (rec === "missing") return { status: "counted", taps: 0 };

  const value: unknown = rec.days[day];
  if (value === undefined) return { status: "counted", taps: 0 };

  // Type guard BEFORE the finite check. `Number(null)` and `Number("")` are both
  // 0, and a tally silently reset to zero is a morning erased.
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    return {
      status: "unreadable",
      message:
        "Today's tally is stored as something this app cannot read, so it is not shown and " +
        "it has not been reset. Count on your fingers and check the app later.",
    };
  }
  return { status: "counted", taps: value };
}

/**
 * Write a day's tally. Returns the value actually stored, or `null` if the write
 * did not land — a counter that silently fails to persist is worse than one that
 * says it failed, because he will trust it.
 */
export function saveBag(day: string, taps: number): number | null {
  if (!Number.isFinite(taps) || taps < 0 || !Number.isInteger(taps)) return null;
  const store = storage();
  if (!store) return null;

  const existing = readBagRecord();
  const days = existing === "missing" || existing === "corrupt" ? {} : existing.days;
  const next: BagRecord = { v: BAG_VERSION, days: { ...days, [day]: taps } };

  try {
    store.setItem(BAG_KEY, JSON.stringify(next));
    return taps;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*  THE SPECIES OVERRIDE                                                      */
/* -------------------------------------------------------------------------- */

/** The hunter's named bird, or `null` when he has not named one. */
export function loadQuarryOverride(): TranscribedSpecies | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(QUARRY_KEY);
    // Validated on the way OUT as well as in — a hand-edited value must not
    // reach the regs table.
    return isTranscribedSpecies(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Name the bird, or pass `null` to hand the question back to the calendar. */
export function saveQuarryOverride(species: TranscribedSpecies | null): boolean {
  const store = storage();
  if (!store) return false;
  try {
    if (species === null) store.removeItem(QUARRY_KEY);
    else if (isTranscribedSpecies(species)) store.setItem(QUARRY_KEY, species);
    else return false;
    return true;
  } catch {
    return false;
  }
}
