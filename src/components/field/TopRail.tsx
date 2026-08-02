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

import { Rail, RailLabel, Reading, Refusal } from "./Instrument";
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
      <Rail first className="py-2">
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
    <Rail first className="py-1">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {/* The coordinates are a DENOMINATOR — every number below this rail
              was computed from them, and a hunter who moved his blind can only
              see that the app did not move with him by reading them. They stay
              on the glass in every mode. */}
          <p className="truncate font-display text-[16px] leading-tight text-amber-400">
            {spot.name}
          </p>
          {/* MEASURED, NOT ASSUMED: these two lines cannot be merged. The day
              controls on the right take 186px of a 375px rail — three 44px tap
              targets and the date — so this column is about 150px wide, and
              `38.4436, -76.0722 · Dorchester County · MD` is 245px of 9.5px
              mono on its own. Putting the annunciator on the same line either
              wraps it (no saving) or truncates the coordinates, and the
              coordinates are the denominator of every number below this rail.

              THE ANNUNCIATOR reports the mode the app derived from time-to-hunt;
              the two words beside it force it for this session only. Session-
              only is the load-bearing part — a forced PLAN that persisted would
              still be forced at 05:15 on the opener, which is the one morning it
              must not be. */}
          <p className="flex flex-wrap items-center gap-x-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-amber-500/45">
            {/* THE COORDINATES AND THE STATE — the two things every number
                below was actually computed FROM. `sky.ts` takes the pair,
                `shootingHours.ts` takes the state, and a hunter who has moved
                his blind checks the pair. THE COUNTY NAME CAME OFF: it is a
                label rather than an input, nothing on this surface is derived
                from it, and it was the difference between one line and two in a
                150px column — the day controls take 186px of a 375px rail and
                that is not negotiable, they are three 44px tap targets. */}
            <span className="w-full normal-case tracking-normal text-amber-500/50">
              {`${spot.lat.toFixed(4)}, ${spot.lng.toFixed(4)}`}
              {spot.state ? ` · ${spot.state}` : ""}
            </span>
            <span className="shrink-0">{mode}</span>
            {(["field", "prep", "plan"] as const)
              .filter((m) => m !== mode)
              .map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onForce(m)}
                  /* An ABSOLUTELY POSITIONED hit area, not padding. This used
                     to be `py-2 -my-2` with a comment claiming it cost no
                     layout height — measured at 375px, it cost seventeen. A
                     negative margin does collapse the box, but it does not
                     collapse the line box of a WRAPPED flex row, and this row
                     wraps. `before:-inset-y-2` puts a ~30px target over a 13px
                     word and takes exactly zero pixels of the column.

                     The control stays visually tiny on purpose — it is never
                     the way to the right answer — but a 13px target a gloved
                     thumb cannot hit is a control that does not exist. */
                  className="relative text-amber-500/30 underline underline-offset-2 before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']"
                >
                  {m}
                </button>
              ))}
            {forced ? (
              <button
                type="button"
                onClick={() => onForce(null)}
                className="relative text-amber-500/30 underline underline-offset-2 before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']"
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
