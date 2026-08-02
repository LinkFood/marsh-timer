/**
 * TideRail.tsx — the water gate. DIRECTION FIRST, HEIGHT SECOND.
 *
 * A hunter reads the tide as a verb before he reads it as a number. Falling
 * water pushes birds off the flats and onto the guts; rising water floats them
 * back up into the grass. That is the thing he needs in half a second, so
 * FALLING / RISING / SLACK is set large with an arrow, and the feet above datum
 * are the receipt underneath it.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * EVERY NUMBER HERE COMES OFF DATA ALREADY IN HIS POCKET.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `tideAt` and `tideDirection` are the pure readers from `src/lib/tide.ts` and
 * they take a materialized curve, never an address. The curve comes from
 * `./tidePocket.ts`, which reads `localStorage` and nothing else. There is no
 * request in this render path and structurally nowhere to put one.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * A PREDICTION IS NOT A READING, AND THE CARD SAYS SO EVERY TIME.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `TideProvenance.kind` is the literal `"prediction"` with no second member —
 * there is no assignment in this codebase that can relabel it as observed. Wind
 * and barometric pressure routinely push real Chesapeake water a foot off
 * prediction and a hard northwest blow can strip Fishing Bay below any predicted
 * low, so the word PREDICTED rides on the reading itself and the full disclaimer
 * rides in the receipt. It is not a disclaimer in the legal sense. It is the
 * difference between a tide chart and a gauge, and he is entitled to know which
 * one is under his thumb.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE REFUSAL IS THE LIKELY RENDER AT BLACKWATER, NOT THE EDGE CASE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The nearest CO-OPS prediction station to Blackwater NWR is Woolford / Church
 * Creek 8571807, 7.00 miles, and it is a SUBORDINATE station — it publishes
 * highs and lows and no continuous curve at any interval. So "no curve for this
 * station" is a first-class outcome here. It renders at the weight of a reading,
 * in its own words, and it never renders as a flat line at zero. At MLLW, 0.0 ft
 * is a real and ordinary water level, which is exactly what would make that
 * fabrication invisible.
 */

import { formatTideHeight, tideAt, tideDirection, type TideResult } from "@/lib/tide";
import { Rail, RailLabel, Reading, Receipt, Refusal } from "./Instrument";
import { INK_READING } from "./ink";
import type { PocketCurve } from "./tidePocket";

/** The glyph for each direction. Shape, not colour — colour is reserved. */
const ARROW: Record<string, string> = {
  rising: "▲",
  falling: "▼",
  slack: "—",
};

/** Age of the saved prediction, in whole days, or `null` if unreadable. */
function ageInDays(fetchedAt: string, now: Date): number | null {
  const then = Date.parse(fetchedAt);
  const nowMs = now?.getTime?.();
  if (!Number.isFinite(then) || typeof nowMs !== "number" || !Number.isFinite(nowMs)) return null;
  const days = Math.floor((nowMs - then) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export function TideRail({
  pocket,
  now,
}: {
  pocket: TideResult<PocketCurve>;
  now: Date;
}) {
  if (pocket.status !== "ok") {
    return (
      <Rail className="py-2">
        <RailLabel>tide</RailLabel>
        <div className="mt-1">
          {/* The refusal keeps its full weight and its own words. What left is
              the SOURCE line — `NOAA CO-OPS`, `downloaded at PREP` — which is
              provenance about the instrument, not a reason this slot is empty,
              and it now prints once at the foot instead of here and again under
              the reading it would have replaced. */}
          <Refusal headline="No water is shown." message={pocket.message} />
        </div>
      </Rail>
    );
  }

  const { curve, stationName, fetchedAt } = pocket.value;
  const motion = tideDirection(curve, now);
  const height = tideAt(curve, now);
  const age = ageInDays(fetchedAt, now);

  // Both readers refuse out of range and across a gap rather than extrapolating.
  // A pocket that ran out yesterday says so; it does not draw yesterday's water.
  if (motion.status !== "ok") {
    return (
      <Rail className="py-2">
        <RailLabel>tide</RailLabel>
        <div className="mt-1">
          {/* The station and the age STAY on this one, because here they are not
              provenance — they are the reason. "The saved water does not reach
              this moment" is only checkable if he can see which pack it was and
              how old. That is a denominator. */}
          <Refusal
            headline="The saved water does not reach this moment."
            message={motion.message}
            cite={[
              `station ${curve.provenance.stationId}`,
              stationName,
              age !== null ? `saved ${age}d ago` : null,
            ]}
          />
        </div>
      </Rail>
    );
  }

  const feet = height.status === "ok" ? formatTideHeight(height.value.height, height.value.units) : null;

  return (
    <Rail className="py-1">
      <div className="flex items-baseline justify-between gap-2">
        <RailLabel>tide</RailLabel>
        <RailLabel>predicted</RailLabel>
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-3">
        <span className="flex items-baseline gap-2">
          <span className={`font-mono text-[20px] leading-none ${INK_READING}`} aria-hidden="true">
            {ARROW[motion.value.direction] ?? "—"}
          </span>
          <Reading size="lg" className="uppercase tracking-[0.06em]">
            {motion.value.direction}
          </Reading>
        </span>
        {/* A height we could not compute renders as a stated absence, never as
            a number. `formatTideHeight` returns null rather than a fallback. */}
        <span className="flex items-baseline gap-1.5">
          <Reading size="lg">{feet ?? "no height"}</Reading>
          <RailLabel>{curve.provenance.datum}</RailLabel>
        </span>
      </div>

      {/* THE RATE AND THE SLACK THRESHOLD ARE A DENOMINATOR, not a method. The
          rail prints the word FALLING; the threshold is what makes that word
          checkable, and without it SLACK is an opinion. It stays on the glass in
          every mode.

          The station name, the pack's age and the prediction disclaimer moved to
          the foot block. The word `predicted` is still in the label row above —
          which one is under his thumb is a reading, the paragraph about wind and
          barometric pressure moving real water is provenance. */}
      <Receipt
        items={[
          `${motion.value.ratePerHour >= 0 ? "+" : ""}${motion.value.ratePerHour.toFixed(2)} ${
            curve.provenance.units === "english" ? "ft" : "m"
          }/h, slack under ${motion.value.slackThresholdPerHour}`,
        ]}
        className="mt-0.5"
      />
    </Rail>
  );
}
