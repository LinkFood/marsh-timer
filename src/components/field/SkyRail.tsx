/**
 * SkyRail.tsx — sun and moon, side by side, both as MEASUREMENTS.
 *
 * Two columns because they are read together and because two columns is how six
 * readings fit above the fold without a scrollbar. Hierarchy on this surface
 * comes from size and position, never from a door.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE MOON STAYS, AND IT STAYS AS A MEASUREMENT.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `sky.ts` deleted the edge function's `excellent | good | fair | poor` rating
 * and said why in its header: a rating is a prediction wearing a number, telling
 * a hunter the birds will fly from lunar geometry alone, with no evidence and no
 * way to be wrong. Nothing here brings that back under a different noun. There
 * is no score on this rail, no rating, no stars, no "good moon", and no arrow
 * pointing at a verdict.
 *
 * What there is: the illuminated fraction, the phase name, the rise and set
 * times, HOW MANY OF THE DARK HOURS THE MOON WAS ACTUALLY ABOVE THE HORIZON
 * (see `./moonNight.ts`), and — the thing that turns any of it into a reading a
 * hunter can place — HOW OFTEN A NIGHT THIS LIT COMES ROUND IN HIS OWN SEASON.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT THIS RAIL USED TO SAY, AND WHY IT NO LONGER SAYS IT.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * It used to close with *"Enough moon, up most of the dark — if clear, they
 * could feed."* Every word of that is defensible in isolation. Read at 05:15
 * with a gun in the other hand it is not read in isolation: it is read as
 * "…and therefore your morning is dead."
 *
 * THAT LINK HAS NEVER BEEN MEASURED BY ANYONE.
 * `docs/MOONLIGHT-AND-THE-MORNING-2026-08-01.md` §2(c) went looking for it and
 * found an empty literature — zero hits in Europe PMC full text, zero
 * occurrences of `moon`, `lunar`, `nocturnal` or `night` in the canonical
 * 21-season hunter-success model or its reference list. The one direct test that
 * exists anywhere, run for that dossier on 105 GPS-tagged ducks and 1,984
 * bird-days, came back at **−0.4%, 95% CI −9% to +9%** — a zero whose interval
 * excludes any suppression larger than about nine percent. The same data found
 * the ducks moved **23% MORE** on bright clear nights, and no less the next day.
 *
 * So the rail now separates the two halves that sentence welded together:
 *
 *   THE CLAIM (serif)   states only what is measured — that more usable light
 *                       lengthens night feeding. Lameris 2021: +3.6 min foraging
 *                       per hour of moon above the horizon. That half is solid.
 *   THE DISCLOSURE      says, at reading weight and in the product's own voice,
 *   (mono)              that the next link is unmeasured, and the receipt
 *                       carries the one estimate with its interval.
 *
 * The claim never reaches this morning. It cannot: nothing on this rail knows
 * anything about this morning, and the previous copy's implication that it did
 * is the exact failure this product was built to refuse.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE THREE THINGS THIS RAIL MUST NEVER DO. (dossier §5)
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * 1. NEVER enter illumination and hours-above-horizon as two predictors or two
 *    scores. Measured at r = 0.988 over 1,090 Blackwater season-nights — at
 *    mid-latitudes in winter they are one variable measured twice. Both are
 *    PRINTED here, because printing two readings is not modelling two variables,
 *    but `./moonBaseRate.ts` counts on illumination ALONE and says so.
 *
 * 2. NEVER code cloud as "blocks the moon". Kyba 2011 measured cloud
 *    AMPLIFYING sky luminance 10.1× inside a city and 2.8× at 32 km, and
 *    van Hasselt found the same sign flip in geese. Near Cambridge, Easton,
 *    Annapolis or Baltimore a cloud-subtracts rule is a known-wrong physical
 *    model. There is no cloud gate on this rail at all — cloud is an input this
 *    phone does not have, the receipt says so, and it says which way the missing
 *    input can cut.
 *
 * 3. NEVER show the moon on a tidal site without the dawn tide beside it. At
 *    Bishops Head the spring-vs-quarter difference at 07:00 is 1.59 ft — 19
 *    inches of water on the marsh at shooting time, locked to lunar phase, with
 *    zero photons in it: the hunter's exact symptom by a completely different
 *    cause. `./dawnTide.ts` renders on EVERY path, present or refused. There is
 *    no branch here that drops it, and its sign is read per station because the
 *    sign genuinely reverses between stations on this coast.
 */

import type { ReactNode } from "react";
import { moonState } from "@/lib/sky";
import { Claim, Rail, RailLabel, Reading, Receipt } from "./Instrument";
import { INK_LABEL } from "./ink";
import { dawnTideClock, dawnTideSentence } from "./dawnTide";
import { formatClock, formatHours, skyDayFor } from "./fieldTime";
import { formatBaseRatePercent, moonBaseRate } from "./moonBaseRate";
import type { NightMoon } from "./moonNight";

/**
 * The lit fraction at or above which the geometry can lengthen night feeding.
 *
 * Half. Stated here and PRINTED ON THE SURFACE next to the reading it gates, so
 * the hunter can disagree with it — a threshold he cannot see is a threshold
 * making the claim on his behalf. This gates a sentence about what the light
 * PERMITS, and it has never gated a sentence about this morning.
 */
const FEED_LIGHT_FRACTION = 0.5;

/** And the moon has to have been up for most of the dark, not just some of it. */
const FEED_NIGHT_FRACTION = 0.8;

/**
 * THE DISCLOSURE. One string, one place, rendered on every branch that makes a
 * claim about the night.
 *
 * It is a constant rather than a line inside each branch ON PURPOSE: a per-branch
 * copy is a per-branch opportunity to forget it, and the forgetting would be
 * silent and would look exactly like the old rail.
 */
const NEVER_MEASURED =
  "Whether that changes this morning has never been measured — not in ducks, not in anything.";

function Col({ children }: { children: ReactNode }) {
  return <div className="min-w-0 flex-1">{children}</div>;
}

/** `↑ 6:33 AM` / `↓ 7:38 PM`, or a stated absence. Never a blank. */
function Event({ mark, at, label }: { mark: string; at: Date | null; label: string }) {
  const t = formatClock(at);
  return (
    <span className="flex items-baseline gap-1">
      <span className={`font-mono text-[11px] ${INK_LABEL}`} aria-hidden="true">
        {mark}
      </span>
      <Reading size="md" aria-label={label}>
        {t ?? "none"}
      </Reading>
    </span>
  );
}

/** A label-and-reading pair on its own line. The rail's own idiom, reused. */
function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-0.5 flex items-baseline gap-1.5">
      <RailLabel>{label}</RailLabel>
      {children}
    </div>
  );
}

/**
 * The mono voice for a stated absence or a stated limit. READING WEIGHT, and it
 * is not dimmed — `Instrument.tsx` rule 4: an absence is set at the weight of a
 * reading, or a hunter learns to read it as "nothing much today" instead of
 * "the app does not know".
 *
 * 10px rather than the 11px the rail used, which is the one honest place there
 * was height to find. It is NOT a `Reading` and it is NOT overriding a `Reading`
 * size through `className` — `Instrument.tsx` documents at length why that
 * silently renders at the wrong size, and adding a rung to that ladder is not in
 * this change's remit.
 */
function Note({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 font-mono text-[10px] leading-[1.35] text-amber-300/85">{children}</p>;
}

export function SkyRail({
  sunrise,
  sunset,
  polar,
  moonRise,
  moonSet,
  night,
  day,
  stationId,
}: {
  sunrise: Date | null;
  sunset: Date | null;
  polar: string | null;
  moonRise: Date | null;
  moonSet: Date | null;
  night: NightMoon;
  /** The calendar day these readings are for. Computed on device from it. */
  day: string;
  /**
   * The CO-OPS station this spot is bound to, off the frozen spot.
   *
   * Required, and `null` is a real value rather than an omission. The dawn tide
   * clock is read PER STATION and its sign reverses between stations on this
   * coast, so a rail that could not name its station would have to either
   * generalise (wrong) or stay silent (also wrong — dossier §5 rule 3). It
   * names it, or it refuses by name.
   */
  stationId: string | null;
}) {
  // `skyDayFor` rather than parsing a datetime string: `sky.ts` floors whatever
  // it is handed through `utcDayStart`, so the UTC-midnight instant is the exact
  // input it wants and there is no engine-specific string parsing in the path.
  const skyDay = skyDayFor(day);
  const moon = moonState(skyDay ?? new Date(NaN));
  const litPct = Number.isFinite(moon.illumination) ? Math.round(moon.illumination * 100) : null;

  const aboveHours = night.status === "ok" ? formatHours(night.aboveMs) : null;
  const darkHours = night.status === "ok" ? formatHours(night.darkMs) : null;

  // The gate for the mechanism sentence. Both halves are printed above it.
  const litEnough = moon.illumination >= FEED_LIGHT_FRACTION;
  const upEnough =
    night.status === "ok" && night.darkMs > 0 && night.aboveMs / night.darkMs >= FEED_NIGHT_FRACTION;

  // THE DENOMINATOR. Illumination only — see `./moonBaseRate.ts`, and rule 1 in
  // this file's header for why hours-up must not join it.
  const rate = moonBaseRate(moon.illumination);

  // Renders on every path. See rule 3.
  const tide = dawnTideClock(stationId);

  // The claim states the MECHANISM and stops at what is measured. It does not
  // restate the lit fraction or the hours-up, because both are printed directly
  // above it, and it does not reach this morning, because nothing here knows
  // anything about this morning.
  let mechanism: string | null = null;
  if (night.status === "ok" && litPct !== null) {
    if (litEnough && night.allNight) {
      mechanism = "Up all night and over half lit. Light like that lengthens night feeding.";
    } else if (litEnough && upEnough) {
      mechanism = "Enough moon, up most of the dark. Light like that lengthens night feeding.";
    } else if (night.neverUp) {
      mechanism = "The moon never cleared the horizon. There was no moonlight to feed by.";
    } else if (!litEnough) {
      mechanism = "Under half a disc — not much light to feed by.";
    } else {
      mechanism = "Over half lit, but down most of the dark. The rest was black.";
    }
  }

  return (
    <Rail className="py-1">
      {/* Two columns, because sun and moon are read together and because two
          columns is how six readings and the overnight span fit above the fold
          without a scrollbar. Nothing here moved behind a control. */}
      <div className="flex gap-4">
        <Col>
          <RailLabel>sun</RailLabel>
          <div className="mt-0.5 flex flex-col">
            <Event mark="↑" at={sunrise} label="Sunrise" />
            <Event mark="↓" at={sunset} label="Sunset" />
          </div>
          {polar && polar !== "none" ? (
            <p className="mt-0.5 font-mono text-[10px] leading-tight text-amber-300/85">
              {polar === "midnight-sun"
                ? "the sun does not set here today"
                : "the sun does not rise here today"}
            </p>
          ) : null}
        </Col>

        <Col>
          <div className="flex items-baseline justify-between gap-1">
            <RailLabel>moon</RailLabel>
            <span className={`truncate font-mono text-[9px] uppercase tracking-[0.08em] ${INK_LABEL}`}>
              {moon.phase}
            </span>
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <Reading size="lg">{litPct !== null ? `${litPct}%` : "—"}</Reading>
            <span className="flex flex-col">
              <Event mark="↑" at={moonRise} label="Moonrise" />
              <Event mark="↓" at={moonSet} label="Moonset" />
            </span>
          </div>
        </Col>
      </div>

      {/* The reading almost nobody prints: hours actually above the horizon,
          over the dark window. Illumination alone says very little about a
          night; a 94% moon that sets at nine leaves eight hours of black. */}
      <Line label="up overnight">
        {night.status === "ok" && aboveHours !== null && darkHours !== null ? (
          <Reading size="md">{`${aboveHours} of ${darkHours} dark hrs`}</Reading>
        ) : (
          <Reading size="md">not computable</Reading>
        )}
      </Line>

      {night.status === "unknown" ? <Note>{night.message}</Note> : null}

      {/* THE BASE RATE — what turns a number into a receipt. "80% lit" places
          nothing; "one morning in five" places it against the only population
          the hunter is actually in. Counted on illumination alone. */}
      <Line label={rate.status === "ok" && rate.tail === "dark" ? "this dark or darker" : "at least this lit"}>
        {rate.status === "ok" ? (
          <Reading size="md">{`${formatBaseRatePercent(rate)} of ${rate.n} season days`}</Reading>
        ) : (
          <Reading size="md">no denominator</Reading>
        )}
      </Line>

      {rate.status === "unknown" ? <Note>{rate.message}</Note> : null}

      {mechanism ? (
        <>
          <Claim className="mt-1 text-[12px] leading-snug !text-amber-300/80">{mechanism}</Claim>
          {/* THE DISCLOSURE. Reading weight, never dimmed, never a branch. */}
          <Note>{NEVER_MEASURED}</Note>
        </>
      ) : null}

      {/* RULE 3. Present or refused — never absent. The moon's largest measured
          effect on a tidal marsh is water, not light. */}
      <Line label="dawn tide">
        {tide.status === "ok" ? (
          <Reading size="md">{`${tide.deltaInches}" spring vs quarter`}</Reading>
        ) : (
          <Reading size="md">
            {tide.status === "inside-the-noise"
              ? "under the weather"
              : tide.stationId
                ? `not computed for ${tide.stationId}`
                : "no station bound"}
          </Reading>
        )}
      </Line>
      {tide.status === "ok" ? (
        <Note>{dawnTideSentence(tide)}</Note>
      ) : (
        <Note>{tide.message}</Note>
      )}

      <Receipt
        items={[
          "on device · NOAA solar, Schlyter lunar · illumination only — hours-up is the same variable (r = 0.988)",
          // The estimate and its interval. This is the finding the old copy's
          // implication was standing on, and it is a zero. It rides in the
          // receipt because a number with an n and a CI on it IS a citation,
          // and the receipt is this surface's citation line — always visible,
          // never behind a tap (`Instrument.tsx`, rule 3).
          "one direct test of last night on next morning: −0.4%, 95% CI −9% to +9% · 105 GPS ducks, 1,984 bird-days · same ducks moved 23% MORE on bright clear nights, no less next day",
          rate.status === "ok"
            ? `base rate over ${rate.n} published MD duck + goose season days, ${rate.firstDay} → ${rate.lastDay}`
            : null,
          // The stated absence, and WHICH WAY it can cut. Cloud is not coded as
          // a subtraction anywhere on this rail — see rule 2.
          "overnight cloud cover is NOT known here — and cloud does not simply subtract; near a town it reflects light back down",
          tide.status === "ok"
            ? `${tide.station.stationName} ${tide.station.stationId} · n = ${tide.station.nearFullN} full / ${tide.station.nearNewN} new / ${tide.station.quarterN} quarter · ${tide.station.window}`
            : "dawn tide read per station, never generalised — the spring sign at dawn reverses between stations here",
          "MOONLIGHT-AND-THE-MORNING-2026-08-01.md §2(c) §4.1 §5",
        ]}
        className="mt-1"
      />
    </Rail>
  );
}
