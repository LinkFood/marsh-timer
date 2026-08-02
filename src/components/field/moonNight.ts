/**
 * moonNight.ts — how long the moon was actually up over the dark hours.
 *
 * PURE. Consumes `sunTimes` and `moonEvents` from `src/lib/sky.ts` and nothing
 * else. No network, no storage, no React.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS: ILLUMINATION IS NOT THE MEASUREMENT.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * "94% lit" is a fact about the moon and very nearly nothing about the night. A
 * 94% moon that sets at 9 p.m. leaves eight hours of black; a 40% moon that
 * rides from dusk to dawn lights the whole thing. The reading a hunter can
 * actually conjoin with the rest of the card is HOURS ABOVE THE HORIZON DURING
 * THE DARK, and that is what this module measures.
 *
 * It is a MEASUREMENT and it stays one. There is no rating here, no score, no
 * "good moon", no star. `sky.ts` deleted exactly that from the edge function
 * (its header, rule 2) and this module does not smuggle it back in wearing a
 * different noun.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * HOW IT IS COMPUTED WITHOUT AN ALTITUDE FUNCTION.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `sky.ts` does not export `moonAltitude` — it exports rise/set EVENTS. That is
 * enough, and using events rather than re-sampling the altitude curve means this
 * module cannot drift from the numbers the rest of the app prints.
 *
 * `moonEvents` reports the FIRST rise and FIRST set inside one UTC day, so three
 * consecutive days are collected — D-1, D, D+1. The dark window is at most about
 * fourteen hours and sits inside D and D+1, so the events bracketing it are
 * always in that 72-hour span even though the moon's ~24.8-hour cycle means a
 * single day can contain a rise with no set, or neither.
 *
 * The state at the START of the window is INFERRED FROM THE NEXT EVENT, not
 * assumed: if the first thing that happens after dark falls is a SET, the moon
 * was already up. If it is a RISE, it was down. If no event follows inside the
 * whole collected span, the last event before the window decides. If there is no
 * event at all in 72 hours — a real thing above the polar circles — this refuses
 * with `"unknown"` rather than reporting zero hours. A moon whose motion we
 * cannot reconstruct is not a moon that was down.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT IT WILL NOT SAY.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Whether that light reached the ground. Overnight cloud cover is not on this
 * phone and cannot be computed from a date and a coordinate. So the mechanism
 * sentence this feeds is conditional in the hunter's own grammar — "if it was
 * clear" — and the card states the missing input out loud. Implying a clear sky
 * we never measured would be the `?? 0` bug in prose.
 */

import { moonEvents, sunTimes } from "@/lib/sky";
import { skyDayFor } from "./fieldTime";

/** One continuous stretch with the moon above the horizon. */
export interface HorizonSpan {
  readonly start: Date;
  readonly end: Date;
}

export type NightMoon =
  | {
      readonly status: "ok";
      /** Sunset of the day asked about. */
      readonly windowStart: Date;
      /** Sunrise of the following day. */
      readonly windowEnd: Date;
      /** Length of the dark window, ms. */
      readonly darkMs: number;
      /** Time inside that window with the moon above the horizon, ms. */
      readonly aboveMs: number;
      readonly spans: readonly HorizonSpan[];
      /** True only when the moon was up for the entire window, edge to edge. */
      readonly allNight: boolean;
      /** True when the moon never cleared the horizon during the dark. */
      readonly neverUp: boolean;
    }
  | {
      readonly status: "unknown";
      /** A sentence the hunter can read verbatim. States what is missing. */
      readonly message: string;
    };

type Crossing = { readonly ms: number; readonly kind: "rise" | "set" };

const DAY_MS = 86_400_000;

/** One minute of slop, for the arithmetic sanity check at the end. */
const MINUTE = 60_000;

/**
 * Hours the moon spent above the horizon between sunset on `localDay` and
 * sunrise the next morning.
 *
 * `localDay` is `YYYY-MM-DD` in the hunter's own calendar, the same string the
 * regs table takes. See `skyDayFor` in `./fieldTime` for the UTC-day framing and
 * the stated longitude limit.
 */
export function moonThroughTheNight(lat: number, lng: number, localDay: string): NightMoon {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      status: "unknown",
      message: "No coordinates for this spot, so the moon's hours cannot be computed.",
    };
  }

  const day = skyDayFor(localDay);
  if (day === null) {
    return { status: "unknown", message: `"${localDay}" is not a date this app can read.` };
  }
  const nextDay = new Date(day.getTime() + DAY_MS);

  const tonight = sunTimes(lat, lng, day);
  const tomorrow = sunTimes(lat, lng, nextDay);

  if (tonight.sunset === null || tomorrow.sunrise === null) {
    return {
      status: "unknown",
      message:
        tonight.polar === "midnight-sun" || tomorrow.polar === "midnight-sun"
          ? "The sun does not set here on this date, so there is no dark window to measure."
          : "The sun does not rise or set here on this date, so there is no dark window to measure.",
    };
  }

  const windowStart = tonight.sunset;
  const windowEnd = tomorrow.sunrise;
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return {
      status: "unknown",
      message: "The dark window for this date could not be computed, so the moon's hours are not shown.",
    };
  }

  // D-1, D, D+1 — see the header for why three days and not one.
  const crossings: Crossing[] = [];
  for (const offset of [-DAY_MS, 0, DAY_MS]) {
    const ev = moonEvents(lat, lng, new Date(day.getTime() + offset));
    const rise = ev.rise?.getTime();
    const set = ev.set?.getTime();
    if (typeof rise === "number" && Number.isFinite(rise)) crossings.push({ ms: rise, kind: "rise" });
    if (typeof set === "number" && Number.isFinite(set)) crossings.push({ ms: set, kind: "set" });
  }
  crossings.sort((a, b) => a.ms - b.ms);

  if (crossings.length === 0) {
    return {
      status: "unknown",
      message:
        "The moon neither rose nor set within a day either side of this night, so this app " +
        "cannot say how long it was above the horizon. It will not report that as zero hours.",
    };
  }

  // State at the start of the window, inferred from the surrounding events.
  const after = crossings.find((c) => c.ms > startMs);
  let up: boolean;
  if (after) {
    up = after.kind === "set";
  } else {
    const before = crossings[crossings.length - 1];
    up = before.kind === "rise";
  }

  const spans: HorizonSpan[] = [];
  let cursor = startMs;
  let aboveMs = 0;

  for (const c of crossings) {
    if (c.ms <= startMs || c.ms >= endMs) continue;
    if (c.kind === "set" && up) {
      aboveMs += c.ms - cursor;
      spans.push({ start: new Date(cursor), end: new Date(c.ms) });
      up = false;
    } else if (c.kind === "rise" && !up) {
      cursor = c.ms;
      up = true;
    }
  }
  if (up) {
    aboveMs += endMs - cursor;
    spans.push({ start: new Date(cursor), end: new Date(endMs) });
  }

  const darkMs = endMs - startMs;
  if (!Number.isFinite(aboveMs) || aboveMs < 0 || aboveMs > darkMs + MINUTE) {
    return {
      status: "unknown",
      message: "The moon's hours above the horizon could not be reconstructed for this night.",
    };
  }

  return {
    status: "ok",
    windowStart,
    windowEnd,
    darkMs,
    aboveMs: Math.min(aboveMs, darkMs),
    spans,
    allNight: spans.length === 1 && spans[0].start.getTime() <= startMs && spans[0].end.getTime() >= endMs,
    neverUp: spans.length === 0,
  };
}
