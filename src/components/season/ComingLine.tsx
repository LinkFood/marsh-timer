import { Wind } from "lucide-react";
import {
  COMING_WINDOW_DAYS,
  ComingEvent,
  ComingModel,
  LANE_STALE_DAYS,
  Load,
  daysBetween,
  longDate,
  shortDate,
  weekday,
} from "@/lib/season";

/**
 * BLOCK 2 — the "is something coming" line.
 *
 * `hunt_weather_events` is forward-dated and has never been rendered anywhere
 * on the site. This is the cheapest real thing in the plan (spec §5.2).
 *
 * Three distinct outcomes, and keeping them distinct is the whole point:
 *
 *   SOMETHING   the lane is fresh and holds detections in the window
 *   QUIET       the lane is fresh and holds nothing — "Nothing moving over
 *               Maryland in the next five days." That is a real answer.
 *   DARK        the lane has not run recently, or has never run for this state.
 *               We do NOT say quiet. A silent instrument and a quiet sky read
 *               identically from the outside, and conflating them is how a
 *               hunter gets told nothing is coming on the morning a front lands.
 *
 * Everything here is a DETECTION off a 16-day state forecast, at one
 * representative point per state. Labeled as such, every time — the same
 * discipline as the card's "Maryland statewide. Not your marsh."
 */

interface Props {
  stateName: string;
  today: string;
  /** Last day of the window (today + COMING_WINDOW_DAYS). */
  horizon: string;
  load: Load<ComingModel>;
  /** Freshest `created_at` this state has in the lane, at any date. */
  laneLastRun: Load<string | null>;
}

const SEVERITY_TONE: Record<string, string> = {
  high: "text-amber-200/90",
  medium: "text-gray-300",
  low: "text-gray-400",
};

export default function ComingLine({ stateName, today, horizon, load, laneLastRun }: Props) {
  const laneAge =
    laneLastRun.s === "ok" && laneLastRun.v ? daysBetween(laneLastRun.v.slice(0, 10), today) : null;
  const laneDark = laneLastRun.s === "ok" && (laneLastRun.v === null || (laneAge !== null && laneAge > LANE_STALE_DAYS));

  return (
    <section>
      <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.28em] text-cyan-300/90">
        <Wind className="h-3.5 w-3.5" aria-hidden />
        IS SOMETHING COMING
      </div>
      <div className="mt-1.5 font-mono text-[11px] text-gray-500">
        the next {COMING_WINDOW_DAYS} days over {stateName} &middot; through {shortDate(horizon)}
      </div>

      <div className="mt-6 max-w-3xl">
        {(load.s === "loading" || laneLastRun.s === "loading") && (
          <p className="font-mono text-xs text-gray-600">reading the lane&hellip;</p>
        )}

        {(load.s === "error" || laneLastRun.s === "error") && (
          <p className="font-body text-[15px] leading-relaxed text-gray-400">
            The event lane did not answer. We can&rsquo;t tell you whether anything is coming over{" "}
            {stateName}, and we won&rsquo;t guess &mdash; reload.
          </p>
        )}

        {load.s === "ok" && laneLastRun.s === "ok" && (
          <>
            {laneDark ? (
              <Dark stateName={stateName} lastRun={laneLastRun.v} laneAge={laneAge} />
            ) : load.v.events.length > 0 ? (
              <Something stateName={stateName} today={today} model={load.v} />
            ) : (
              <Quiet stateName={stateName} horizon={horizon} />
            )}
            <Receipts model={load.v} lastRun={laneLastRun.v} laneDark={laneDark} />
          </>
        )}
      </div>
    </section>
  );
}

/* ────────────────────────────── outcomes ─────────────────────────── */

function whenPhrase(date: string, today: string): string {
  const d = daysBetween(today, date);
  if (d <= 0) return "today";
  if (d === 1) return "tomorrow";
  if (d <= 6) return `${weekday(date)}`;
  return shortDate(date);
}

function Something({
  stateName,
  today,
  model,
}: {
  stateName: string;
  today: string;
  model: ComingModel;
}) {
  // The lede is the nearest day's most severe detection.
  const first = model.events[0];
  const lede = model.events
    .filter((e) => e.date === first.date)
    .sort((a, b) => rank(b.severity) - rank(a.severity))[0];

  return (
    <>
      <h2 className="font-display text-[1.45rem] leading-[1.3] text-gray-50 sm:text-[2rem]">
        {capitalize(lede.phrase)} is in the forecast over {stateName} {whenPhrase(lede.date, today)}.
      </h2>

      <ul className="mt-6 space-y-2 font-mono text-[13px]">
        {model.events.map((e) => (
          <Row key={e.key} event={e} today={today} />
        ))}
      </ul>
    </>
  );
}

function Row({ event, today }: { event: ComingEvent; today: string }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/5 pb-2">
      <span className="text-gray-500">
        {shortDate(event.date)}
        <span className="ml-2 text-gray-600">{whenPhrase(event.date, today)}</span>
      </span>
      <span className={SEVERITY_TONE[event.severity ?? ""] ?? "text-gray-300"}>{event.phrase}</span>
    </li>
  );
}

/** A real answer, not an empty state (spec §5.2). */
function Quiet({ stateName, horizon }: { stateName: string; horizon: string }) {
  return (
    <>
      <h2 className="font-display text-[1.45rem] leading-[1.3] text-gray-300 sm:text-[2rem]">
        Nothing moving over {stateName} in the next {COMING_WINDOW_DAYS} days.
      </h2>
      <p className="mt-3 font-body text-[15px] leading-relaxed text-gray-500">
        No pressure fall, cold front, high wind or freeze in the state forecast lane through{" "}
        {longDate(horizon)}.
      </p>
    </>
  );
}

/**
 * The refusal. The lane being silent is not the sky being quiet, and we will
 * not let the first read as the second.
 */
function Dark({
  stateName,
  lastRun,
  laneAge,
}: {
  stateName: string;
  lastRun: string | null;
  laneAge: number | null;
}) {
  return (
    <>
      <h2 className="font-display text-[1.45rem] leading-[1.3] text-gray-300 sm:text-[2rem]">
        {lastRun
          ? `The event lane hasn't run for ${stateName} in ${laneAge} days.`
          : `We hold no event-lane rows for ${stateName} at all.`}
      </h2>
      <p className="mt-3 font-body text-[15px] leading-relaxed text-gray-500">
        A silent instrument is not a quiet sky. We won&rsquo;t tell you nothing is coming when what
        we actually know is that nobody looked.
        {lastRun && <> Last detection written {longDate(lastRun.slice(0, 10))}.</>}
      </p>
    </>
  );
}

/* ────────────────────────────── receipts ─────────────────────────── */

function Receipts({
  model,
  lastRun,
  laneDark,
}: {
  model: ComingModel;
  lastRun: string | null;
  laneDark: boolean;
}) {
  return (
    <div className="mt-6 space-y-1.5">
      <p className="font-mono text-[10px] leading-relaxed text-gray-600">
        detections off the 16-day state forecast lane &middot; one representative point per state,
        not your marsh &middot; a detection is not an observation
        {!laneDark && lastRun && <> &middot; lane last ran {shortDate(lastRun.slice(0, 10))}</>}
      </p>
      {model.dropped > 0 && (
        <p className="font-mono text-[10px] leading-relaxed text-gray-600">
          data-quality receipt: {model.dropped}{" "}
          {model.dropped === 1 ? "row" : "rows"} dropped from this window &mdash; past its horizon
          the upstream forecast reports 0 mb, which the detector reads as a ~1015 mb
          &ldquo;pressure fall&rdquo; and stamps high severity. Not shown, not counted.
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────── utils ───────────────────────────── */

function rank(sev: string | null): number {
  return sev === "high" ? 3 : sev === "medium" ? 2 : sev === "low" ? 1 : 0;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
