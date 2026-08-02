/**
 * SkyRail.tsx — sun and moon, one line each, both as MEASUREMENTS.
 *
 * A rise and a set fit side by side on a 375px line with room to spare, so the
 * rail is a stack of full-width label-and-reading rows rather than two columns
 * of stacked pairs. Same readings, two thirds of the height, no door. Hierarchy
 * on this surface comes from size and position, never from a control.
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
 *   (mono)              that the next link is unmeasured, and carries the one
 *                       estimate with its interval.
 *
 * The claim never reaches this morning. It cannot: nothing on this rail knows
 * anything about this morning, and the previous copy's implication that it did
 * is the exact failure this product was built to refuse.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHERE EACH HALF LIVES NOW, AND WHY THEY LIVE APART.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * THE READINGS ARE FIELD. The lit fraction, the phase, the rise and set, the
 * hours above the horizon over the dark window, the base rate with its n, and
 * the dawn tide with its inches. All of them print in every mode, unchanged.
 * Every one of those carries its DENOMINATOR inline, because a denominator is
 * part of reading the number and he reads it in the moment.
 *
 * THE MECHANISM SENTENCE IS PREP. *"Enough moon, up most of the dark. Light like
 * that lengthens night feeding."* is a true statement about a night that has
 * already happened, and there is nothing a man standing in the water with a gun
 * can do with it. It belongs to the kitchen table the evening before, so it
 * renders when `mode` is not `"field"`. The same goes for the dawn-tide sentence
 * — the INCHES stay on the glass in every mode, the paragraph explaining which
 * way this particular station leans does not.
 *
 * THE DISCLOSURE IS EVERY MODE, and it moved to the foot of the surface —
 * `./provenance.ts`, `NEVER_MEASURED`. It is NOT gone and it is NOT behind
 * a tap; it is on the same screen, below, printed once instead of beside a claim
 * that is itself only shown half the time. That is deliberate: the disclosure
 * has to outlive the claim, because the moon NUMBERS print in FIELD whether the
 * sentence does or not, and a number is where the inference actually starts.
 *
 * REFUSALS DO NOT MOVE. `night.status === "unknown"`, `rate.status ===
 * "unknown"` and every branch of `dawnTideClock` that is not `ok` print their
 * reason right here, at reading weight, in every mode. A stated absence is a
 * reading and it keeps its slot.
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
 *    phone does not have, the foot provenance block says so, and it says which
 *    way the missing input can cut.
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
import { Claim, Rail, RailLabel, Reading } from "./Instrument";
import { INK_LABEL } from "./ink";
import { dawnTideClock, dawnTideSentence } from "./dawnTide";
import type { FieldMode } from "./fieldSeason";
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
    <div className="flex items-baseline gap-1.5">
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
  mode = "prep",
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
   * How far he is from the hunt. Not a style flag — it is the difference between
   * a man at a kitchen table and a man in the water, and only the prose changes.
   * Readings, denominators and refusals are identical in all three.
   *
   * Defaults to `"prep"`, the fuller render, so a caller that has not been
   * taught about the mode gets MORE prose rather than less. Losing a sentence
   * has to be a decision somebody made.
   */
  mode?: FieldMode;
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

  // PREP-WEIGHT. The claim states the MECHANISM and stops at what is measured.
  // It does not restate the lit fraction or the hours-up, because both are
  // printed directly above it, and it does not reach this morning, because
  // nothing here knows anything about this morning. It is not computed at all in
  // FIELD — see the header: there is nothing a man in the water does with a
  // statement about a night that is already over.
  const prose = mode !== "field";
  let mechanism: string | null = null;
  if (prose && night.status === "ok" && litPct !== null) {
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
      {/* SUN AND MOON WERE TWO COLUMNS OF STACKED PAIRS. They are now two full
          -width lines, and it is the same readings in less than two thirds of
          the height with no door added.

          The old shape stacked rise over set inside a half-width column, so the
          block was two label rows plus four reading rows deep. At 375px a rise
          and a set fit side by side on ONE line with room to spare — `↑ 6:33 AM
          ↓ 7:34 PM` is about 170px of a 343px measure — so the stack was buying
          nothing but height. Nothing was dropped, nothing shrank: the lit
          fraction is still the 20px reading it was, the times are still 14px,
          and the phase still rides beside the moon label. */}
      <div className="flex items-baseline gap-2">
        <RailLabel>sun</RailLabel>
        <span className="flex items-baseline gap-3">
          <Event mark="↑" at={sunrise} label="Sunrise" />
          <Event mark="↓" at={sunset} label="Sunset" />
        </span>
      </div>
      {polar && polar !== "none" ? (
        <p className="font-mono text-[10px] leading-tight text-amber-300/85">
          {polar === "midnight-sun"
            ? "the sun does not set here today"
            : "the sun does not rise here today"}
        </p>
      ) : null}

      <div className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <RailLabel>moon</RailLabel>
          <Reading size="lg">{litPct !== null ? `${litPct}%` : "—"}</Reading>
          <span className="flex items-baseline gap-3">
            <Event mark="↑" at={moonRise} label="Moonrise" />
            <Event mark="↓" at={moonSet} label="Moonset" />
          </span>
        </span>
        <span
          className={`shrink-0 truncate font-mono text-[9px] uppercase tracking-[0.08em] ${INK_LABEL}`}
        >
          {moon.phase}
        </span>
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

      {/* THE BASE RATE — what turns a number into a reading. "80% lit" places
          nothing; "one morning in five" places it against the only population
          the hunter is actually in. Counted on illumination alone. THE
          DENOMINATOR IS ON THE GLASS IN EVERY MODE — it is part of reading the
          number, not a note about how the number was made. */}
      <Line label={rate.status === "ok" && rate.tail === "dark" ? "this dark or darker" : "at least this lit"}>
        {rate.status === "ok" ? (
          <Reading size="md">{`${formatBaseRatePercent(rate)} of ${rate.n} season days`}</Reading>
        ) : (
          <Reading size="md">no denominator</Reading>
        )}
      </Line>

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

      {/* ── THE REFUSALS. Every mode, no exceptions, at reading weight. ────── */}
      {night.status === "unknown" ? <Note>{night.message}</Note> : null}
      {rate.status === "unknown" ? <Note>{rate.message}</Note> : null}
      {tide.status !== "ok" ? <Note>{tide.message}</Note> : null}

      {/* ── PREP PROSE. Read at the kitchen table, never with a gun in hand. ─ */}
      {mechanism ? (
        <Claim className="mt-1 text-[12px] leading-snug !text-amber-300/80">{mechanism}</Claim>
      ) : null}
      {prose && tide.status === "ok" ? <Note>{dawnTideSentence(tide)}</Note> : null}
    </Rail>
  );
}
