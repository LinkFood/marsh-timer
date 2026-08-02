/**
 * LegalLightRail.tsx — the hero. The one thing he opened the app for.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * WHAT THE BIG NUMBER IS, AND WHY IT CHANGES.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The hero is always the duration he is actually watching, which is a different
 * duration depending on where the morning is:
 *
 *   before open   time until he may legally shoot
 *   inside        time until he must stop
 *   after close   no duration — the word CLOSED, because a countdown to nothing
 *                 is a number pretending to be information
 *
 * Both boundary INSTANTS are on the glass at all times regardless, in mono, with
 * machine-readable `<time dateTime>` — the countdown is the convenience and the
 * clock times are the law. A hunter who only ever sees a countdown has no way to
 * check the app against his watch, and the whole product is built on being
 * checkable.
 *
 * THE LAST TEN MINUTES ARE RED. Not decoration and not urgency-theatre: red is
 * a state change in the only variable that can get him written up, and long-
 * wavelength red costs no more dark adaptation than the amber does. It is the
 * one colour change on the surface and it means exactly one thing.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THREE OUTCOMES, THREE RENDERS, AND ONE OF THEM HAS NO CLOCK.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 *   closed day    Maryland does not permit Sunday waterfowl hunting. NO CLOCK.
 *                 Checked FIRST, before the window is even consulted, because
 *                 legal light on a closed day is true about the sun and
 *                 misleading about the law.
 *   refused       No open season, or a state we have not transcribed. NO CLOCK,
 *                 the regs module's own sentence instead.
 *   narrowed      The season could not be pinned down. The SHORTER times render
 *                 AND the message renders with them, loudly. Never the longer
 *                 ones, never the message alone.
 *   ok            The season is known. The times are that season's times, and
 *                 the receipt names the rule and its citation.
 *
 * The refusal is not dimmed. See `Instrument.tsx`, mark 4.
 */

import { Claim, Rail, RailLabel, Reading, Receipt, Refusal } from "./Instrument";
import { citeLabel } from "./ink";
import { formatClock, formatDuration, isoOf } from "./fieldTime";
import type { NextOpen } from "./fieldSeason";
import type { LegalLight } from "./legalLight";

/** Inside this many minutes of the close, the hero turns red. */
const LAST_LIGHT_WARNING_MIN = 10;

type Phase = "waiting" | "running" | "closed" | "none";

function phaseOf(now: Date, openAt: Date | null, closeAt: Date | null): Phase {
  const n = now?.getTime?.();
  const o = openAt?.getTime?.();
  const c = closeAt?.getTime?.();
  if (
    typeof n !== "number" ||
    typeof o !== "number" ||
    typeof c !== "number" ||
    !Number.isFinite(n) ||
    !Number.isFinite(o) ||
    !Number.isFinite(c)
  ) {
    return "none";
  }
  if (n < o) return "waiting";
  if (n <= c) return "running";
  return "closed";
}

/**
 * The boundary pair, always on the glass.
 *
 * `aria-label` on each `<time>` is doing double duty: it is what a screen reader
 * announces, and it is the handle the offline proof test grabs to read the
 * `dateTime` attribute and assert the close is sunset+30 to the millisecond.
 */
function Boundaries({ openAt, closeAt }: { openAt: Date | null; closeAt: Date | null }) {
  const open = formatClock(openAt);
  const close = formatClock(closeAt);
  const openIso = isoOf(openAt);
  const closeIso = isoOf(closeAt);

  return (
    <div className="mt-2 flex items-baseline justify-between gap-2">
      <span className="flex items-baseline gap-1.5">
        <RailLabel>open</RailLabel>
        {open !== null && openIso !== null ? (
          <time dateTime={openIso} aria-label="Legal shooting light opens">
            <Reading size="lg">{open}</Reading>
          </time>
        ) : (
          <Reading size="lg">—</Reading>
        )}
      </span>
      <span className="flex items-baseline gap-1.5">
        <RailLabel>close</RailLabel>
        {close !== null && closeIso !== null ? (
          <time dateTime={closeIso} aria-label="Legal shooting light closes">
            <Reading size="lg">{close}</Reading>
          </time>
        ) : (
          <Reading size="lg">—</Reading>
        )}
      </span>
    </div>
  );
}

/**
 * The days-to-open hero.
 *
 * The instrument always shows time until the next thing that matters; on a
 * closed day that unit is days, not minutes. It COUNTS forward through the
 * cited digest — it does not forecast a season. When nothing is found inside
 * the horizon the block is simply absent, because "no open day in the next 400"
 * is not "the season opens in 400 days".
 */
function DaysToOpen({ nextOpen }: { nextOpen: NextOpen | null }) {
  if (nextOpen === null) return null;
  return (
    <div className="mt-1">
      <div className="flex items-baseline gap-2">
        <Reading size="hero">{nextOpen.daysAway}</Reading>
        <Reading size="lg">{nextOpen.daysAway === 1 ? "day" : "days"}</Reading>
      </div>
      <Claim className="mt-1 text-[13px] !text-amber-300/70">
        until the next day Maryland publishes an open season
      </Claim>
      <Receipt items={[`next open day ${nextOpen.day}`, "counted forward through the transcribed digest, not forecast"]} className="mt-1" />
    </div>
  );
}

export function LegalLightRail({
  light,
  now,
  nextOpen = null,
}: {
  light: LegalLight;
  now: Date;
  /** The next open day, for the closed-day and no-season faces. */
  nextOpen?: NextOpen | null;
}) {
  /* ---- 1. A CLOSED DAY OUTRANKS EVERYTHING. No clock. ------------------- */
  if (light.closedDay !== null) {
    return (
      <Rail first className="py-4">
        <RailLabel>legal shooting light</RailLabel>
        <div className="mt-2">
          <Refusal
            headline={light.closedDay.headline}
            message={light.closedDay.message}
            cite={[citeLabel(light.closedDay.cite), "closed day, not different hours"]}
          />
        </div>
        <DaysToOpen nextOpen={nextOpen} />
      </Rail>
    );
  }

  /* ---- 2. REFUSED. Also no clock. --------------------------------------- */
  if (light.window.status === "refused") {
    const extra = light.season.closedMessages.filter((m) => m !== light.window.message);
    return (
      <Rail first className="py-4">
        <RailLabel>legal shooting light</RailLabel>
        <DaysToOpen nextOpen={nextOpen} />
        <div className="mt-2">
          <Refusal
            headline="No shooting light is shown for this day."
            message={light.window.message}
          />
          {extra.map((m) => (
            <p key={m} className="mt-2 font-mono text-[11px] leading-[1.5] text-amber-300/85">
              {m}
            </p>
          ))}
          <Receipt items={[`reason: ${light.window.reason}`, "no clock is shown rather than a wrong one"]} className="mt-1.5" />
        </div>
      </Rail>
    );
  }

  /* ---- 3. There is a window. Draw the instrument. ------------------------ */
  const rule = light.window.rule;
  const phase = phaseOf(now, light.openAt, light.closeAt);
  const nowMs = now.getTime();

  let hero = "—";
  let subject = "";
  let warn = false;

  if (phase === "waiting" && light.openAt) {
    hero = formatDuration(light.openAt.getTime() - nowMs) ?? "—";
    subject = "until you may legally shoot";
  } else if (phase === "running" && light.closeAt) {
    const left = light.closeAt.getTime() - nowMs;
    hero = formatDuration(left) ?? "—";
    subject = "until you must stop";
    warn = left <= LAST_LIGHT_WARNING_MIN * 60_000;
  } else if (phase === "closed") {
    hero = "CLOSED";
    subject = "legal shooting light is over for today";
  } else {
    subject = "the clock for this day could not be computed";
  }

  const running = phase === "running";
  const narrowed = light.window.status === "narrowed";

  const speciesLabel =
    light.season.species.length > 0 ? light.season.species.join(" + ") : null;

  return (
    <Rail
      first
      className={`py-2.5 ${running ? "border-l-2 border-l-amber-400 pl-3.5" : "border-l-2 border-l-transparent pl-3.5"}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <RailLabel>legal shooting light</RailLabel>
        <RailLabel>
          {running ? "running" : phase === "waiting" ? "not yet" : phase === "closed" ? "closed" : "—"}
        </RailLabel>
      </div>

      <div className="mt-1">
        <Reading size="hero" className={warn ? "!text-red-400" : ""}>
          {hero}
        </Reading>
      </div>
      <Claim className="mt-1 text-[13px] !text-amber-300/70">{subject}</Claim>

      <Boundaries openAt={light.openAt} closeAt={light.closeAt} />

      <Receipt
        items={[
          `${rule.start} → ${rule.end}`,
          citeLabel(rule.cite),
          `verified ${rule.verified}, booklet check pending`,
          speciesLabel,
          light.season.basis === "sole-open-season"
            ? "species read off the season calendar"
            : light.season.basis === "override"
              ? "species set by you"
              : light.season.basis === "agreeing-seasons"
                ? "both seasons open, same hours"
                : null,
        ]}
        className="mt-1.5"
      />

      {narrowed && light.window.status === "narrowed" ? (
        <div className="mt-2.5 border-l-2 border-l-amber-400/70 pl-2.5">
          <Claim className="text-[13px]">This is the SHORTER window.</Claim>
          <p className="mt-0.5 font-mono text-[11px] leading-[1.5] text-amber-300/85">
            {light.window.message}
          </p>
        </div>
      ) : null}
    </Rail>
  );
}
