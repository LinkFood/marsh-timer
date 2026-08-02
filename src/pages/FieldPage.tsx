/**
 * FieldPage.tsx — THE SURFACE. There is exactly one screen in this product.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * THE OFFLINE LAW, AND WHY IT IS THE LINTER'S JOB AND NOT MINE.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * `eslint.config.js` names THIS FILE in its offline `files:` glob and bans
 * `@/lib/supabase`, `@supabase/supabase-js` by any path, bare `fetch`,
 * `window.fetch` and `globalThis.fetch` inside it. That is deliberate and it is
 * the point: a network read here does not fail in CI and it does not fail in
 * review. It fails at the boat ramp, silently, as a spinner that never resolves
 * while legal light comes and goes.
 *
 * So everything this page renders is one of exactly four things:
 *
 *   1. COMPUTED ON THE DEVICE   `src/lib/sky.ts` — sun and moon from the date
 *                               and the coordinates and nothing else.
 *   2. A COMMITTED CONSTANT     `src/data/regs/*` — the cited legal rule, in the
 *                               bundle, versioned in git, offline by nature.
 *   3. `localStorage`           the frozen spot, the tide pocket, the tally.
 *   4. ALREADY PACKED           the tide curve, downloaded at PREP with signal.
 *
 * There is no fifth. If a future reading needs the wire, it is fetched
 * elsewhere, earlier, deliberately — and frozen. Not on mount.
 *
 * `useSpot()` is imported and that is safe by inspection as well as by lint:
 * its network half (`resolveNearestStation`) is only reachable through `save()`,
 * which is a save-flow call and is never made here. Its mount effect calls
 * `loadSpot()`, which touches `localStorage` and nothing else. `spot.ts` says
 * so in its own header and the offline proof test holds it to it by running this
 * entire page with `globalThis.fetch` replaced by a throwing stub.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * NO TABS. THE MODE IS A DISTANCE IN TIME AND THE APP ALREADY KNOWS IT.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * FIELD, PREP and PLAN were three tabs. They are not places — they are how far
 * he is from the hunt, and every input needed to compute that is already here:
 * the clock, the calendar day, the season windows in `mdSeasons.ts`, the frozen
 * spot. Asking a cold hand to tap a tab so the app can be told something it can
 * derive is the opposite of an instrument. `selectMode` in `./fieldSeason.ts`
 * picks it, the thresholds are named and argued there, and the override at the
 * foot of this file is session-only ON PURPOSE — a forced PLAN that persisted
 * would still be forced at 05:15 on the opener, which is the one morning it must
 * not be.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * ONE SCREEN DOES NOT MEAN LESS INFORMATION. IT MEANS NOTHING HIDDEN.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * The reference is a primary flight display, not a minimal app. A PFD is dense —
 * altitude, airspeed, attitude, heading, vertical speed, mode annunciators, all
 * on one small piece of glass, all readable in a glance, none of it behind a
 * control. Hierarchy comes from SIZE AND POSITION, never from a door.
 *
 * There is a structural reason that is non-negotiable here and not merely a
 * preference. The gates a hunter evaluates are a CONJUNCTION: legal light AND
 * water AND light AND season. He cannot evaluate an AND if he has to navigate to
 * see the operands. A water gate behind a tap cannot be conjoined with the moon
 * — the tap breaks the exact cognitive act this product exists to support. So
 * every gate that has an answer is present, and every gate that refuses shows
 * its refusal in the same slot at the same weight, because a stated absence is
 * information and it occupies its place.
 *
 * ═════════════════════════════════════════════════════════════════════════════
 * NO SCORE. NO RATING. NO GO / NO-GO.
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Nothing on this page composites the rails into a verdict, and nothing may. The
 * hunter conjoins the facts. `sky.ts` deleted exactly this from the edge
 * function and said why: a rating is a prediction wearing a number, with no
 * evidence and no way to be wrong. He is better at this than we are.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSpot } from "@/lib/spot";
import type { TranscribedSpecies } from "@/data/regs/shootingHours";
import { moonEvents } from "@/lib/sky";
import { BagRail } from "@/components/field/BagRail";
import { FieldProvenance } from "@/components/field/FieldProvenance";
import { FIELD_BG } from "@/components/field/ink";
import { LegalLightRail } from "@/components/field/LegalLightRail";
import { SeasonRail } from "@/components/field/SeasonRail";
import { SkyRail } from "@/components/field/SkyRail";
import { TideRail } from "@/components/field/TideRail";
import { TopRail } from "@/components/field/TopRail";
import {
  anySeasonOpen,
  findNextOpen,
  selectMode,
  type FieldMode,
} from "@/components/field/fieldSeason";
import {
  localCalendarDay,
  nextCalendarDay,
  skyDayFor,
} from "@/components/field/fieldTime";
import { loadQuarryOverride, saveQuarryOverride } from "@/components/field/fieldStore";
import { closedDayFor, computeLegalLight } from "@/components/field/legalLight";
import { moonThroughTheNight } from "@/components/field/moonNight";
import { loadTidePocket } from "@/components/field/tidePocket";

/**
 * How often the countdown re-renders, ms.
 *
 * One second, because inside the last minutes before legal light the seconds are
 * the number he is watching. `formatDuration` stops printing seconds past an
 * hour, so the extra ticks cost a repaint of characters that did not change —
 * cheap, and cheaper than the alternative of a clock that lies by up to a minute
 * at the only moment it matters.
 */
const TICK_MS = 1000;

const DAY_MS = 86_400_000;

/** The previous calendar day, from the string, through UTC. */
function prevCalendarDay(day: string): string | null {
  const base = skyDayFor(day);
  if (base === null) return null;
  const d = new Date(base.getTime() - DAY_MS);
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export interface FieldPageProps {
  /**
   * The clock. Injected only by tests, which need a fixed instant to assert
   * against; in the app it is `new Date()` on a one-second tick. Passing it in
   * rather than reading `Date.now()` inside the math is the same discipline
   * `sky.ts` applies to itself — same inputs, same output, forever.
   */
  now?: Date;
}

export default function FieldPage({ now: fixedNow }: FieldPageProps = {}) {
  const { spot, loading } = useSpot();

  /* ---- the clock -------------------------------------------------------- */
  const [tick, setTick] = useState<Date>(() => fixedNow ?? new Date());
  useEffect(() => {
    if (fixedNow) return; // a fixed clock does not tick
    const id = setInterval(() => setTick(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, [fixedNow]);
  const now = fixedNow ?? tick;

  /* ---- the day ---------------------------------------------------------- */
  const today = localCalendarDay(now);
  const [dayOverride, setDayOverride] = useState<string | null>(null);
  const day = dayOverride ?? today;

  /* ---- the hunter's bird, if he named one ------------------------------- */
  const [override, setOverride] = useState<TranscribedSpecies | null>(null);
  useEffect(() => {
    setOverride(loadQuarryOverride());
  }, []);
  const applyOverride = useCallback((species: TranscribedSpecies | null) => {
    saveQuarryOverride(species);
    setOverride(species);
  }, []);

  /* ---- the readings ----------------------------------------------------- */
  const lat = spot?.lat ?? null;
  const lng = spot?.lng ?? null;

  const light = useMemo(
    () =>
      day === null || lat === null || lng === null
        ? null
        : computeLegalLight(lat, lng, spot?.state ?? null, day, override),
    [lat, lng, spot?.state, day, override],
  );

  const night = useMemo(
    () =>
      day === null || lat === null || lng === null
        ? null
        : moonThroughTheNight(lat, lng, day),
    [lat, lng, day],
  );

  const moon = useMemo(() => {
    if (day === null || lat === null || lng === null) return null;
    const skyDay = skyDayFor(day);
    return skyDay === null ? null : moonEvents(lat, lng, skyDay);
  }, [lat, lng, day]);

  // Read once per station, not per tick — the pocket does not change under him.
  const pocket = useMemo(
    () => loadTidePocket(spot?.coops_station_id ?? null),
    [spot?.coops_station_id],
  );

  /* ---- the mode --------------------------------------------------------- */
  const tomorrow = day === null ? null : nextCalendarDay(day);
  const tomorrowOpen =
    tomorrow !== null && spot?.state ? anySeasonOpen(spot.state, tomorrow) : false;

  // Only walked when today has no clock — either no open season, or a day the
  // state closes outright. 400 pure lookups, once per day change, never per tick.
  const needsNextOpen = light !== null && (light.window.status === "refused" || light.closedDay !== null);
  const nextOpen = useMemo(
    () =>
      day === null || !spot?.state || !needsNextOpen
        ? null
        : findNextOpen(spot.state, day, {
            // A Sunday inside an open season is not a huntable day. Without this
            // the instrument would count him down to a morning he cannot hunt.
            isClosedDay: (d) => closedDayFor(spot.state, d) !== null,
          }),
    [day, spot?.state, needsNextOpen],
  );

  const derivedMode: FieldMode = selectMode({
    now,
    openAt: light?.openAt ?? null,
    closeAt: light?.closeAt ?? null,
    tomorrowOpen,
    localHour: now.getHours(),
    // A Maryland Sunday still HAS a computed window when the season is open.
    // Only the day is shut, and the selector has to be told that separately or
    // it puts the field face in front of a morning he cannot hunt.
    closedDay: light?.closedDay !== null && light?.closedDay !== undefined,
  });

  // Session-only. See the file header — a persisted force would still be forced
  // on the one morning it must not be.
  const [forced, setForced] = useState<FieldMode | null>(null);
  const mode: FieldMode = forced ?? derivedMode;

  /* ---- day nudges ------------------------------------------------------- */
  const goPrev = useCallback(() => {
    setDayOverride((d) => prevCalendarDay(d ?? today ?? "") ?? d);
  }, [today]);
  const goNext = useCallback(() => {
    setDayOverride((d) => nextCalendarDay(d ?? today ?? "") ?? d);
  }, [today]);
  const goToday = useCallback(() => setDayOverride(null), []);

  /* ---- render ----------------------------------------------------------- */
  return (
    <div className="min-h-[100dvh] w-full" style={{ backgroundColor: FIELD_BG }}>
      <div className="mx-auto flex w-full max-w-md flex-col">
        <TopRail
          spot={spot}
          day={day ?? "—"}
          isToday={dayOverride === null}
          onPrev={goPrev}
          onNext={goNext}
          onToday={goToday}
          /* The mode annunciator rides in the top rail, PFD-style, rather than
             occupying a band of its own at the foot of the glass. It is a
             readout of a derived state plus a session-only override, which is
             exactly what an annunciator is. */
          mode={mode}
          forced={forced !== null}
          onForce={setForced}
        />

        {loading && spot === null ? null : light && day && night && spot ? (
          <>
            <LegalLightRail light={light} now={now} nextOpen={nextOpen} />
            <SeasonRail season={light.season} override={override} onOverride={applyOverride} />
            <TideRail pocket={pocket} now={now} />
            <SkyRail
              sunrise={light.sunrise}
              sunset={light.sunset}
              polar={light.polar}
              moonRise={moon?.rise ?? null}
              moonSet={moon?.set ?? null}
              night={night}
              day={day}
              /* The dawn tide clock is read PER STATION and its sign reverses
                 between stations on this coast, so the rail is handed the bound
                 station rather than inferring one. `null` is a real value: a
                 spot with no station gets a refusal by name, not silence. */
              stationId={spot.coops_station_id ?? null}
              /* THE MODE IS ALREADY DERIVED — the rail does not get to ask for
                 it and does not get to decide it. It only decides how much PROSE
                 to print: readings, denominators and refusals are identical in
                 all three modes, and the mechanism sentence about a night that
                 is already over is not something a man in the water reads. */
              mode={mode}
            />
            <BagRail day={day} />
            {/* THE FOOT. Every method, source, interval and stated unknown on
                this surface, once, in the smallest legible mono, in the flow —
                no tap, no accordion, no modal, no `aria-hidden`. It is last
                because it is least urgent, which is the only kind of hierarchy
                this screen has. */}
            <FieldProvenance
              light={light}
              day={day}
              stationId={spot.coops_station_id ?? null}
              pocket={pocket}
              now={now}
              nextOpen={nextOpen}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}
