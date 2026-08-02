/**
 * tidePocket.ts — the tide the hunter already has in his pocket.
 *
 * `src/lib/tide.ts` is the pure reader and `src/lib/tideFetch.ts` is the wire.
 * This file is neither: it is the POCKET, the thing that stands between them so
 * the field path can call `tideAt` and `tideDirection` with real samples and
 * never touch a socket.
 *
 * THE DEPENDENCY DIRECTION, same law as `tide.ts` states for itself:
 *
 *      tidePocket.ts  ──imports──▶  tide.ts        (types, refusals, readers)
 *      tidePocket.ts  ──imports──▶  NOTHING from tideFetch.ts. Ever.
 *
 * That is not stylistic. Importing the wire half here would put a `fetch` two
 * hops from a component that renders at 05:15 with no bars, and the whole reason
 * `tide.ts` was split into two files was that a rule enforced by tooling beats a
 * rule enforced by whoever remembers to read the header.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THE POCKET HOLDS A CURVE AND NOT JUST THE HIGHS AND LOWS.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `TidePack` in `tide.ts` encodes a whole season of highs and lows in about five
 * kilobytes, and it is the right structure for a season. It is the WRONG
 * structure for "what is the water doing right now", because `tideAt` and
 * `tideDirection` both take a `TideCurve` — a sampled curve — and there is no
 * honest way to manufacture one from hi/lo pairs. Drawing a line from a high to
 * a low six hours later invents the four hours in between, and the real curve
 * there is nearer a cosine than a line. `tide.ts` refuses to interpolate across
 * a hole wider than two sampling steps for exactly this reason; synthesising a
 * curve out of turning points would be that refusal defeated by the caller.
 *
 * So the pocket stores an actual sampled curve — the one `fetchTideDay` already
 * returns as `TideDay.curve` — written at PREP time with bars, read in the field
 * with none. The encoding below mirrors `TidePack`'s conventions on purpose
 * (`dm` minute offsets, `mv` integer thousandths) so a reader who knows one
 * knows the other, and so heights survive the round trip as integers with no
 * float noise.
 *
 * NOT EVERY STATION HAS ONE. `tide.ts` records the measurement: CO-OPS
 * SUBORDINATE STATIONS PUBLISH HIGHS AND LOWS BUT NO CURVE AT ANY INTERVAL, and
 * Woolford / Church Creek 8571807 — the nearest prediction station to Blackwater
 * NWR, 7.00 miles — is one of them. So the "no curve for this station" refusal
 * is not a corner case here. It is the reference spot's most likely outcome, it
 * has its own sentence, and the honest field render is that sentence rather than
 * a flat line at zero.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE HONESTY RULES, INHERITED WHOLE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * No `?? 0`, not once. Every number out of `JSON.parse` is type-guarded BEFORE
 * `Number.isFinite` sees it, because `Number(null)` is `0` and `Number("")` is
 * `0` — the two shapes a missing JSON field actually takes — and at MLLW a
 * 0.0 ft tide is a real and ordinary water level, which is what makes that
 * particular fabrication invisible.
 *
 * Every failure returns a `TideResult` refusal built with `refuse()` from
 * `tide.ts`, so the field surface has ONE refusal vocabulary to narrow on rather
 * than two. There is no `value` on the refusal branch, so a component cannot
 * read a height without checking first.
 */

import {
  PREDICTION_DISCLAIMER,
  refuse,
  resultOk,
  type TideCurve,
  type TideDatum,
  type TideProvenance,
  type TideResult,
  type TideSample,
  type TideUnits,
} from "@/lib/tide";

/** Where PREP writes the pocket and FIELD reads it. Versioned in the key. */
export const TIDE_POCKET_KEY = "dcd.hunt.tide.v1";

/**
 * Bumping this REFUSES an old record rather than misreading it, exactly as
 * `SPOT_SCHEMA_VERSION` does in `src/lib/spot.ts`. A half-understood curve is
 * worse than no curve: it puts confident wrong water on the screen.
 */
const POCKET_VERSION = 1;

/** Heights are integer thousandths, matching CO-OPS' three published decimals. */
const PACK_SCALE = 1000;

const MS_PER_MINUTE = 60_000;

/**
 * The stored shape. Parallel columns, same idea as `TidePack`:
 *   `dm[i]` — minutes from `startUTC` to sample i, ascending.
 *   `mv[i]` — height at sample i, in integer thousandths of `units`.
 *
 * `stationId`, `datum` and `units` ride along because a height with no datum is
 * a number with no meaning, and CO-OPS will serve half a dozen datums with
 * nothing in the response saying which one you got.
 */
export interface TidePocketRecord {
  readonly v: number;
  readonly stationId: string;
  readonly stationName?: string;
  readonly datum: TideDatum;
  readonly units: TideUnits;
  /** ISO instant the wire call was made, at PREP time. Displayed as the age. */
  readonly fetchedAt: string;
  /** Nominal spacing, minutes. Feeds `tide.ts`'s gap guard unchanged. */
  readonly stepMinutes: number;
  readonly startUTC: string;
  readonly dm: readonly number[];
  readonly mv: readonly number[];
}

export interface PocketCurve {
  readonly curve: TideCurve;
  /** The hunter's own name for the station, when PREP saved one. */
  readonly stationName: string | null;
  /** ISO instant the data was fetched. The card prints how old it is. */
  readonly fetchedAt: string;
}

/* -------------------------------------------------------------------------- */
/*  GUARDED PARSING — the type guard fires BEFORE Number.isFinite, always.     */
/* -------------------------------------------------------------------------- */

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number") return null;
  return Number.isFinite(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * PURE. Turn a stored record into a `TideCurve` the committed readers accept.
 *
 * Exported separately from the storage read so the decoding can be exercised
 * without a `localStorage`, and so a caller holding a record from anywhere — a
 * fixture, a future sync, a file — decodes it through the same guards.
 */
export function parseTidePocket(raw: unknown): TideResult<PocketCurve> {
  if (!raw || typeof raw !== "object") {
    return refuse("malformed-response", "The saved tide for this spot could not be read.");
  }
  const rec = raw as Record<string, unknown>;

  if (finiteNumber(rec.v) !== POCKET_VERSION) {
    return refuse(
      "malformed-response",
      "The saved tide for this spot was written by a different version of the app, so no " +
        "water is shown. Save it again from PREP while you have signal.",
      `v ${String(rec.v)}`,
    );
  }

  const stationId = nonEmptyString(rec.stationId);
  if (stationId === null) {
    return refuse("malformed-response", "The saved tide has no station on it, so no water is shown.");
  }

  // Closed unions, both of them. See `TideDatum` in tide.ts — a datum mix-up
  // moves every number by more than a foot without making one of them look wrong.
  if (rec.datum !== "MLLW") {
    return refuse(
      "malformed-response",
      "The saved tide is measured against a datum this app does not read, so no water is shown.",
      `datum ${String(rec.datum)}`,
    );
  }
  if (rec.units !== "english" && rec.units !== "metric") {
    return refuse(
      "malformed-response",
      "The saved tide has no units on it, so no water is shown.",
      `units ${String(rec.units)}`,
    );
  }

  const fetchedAt = nonEmptyString(rec.fetchedAt);
  if (fetchedAt === null || !Number.isFinite(Date.parse(fetchedAt))) {
    return refuse(
      "malformed-response",
      "The saved tide does not say when it was downloaded, so no water is shown. A reading " +
        "with no age is a reading you cannot judge.",
    );
  }

  const stepMinutes = finiteNumber(rec.stepMinutes);
  if (stepMinutes === null || stepMinutes <= 0) {
    return refuse(
      "malformed-response",
      "The saved tide does not say how far apart its readings are, so no water is shown.",
    );
  }

  const startMs = Date.parse(nonEmptyString(rec.startUTC) ?? "");
  if (!Number.isFinite(startMs)) {
    return refuse("malformed-response", "The saved tide has no valid start time, so no water is shown.");
  }

  const dm = rec.dm;
  const mv = rec.mv;
  if (!Array.isArray(dm) || !Array.isArray(mv) || dm.length !== mv.length) {
    return refuse(
      "malformed-response",
      "The saved tide is damaged — its times and heights do not line up — so no water is shown.",
    );
  }
  if (dm.length === 0) {
    return refuse("no-data", "The saved tide for this spot has no readings in it.");
  }

  const samples: TideSample[] = [];
  let prevMs = -Infinity;
  for (let i = 0; i < dm.length; i++) {
    const offset = finiteNumber(dm[i]);
    const height = finiteNumber(mv[i]);
    if (offset === null || height === null) {
      // THE LAW. A missing reading is not a low tide.
      return refuse(
        "unparsable-value",
        "A saved tide reading has no height or no time, so no water is shown. A missing " +
          "reading is not a low tide.",
        `index ${i}`,
      );
    }
    const at = startMs + offset * MS_PER_MINUTE;
    if (!Number.isFinite(at) || at <= prevMs) {
      return refuse(
        "unparsable-value",
        "The saved tide readings are out of order, so no water is shown.",
        `index ${i}`,
      );
    }
    prevMs = at;
    samples.push({ at: new Date(at), height: height / PACK_SCALE });
  }

  const provenance: TideProvenance = {
    kind: "prediction",
    source: "NOAA CO-OPS",
    stationId,
    datum: "MLLW",
    units: rec.units,
    timeFrame: "utc",
    fetchedAt,
    disclaimer: PREDICTION_DISCLAIMER,
  };

  return resultOk({
    curve: { provenance, stepMinutes, samples },
    stationName: nonEmptyString(rec.stationName),
    fetchedAt,
  });
}

/* -------------------------------------------------------------------------- */
/*  STORAGE                                                                   */
/* -------------------------------------------------------------------------- */

function storage(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // Safari private mode throws on access. No pocket is a valid answer.
    return null;
  }
}

/**
 * Read the pocket. Touches `localStorage` and nothing else — no network, by
 * construction and not by convention.
 *
 * The absent case is a REFUSAL WITH A SENTENCE, not an empty state. A field card
 * that simply omits the tide when nothing is saved teaches the hunter that the
 * water is unremarkable today; a card that says "nothing was saved for this
 * spot" teaches him to go save it. Silence is the failure mode this whole
 * product is built against.
 */
export function loadTidePocket(stationId?: string | null): TideResult<PocketCurve> {
  const store = storage();
  if (!store) {
    return refuse(
      "no-data",
      "This browser will not let the app store anything, so no tide could be saved for the " +
        "field. Private browsing blocks it.",
    );
  }

  let raw: string | null;
  try {
    raw = store.getItem(TIDE_POCKET_KEY);
  } catch {
    return refuse("no-data", "The saved tide could not be read from this browser.");
  }

  if (!raw) {
    return refuse(
      "no-data",
      // Two lines rather than four, saying the same two things: nothing is
      // saved, and nothing will be made up. The clause about downloading at
      // PREP with signal is instrument provenance and prints once at the foot
      // of the surface with the rest of it.
      "No tide is saved for this spot, and this app will not invent water. Save one at PREP, " +
        "with signal.",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse("malformed-response", "The saved tide is damaged, so no water is shown.");
  }

  const pocket = parseTidePocket(parsed);
  if (pocket.status !== "ok") return pocket;

  // A pocket saved for a different station is not this spot's water. Say so
  // rather than quietly showing the wrong marsh.
  const want = nonEmptyString(stationId);
  if (want !== null && pocket.value.curve.provenance.stationId !== want) {
    return refuse(
      "no-data",
      `The saved tide is for station ${pocket.value.curve.provenance.stationId}, but this spot ` +
        `is bound to station ${want}. Another marsh's water is not this one's, so none is shown.`,
    );
  }

  return pocket;
}
