import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { drawFrame, fitCanvas, hitTest, type BoardModel } from "@/lib/boardPlayer";
import { BOARD_PROJECTION, CONUS_BORDERS } from "@/data/board/conusBorders";
import { InnerFooter } from "@/components/InnerNav";
import RarityMap from "@/components/map/RarityMap";
import { TAIL_DEPTH_IS_COMPARABLE } from "@/lib/board/tailDepthGate";
import TodayFitted from "@/components/TodayFitted";
import { useYourGround } from "@/hooks/useYourGround";
import { dayOfYear, fetchGroundSky, loreLine, seasonCounter, type GroundSky } from "@/lib/almanac";
import {
  compileDayFilm,
  fetchActiveAlerts,
  fetchFormingWatches,
  fetchFrames,
  fetchInstruments,
  fetchRhymes,
  formingByState,
  longDate,
  medDate,
  porchLine,
  resolveDay,
  stateFullName,
  todayIso,
  isoDaysBefore,
  type BoardRhyme,
  type DayFrame,
  type FormationWatch,
  type Instrument,
  type ResolvedInstrument,
  type PorchLine,
  type RhymeFollowed,
  type StateAlert,
} from "@/lib/board/frameStore";
import { supabase } from "@/lib/supabase";
import {
  READ_TIMEOUT_MS,
  currentSeasonYear,
  nextOpenerNationally,
  seasonYearLabel,
  shortDate as openerDate,
  weekday,
  type NextOpener,
  type SeasonRow,
} from "@/lib/season";

/**
 * TODAY — THE FRONT DOOR (`/`). One room, one true sentence per screen.
 *
 * Identity first — brand, thesis, and a dim US skeleton render statically
 * before a single row arrives; the page never opens on a bare black screen.
 * Then the porch: today's frame spoken in one honest, kind-aware sentence.
 *
 * Under it, THE COUNTRY MAP — the primary map since 2026-07-25. It is the
 * index, the card is the product, so a state is a door: tapping one lands on
 * /season?state=XX.
 *
 * WHAT THE PORCH AND THE MAP MAY SAY CHANGED ON 2026-07-25. Both used to lead
 * with a percentile off the frame store's tail-depth byte — "California is
 * running hotter than 99% of its July record". That byte ranks a live one-point
 * centroid forecast against a multi-station archive pool: two constructions,
 * landing in different shade bands 43% of the time. It is withheld through one
 * flag (src/lib/board/tailDepthGate.ts) with the reason printed on the page.
 * In its place the headline is the next season opener anywhere in the country —
 * a date a state agency published, with its regulation one tap away — and the
 * map shades by what is live on each state's ground right now.
 *
 * Then the rhyme (the day today reads most like, and what followed), then THE
 * INSTRUMENTS — the breathing dot board, which used to hold the hero. It moved
 * rather than died: a state choropleth cannot draw the climate needles, tide
 * gauges and Gulf buoys, and it is still the only surface that shows them.
 *
 * Scroll down and the past days read as a typographic ledger — a diary, not
 * dot-blobs — and tapping any row loads that day into BOTH maps. The films get
 * their own cards; the doors footer is the same one every sibling page shares.
 */

const DAYS_BACK = 30;

interface DayEntry {
  frame: DayFrame;
  resolved: ResolvedInstrument[];
  porch: PorchLine;
}

interface RoomData {
  instruments: Instrument[];
  days: DayEntry[]; // newest first
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: RoomData }
  | { status: "empty" }
  | { status: "error" };

/**
 * Honest reading for a tapped instrument.
 *
 * The `state-temp` branch is gated. Its percentile is the same claim the map is
 * withholding — a live one-point centroid reading ranked against a
 * station-network pool — and a tap card is not a loophole. The other lanes are
 * ranked against pools of their own construction and keep their numbers.
 */
function readingText(r: ResolvedInstrument): string {
  if (!r.hasData || r.pct === null) return "no reading on file today";
  const p = Math.round(r.pct * 100);
  const high = r.side === "high";
  switch (r.inst.kind) {
    case "needle":
      return high
        ? `riding higher than ${p}% of its recorded days`
        : `sunk lower than ${p}% of its recorded days`;
    case "state-temp":
      if (!TAIL_DEPTH_IS_COMPARABLE) {
        return "reported today — where that reading sits in this state's record is withheld";
      }
      return high ? `hotter than ${p}% of its recorded days` : `colder than ${p}% of its recorded days`;
    case "tide":
      return high
        ? `running higher than ${p}% of its recorded tides`
        : `running lower than ${p}% of its recorded tides`;
    case "buoy":
      return high
        ? `pressure higher than ${p}% of its record`
        : `pressure lower than ${p}% of its record`;
    default:
      return `deeper than ${p}% of its recorded readings`;
  }
}

/** "$9.5B" / "$320M" — plain, no fake precision below a million. */
function fmtDamage(usd: number): string {
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(1)}B`;
  if (usd >= 1e6) return `$${Math.round(usd / 1e6)}M`;
  return `$${Math.round(usd).toLocaleString()}`;
}

/**
 * Stitched titles sometimes carry machine date stamps ("Mid-Atlantic Heat
 * Event, 2015-06-23" · "Tornado — O'BRIEN IA 1971-10-01"). The ledger speaks
 * in dates already — strip the stamp, keep the name.
 */
function cleanEventTitle(title: string): string {
  return title
    .replace(/[,\s—–-]*\(?\d{4}-\d{2}-\d{2}\)?\s*$/, "")
    .replace(/[,\s—–-]+$/, "")
    .trim();
}

/** "What followed then: {title}, N days later — X dead, $Y.YB in damage." */
function followedLine(f: RhymeFollowed): string {
  const when =
    f.days_after === 0 ? "that same day" : f.days_after === 1 ? "1 day later" : `${f.days_after} days later`;
  const toll: string[] = [];
  if (f.deaths) toll.push(`${f.deaths} dead`);
  if (f.injuries) toll.push(`${f.injuries} injured`);
  if (f.damage_usd) toll.push(`${fmtDamage(f.damage_usd)} in damage`);
  return `What followed then: ${cleanEventTitle(f.title)}, ${when}${toll.length ? ` — ${toll.join(", ")}` : ""}.`;
}

// ── The skeleton ground: dim US outline before any data arrives ────────────────

function SkeletonGround() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => {
      const cssW = c.clientWidth || c.parentElement?.clientWidth || 0;
      if (cssW <= 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssH = (cssW * BOARD_PROJECTION.height) / BOARD_PROJECTION.width;
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const s = (cssW / BOARD_PROJECTION.width) * dpr;
      ctx.setTransform(s, 0, 0, s, 0, 0);
      ctx.fillStyle = "#0a0f14";
      ctx.fillRect(0, 0, BOARD_PROJECTION.width, BOARD_PROJECTION.height);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1.1;
      ctx.lineJoin = "round";
      for (const ring of CONUS_BORDERS) {
        ctx.beginPath();
        ctx.moveTo(ring[0], ring[1]);
        for (let i = 2; i < ring.length; i += 2) ctx.lineTo(ring[i], ring[i + 1]);
        ctx.stroke();
      }
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);
  return <canvas ref={ref} className="block h-full w-full" />;
}

// ── The lanes, counted: which instruments actually reported ────────────────────

/**
 * A dead instrument and a calm one look identical on the board — `drawDot`
 * paints a no-reading dot at pct 0.03, which is a real and ordinary depth. 22
 * of the 72 instruments have carried no byte at all since mid-July, and the
 * board was quietly drawing all 22 as quiet ground.
 *
 * So the lanes are counted here, per kind, off the same resolved frame the
 * canvas draws — never off a hardcoded roster, so the number cannot go stale
 * the way "72 of them" did.
 */
interface LaneReport {
  kind: string;
  one: string;
  many: string;
  total: number;
  reported: number;
  /** The newest day in the ledger on which anything in this lane reported. */
  lastSeen: string | null;
}

const LANE_WORDS: Record<string, { one: string; many: string }> = {
  needle: { one: "climate needle", many: "climate needles" },
  "state-temp": { one: "state thermometer", many: "state thermometers" },
  tide: { one: "harbor", many: "harbors" },
  buoy: { one: "Gulf buoy", many: "Gulf buoys" },
};

const laneWords = (kind: string) => LANE_WORDS[kind] ?? { one: kind, many: `${kind}s` };

/** "5 climate needles" / "1 harbor" — the count with its own noun. */
const laneCount = (n: number, l: { one: string; many: string }) => `${n} ${n === 1 ? l.one : l.many}`;

/**
 * Count each lane on the selected day, and find the last day it said anything.
 * `days` is newest-first, so the first hit is the answer; a lane silent through
 * the whole ledger reports `null` rather than a date we do not hold.
 */
function laneReports(selected: DayEntry, days: DayEntry[]): LaneReport[] {
  const order = ["state-temp", "needle", "tide", "buoy"];
  const byKind = new Map<string, LaneReport>();
  for (const r of selected.resolved) {
    const kind = r.inst.kind;
    const w = laneWords(kind);
    const cur = byKind.get(kind) ?? { kind, one: w.one, many: w.many, total: 0, reported: 0, lastSeen: null };
    cur.total += 1;
    if (r.hasData) cur.reported += 1;
    byKind.set(kind, cur);
  }
  for (const lane of byKind.values()) {
    if (lane.reported > 0) {
      lane.lastSeen = selected.frame.day;
      continue;
    }
    for (const d of days) {
      if (d.resolved.some((r) => r.inst.kind === lane.kind && r.hasData)) {
        lane.lastSeen = d.frame.day;
        break;
      }
    }
  }
  const rank = (k: string) => (order.indexOf(k) === -1 ? order.length : order.indexOf(k));
  return [...byKind.values()].sort((a, b) => rank(a.kind) - rank(b.kind) || a.kind.localeCompare(b.kind));
}

/**
 * WHY THE DARK LANES ARE DARK — named, with the real reason for each, because a
 * gauge that stopped reporting is a true and interesting fact about the
 * instrument and not an error message. The date each lane last spoke is read
 * off the ledger this page already holds, so it corrects itself the day a lane
 * comes back.
 *
 * The buoy paragraph is the load-bearing one. A live `ocean-buoy` lane exists
 * and covers these four stations; pointing the board at it is a one-line change
 * and would be the same defect the tail-depth gate exists for. That lane writes
 * a single instantaneous pressure, and the board's pool holds daily means and
 * daily minima — and a daily minimum is by definition at or below any single
 * reading of that day, so every rank would come out low by construction.
 */
function DarkLanesNote({ lanes }: { lanes: LaneReport[] }) {
  const WHY: Record<string, string> = {
    tide: "The harbors stopped because nothing is scheduled to read them — there is no cron for the tide lane at all, and there never has been. Not a failure: an instrument nobody wound.",
    needle:
      "The climate needles stopped at daily resolution. The index feed still runs and still succeeds, but what it writes now is monthly — one number for all of December. A month is not a day, and standing a month where a day belongs would be the quietest kind of lie.",
    buoy:
      "The Gulf buoys are dark on purpose. A live buoy feed exists and covers these exact stations, and pointing the board at it is a one-line change. It writes a single instantaneous pressure; the record it would be ranked against holds daily means and daily lows. A day's low is at or under any one reading from that day, so every rank would come back deep whether or not anything happened — the same mismatch the map's depth is withheld for, one dimension over. They stay dark rather than read low for free.",
    "state-temp":
      "The state thermometers are dark, which is the lane the rest of this page depends on.",
  };
  return (
    <details className="mx-auto mt-4 max-w-xl rounded-xl border border-white/10 bg-gray-900/30 px-4 py-3 open:bg-gray-900/50">
      <summary className="cursor-pointer list-none font-mono text-[11px] tracking-wide text-gray-400 transition-colors hover:text-cyan-200">
        Why {lanes.reduce((n, l) => n + l.total, 0)} of these instruments are dark{" "}
        <span className="text-cyan-400/70">&rarr;</span>
      </summary>
      <div className="mt-3 space-y-3 font-body text-[13px] leading-relaxed text-gray-400">
        {lanes.map((l) => (
          <p key={l.kind}>
            <span className="font-mono text-[11px] uppercase tracking-wide text-gray-500">
              {l.many} &middot;{" "}
              {l.lastSeen ? `last reported ${longDate(l.lastSeen)}` : "silent through this whole ledger"}
            </span>
            <br />
            {WHY[l.kind] ?? `The ${l.many} have stopped writing rows.`}
          </p>
        ))}
        <p className="border-t border-white/5 pt-3 text-gray-500">
          They are drawn hatched rather than dim. The renderer paints a missing reading at the same
          faint depth an ordinary calm day earns, so left alone a dead gauge and a quiet one are the
          same mark — and of the two, only one of them is telling you anything.
        </p>
      </div>
    </details>
  );
}

// ── The headline: the next opener anywhere in the country ──────────────────────

/**
 * The one number the domain name promises, sourced from `hunt_seasons` at the
 * current season year and `status = 'ok'`. Every part of it is either a date a
 * state published or a count of those dates. The state's own zone label rides
 * along, because the earliest legal day is often a special early season and
 * saying "goose season" flat would be the state's sentence, not ours. A
 * provisional row says provisional; PLAN §10.1 makes that a displayed field.
 *
 * An absence renders as an absence and names what we hold instead. It never
 * counts down to a date we do not have.
 */
function OpenerHeadline({ opener, read }: { opener: NextOpener | null; read: boolean }) {
  if (!read) return null;
  if (!opener) {
    return (
      <p className="mx-auto mt-2 max-w-xl font-display text-[1.35rem] leading-snug text-gray-400 sm:text-[1.7rem]">
        We hold no {seasonYearLabel(currentSeasonYear(todayIso()))} opener yet — the states are still
        publishing.
      </p>
    );
  }
  const { daysOut, opensOn } = opener;
  const when =
    daysOut === 0 ? "opens today" : daysOut === 1 ? "opens tomorrow" : `opens in ${daysOut} days`;
  return (
    <div className="mx-auto mt-2 max-w-2xl">
      <h2 className="font-display text-[1.55rem] font-medium leading-[1.26] text-gray-50 sm:text-[2.1rem]">
        {stateFullName(opener.stateAbbr)}&rsquo;s first {opener.speciesLabel.toLowerCase()} season{" "}
        {when} &mdash; {weekday(opensOn)}, {openerDate(opensOn)}.
      </h2>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-gray-500">
        {opener.zone ?? "statewide"}
        {opener.sameDay > 0 && (
          <span className="text-gray-600">
            {" "}
            &middot; {opener.sameDay} more {opener.sameDay === 1 ? "opener" : "openers"} share that day
          </span>
        )}
        {opener.aheadCount > 0 && (
          <span className="text-gray-600"> &middot; {opener.aheadCount} still ahead nationwide</span>
        )}
      </p>
      <p className="mt-1 font-mono text-[10px] leading-relaxed text-gray-600">
        {opener.provisional
          ? "state-published, provisional — the state has not called it final"
          : "as the state published it"}
        {opener.sourceUrl && (
          <>
            {" "}
            &middot;{" "}
            <a
              href={opener.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-cyan-300/70 underline-offset-2 transition-colors hover:text-cyan-200 hover:underline"
            >
              read the regulation
            </a>
          </>
        )}
      </p>
    </div>
  );
}

// ── A film card: the site's best artifacts, promoted ───────────────────────────

function FilmCard({ to, era, title }: { to: string; era: string; title: string }) {
  return (
    <Link
      to={to}
      className="group flex flex-col rounded-xl border border-white/10 bg-gray-900/30 px-5 py-4 transition-colors hover:border-cyan-400/30 hover:bg-gray-900/60"
    >
      <span className="font-mono text-[10px] tracking-[0.2em] text-gray-500">{era}</span>
      <span className="mt-1.5 font-display text-base leading-snug text-gray-100 transition-colors group-hover:text-cyan-200 sm:text-lg">
        {title} <span className="text-cyan-400/70">&rarr;</span>
      </span>
    </Link>
  );
}

// ── A ledger row: one past day as a diary entry ─────────────────────────────────

function LedgerRow({
  entry,
  rhyme,
  selected,
  onSelect,
}: {
  entry: DayEntry;
  rhyme: BoardRhyme | undefined;
  selected: boolean;
  onSelect: (day: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(entry.frame.day)}
      className={`block w-full border-b border-white/5 px-2 py-4 text-left transition-colors hover:bg-white/[0.03] ${
        selected ? "bg-white/[0.04]" : ""
      }`}
    >
      <span
        className={`font-mono text-[10px] tracking-[0.22em] ${selected ? "text-cyan-300/90" : "text-gray-500"}`}
      >
        {longDate(entry.frame.day).toUpperCase()}
      </span>
      <span className="mt-1 block font-body text-[15px] leading-relaxed text-gray-300">
        {entry.porch.lead}
      </span>
      {rhyme && (
        <span className="mt-1 block font-mono text-[11px] leading-relaxed text-gray-500">
          read like {medDate(rhyme.rhyme_day)} &rarr;{" "}
          {rhyme.followed ? cleanEventTitle(rhyme.followed.title) : "a quiet week followed"}
        </span>
      )}
    </button>
  );
}

// ── The room ────────────────────────────────────────────────────────────────────

interface CardState {
  r: ResolvedInstrument;
  left: number;
  top?: number;
  bottom?: number;
}

export default function TodayPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // The one ground choice — ?state=XX overrides and persists (§2e).
  const { ground, groundName, setGround } = useYourGround(searchParams.get("state"));
  const [sky, setSky] = useState<GroundSky | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  // `null` on either of these means THE LANE DID NOT ANSWER — distinct from an
  // empty answer, because the map now shades from them and "fifty quiet states"
  // must never be drawn out of a dropped connection.
  const [alerts, setAlerts] = useState<Map<string, StateAlert> | null>(null);
  const [watches, setWatches] = useState<FormationWatch[] | null>(null);
  const [opener, setOpener] = useState<NextOpener | null>(null);
  const [openerRead, setOpenerRead] = useState(false);
  const [rhymes, setRhymes] = useState<Map<string, BoardRhyme>>(new Map());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [card, setCard] = useState<CardState | null>(null);

  const heroRef = useRef<HTMLDivElement | null>(null);
  /** The rarity map — the front door's primary map, and the scroll target. */
  const stageRef = useRef<HTMLDivElement | null>(null);
  /** The instrument board, one section down; it sizes its own canvas. */
  const boardStageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cssWRef = useRef(0);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    document.title = "Duck Countdown — the honest memory of American ground";
  }, []);

  // The fitted sky for the ground — two pure-compute calls, localized to the
  // state's civil timezone. A failed fetch renders nothing, never a spinner.
  useEffect(() => {
    let cancelled = false;
    setSky(null);
    fetchGroundSky(ground)
      .then((s) => {
        if (!cancelled) setSky(s);
      })
      .catch(() => {
        /* honest absence — the fitted lines simply don't render */
      });
    return () => {
      cancelled = true;
    };
  }, [ground]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const today = todayIso();
        const from = isoDaysBefore(today, DAYS_BACK - 1);
        const [instruments, frames, liveAlerts, liveWatches] = await Promise.all([
          fetchInstruments(),
          fetchFrames(from, today),
          fetchActiveAlerts(),
          fetchFormingWatches(),
        ]);
        if (cancelled) return;
        if (!instruments.length || !frames.length) {
          setLoad({ status: "empty" });
          return;
        }
        // frames come newest-first. The first is the room's "today"; even if
        // the real calendar today is missing, the newest frame is the honest now.
        // Active alerts + formation watches speak of NOW — they apply only to
        // the newest frame, and only when it is actually current; a past day
        // never wears them.
        const days = frames.map((frame, i) => {
          const isNow = i === 0 && frame.day >= isoDaysBefore(today, 1);
          const resolved = resolveDay(frame, instruments);
          const live = isNow ? liveAlerts ?? undefined : undefined;
          const liveForming = isNow ? liveWatches ?? undefined : undefined;
          return { frame, resolved, porch: porchLine(frame.day, resolved, frame, live, liveForming) };
        });
        setAlerts(liveAlerts);
        setWatches(liveWatches);
        setLoad({ status: "ready", data: { instruments, days } });
        // The rhymes ride in behind the frames; a missing table or empty rows
        // simply render nothing.
        const map = await fetchRhymes(days[days.length - 1].frame.day, days[0].frame.day);
        if (!cancelled) setRhymes(map);
      } catch {
        if (!cancelled) setLoad({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── THE HEADLINE — the next opener anywhere in the country.
  // It replaced a percentile (see src/lib/board/tailDepthGate.ts). One bounded
  // read of the current season year's `ok` rows; the model does the rest and is
  // total over them. No rows, a stale year, or a failed read all land on the
  // same honest absence rather than a countdown to last season.
  useEffect(() => {
    if (!supabase) {
      setOpenerRead(true);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), READ_TIMEOUT_MS);
    const today = todayIso();
    const seasonYear = currentSeasonYear(today);
    (async () => {
      try {
        const { data, error } = await supabase
          .from("hunt_seasons")
          .select("id,species_id,state_abbr,season_type,zone,dates,notes,source_url,season_year,status,provisional,provisional_note")
          .eq("season_year", seasonYear)
          .eq("status", "ok")
          .in("species_id", ["duck", "goose"])
          .abortSignal(ctrl.signal);
        if (cancelled) return;
        if (!error && data) {
          setOpener(nextOpenerNationally(data as SeasonRow[], today, seasonYear));
        }
      } catch {
        /* honest absence — the headline falls back to what is live on the board */
      } finally {
        if (!cancelled) setOpenerRead(true);
        clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, []);

  const data = load.status === "ready" ? load.data : null;

  const selected = useMemo(() => {
    if (!data) return null;
    return data.days.find((d) => d.frame.day === selectedDay) ?? data.days[0];
  }, [data, selectedDay]);
  const isNewest = !!data && !!selected && selected.frame.day === data.days[0].frame.day;
  // Active alerts + forming rings mark only the live board — the newest frame,
  // while it's current.
  const isLiveNow = isNewest && !!selected && selected.frame.day >= isoDaysBefore(todayIso(), 1);
  const alertsApply = isLiveNow && (alerts?.size ?? 0) > 0;
  const formingApply = isLiveNow && (watches?.length ?? 0) > 0;

  const formingMap = useMemo(() => formingByState(watches ?? []), [watches]);

  const model: BoardModel | null = useMemo(
    () =>
      selected
        ? compileDayFilm(
            selected.frame.day,
            selected.resolved,
            alertsApply ? alerts ?? undefined : undefined,
            formingApply ? formingMap : undefined,
          )
        : null,
    [selected, alertsApply, alerts, formingApply, formingMap],
  );

  const rhyme = selected ? rhymes.get(selected.frame.day) : undefined;

  // The lanes, counted off the frame the canvas is actually drawing.
  const lanes = useMemo(
    () => (selected && data ? laneReports(selected, data.days) : []),
    [selected, data],
  );
  const reportedCount = lanes.reduce((n, l) => n + l.reported, 0);
  const instrumentCount = lanes.reduce((n, l) => n + l.total, 0);
  const darkLanes = lanes.filter((l) => l.reported === 0);
  /** Every instrument with no byte on file — the ones the renderer draws quiet. */
  const darkInstruments = useMemo(
    () => (selected ? selected.resolved.filter((r) => !r.hasData) : []),
    [selected],
  );

  const resolvedById = useMemo(() => {
    const m = new Map<string, ResolvedInstrument>();
    if (selected) for (const r of selected.resolved) m.set(r.inst.id, r);
    return m;
  }, [selected]);

  // Fit + draw the room's ground. The board breathes — deep readings pulse by
  // severity (drawDot's per-dot breath), so the room runs a gentle ~30fps loop.
  // Reduced-motion visitors get the single still frame.
  const refit = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = boardStageRef.current;
    if (!canvas || !stage || !model) return;
    const cssW = stage.clientWidth;
    if (cssW <= 0) return;
    cssWRef.current = cssW;
    fitCanvas(canvas, cssW, model.film.projection);
    const ctx = canvas.getContext("2d");
    if (ctx) drawFrame(ctx, model, 0, performance.now());
  }, [model]);

  useEffect(() => {
    refit();
    window.addEventListener("resize", refit);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = 0;
    const breathe = (now: number) => {
      if (now - last >= 33) {
        last = now;
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (ctx && model) drawFrame(ctx, model, 0, now);
      }
      raf = requestAnimationFrame(breathe);
    };
    if (!still && model) raf = requestAnimationFrame(breathe);
    return () => {
      window.removeEventListener("resize", refit);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [refit, model]);

  const scrollToBoard = useCallback(() => {
    stageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const selectDay = useCallback((day: string) => {
    setSelectedDay(day);
    setCard(null);
    heroRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const onCanvasDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
  };
  const onCanvasUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!model || !down) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const proj = model.film.projection;
    const projX = (cssX / rect.width) * proj.width;
    const projY = (cssY / rect.height) * proj.height;
    const hit = hitTest(model, projX, projY, 0);
    if (!hit || hit.type !== "dot") {
      setCard(null);
      return;
    }
    const r = resolvedById.get(hit.dot.id);
    if (!r) {
      setCard(null);
      return;
    }
    if (cssY > rect.height * 0.5) {
      setCard({ r, left: cssX, bottom: rect.height - cssY + 14 });
    } else {
      setCard({ r, left: cssX, top: cssY + 14 });
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* IDENTITY — static, before any row arrives */}
      <header className="mx-auto w-full max-w-3xl px-5 pt-8 text-center sm:px-8 sm:pt-12">
        <div className="font-mono text-[11px] tracking-[0.3em] text-cyan-300/90">DUCK COUNTDOWN</div>
        <h1 className="mx-auto mt-4 max-w-2xl font-display text-lg font-normal leading-normal text-gray-300 sm:text-xl">
          The honest memory of American ground — what today is here, what it rhymes with, and what
          followed.
        </h1>
        <p className="mt-2 font-mono text-[10px] tracking-wide text-gray-600">
          every sentence traceable to a row &middot; never a forecast
        </p>
      </header>

      {/* THE PORCH — the hero sentence over the live board */}
      <section ref={heroRef} className="mx-auto w-full max-w-3xl scroll-mt-6 px-5 sm:px-8">
        <div className="mt-7 text-center sm:mt-10">
          <p className="font-mono text-[11px] tabular-nums text-gray-500">
            {selected ? (
              <>
                {longDate(selected.frame.day)}
                {isNewest && (
                  <span className="text-gray-600">
                    {" "}
                    &middot; Day {dayOfYear(selected.frame.day)} of{" "}
                    {selected.frame.day.slice(0, 4)} &middot; {seasonCounter(selected.frame.day)}
                  </span>
                )}
              </>
            ) : " "}
          </p>

          {load.status === "loading" && (
            <p className="mt-3 font-mono text-xs text-gray-600">reading the instruments&hellip;</p>
          )}
          {load.status === "empty" && (
            <p className="mx-auto mt-3 max-w-md font-display text-xl leading-snug text-gray-400">
              The board is dark right now — no instrument has reported.
            </p>
          )}
          {load.status === "error" && (
            <p className="mx-auto mt-3 max-w-md font-display text-xl leading-snug text-gray-400">
              The board can&rsquo;t be reached right now.
            </p>
          )}

          {/* THE HEADLINE — the next opener anywhere in the country. It stands
              in for the percentile sentence the porch used to lead with, and it
              is a transcription of a state agency's own published date with its
              URL one tap away: no pool, no rank, nothing to mismatch. It speaks
              only on the live board — a countdown is a statement about NOW. */}
          {isLiveNow && <OpenerHeadline opener={opener} read={openerRead} />}

          {selected && (
            <>
              <h2
                className={
                  isLiveNow
                    ? "mx-auto mt-3 max-w-2xl font-display text-lg font-normal leading-snug text-gray-300 sm:text-xl"
                    : "mx-auto mt-2 max-w-2xl font-display text-[1.55rem] font-medium leading-[1.26] text-gray-50 sm:text-[2.1rem]"
                }
              >
                {selected.porch.lead}
              </h2>

              {/* THE STRIP — the rest of what's standing, scannable, not prose */}
              {(selected.porch.active.length > 0 || selected.porch.forming.length > 0) && (
                <div className="mx-auto mt-3.5 max-w-xl space-y-1">
                  {selected.porch.active.length > 0 && (
                    <p className="font-mono text-[11px] leading-relaxed text-gray-400">
                      <span className="tracking-[0.2em] text-amber-300/80">ACTIVE</span>
                      <span className="text-gray-600"> — </span>
                      {selected.porch.active.map((f, i) => (
                        <span key={f}>
                          {i > 0 && <span className="text-gray-600"> &middot; </span>}
                          <button
                            type="button"
                            onClick={scrollToBoard}
                            className="transition-colors hover:text-amber-200"
                          >
                            {f}
                          </button>
                        </span>
                      ))}
                    </p>
                  )}
                  {selected.porch.forming.length > 0 && (
                    <p className="font-mono text-[11px] leading-relaxed text-gray-500">
                      <span className="tracking-[0.2em] text-slate-400/90">FORMING</span>
                      <span className="text-gray-600"> — </span>
                      {selected.porch.forming.map((f, i) => (
                        <span key={f}>
                          {i > 0 && <span className="text-gray-600"> &middot; </span>}
                          <Link to="/morning" className="transition-colors hover:text-slate-200">
                            {f}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              )}

              <p className="mt-3 font-mono text-[11px] leading-relaxed text-gray-500">
                {selected.porch.coda}
              </p>
              {!isNewest && (
                <button
                  type="button"
                  onClick={() => selectDay(data!.days[0].frame.day)}
                  className="mt-2.5 font-mono text-[11px] tracking-wide text-cyan-300/80 transition-colors hover:text-cyan-200"
                >
                  &larr; back to today
                </button>
              )}
            </>
          )}

          {/* THE FITTED BLOCK — your ground's numbers, pre-corrected (§2a).
              Speaks only of NOW: it renders on the live board, never a past day. */}
          {isLiveNow && selected && (
            <TodayFitted
              ground={ground}
              groundName={groundName}
              setGround={setGround}
              sky={sky}
              resolved={selected.resolved}
            />
          )}

        </div>

        {/* THE COUNTRY MAP — the index. A state is a door to its card, by
            touch, by mouse and by keyboard. What it shades by is gated; what it
            is FOR is not. Skeleton ground until the frame lands, so the page
            never opens on bare black. */}
        <div ref={stageRef} className="mt-6 scroll-mt-6">
          {selected ? (
            <RarityMap
              resolved={selected.resolved}
              day={selected.frame.day}
              day0Source={selected.frame.day0_source}
              // The live lanes describe NOW. A past ledger day is handed empty
              // lanes rather than today's, so the map never dresses July 3 in
              // this evening's watches.
              alerts={isLiveNow ? alerts : new Map()}
              watches={isLiveNow ? watches : []}
              onPick={(abbr) => navigate(`/season?state=${abbr}`)}
            />
          ) : (
            <div
              className="w-full overflow-hidden rounded-2xl"
              style={{ background: "#0a0f14", aspectRatio: "975 / 610" }}
            >
              <SkeletonGround />
            </div>
          )}
        </div>

        {/* THE RHYME — only when the archive holds one; never a placeholder.
            Withheld under the same gate as the depth: a rhyme is a similarity
            between two frame VECTORS, and today's vector carries the same
            centroid-vs-station-network bytes the depth is withheld for. The
            match is not merely described wrongly, it is COMPUTED from the
            mismatch — so the sentence and the ranking go together. */}
        {selected && rhyme && (
          <div className="mx-auto mt-8 max-w-xl text-center">
            {/* Honest scope: the rhyme is the NATIONAL board's, not your ground's */}
            <p className="font-mono text-[10px] tracking-[0.2em] text-gray-600">THE NATIONAL BOARD</p>
            {TAIL_DEPTH_IS_COMPARABLE ? (
              <>
                <p className="mt-1 font-body text-[15px] leading-relaxed text-gray-300 sm:text-base">
                  {isNewest ? "Today reads" : "This day read"} most like{" "}
                  <strong className="font-medium text-gray-100">{longDate(rhyme.rhyme_day)}</strong> — the
                  same instruments, deep the same way.
                </p>
                <p className="mt-1 font-body text-[14px] leading-relaxed text-gray-400">
                  {rhyme.followed
                    ? followedLine(rhyme.followed)
                    : "A quiet week followed — that's on the record too."}
                </p>
                <Link
                  to={`/atlas?date=${rhyme.rhyme_day}`}
                  className="mt-1.5 inline-block font-mono text-[11px] tracking-wide text-cyan-300/80 transition-colors hover:text-cyan-200"
                >
                  read that day &rarr;
                </Link>
              </>
            ) : (
              <p className="mt-1 font-body text-[15px] leading-relaxed text-gray-400 sm:text-base">
                Which day this one reads like is withheld for the same reason the shading is. A rhyme
                is a similarity between two days&rsquo; instruments, and today&rsquo;s thermometers are
                not measured the way the record&rsquo;s were — so the match would be between a day and a
                yardstick, not between two days. It returns with the depth.
              </p>
            )}
          </div>
        )}
      </section>

      {/* THE INSTRUMENTS — the breathing board, displaced from the hero by the
          rarity map but not diminished: it is the only surface that shows the
          non-areal lanes (climate needles, tide gauges, Gulf buoys) a state
          choropleth cannot draw, and it keeps its tap-card verbatim. */}
      <section className="mx-auto mt-14 w-full max-w-3xl px-5 sm:px-8">
        <p className="text-center font-mono text-[10px] tracking-[0.24em] text-gray-500">
          THE INSTRUMENTS
        </p>
        {/* THE COUNT — what actually reported, not the roster. The old line said
            "72 of them"; 50 of the 72 carry a byte and the other 22 were being
            drawn at the renderer's dim minimum, which is the same mark a genuinely
            quiet instrument gets. A dark gauge must not look like a calm one. */}
        <p className="mx-auto mt-2 max-w-lg text-center font-body text-[13px] leading-relaxed text-gray-500">
          The same day, gauge by gauge
          {instrumentCount > 0 ? ` — ${reportedCount} of ${instrumentCount} reported` : ""}
          {TAIL_DEPTH_IS_COMPARABLE ? ": each one lit by how deep it sits in its own history." : "."}
          {darkLanes.length > 0 && (
            <>
              {" "}
              <span className="text-gray-400">
                The {darkLanes.map((l) => laneCount(l.total, l)).join(", the ")} are dark.
              </span>
            </>
          )}
        </p>
        <div
          ref={boardStageRef}
          className="relative mt-4 w-full overflow-hidden rounded-2xl"
          style={{ background: "#0a0f14", aspectRatio: "975 / 610" }}
        >
          {model ? (
            <canvas
              ref={canvasRef}
              className="block w-full touch-none select-none"
              onPointerDown={onCanvasDown}
              onPointerUp={onCanvasUp}
            />
          ) : (
            <SkeletonGround />
          )}

          {/* THE DARK GAUGES — drawn OVER the canvas, in the same hatch the
              country map uses for "no reading on file", because the renderer
              has no mark for absence: `drawDot` paints a null reading at pct
              0.03, which is a perfectly ordinary depth. Rather than reach into
              the film engine, the absence is stamped on top in the same Albers
              space the canvas draws in, so the two register exactly.

              These are decoration only — pointer-events off — so the canvas
              keeps its hit test and a tap still opens the card, which already
              says "no reading on file today" in the instrument's own name. */}
          {model && darkInstruments.length > 0 && (
            <svg
              className="pointer-events-none absolute inset-0 h-full w-full"
              viewBox={`0 0 ${BOARD_PROJECTION.width} ${BOARD_PROJECTION.height}`}
              aria-hidden="true"
            >
              <defs>
                <pattern
                  id="board-dark"
                  width="3.5"
                  height="3.5"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="3.5" height="3.5" fill="#0d1217" />
                  <line x1="0" y1="0" x2="0" y2="3.5" stroke="rgba(255,255,255,0.34)" strokeWidth="1" />
                </pattern>
              </defs>
              {darkInstruments.map((r) => (
                <circle
                  key={r.inst.id}
                  cx={r.inst.albers_x}
                  cy={r.inst.albers_y}
                  r={5.5}
                  fill="url(#board-dark)"
                  stroke="rgba(255,255,255,0.22)"
                  strokeWidth={0.8}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </svg>
          )}

          {card && (
            <>
              <button
                aria-label="Dismiss"
                className="absolute inset-0 z-10 cursor-default"
                onPointerUp={() => setCard(null)}
              />
              <div
                className="pointer-events-none absolute z-20 max-w-[240px] rounded-lg bg-gray-900/95 px-3 py-2.5 ring-1 ring-white/10 backdrop-blur"
                style={{
                  left: Math.min(Math.max(8, card.left - 110), (cssWRef.current || 320) - 232),
                  ...(card.bottom !== undefined
                    ? { bottom: card.bottom }
                    : { top: Math.max(8, card.top ?? 0) }),
                }}
              >
                <div className="font-mono text-[11px] tracking-wide text-cyan-300/90">
                  {card.r.inst.label}
                </div>
                {card.r.inst.sublabel && (
                  <div className="mt-0.5 font-mono text-[10px] text-gray-500">
                    {card.r.inst.sublabel}
                  </div>
                )}
                <div className="mt-1.5 font-body text-[13px] leading-snug text-gray-200">
                  {readingText(card.r)}
                </div>
              </div>
            </>
          )}
        </div>
        <p className="mt-2.5 text-center font-mono text-[10px] leading-relaxed text-gray-600">
          {TAIL_DEPTH_IS_COMPARABLE ? (
            <>
              each light is an instrument deep in its own history —{" "}
              <span className="text-amber-300/80">amber hot</span> &middot;{" "}
              <span className="text-sky-300/80">ice cold</span> &middot; size = depth
            </>
          ) : (
            /* The lights used to be sized and tinted by tail depth. That is the
               withheld claim drawn instead of written, so every thermometer that
               reported now carries the same mark and no hue. */
            <>every state thermometer that reported, marked the same &mdash; the depth that used to
              size them is withheld</>
          )}
          {alertsApply && (
            <>
              {" "}
              &middot; <span className="text-orange-300/80">ring = active NWS alert</span>
            </>
          )}
          {formingApply && (
            <>
              {" "}
              &middot; <span className="text-slate-300/80">dashed ring = forming</span>
            </>
          )}
          {darkInstruments.length > 0 && (
            <>
              {" "}
              &middot; <span className="text-gray-500">hatched = no reading on file</span>
            </>
          )}
        </p>

        {darkLanes.length > 0 && <DarkLanesNote lanes={darkLanes} />}
      </section>

      {/* THE FILMS — the site's best artifacts, given their own cards */}
      <section className="mx-auto mt-14 w-full max-w-3xl px-5 sm:px-8">
        <p className="text-center font-mono text-[10px] tracking-[0.24em] text-gray-500">
          WATCH A DAY ASSEMBLE ITSELF
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <FilmCard
            to="/board/uri"
            era="FEBRUARY 2021"
            title="Winter Storm Uri, as the instruments saw it coming"
          />
          <FilmCard
            to="/board/sandy"
            era="OCTOBER 2012"
            title="Hurricane Sandy, six harbors saw it first"
          />
        </div>
      </section>

      {/* THE LEDGER — the past days as a diary, each row a door */}
      {data && data.days.length > 1 && (
        <section className="mx-auto mt-16 w-full max-w-3xl px-5 sm:px-8">
          <p className="text-center font-mono text-[10px] tracking-[0.24em] text-gray-500">
            THE DAYS BEFORE
          </p>
          <div className="mt-4 border-t border-white/5">
            {data.days.slice(1).map((entry) => (
              <LedgerRow
                key={entry.frame.day}
                entry={entry}
                rhyme={rhymes.get(entry.frame.day)}
                selected={!!selected && selected.frame.day === entry.frame.day}
                onSelect={selectDay}
              />
            ))}
          </div>
        </section>
      )}

      {/* THE INVITATION */}
      <section className="mx-auto mt-16 w-full max-w-3xl px-5 text-center sm:px-8">
        <Link
          to="/born"
          className="font-display text-lg leading-snug text-gray-200 transition-colors hover:text-cyan-200 sm:text-xl"
        >
          Pick a day you remember — see what the ground remembers.{" "}
          <span className="text-cyan-400/70">&rarr;</span>
        </Link>
      </section>

      {/* THE DOORS — the same footer every sibling page shares, with the
          rotating lore line above it (1950 insight 8 — moon-phase only). */}
      <div className="mx-auto w-full max-w-3xl px-5 pb-10 sm:px-8">
        {sky && loreLine(sky) && (
          <p className="mt-14 text-center font-display text-sm italic text-gray-500">
            &ldquo;{loreLine(sky)}&rdquo;
          </p>
        )}
        <InnerFooter current="today" />
      </div>
    </div>
  );
}
