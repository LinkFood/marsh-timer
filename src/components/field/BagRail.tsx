/**
 * BagRail.tsx — the only thing on this surface he touches with cold hands.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * IT COUNTS. IT NEVER SAYS HE IS LEGAL.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * There is no limit here, no target, no remaining, no progress bar, and no green
 * anything. That is the owner's ruling for this pass and it is also the only
 * defensible design: the app does not know what he shot before he opened it, it
 * does not know what the man forty yards down the bank put into the same spread,
 * and Maryland's daily limits are species-and-sex specific in ways one integer
 * cannot carry. A number on a screen next to the word "limit" becomes a
 * permission, and this app has no standing to grant one.
 *
 * So the label says TAPS and means it. See `./fieldStore.ts` for why an untouched
 * tally is honestly zero when nothing else in this app may default to zero — the
 * short version is that this is a count of an action the app witnessed, not a
 * measurement of the world, and an UNREADABLE stored tally is a separate state
 * that refuses rather than silently resetting his morning to nothing.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * PHYSICAL DESIGN: GLOVES, DARK, ONE HAND, GUN IN THE OTHER.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The +1 target is the full width of the glass and 72px tall — well past the
 * 64px floor, because the floor is what a bare finger needs and this is a wet
 * glove at 27°F on a phone he is not looking at. It is the bottom-most element,
 * where a thumb rests when a phone is held one-handed.
 *
 * CONFIRMATION WITHOUT A FLASH OF WHITE. A successful tap is confirmed three
 * ways, none of which touch dark adaptation: the number itself changes (the only
 * motion on this surface that is not a clock tick), the border goes solid amber
 * for 180 ms, and the phone buzzes where `navigator.vibrate` exists. A white
 * flash or a bright toast would cost him the twenty minutes of night vision he
 * has been building since he left the truck, to tell him something the number
 * already told him.
 *
 * −1 IS PRESENT AND SMALL. A counter with no way back turns one fat-fingered tap
 * into a wrong tally for the rest of the morning, and he will not open a settings
 * screen in the dark to fix it. It is 44px, off to the side, and deliberately
 * unattractive to a wandering thumb — no confirmation dialog, because a modal in
 * a blind is a trap, and because the way to undo a mistaken −1 is a +1.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Rail, RailLabel, Reading, Receipt, Refusal } from "./Instrument";
import { loadBag, saveBag, type BagCount } from "./fieldStore";

/** How long the border stays solid after a tap, ms. Long enough to see, short enough not to lag. */
const CONFIRM_MS = 180;

/** Haptic length, ms. Short — this is a tick, not an alarm. */
const HAPTIC_MS = 18;

function buzz() {
  try {
    const nav = typeof navigator === "undefined" ? null : navigator;
    if (nav && typeof nav.vibrate === "function") nav.vibrate(HAPTIC_MS);
  } catch {
    // A phone that will not buzz is not a reason to fail a tap.
  }
}

export function BagRail({
  day,
  species,
}: {
  /** The calendar day the tally belongs to. Per-date, always. */
  day: string;
  species: readonly string[];
}) {
  const [bag, setBag] = useState<BagCount>({ status: "counted", taps: 0 });
  const [confirming, setConfirming] = useState(false);
  const [writeFailed, setWriteFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-read whenever the day changes — the scrubber can move him to another
  // date and that date has its own tally.
  useEffect(() => {
    setBag(loadBag(day));
    setWriteFailed(false);
  }, [day]);

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const bump = useCallback(
    (delta: number) => {
      if (bag.status !== "counted") return;
      const next = bag.taps + delta;
      if (next < 0) return;
      const written = saveBag(day, next);
      if (written === null) {
        // A counter that silently fails to persist is worse than one that says
        // it failed, because he will trust it.
        setWriteFailed(true);
        return;
      }
      setBag({ status: "counted", taps: written });
      setWriteFailed(false);
      buzz();
      setConfirming(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setConfirming(false), CONFIRM_MS);
    },
    [bag, day],
  );

  if (bag.status === "unreadable") {
    return (
      <Rail className="py-3">
        <RailLabel>bag</RailLabel>
        <div className="mt-1.5">
          <Refusal headline="Today's tally could not be read." message={bag.message} />
        </div>
      </Rail>
    );
  }

  const what = species.length > 0 ? species.join(" + ") : null;

  return (
    <Rail className="py-1">
      <div className="flex items-baseline justify-between gap-2">
        <RailLabel>bag · taps today</RailLabel>
        <RailLabel>{what ?? "no open season"}</RailLabel>
      </div>

      <div className="mt-1 flex items-stretch gap-2">
        {/* The target. Full width, 72px, bottom of the glass, under the thumb. */}
        <button
          type="button"
          onClick={() => bump(1)}
          aria-label="Add one to today's tally"
          className={[
            "flex min-h-[72px] flex-1 items-center justify-center gap-4 rounded-md border-2 transition-colors duration-150",
            confirming
              ? "border-amber-400 bg-amber-500/15"
              : "border-amber-500/25 bg-amber-500/[0.04]",
          ].join(" ")}
        >
          <span className="font-mono text-[40px] leading-none tabular-nums text-amber-400">
            {bag.taps}
          </span>
          <span className="font-mono text-[13px] uppercase tracking-[0.18em] text-amber-500/60">
            tap +1
          </span>
        </button>

        {/* Small, deliberately unattractive to a wandering thumb, no dialog. */}
        <button
          type="button"
          onClick={() => bump(-1)}
          disabled={bag.taps === 0}
          aria-label="Take one off today's tally"
          className="min-h-[44px] w-[52px] self-end rounded-md border border-amber-500/20 font-mono text-[18px] text-amber-500/55 disabled:opacity-30"
        >
          −1
        </button>
      </div>

      {writeFailed ? (
        <p className="mt-1.5 font-mono text-[11px] leading-[1.5] text-amber-300/85">
          That tap did not save — this browser is refusing to store it, so the number above is not
          being kept. Count on your fingers.
        </p>
      ) : null}

      <Receipt
        items={[
          `for ${day} · your taps, not birds, and not a legal count`,
          "no limit shown — limits are species and sex specific and this app cannot know your earlier take",
        ]}
        className="mt-1"
      />
    </Rail>
  );
}
