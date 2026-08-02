/**
 * tide.ts — the water gate, offline.
 *
 * This is the half of the tide module a hunter runs standing in water at 05:40
 * with no bars. Every function here is synchronous, total, and operates on data
 * already in his pocket. THERE IS NO NETWORK IN THIS FILE, and there is no way
 * to add one quietly: `eslint.config.js` names `src/lib/tide.ts` in its offline
 * `files:` glob and bans bare `fetch`, `window.fetch` and `globalThis.fetch`
 * here. If you are editing this file and reaching for a request, you are in the
 * wrong file — the wire lives in `src/lib/tideFetch.ts`.
 *
 * That split is a FILE boundary and not a comment inside one module on purpose:
 * a rule that cannot be violated beats a rule that must be remembered. While
 * both halves shared a file, the offline guarantee was an in-file convention
 * enforced by whoever happened to read the header, and eslint had nothing to
 * bite on. Now the tooling holds it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE DEPENDENCY DIRECTION IS ONE-WAY.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *      tideFetch.ts  ──imports──▶  tide.ts
 *      tide.ts       ──imports──▶  NOTHING from tideFetch.ts. Ever.
 *
 * This module owns the vocabulary: the types, the refusal, the pure readers, and
 * the pocket encoding. `tideFetch.ts` owns exactly one thing on top of that —
 * how those values are obtained over a network. An import pointing the other way
 * would reintroduce the coupling the split exists to remove, and would let the
 * eslint tripwire be routed around through a re-export.
 *
 * DO NOT IMPORT `tideFetch.ts` HERE TO "SHARE A HELPER". If both halves need
 * something, it belongs here and `tideFetch.ts` imports it — which is already
 * how `PREDICTION_DISCLAIMER`, `resultOk`, `refuse` and `packTideEvents` work.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT KEEPS THE PURE HALF PURE, BEYOND THE LINT RULE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *   1. EVERY EXPORTED FUNCTION HERE IS SYNCHRONOUS. Not one returns a Promise.
 *      You cannot `await fetch(...)` inside a sync function and return the
 *      result, so an edit that tries to reach the network has to change the
 *      signature first — which changes every call site, which is exactly the
 *      loud, reviewable diff we want. `tide.test.ts` asserts at runtime that no
 *      export here is an `AsyncFunction`.
 *
 *   2. THESE FUNCTIONS TAKE MATERIALIZED DATA (`TideCurve`, `TidePack`,
 *      `TideEvent[]`) and never a network address. There is no function in this
 *      file that accepts a `(stationId, date)` pair, because that pair is the
 *      only thing you could actually go fetch with. They are structurally not
 *      holding enough information to make a request.
 *
 *   3. NOTHING HERE ACCEPTS A `fetchImpl`, a timeout or an `AbortSignal`. That
 *      options bag is `TideFetchOptions` and it lives in the other file. A
 *      function here has nowhere to put a socket even if a caller handed it one.
 *
 *   `tide.test.ts` also runs this entire surface with `globalThis.fetch`
 *   replaced by a throwing stub, which is the strongest proof available that
 *   none of it reaches for the network.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE HONESTY RULES. These are the product, not decoration.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * A. A PREDICTION IS NOT A READING. NOAA tide predictions are harmonic, which is
 *    what lets a whole season pre-cache — and also what makes them a model of
 *    the moon and the coastline rather than a measurement of the water. Every
 *    structure here carries `kind: "prediction"` as a LITERAL type with no
 *    second member, so there is no assignment anywhere in this codebase that can
 *    relabel it as observed. Wind and barometric pressure routinely push real
 *    Chesapeake water a foot off prediction; a hard northwest blow can strip
 *    Fishing Bay well below any predicted low. Every surface gets
 *    `TideProvenance.disclaimer` so it can say so in words.
 *
 * B. NO `?? 0`. NOT ONCE. A missing tide reading is not a 0.0 ft tide; at MLLW,
 *    0.0 ft is a real and ordinary water level, which is precisely what makes
 *    the fabrication invisible. `Number(null)` is `0` and `Number("")` is `0` —
 *    the two shapes a JSON field most often takes when it is absent — so
 *    `Number.isFinite` ALONE does not save you; the type guard has to fire
 *    first. The read path (`unpackTideEvents`) and the write path
 *    (`packTideEvents`) both refuse rather than substitute. This project has
 *    fabricated 1,095 high-severity weather events from exactly this bug once
 *    already.
 *
 * C. REFUSE OUT LOUD. Every entry point returns a `TideResult<T>` — a closed
 *    discriminated union with NO `value` property on the refusal branch, so
 *    TypeScript will not let a caller read `.value` without narrowing on
 *    `status === "ok"` first. This mirrors `ShootingHoursLookup` in
 *    `src/data/regs/shootingHours.ts` deliberately: same shape, same reason,
 *    same refusal-is-a-different-type discipline. There is no
 *    `value: T | null` and no optional `value?` — both of those compile at the
 *    call site and render a zero in a marsh.
 *
 * D. NEVER EXTRAPOLATE, NEVER BRIDGE A HOLE. `tideAt` refuses past either end of
 *    the curve and refuses across a gap wider than two sampling steps, rather
 *    than drawing a plausible line through water nobody predicted.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE FRAME: every instant in this module is an honest UTC instant.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Same as `sky.ts` — "localizing to the spot's timezone is the caller's job" —
 * so a tide curve and a sunrise can be compared with no conversion in between,
 * which is the entire point of the shaded shooting window. It is also the only
 * honest option: CO-OPS' local-time mode returns bare wall-clock strings that
 * are ambiguous or missing across a DST transition, including 24 hourly rows for
 * the 25-hour local day of 2026-11-01, which falls inside duck season. The
 * reasoning and the measurements are recorded in `tideFetch.ts`, which is where
 * the request is actually built.
 */

/* ───────────────────────────── constants ───────────────────────────── */

/**
 * How far apart two curve samples may sit before `tideAt` refuses to draw a line
 * between them. A gap wider than twice the nominal step is a hole in the data,
 * and interpolating a tide across a hole invents water.
 */
const MAX_GAP_FACTOR = 2;

/**
 * Half-width of the centred window `tideDirection` differences across, minutes.
 *
 * Why a centred window rather than the slope of the segment the instant sits in:
 * on a 60-minute curve the piecewise-linear slope is constant within an hour and
 * flips sign discontinuously at a turning point, so a segment slope can never
 * report slack water and will call a moment two minutes before high tide a full
 * rising tide. Differencing across ±15 minutes straddles the turn and lets the
 * rate genuinely pass through zero.
 */
const DIRECTION_PROBE_MIN = 15;

/**
 * Below this rate of change the water is called slack. Stated convention, not a
 * measured fact — there is no NOAA definition of slack for a height curve, only
 * for currents. Tuned to feet for the Chesapeake, where a ~2 ft range over ~6 h
 * peaks near 0.6 ft/h, so 0.05 ft/h is roughly the last and first ten minutes
 * either side of the turn.
 */
const SLACK_RATE_PER_HOUR: Readonly<Record<TideUnits, number>> = {
  english: 0.05,
  metric: 0.015,
};

/** Heights are packed as integer thousandths. CO-OPS publishes three decimals. */
const PACK_SCALE = 1000;

const MS_PER_MINUTE = 60_000;

/**
 * The sentence every surface must be able to show. Wind and pressure move real
 * Chesapeake water routinely; this is the difference between a tide chart and a
 * gauge, and the hunter is entitled to know which one he is reading.
 */
export const PREDICTION_DISCLAIMER =
  "NOAA harmonic PREDICTION, not an observed water level. Wind and barometric " +
  "pressure routinely push real water a foot or more off prediction in the " +
  "Chesapeake. Heights are relative to the stated datum.";

/* ───────────────────────────── vocabulary ───────────────────────────── */

/**
 * Vertical reference. A CLOSED UNION on purpose — see finding 5 in the header.
 * CO-OPS will happily serve NAVD, MSL, MTL and half a dozen others with no
 * indication in the response of which you got, and a datum mix-up moves every
 * number by more than a foot without making a single one of them look wrong.
 * MLLW is the chart datum American mariners and every printed tide table use.
 * Adding a member here means auditing every surface that prints a height.
 */
export type TideDatum = "MLLW";

export type TideUnits = "english" | "metric";

export type TideEventKind = "high" | "low";

/** Which way the water is going. */
export type TideDirection = "rising" | "falling" | "slack";

/**
 * Where a number came from and what it is worth.
 *
 * `kind` is the literal `"prediction"` and has no second member. That is not
 * pedantry: it means no code path anywhere in this app can assign an observed
 * reading into a tide structure or relabel a prediction as a gauge value,
 * because there is no other value the field can hold.
 */
export interface TideProvenance {
  readonly kind: "prediction";
  readonly source: "NOAA CO-OPS";
  readonly stationId: string;
  readonly datum: TideDatum;
  readonly units: TideUnits;
  /** All instants in the payload are UTC. See finding 2 in the header. */
  readonly timeFrame: "utc";
  /** ISO instant the request was made. */
  readonly fetchedAt: string;
  /** Show this. Verbatim. */
  readonly disclaimer: string;
}

/** One point on the predicted water curve. */
export interface TideSample {
  /** Honest UTC instant. */
  readonly at: Date;
  /** Height above the datum, in `TideCurve.units`. */
  readonly height: number;
}

/** A predicted high or low water. */
export interface TideEvent extends TideSample {
  readonly kind: TideEventKind;
}

/**
 * A sampled water curve. `samples` is ascending by time and every height in it
 * is finite — both guaranteed at construction by `parsePredictions`, so the pure
 * readers below can binary-search without re-validating.
 */
export interface TideCurve {
  readonly provenance: TideProvenance;
  /** Nominal spacing of `samples`, minutes. Used for the gap guard. */
  readonly stepMinutes: number;
  readonly samples: readonly TideSample[];
}

/* ──────────────────────────── the refusal ──────────────────────────── */

/**
 * Why something refused. Closed union so a caller can branch on cause without
 * string-matching a message, exactly as `RefusalReason` does in
 * `src/data/regs/shootingHours.ts`.
 */
export type TideRefusalReason =
  /** Caller's arguments are wrong. Never retried, never fetched. */
  | "bad-request"
  /** CO-OPS answered, and its answer is "there is nothing here". */
  | "no-data"
  /** Station publishes hi/lo but no interval curve — a subordinate station. */
  | "no-curve"
  /** Body was not shaped like a CO-OPS prediction response. */
  | "malformed-response"
  /** A row carried a height or timestamp that could not be read. See rule B. */
  | "unparsable-value"
  /** The instant asked about lies outside the data in hand. */
  | "out-of-range"
  /** There is a hole in the curve here and we will not draw across it. */
  | "gap"
  /** fetch threw, or the caller aborted. */
  | "network"
  /** Our own deadline elapsed. */
  | "timeout"
  /** 5xx after retries. */
  | "upstream-error";

/**
 * Every entry point in this module returns one of these.
 *
 * NOTE WHAT IS ABSENT FROM THE REFUSAL BRANCH: there is no `value`. TypeScript
 * refuses property access on a union unless the property exists on every member,
 * so `fetchTideDay(...).value` does not compile. The only way to a value is to
 * narrow on `status === "ok"`, which is the check that keeps a fabricated
 * 0.0 ft off the screen.
 */
export type TideResult<T> =
  | { readonly status: "ok"; readonly value: T }
  | {
      readonly status: "refused";
      readonly reason: TideRefusalReason;
      /** A sentence that can be shown to the hunter verbatim. */
      readonly message: string;
      /** Upstream text, when there was any. Diagnostics, never displayed alone. */
      readonly detail?: string;
    };

/**
 * The two constructors for a `TideResult`.
 *
 * EXPORTED SO `tideFetch.ts` CAN BUILD REFUSALS IN THE SAME SHAPE. That is the
 * whole reason they are public — the wire half must not hand back a differently
 * shaped result, or a caller would have two refusal vocabularies to narrow on
 * and would eventually stop narrowing. Keeping the constructors here, and having
 * the fetch half import them, is also what keeps the dependency arrow pointing
 * one way (see the file header).
 *
 * `resultOk`, not `ok`, because a bare `ok` in an importing module reads like a
 * boolean.
 */
export const resultOk = <T,>(value: T): TideResult<T> => ({ status: "ok", value });

export const refuse = <T,>(
  reason: TideRefusalReason,
  message: string,
  detail?: string,
): TideResult<T> =>
  detail === undefined
    ? { status: "refused", reason, message }
    : { status: "refused", reason, message, detail };

/**
 * A day's water at one station.
 *
 * Produced by `fetchTideDay` in `tideFetch.ts`; the shape lives here because it
 * is materialized data the pure readers work over, and a component should be
 * able to type against this module without importing the wire half.
 *
 * `curve` IS A RESULT, NOT A NULLABLE FIELD, and that is load-bearing. A whole
 * real station can only ever give you the headline: CO-OPS subordinate stations
 * — including Woolford / Church Creek 8571807, one of the two nearest Blackwater
 * NWR — publish highs and lows but no continuous curve at any interval. A caller
 * must look at `curve.status` before it can shade anything, and when it refuses
 * the honest UI is the hi/lo times with no chart, not a flat line at zero. The
 * measurements behind this are recorded in `tideFetch.ts`, finding 1.
 */
export interface TideDay {
  readonly provenance: TideProvenance;
  /** Midnight UTC of the day requested. */
  readonly dayStartUTC: Date;
  /** Predicted highs and lows, ascending. */
  readonly events: readonly TideEvent[];
  /** Hourly curve, or a refusal explaining why this station has none. */
  readonly curve: TideResult<TideCurve>;
}

/* ─────────────────────────────── the pack ─────────────────────────────── */

/**
 * A whole season of highs and lows, encoded for the pocket.
 *
 * MEASURED 2026-08-01: Bishops Head, 2026-10-01 → 2027-01-31, is 475 events.
 * Raw CO-OPS JSON is 22,896 bytes (3,809 gzipped). This encoding is 5,045 bytes
 * (2,120 gzipped) — well under half the budget, which leaves room for every
 * station a hunter has saved rather than just one. `tide.test.ts` re-measures it
 * on every run and fails if it drifts over budget.
 *
 * Where the bytes went:
 *   • Times are MINUTE DELTAS from the previous event (`dm[0]` is measured from
 *     `epochUTC`). Absolute minute offsets gzip to 2,527 bytes; deltas to 1,802,
 *     because consecutive tides are ~370 minutes apart and the delta column is
 *     therefore three repeating digits that DEFLATE eats alive.
 *   • Heights are INTEGER THOUSANDTHS (`mv`), matching CO-OPS' three published
 *     decimals exactly. Integers, so no float noise and no `2.3510000000000002`.
 *   • Kinds are one character each in a single string, not 475 `"type"` keys.
 *
 * The provenance sentence rides along uncompressed and unabbreviated. It costs
 * about 250 bytes once and it is the reason this file exists.
 */
export interface TidePack {
  readonly packVersion: 1;
  readonly stationId: string;
  readonly datum: TideDatum;
  readonly units: TideUnits;
  readonly kind: "prediction";
  readonly source: "NOAA CO-OPS";
  readonly timeFrame: "utc";
  readonly disclaimer: string;
  readonly fetchedAt: string;
  /** ISO instant `dm[0]` is measured from. */
  readonly epochUTC: string;
  /** Minute deltas. `dm[0]` from `epochUTC`, `dm[i]` from the previous event. */
  readonly dm: readonly number[];
  /** Heights in integer thousandths of `units`. */
  readonly mv: readonly number[];
  /** `"H"` / `"L"`, one character per event, same order as `dm` and `mv`. */
  readonly kinds: string;
}

/**
 * PURE. Encode events into the pocket format.
 *
 * Lives on the pure side so the packing arithmetic is testable without a socket,
 * and so a caller holding events from anywhere — a cache, a fixture, a previous
 * pack — can re-pack them. `fetchTideRange` calls this; it is not special.
 *
 * Refuses rather than encoding a non-finite height or a bad instant, because a
 * pack is written to disk and a lie that reaches disk outlives the session.
 */
export function packTideEvents(
  events: readonly TideEvent[],
  meta: {
    readonly stationId: string;
    readonly datum: TideDatum;
    readonly units: TideUnits;
    readonly fetchedAt: string;
  },
): TideResult<TidePack> {
  if (events.length === 0) {
    return refuse("no-data", "There are no tides to save for this range.");
  }

  const epochMs = events[0].at.getTime();
  if (!Number.isFinite(epochMs)) {
    return refuse("unparsable-value", "The first tide in this range has no valid time.");
  }

  const dm: number[] = [];
  const mv: number[] = [];
  let kinds = "";
  let prevMs = epochMs;

  for (const e of events) {
    const ms = e.at.getTime();
    if (!Number.isFinite(ms) || ms < prevMs) {
      return refuse(
        "unparsable-value",
        "The tides for this range are out of order or carry an unreadable time.",
      );
    }
    if (!Number.isFinite(e.height)) {
      // THE LAW, on the write path too.
      return refuse(
        "unparsable-value",
        "A tide in this range has no height, so nothing is saved. " +
          "A missing reading is not a low tide.",
      );
    }
    dm.push(Math.round((ms - prevMs) / MS_PER_MINUTE));
    mv.push(Math.round(e.height * PACK_SCALE));
    kinds += e.kind === "high" ? "H" : "L";
    prevMs = ms;
  }

  return resultOk({
    packVersion: 1,
    stationId: meta.stationId,
    datum: meta.datum,
    units: meta.units,
    kind: "prediction",
    source: "NOAA CO-OPS",
    timeFrame: "utc",
    disclaimer: PREDICTION_DISCLAIMER,
    fetchedAt: meta.fetchedAt,
    epochUTC: new Date(epochMs).toISOString(),
    dm,
    mv,
    kinds,
  });
}

/**
 * PURE. Decode a pack back into events.
 *
 * Validates that the three parallel columns are the same length before trusting
 * any of them. A truncated `mv` against a full `dm` would otherwise hand back
 * `undefined` heights, which is the `?? 0` bug arriving through the cache
 * instead of through the network.
 */
export function unpackTideEvents(pack: TidePack): TideResult<readonly TideEvent[]> {
  if (pack.packVersion !== 1) {
    return refuse(
      "malformed-response",
      "This saved tide pack was written by a different version of the app.",
      `packVersion ${String(pack.packVersion)}`,
    );
  }
  if (
    !Array.isArray(pack.dm) ||
    !Array.isArray(pack.mv) ||
    typeof pack.kinds !== "string" ||
    pack.dm.length !== pack.mv.length ||
    pack.dm.length !== pack.kinds.length
  ) {
    return refuse("malformed-response", "The saved tide pack is damaged, so no tide is shown.");
  }
  if (pack.dm.length === 0) {
    return refuse("no-data", "The saved tide pack has no tides in it.");
  }

  const epochMs = Date.parse(pack.epochUTC);
  if (!Number.isFinite(epochMs)) {
    return refuse("malformed-response", "The saved tide pack has no valid start time.");
  }

  const events: TideEvent[] = [];
  let ms = epochMs;
  for (let i = 0; i < pack.dm.length; i++) {
    const d = pack.dm[i];
    const v = pack.mv[i];
    if (!Number.isFinite(d) || !Number.isFinite(v)) {
      return refuse(
        "unparsable-value",
        "A saved tide has no height or no time, so no tide is shown. " +
          "A missing reading is not a low tide.",
        `index ${i}`,
      );
    }
    const kind = pack.kinds[i] === "H" ? "high" : pack.kinds[i] === "L" ? "low" : null;
    if (kind === null) {
      return refuse("malformed-response", "A saved tide is neither a high nor a low.", `index ${i}`);
    }
    ms += d * MS_PER_MINUTE;
    events.push({ at: new Date(ms), height: v / PACK_SCALE, kind });
  }

  return resultOk(events);
}

/**
 * Milliseconds out of something that claims to be a `Date`, or `NaN`.
 *
 * DUCK-TYPED ON `getTime`, NOT `instanceof Date`, and that is deliberate.
 * `instanceof` compares against the `Date` binding in THIS realm, so it returns
 * false for a perfectly good Date that arrived from an iframe, a worker, a
 * structured clone, or a test that installed fake timers. All four are ways for
 * a real instant to be rejected as garbage, which would refuse a hunter's tide
 * for a reason that has nothing to do with the water.
 *
 * Still refuses everything that matters: `null`, `undefined`, strings, numbers,
 * plain objects and an Invalid Date all come back `NaN`, and every caller guards
 * on `Number.isFinite`.
 */
function instantMs(value: unknown): number {
  if (value === null || typeof value !== "object") return NaN;
  const getTime = (value as { getTime?: unknown }).getTime;
  if (typeof getTime !== "function") return NaN;
  const ms = (getTime as () => unknown).call(value);
  return typeof ms === "number" ? ms : NaN;
}

/** Index of the last sample at or before `ms`. Binary search; samples ascend. */
function floorIndex(samples: readonly TideSample[], ms: number): number {
  let lo = 0;
  let hi = samples.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].at.getTime() <= ms) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/** The answer `tideAt` gives. */
export interface TideHeight {
  readonly instant: Date;
  /** Height above the datum, in `units`. */
  readonly height: number;
  readonly units: TideUnits;
  readonly datum: TideDatum;
  /** False only when the instant lands exactly on a sample. */
  readonly interpolated: boolean;
  /** Carried through so a surface cannot render this without the disclaimer. */
  readonly provenance: TideProvenance;
}

/**
 * PURE. Predicted water height at a moment, from a curve already in hand.
 *
 * Linear between the two bracketing samples. Linear, not spline: the real tide
 * between two hourly samples is closer to a cosine than a line, so linear
 * slightly clips the peaks and troughs — by a few hundredths of a foot on a
 * 2 ft Chesapeake range, which is one to two orders of magnitude smaller than
 * the foot of wind setup the disclaimer already warns about. A spline would look
 * more precise and be no more true.
 *
 * REFUSES rather than extrapolating past either end of the curve, and refuses
 * rather than drawing a line across a hole wider than `MAX_GAP_FACTOR` steps.
 * An extrapolated tide is an invented tide.
 */
export function tideAt(curve: TideCurve, instant: Date): TideResult<TideHeight> {
  const samples = curve.samples;
  if (!Array.isArray(samples) || samples.length === 0) {
    return refuse("no-data", "There is no tide curve for this station, so no height is shown.");
  }

  const ms = instantMs(instant);
  if (!Number.isFinite(ms)) {
    return refuse("bad-request", "No valid time was given, so no tide height is shown.");
  }

  const first = samples[0].at.getTime();
  const last = samples[samples.length - 1].at.getTime();
  if (ms < first || ms > last) {
    return refuse(
      "out-of-range",
      "That moment is outside the tide data we have, so no height is shown.",
      `${new Date(ms).toISOString()} not in ${samples[0].at.toISOString()}…${samples[
        samples.length - 1
      ].at.toISOString()}`,
    );
  }

  const i = floorIndex(samples, ms);
  const lower = samples[i];
  if (lower.at.getTime() === ms) {
    return resultOk({
      instant: new Date(ms),
      height: lower.height,
      units: curve.provenance.units,
      datum: curve.provenance.datum,
      interpolated: false,
      provenance: curve.provenance,
    });
  }

  // A single-point curve can only answer at its own instant, handled above.
  const upper = samples[i + 1];
  if (upper === undefined) {
    return refuse(
      "out-of-range",
      "That moment is outside the tide data we have, so no height is shown.",
    );
  }

  const spanMin = (upper.at.getTime() - lower.at.getTime()) / MS_PER_MINUTE;
  const maxGap = curve.stepMinutes * MAX_GAP_FACTOR;
  if (!Number.isFinite(spanMin) || spanMin <= 0 || spanMin > maxGap) {
    return refuse(
      "gap",
      "There is a gap in the tide data around that time, so no height is shown.",
      `${spanMin} min gap, limit ${maxGap}`,
    );
  }

  const f = (ms - lower.at.getTime()) / (upper.at.getTime() - lower.at.getTime());
  const height = lower.height + (upper.height - lower.height) * f;
  if (!Number.isFinite(height)) {
    return refuse("unparsable-value", "The tide height could not be computed for that time.");
  }

  return resultOk({
    instant: new Date(ms),
    height,
    units: curve.provenance.units,
    datum: curve.provenance.datum,
    interpolated: true,
    provenance: curve.provenance,
  });
}

/** The answer `tideDirection` gives. */
export interface TideMotion {
  readonly instant: Date;
  readonly direction: TideDirection;
  /** Signed rate of change, `units` per hour. Positive is rising. */
  readonly ratePerHour: number;
  /** The threshold `direction` was called against. Stated, not hidden. */
  readonly slackThresholdPerHour: number;
  readonly provenance: TideProvenance;
}

/**
 * PURE. Which way the water is going at a moment.
 *
 * Differenced across a window CENTRED on the instant (±15 min, clamped to the
 * curve) rather than read off the segment slope — see `DIRECTION_PROBE_MIN` for
 * why a segment slope can never report slack and mislabels the minutes either
 * side of a turn.
 *
 * `slack` is a STATED CONVENTION with the threshold returned alongside the
 * answer, not a fact about the ocean. A surface that wants to argue with the
 * threshold has the number to argue with.
 */
export function tideDirection(curve: TideCurve, instant: Date): TideResult<TideMotion> {
  const samples = curve.samples;
  if (!Array.isArray(samples) || samples.length === 0) {
    return refuse("no-data", "There is no tide curve for this station, so no direction is shown.");
  }
  if (samples.length === 1) {
    return refuse(
      "out-of-range",
      "There is only one tide reading for this station, which is not enough to say " +
        "whether the water is rising or falling.",
    );
  }

  const ms = instantMs(instant);
  if (!Number.isFinite(ms)) {
    return refuse("bad-request", "No valid time was given, so no tide direction is shown.");
  }

  const first = samples[0].at.getTime();
  const last = samples[samples.length - 1].at.getTime();
  if (ms < first || ms > last) {
    return refuse(
      "out-of-range",
      "That moment is outside the tide data we have, so no direction is shown.",
    );
  }

  const probe = DIRECTION_PROBE_MIN * MS_PER_MINUTE;
  const aMs = Math.max(first, ms - probe);
  const bMs = Math.min(last, ms + probe);
  if (bMs <= aMs) {
    return refuse(
      "out-of-range",
      "There is not enough tide data around that time to say which way the water is going.",
    );
  }

  const a = tideAt(curve, new Date(aMs));
  if (a.status !== "ok") return a;
  const b = tideAt(curve, new Date(bMs));
  if (b.status !== "ok") return b;

  const hours = (bMs - aMs) / 3_600_000;
  const ratePerHour = (b.value.height - a.value.height) / hours;
  if (!Number.isFinite(ratePerHour)) {
    return refuse("unparsable-value", "The tide direction could not be computed for that time.");
  }

  const threshold = SLACK_RATE_PER_HOUR[curve.provenance.units];
  const direction: TideDirection =
    Math.abs(ratePerHour) < threshold ? "slack" : ratePerHour > 0 ? "rising" : "falling";

  return resultOk({
    instant: new Date(ms),
    direction,
    ratePerHour,
    slackThresholdPerHour: threshold,
    provenance: curve.provenance,
  });
}

/**
 * PURE. The stretch of curve inside a window — the shaded shooting window.
 *
 * Returns the samples strictly inside `[from, to]` plus INTERPOLATED endpoints
 * at `from` and `to` themselves, so the shaded band starts and ends exactly at
 * legal light rather than snapping to the nearest hour. Both endpoints go
 * through `tideAt`, so both inherit its out-of-range and gap refusals: a window
 * that runs past the end of the data does not get half a band, it gets a
 * refusal.
 */
export function tideCurveSlice(
  curve: TideCurve,
  from: Date,
  to: Date,
): TideResult<TideCurve> {
  const fromMs = instantMs(from);
  const toMs = instantMs(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return refuse("bad-request", "No valid window was given, so no tide band is drawn.");
  }
  if (toMs < fromMs) {
    return refuse("bad-request", "That tide window ends before it begins.");
  }

  const start = tideAt(curve, from);
  if (start.status !== "ok") return start;
  const end = tideAt(curve, to);
  if (end.status !== "ok") return end;

  const inner = curve.samples.filter((s) => {
    const t = s.at.getTime();
    return t > fromMs && t < toMs;
  });

  return resultOk({
    provenance: curve.provenance,
    stepMinutes: curve.stepMinutes,
    samples: [
      { at: start.value.instant, height: start.value.height },
      ...inner,
      ...(toMs === fromMs ? [] : [{ at: end.value.instant, height: end.value.height }]),
    ],
  });
}

/**
 * PURE. A height as a hunter says it.
 *
 * One decimal. CO-OPS publishes three, but the third is thousandths of a foot on
 * a number that wind moves by a foot — printing it would claim a precision the
 * prediction does not have. Refuses to render a non-finite height as anything;
 * there is no fallback string that reads like a number.
 */
export function formatTideHeight(height: number, units: TideUnits): string | null {
  if (!Number.isFinite(height)) return null;
  return `${height.toFixed(1)} ${units === "english" ? "ft" : "m"}`;
}
