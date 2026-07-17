import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSearchParams } from "react-router-dom";
import { drawFrame, fitCanvas, hitTest, type BoardModel } from "@/lib/boardPlayer";
import { BOARD_PROJECTION, CONUS_BORDERS } from "@/data/board/conusBorders";
import { InnerFooter } from "@/components/InnerNav";
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

/**
 * TODAY — THE FRONT DOOR (`/`). One room, one true sentence per screen.
 *
 * Identity first — brand, thesis, and a dim US skeleton render statically
 * before a single row arrives; the page never opens on a bare black screen.
 * Then the porch: today's frame spoken in one honest, kind-aware sentence
 * over the live board (hot states glow amber, cold states ice; tides and
 * buoys keep the ember teal). Under it, when the archive holds one, the
 * rhyme: the day today reads most like, and what followed then. Scroll down
 * and the past days read as a typographic ledger — a diary, not dot-blobs —
 * and tapping any row loads that day's full board into the hero. The films
 * get their own cards; the doors footer is the same one every sibling page
 * shares.
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

/** Honest reading for a tapped instrument. */
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
  const [searchParams] = useSearchParams();
  // The one ground choice — ?state=XX overrides and persists (§2e).
  const { ground, groundName, setGround } = useYourGround(searchParams.get("state"));
  const [sky, setSky] = useState<GroundSky | null>(null);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [alerts, setAlerts] = useState<Map<string, StateAlert>>(new Map());
  const [watches, setWatches] = useState<FormationWatch[]>([]);
  const [rhymes, setRhymes] = useState<Map<string, BoardRhyme>>(new Map());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [card, setCard] = useState<CardState | null>(null);

  const heroRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
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
          const live = isNow ? liveAlerts : undefined;
          const liveForming = isNow ? liveWatches : undefined;
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

  const data = load.status === "ready" ? load.data : null;

  const selected = useMemo(() => {
    if (!data) return null;
    return data.days.find((d) => d.frame.day === selectedDay) ?? data.days[0];
  }, [data, selectedDay]);
  const isNewest = !!data && !!selected && selected.frame.day === data.days[0].frame.day;
  // Active alerts + forming rings mark only the live board — the newest frame,
  // while it's current.
  const isLiveNow = isNewest && !!selected && selected.frame.day >= isoDaysBefore(todayIso(), 1);
  const alertsApply = isLiveNow && alerts.size > 0;
  const formingApply = isLiveNow && watches.length > 0;

  const formingMap = useMemo(() => formingByState(watches), [watches]);

  const model: BoardModel | null = useMemo(
    () =>
      selected
        ? compileDayFilm(
            selected.frame.day,
            selected.resolved,
            alertsApply ? alerts : undefined,
            formingApply ? formingMap : undefined,
          )
        : null,
    [selected, alertsApply, alerts, formingApply, formingMap],
  );

  const rhyme = selected ? rhymes.get(selected.frame.day) : undefined;

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
    const stage = stageRef.current;
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

          {selected && (
            <>
              <h2 className="mx-auto mt-2 max-w-2xl font-display text-[1.55rem] font-medium leading-[1.26] text-gray-50 sm:text-[2.1rem]">
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

          {/* THE RHYME — only when the archive holds one; never a placeholder */}
          {selected && rhyme && (
            <div className="mx-auto mt-5 max-w-xl">
              <p className="font-body text-[15px] leading-relaxed text-gray-300 sm:text-base">
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
            </div>
          )}
        </div>

        {/* THE GROUND — skeleton until the frame lands, never a bare black screen */}
        <div
          ref={stageRef}
          className="relative mt-6 w-full overflow-hidden rounded-2xl"
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
          each light is an instrument deep in its own history —{" "}
          <span className="text-amber-300/80">amber hot</span> &middot;{" "}
          <span className="text-sky-300/80">ice cold</span> &middot; size = depth
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
        </p>
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
