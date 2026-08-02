/**
 * TopRail.tsx — where he is, which day, and the only navigation on the surface.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * TIME IS THE NAVIGATION. THERE IS NOTHING ELSE TO NAVIGATE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * There are no tabs on this product and no routes off it. The only thing a
 * hunter ever wants to move is WHICH DAY, so the day is the only control: a
 * nudge back, a nudge forward, and a return to today when he has wandered.
 * Changing it recomputes the same single screen — same rails, same order, same
 * positions — so nothing he learned about where a number lives stops being true
 * because he looked at Thursday.
 *
 * It is deliberately a NUDGE and not a picker. A calendar popover is a modal, a
 * modal in a blind is a trap for a mis-tap, and the days he actually wants are
 * adjacent to the one he is on. The buttons are 44px and separated, so the
 * back-arrow and the forward-arrow cannot be confused by a gloved thumb.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE SPOT IS FROZEN AND THIS RAIL SAYS SO.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `src/lib/spot.ts` resolves the county, the state and the tide station ONCE, at
 * save time, on the couch, with bars — and nothing re-resolves them. This rail
 * prints the frozen coordinates to four decimals rather than a friendly place
 * name alone, because the coordinates are what every number below was computed
 * from and a hunter who has moved his blind needs to be able to see that the app
 * has not moved with him.
 */

import { Rail, RailLabel, Reading, Receipt, Refusal } from "./Instrument";
import type { FieldMode } from "./fieldSeason";
import type { Spot } from "@/lib/spot";

const WEEKDAY = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

/** 44px, separated, unmistakable under a glove. */
function Nudge({
  onClick,
  label,
  glyph,
}: {
  onClick: () => void;
  label: string;
  glyph: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-md border border-amber-500/20 font-mono text-[16px] text-amber-400/80"
    >
      {glyph}
    </button>
  );
}

export function TopRail({
  spot,
  day,
  isToday,
  onPrev,
  onNext,
  onToday,
  mode,
  forced,
  onForce,
}: {
  spot: Spot | null;
  /** `YYYY-MM-DD`, the hunter's own calendar. */
  day: string;
  isToday: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  /** The DERIVED mode. A readout, not a control. */
  mode: FieldMode;
  /** True when the hunter has forced it this session. */
  forced: boolean;
  onForce: (m: FieldMode | null) => void;
}) {
  // Built from the STRING through UTC so the label names the day he asked for
  // and not the day the machine's offset drags it into.
  const [y, m, d] = day.split("-").map(Number);
  const labelDate =
    Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
      ? new Date(Date.UTC(y, m - 1, d, 12))
      : null;
  const dayLabel = labelDate ? WEEKDAY.format(labelDate) : day;

  if (spot === null) {
    return (
      <Rail first className="py-3">
        <Refusal
          headline="No spot is saved."
          message={
            "Every number on this screen is computed from your own coordinates, so there is " +
            "nothing to compute until a spot is frozen. Save it at PREP, with signal — the " +
            "county, the state and the tide station are resolved once and never asked for again."
          }
        />
      </Rail>
    );
  }

  return (
    <Rail first className="py-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-display text-[17px] leading-tight text-amber-400">
            {spot.name}
          </p>
          <Receipt
            items={[
              `${spot.lat.toFixed(4)}, ${spot.lng.toFixed(4)}`,
              spot.county_name,
              spot.state,
            ]}
          />
          {/* THE ANNUNCIATOR. It reports the mode the app derived from
              time-to-hunt; the two words beside it force it for this session
              only. Session-only is the load-bearing part — a forced PLAN that
              persisted would still be forced at 05:15 on the opener, which is
              the one morning it must not be. */}
          <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-amber-500/45">
            <span>{mode}</span>
            {(["field", "prep", "plan"] as const)
              .filter((m) => m !== mode)
              .map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onForce(m)}
                  /* `py-2 -my-2` buys a ~30px hit area without spending a single
                     pixel of layout height. This control stays visually tiny on
                     purpose — it is never the way to the right answer — but a
                     14px target that a gloved thumb genuinely cannot hit is a
                     control that does not exist. */
                  className="-my-2 py-2 text-amber-500/30 underline underline-offset-2"
                >
                  {m}
                </button>
              ))}
            {forced ? (
              <button
                type="button"
                onClick={() => onForce(null)}
                className="-my-2 py-2 text-amber-500/30 underline underline-offset-2"
              >
                auto
              </button>
            ) : null}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Nudge onClick={onPrev} label="Previous day" glyph="◀" />
          <button
            type="button"
            onClick={onToday}
            aria-label={isToday ? "Showing today" : "Back to today"}
            className="flex h-[44px] min-w-[86px] flex-col items-center justify-center rounded-md border border-amber-500/20 px-2"
          >
            <Reading size="md" className="whitespace-nowrap">
              {dayLabel}
            </Reading>
            <RailLabel>{isToday ? "today" : "tap for today"}</RailLabel>
          </button>
          <Nudge onClick={onNext} label="Next day" glyph="▶" />
        </div>
      </div>
    </Rail>
  );
}
