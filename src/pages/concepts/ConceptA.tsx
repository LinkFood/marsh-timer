import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { drawFrame, fitCanvas, hitTest, type BoardModel } from "@/lib/boardPlayer";
import {
  albersXRange,
  compileDayFilm,
  drawRibbon,
  fetchFrames,
  fetchInstruments,
  longDate,
  porchLine,
  resolveDay,
  shortDate,
  todayIso,
  isoDaysBefore,
  type DayFrame,
  type Instrument,
  type ResolvedInstrument,
  type PorchLine,
} from "@/lib/board/frameStore";

/**
 * THE ONE ROOM (concept A → the facelift candidate).
 *
 * Not a page. A room. You open it and you are standing on the ground: today's
 * live frame as embers on the dark CONUS, one true sentence over it in Playfair,
 * the date whispered in a corner. Tap a swollen ember and it tells you, inline,
 * how deep it sits. Scroll down and you fall backward through the days — each
 * prior day one honest row, its ribbon and, if anything swelled, its one line.
 * At the floor of the room, the other doors, whispered.
 *
 * The embers are drawn by the film's own renderer (boardPlayer.drawFrame) over a
 * synthesized one-day film, so the room and the film speak with one hand. No
 * header bar, no section labels, no card chrome. Every word earns its place.
 */

const DAYS_BACK = 30;

interface RoomData {
  instruments: Instrument[];
  today: DayFrame;
  todayResolved: ResolvedInstrument[];
  porch: PorchLine;
  model: BoardModel;
  history: { frame: DayFrame; resolved: ResolvedInstrument[]; porch: PorchLine }[];
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

// ── Mini heat-ribbon: a day's swell laid west→east by Albers x ──────────────────

function DayRibbon({
  resolved,
  xMin,
  xMax,
}: {
  resolved: ResolvedInstrument[];
  xMin: number;
  xMax: number;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => drawRibbon(c, resolved, xMin, xMax);
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [resolved, xMin, xMax]);
  return <canvas ref={ref} className="block h-9 w-full" />;
}

// ── A prior day, one honest row ─────────────────────────────────────────────────

function HistoryRow({
  frame,
  resolved,
  porch,
  xMin,
  xMax,
}: {
  frame: DayFrame;
  resolved: ResolvedInstrument[];
  porch: PorchLine;
  xMin: number;
  xMax: number;
}) {
  const [open, setOpen] = useState(false);
  const swelled = porch.swollen.length > 0;

  return (
    <div className="border-b border-white/5">
      <button
        type="button"
        onClick={() => swelled && setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 py-3.5 text-left transition-colors ${
          swelled ? "cursor-pointer hover:bg-white/[0.02]" : "cursor-default"
        }`}
      >
        <span
          className={`w-14 shrink-0 text-right font-mono text-[11px] tabular-nums ${
            swelled ? "text-gray-400" : "text-gray-600"
          }`}
        >
          {shortDate(frame.day)}
        </span>
        <span className="min-w-0 flex-1">
          <DayRibbon resolved={resolved} xMin={xMin} xMax={xMax} />
        </span>
      </button>
      {swelled && (
        <p className="-mt-1 pb-3.5 pl-[4.25rem] pr-2 font-body text-[13px] leading-snug text-gray-400">
          {porch.lead}
          {open && (
            <span className="mt-1.5 block font-mono text-[11px] text-gray-500">
              {porch.swollen.map((r) => (
                <span key={r.inst.id} className="mr-3 inline-block">
                  {r.inst.label} · {readingText(r)}
                </span>
              ))}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

// ── The room ────────────────────────────────────────────────────────────────────

interface CardState {
  r: ResolvedInstrument;
  left: number;
  top?: number;
  bottom?: number;
}

export default function ConceptA() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [card, setCard] = useState<CardState | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cssWRef = useRef(0);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    document.title = "Duck Countdown";
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const today = todayIso();
        const from = isoDaysBefore(today, DAYS_BACK - 1);
        const [instruments, frames] = await Promise.all([
          fetchInstruments(),
          fetchFrames(from, today),
        ]);
        if (cancelled) return;
        if (!instruments.length || !frames.length) {
          setLoad({ status: "empty" });
          return;
        }
        // frames come newest-first. The first is the room's "today"; even if the
        // real calendar today is missing, the newest frame is the honest now.
        const [head, ...rest] = frames;
        const todayResolved = resolveDay(head, instruments);
        const model = compileDayFilm(head.day, todayResolved);
        const history = rest.map((frame) => {
          const resolved = resolveDay(frame, instruments);
          return { frame, resolved, porch: porchLine(frame.day, resolved, frame) };
        });
        setLoad({
          status: "ready",
          data: {
            instruments,
            today: head,
            todayResolved,
            porch: porchLine(head.day, todayResolved, head),
            model,
            history,
          },
        });
      } catch {
        if (!cancelled) setLoad({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const data = load.status === "ready" ? load.data : null;
  const model = data?.model ?? null;

  const [xMin, xMax] = useMemo(
    () => (data ? albersXRange(data.instruments) : [0, 975]),
    [data],
  );

  const resolvedById = useMemo(() => {
    const m = new Map<string, ResolvedInstrument>();
    if (data) for (const r of data.todayResolved) m.set(r.inst.id, r);
    return m;
  }, [data]);

  // Fit + draw the room's ground. One frame; redraw on resize.
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
    return () => window.removeEventListener("resize", refit);
  }, [refit]);

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
      {/* THE ROOM — first screen, full height */}
      <section className="relative flex min-h-[100svh] flex-col items-center justify-center px-5 pb-16 pt-20 sm:px-8">
        {/* whispered corners — they belong to the room, and scroll away with it */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between px-5 py-4 sm:px-8">
          <span className="font-mono text-[11px] tabular-nums text-gray-500">
            {data ? longDate(data.today.day) : ""}
          </span>
          <span className="font-mono text-[10px] tracking-[0.28em] text-gray-600">DUCK COUNTDOWN</span>
        </div>

        {load.status === "loading" && (
          <p className="font-mono text-xs text-gray-600">lighting the board&hellip;</p>
        )}

        {load.status === "empty" && (
          <p className="max-w-md text-center font-display text-xl leading-snug text-gray-400">
            The board is dark right now — no instrument has reported.
          </p>
        )}
        {load.status === "error" && (
          <p className="max-w-md text-center font-display text-xl leading-snug text-gray-400">
            The board can&rsquo;t be reached right now.
          </p>
        )}

        {load.status === "ready" && data && (
          <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
            {/* the one true sentence */}
            <p className="mb-1 max-w-2xl text-center font-display text-[1.6rem] font-medium leading-[1.28] text-gray-50 sm:text-[2.1rem]">
              {data.porch.lead}
            </p>
            <p className="mb-6 font-body text-sm text-gray-500 sm:text-base">{data.porch.coda}</p>

            {/* the ground */}
            <div
              ref={stageRef}
              className="relative w-full overflow-hidden rounded-2xl"
              style={{ background: "#0a0f14" }}
            >
              <canvas
                ref={canvasRef}
                className="block w-full touch-none select-none"
                onPointerDown={onCanvasDown}
                onPointerUp={onCanvasUp}
              />
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

            {/* the film — one quiet line inside the room */}
            <Link
              to="/board/uri"
              className="mt-7 font-mono text-[12px] tracking-wide text-cyan-300/70 transition-colors hover:text-cyan-200"
            >
              watch a storm form &rarr;
            </Link>

            {/* the way down */}
            <div className="mt-10 flex flex-col items-center gap-1 text-gray-600">
              <span className="font-mono text-[11px] tracking-wide">fall back through the days</span>
              <span className="animate-bounce text-lg leading-none">&darr;</span>
            </div>
          </div>
        )}
      </section>

      {/* THE DESCENT — scroll is time */}
      {load.status === "ready" && data && (
        <section className="mx-auto w-full max-w-3xl px-5 pb-6 sm:px-8">
          {data.history.map((d) => (
            <HistoryRow
              key={d.frame.day}
              frame={d.frame}
              resolved={d.resolved}
              porch={d.porch}
              xMin={xMin}
              xMax={xMax}
            />
          ))}

          {/* the floor of the room — every other door, whispered */}
          <div className="mt-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 pb-16 pt-8">
            {[
              { to: "/atlas", label: "fall into your ground" },
              { to: "/morning", label: "the morning line" },
              { to: "/born", label: "the day you were born" },
              { to: "/court", label: "the court" },
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="font-mono text-[11px] tracking-wide text-gray-600 transition-colors hover:text-cyan-300"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
