/**
 * dawnTide.ts — the tidal clock beside the moon. PER STATION, OR IT REFUSES.
 *
 * PURE. Reads the committed table in `src/data/dawnTide.ts` and nothing else.
 * No network, no storage, no React. The table's header carries the mechanism and
 * the sign-flip warning; this file is the resolution and the refusal.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHY THIS LINE IS MANDATORY AND NOT AN ENHANCEMENT.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The dossier's third standing rule for the moon card (§5): *"Never show a moon
 * card on a tidal site without the dawn tide stage beside it. At Bishops Head
 * the moon IS the tide, and the tide is 19 inches."*
 *
 * A moon block standing alone on a tidal marsh invites exactly one inference —
 * that the light did it — at the moment the strongest measured lunar effect on
 * that marsh is a foot and a half of water arriving on a lunar schedule with no
 * photons in it. So the line renders on every render. Present or refused, never
 * absent. `SkyRail` has no branch that drops it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE REFUSAL IS TODAY'S ANSWER, AND IT IS THE CORRECT ONE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The reference spot binds to Woolford / Church Creek 8571807. The dossier
 * measured Bishops Head 8571421. Those are different marshes and the sign of
 * this effect is known to reverse between stations on this coast — so printing
 * Bishops Head's numbers under a Woolford-bound spot would be a true statement
 * relocated into a false one, which is the single failure mode this line exists
 * to prevent. The lookup is keyed on the station id with no fallback, so that
 * substitution is not something a future caller can opt into by accident.
 *
 * When a pack for the bound station exists, the "ok" branch below renders it and
 * nothing else on the surface has to change. That branch is written, typed and
 * exercised now precisely so the pack work later is data and not a redesign.
 */

import { dawnTideStation, type DawnTideStation } from "@/data/dawnTide";

export type DawnTideClock =
  | {
      readonly status: "ok";
      readonly station: DawnTideStation;
      /** Sample-weighted mean dawn level across the near-full and near-new bins. */
      readonly springFt: number;
      readonly quarterFt: number;
      /** `quarterFt - springFt`. Positive means springs run LOWER at dawn here. */
      readonly deltaFt: number;
      /** `|deltaFt|` in whole inches, which is how a marsh is actually read. */
      readonly deltaInches: number;
      /** Where the spring-moon dawn level sits relative to the quarter moons. */
      readonly springStage: "lower" | "higher";
    }
  | {
      readonly status: "inside-the-noise";
      readonly station: DawnTideStation;
      readonly deltaFt: number;
      readonly message: string;
    }
  | {
      readonly status: "refused";
      /** The station that has no pack, when the spot named one. */
      readonly stationId: string | null;
      /** A sentence the hunter can read verbatim. States what is missing. */
      readonly message: string;
    };

/**
 * The dawn tide clock for the station this spot is bound to.
 *
 * `stationId` comes off the frozen spot. `null` is its own refusal rather than
 * a silent skip: a spot with no station is a spot whose water nobody can speak
 * for, and that is information the hunter should have in the same slot.
 */
export function dawnTideClock(stationId: string | null | undefined): DawnTideClock {
  const id = typeof stationId === "string" && stationId.trim() !== "" ? stationId.trim() : null;

  if (id === null) {
    return {
      status: "refused",
      stationId: null,
      message:
        "The moon sets the hour of high water, not just its height. No station is bound to this " +
        "spot, so none of it can be computed here.",
    };
  }

  const station = dawnTideStation(id);
  if (station === null) {
    return {
      status: "refused",
      stationId: id,
      message:
        "The moon sets the hour of high water, not just its height — feet of water at shooting " +
        "time on some marshes, with no light in it. None is packed for this one.",
    };
  }

  // Sample-weighted, because the two bins are not the same size and because a
  // straight average of two means is a third number belonging to nobody.
  const nSpring = station.nearFullN + station.nearNewN;
  const springFt =
    nSpring > 0
      ? (station.nearFullFt * station.nearFullN + station.nearNewFt * station.nearNewN) / nSpring
      : NaN;
  const deltaFt = station.quarterFt - springFt;

  if (!Number.isFinite(springFt) || !Number.isFinite(deltaFt)) {
    return {
      status: "refused",
      stationId: id,
      message: `The lunar tide pack for station ${id} could not be read, so no dawn water is shown.`,
    };
  }

  // Wind setup shifts LEVEL, not PHASE, so it does not erase this clock — the
  // dossier makes that argument explicitly and shows the 1.59 ft difference at
  // Bishops Head surviving at 2.7× the residual SD. But a phase difference
  // SMALLER than the weather noise is one the hunter will never see through a
  // northwest blow, and printing it at full confidence would be a precision
  // this measurement does not have.
  if (Math.abs(deltaFt) < station.windResidualSdFt) {
    return {
      status: "inside-the-noise",
      station,
      deltaFt,
      message:
        `At ${station.stationName} the moon moves the ${hourLabel(station.dawnHourLocal)} water ` +
        `by ${Math.abs(deltaFt).toFixed(2)} ft between spring and quarter moons, which is less ` +
        `than the ${station.windResidualSdFt.toFixed(2)} ft that wind alone moves it. The clock ` +
        "is here, but it is under the weather and no direction is claimed.",
    };
  }

  return {
    status: "ok",
    station,
    springFt,
    quarterFt: station.quarterFt,
    deltaFt,
    deltaInches: Math.round(Math.abs(deltaFt) * 12),
    springStage: deltaFt > 0 ? "lower" : "higher",
  };
}

/** `7` → `"07:00"`. The hour the pack was measured at, printed verbatim. */
export function hourLabel(hour: number): string {
  if (!Number.isFinite(hour)) return "dawn";
  const h = Math.trunc(hour);
  return `${h < 10 ? "0" : ""}${h}:00`;
}

/**
 * The one sentence, DERIVED FROM THE NUMBERS rather than written down.
 *
 * This is the guard that makes the sign-flip survivable. If the sentence were a
 * string in the table, a station added later with the opposite sign would get
 * whichever sentence its author happened to paste. Deriving it from `deltaFt`
 * means a row cannot disagree with its own copy.
 */
export function dawnTideSentence(clock: Extract<DawnTideClock, { status: "ok" }>): string {
  const at = hourLabel(clock.station.dawnHourLocal);
  const other = clock.springStage === "lower" ? "higher" : "lower";
  return (
    `Full and new moons put ${clock.springStage} water here at ${at} — ` +
    `${Math.abs(clock.deltaFt).toFixed(1)} ft ${other} on the quarters. That is the tide, not the light.`
  );
}
