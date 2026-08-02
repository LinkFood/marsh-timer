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
 * times, and — the reading that actually matters and that almost nobody prints —
 * HOW MANY OF THE DARK HOURS THE MOON WAS ACTUALLY ABOVE THE HORIZON. See
 * `./moonNight.ts`. "94% lit" is a fact about the moon and nearly nothing about
 * the night; a 94% moon that sets at nine leaves eight hours of black.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE MECHANISM SENTENCE, AND THE THING IT REFUSES TO SAY.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Where the inputs support it the rail states the mechanism — "if it was clear
 * they could see to feed all night" — in the hunter's own conditional grammar.
 * That sentence is a statement about what the geometry PERMITS, and its gate is
 * printed on the screen next to it (the lit fraction and the hours up), so there
 * is no hidden threshold doing the talking.
 *
 * IT IS CONDITIONAL BECAUSE THE CONDITION IS GENUINELY UNKNOWN. Overnight cloud
 * cover is not on this phone and cannot be derived from a date and a coordinate.
 * So the rail says so, out loud, every time it makes the claim. Dropping the
 * "if it was clear" would be the `?? 0` bug rewritten as prose: an absent input
 * silently defaulting to the value that makes the sentence work.
 *
 * It is never a verdict. It does not say the birds fed, it does not say they
 * will not fly this morning, and it does not tell him whether to go. He
 * conjoins the facts; that is his job and he is better at it than we are.
 */

import type { ReactNode } from "react";
import { moonState } from "@/lib/sky";
import { Claim, Rail, RailLabel, Reading, Receipt } from "./Instrument";
import { INK_LABEL } from "./ink";
import { formatClock, formatHours, skyDayFor } from "./fieldTime";
import type { NightMoon } from "./moonNight";

/**
 * The lit fraction at or above which the geometry can permit night feeding.
 *
 * Half. Stated here and PRINTED ON THE SURFACE next to the reading it gates, so
 * the hunter can disagree with it — a threshold he cannot see is a threshold
 * making the claim on his behalf. This gates a sentence about what the light
 * PERMITS, not a claim about what happened.
 */
const FEED_LIGHT_FRACTION = 0.5;

/** And the moon has to have been up for most of the dark, not just some of it. */
const FEED_NIGHT_FRACTION = 0.8;

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

export function SkyRail({
  sunrise,
  sunset,
  polar,
  moonRise,
  moonSet,
  night,
  day,
}: {
  sunrise: Date | null;
  sunset: Date | null;
  polar: string | null;
  moonRise: Date | null;
  moonSet: Date | null;
  night: NightMoon;
  /** The calendar day these readings are for. Computed on device from it. */
  day: string;
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

  // The sentence states the MECHANISM and nothing else. It deliberately does not
  // restate the lit fraction or the hours-up, because both are printed directly
  // above it — repeating them was two lines of glass buying nothing, on a screen
  // that must not scroll. The gate is `FEED_LIGHT_FRACTION` / `FEED_NIGHT_FRACTION`
  // and the readings it is gated on are the ones the hunter can see.
  let mechanism: string | null = null;
  if (night.status === "ok" && litPct !== null) {
    if (litEnough && night.allNight) {
      mechanism = "Up all night and over half lit — if clear, they fed all night.";
    } else if (litEnough && upEnough) {
      mechanism = "Enough moon, up most of the dark — if clear, they could feed.";
    } else if (night.neverUp) {
      mechanism = "The moon never cleared the horizon. It was not the light.";
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
      <div className="mt-1 flex items-baseline gap-1.5">
        <RailLabel>up overnight</RailLabel>
        {night.status === "ok" && aboveHours !== null && darkHours !== null ? (
          <Reading size="md">{`${aboveHours} of ${darkHours} dark hrs`}</Reading>
        ) : (
          <Reading size="md">not computable</Reading>
        )}
      </div>

      {night.status === "unknown" ? (
        <p className="mt-0.5 font-mono text-[11px] leading-[1.45] text-amber-300/85">
          {night.message}
        </p>
      ) : null}

      {mechanism ? (
        <Claim className="mt-0.5 text-[12px] leading-snug !text-amber-300/80">{mechanism}</Claim>
      ) : null}

      <Receipt
        items={[
          "computed on device from your coordinates · NOAA solar, Schlyter lunar",
          // The stated absence. It is the input the sentence above is missing,
          // and it is said every time that sentence is made.
          "overnight cloud cover is NOT known here — the sentence above assumes a clear sky this phone cannot check",
        ]}
        className="mt-1"
      />
    </Rail>
  );
}
