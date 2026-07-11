import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  activeBeat,
  compileFilm,
  dayAt,
  drawFrame,
  fitCanvas,
  hitTest,
  totalDays,
  type BoardFilm,
  type BoardHit,
  type BoardModel,
} from "@/lib/boardPlayer";
import { makeUriFixture } from "@/data/board/uriFixture";

/**
 * THE BOARD — the sentry's face, first film (docs/THE-WEEK.md PARK LIST →
 * THE BOARD). A detective's evidence board come alive: dark ground, embers
 * that swell with how deep a reading sits in its own historical tail, strings
 * that tighten as a fusion forms, one bloom, strings etched permanent after.
 *
 * The film's data lands at /board/uri-2021.json (baked separately). Until it
 * exists, production renders an honest quiet state — no spinner theater. In dev
 * a synthetic fixture stands in so the rendering can be perfected now; the real
 * file simply replaces it at fetch time (the fixture is never the real file).
 *
 * One <canvas>, hand-rolled (src/lib/boardPlayer.ts). Auto-plays once, then
 * holds on the etched board; a quiet scrubber reaches any day; tap a dot for
 * its honest reading. Apple restraint: one sentence at a time, below the film.
 */

const MS_PER_DAY = 800; // playback cadence
const BEAT_FADE_MS = 450;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function dayLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; model: BoardModel; live: boolean }
  | { status: "absent" }
  | { status: "error" };

function readingFor(hit: Extract<BoardHit, { type: "dot" }>): string {
  if (hit.dim || hit.v === null || hit.v === undefined) return "no reading on file for this day";
  const p = Math.round((hit.pct ?? 0) * 100);
  const deeper = `deeper than ${p}% of its recorded readings`;
  switch (hit.dot.kind) {
    case "needle":
      return `${hit.v.toFixed(2)} — ${deeper}`;
    case "state-temp":
      return `${hit.v.toFixed(1)}°F — colder than ${p}% of its recorded mid-Februaries`;
    case "buoy-pressure":
      return `${hit.v.toFixed(1)} mb — lower than ${p}% of its recorded pressures`;
    case "tide-setdown":
      return `${hit.v.toFixed(2)} ft — a setdown ${deeper}`;
    default:
      return `${hit.v} — ${deeper}`;
  }
}

interface CardState {
  hit: BoardHit;
  left: number; // CSS px within the stage
  top?: number; // anchored below the tap
  bottom?: number; // anchored above the tap (when the tap sits low on the board)
}

export default function BoardPage() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [t, setT] = useState(0); // fractional master-day cursor
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [card, setCard] = useState<CardState | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastMsRef = useRef<number>(0);
  const tRef = useRef(0); // current cursor, for RAF + resize redraws
  const cssWRef = useRef<number>(0);
  const autoPlayedRef = useRef(false);
  const scrubbingRef = useRef(false);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  const model = load.status === "ready" ? load.model : null;
  const nDays = model ? totalDays(model) : 0;
  const lastIndex = Math.max(0, nDays - 1);

  useEffect(() => {
    document.title = model
      ? `${load.status === "ready" ? load.model.film.title : "The Board"} — The Board`
      : "The Board — Duck Countdown";
  }, [model, load]);

  // Fetch the film. Real file wins; in dev the fixture stands in when absent.
  useEffect(() => {
    let cancelled = false;
    fetch("/board/uri-2021.json", { cache: "no-cache" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as BoardFilm;
        if (cancelled) return;
        setLoad({ status: "ready", model: compileFilm(json), live: true });
      })
      .catch(() => {
        if (cancelled) return;
        if (import.meta.env.DEV) {
          setLoad({ status: "ready", model: compileFilm(makeUriFixture()), live: false });
        } else {
          setLoad({ status: "absent" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fit the canvas to its container width, redraw once at the current cursor.
  // Depends only on the model (NOT t) — per-frame drawing is the RAF loop's job;
  // this runs on load and on window resize, so it must not re-fit every frame.
  const refit = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || !model) return;
    const cssW = stage.clientWidth;
    if (cssW <= 0) return; // layout not settled yet
    cssWRef.current = cssW;
    fitCanvas(canvas, cssW, model.film.projection);
    const ctx = canvas.getContext("2d");
    if (ctx) drawFrame(ctx, model, tRef.current, performance.now());
  }, [model]);

  useEffect(() => {
    refit();
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [refit]);

  // Auto-play once on first ready.
  useEffect(() => {
    if (model && !autoPlayedRef.current) {
      autoPlayedRef.current = true;
      setPlaying(true);
    }
  }, [model]);

  // Keep the cursor ref in sync so the RAF closure and resize redraw stay current.
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  // The RAF loop — advances the cursor while playing, always redraws so the
  // string pulse and bloom animate even when paused at the end.
  useEffect(() => {
    if (!model) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;

    lastMsRef.current = performance.now();
    const tick = (nowMs: number) => {
      const dt = Math.max(0, nowMs - lastMsRef.current); // never advance backward
      lastMsRef.current = nowMs;
      if (playing && !scrubbingRef.current && !document.hidden) {
        const next = tRef.current + dt / MS_PER_DAY;
        if (next >= lastIndex) {
          tRef.current = lastIndex;
          setT(lastIndex);
          setPlaying(false);
          setEnded(true);
        } else {
          tRef.current = next;
          setT(next);
        }
      }
      drawFrame(ctx, model, tRef.current, nowMs);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [model, playing, lastIndex]);

  const replay = () => {
    setCard(null);
    setEnded(false);
    setT(0);
    setPlaying(true);
  };
  const togglePlay = () => {
    if (ended) return replay();
    setPlaying((p) => !p);
  };

  // ── Scrubber (pointer-driven; 44px hit zone, 2px visual line) ──────────────
  const scrubToClientX = (clientX: number, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setT(frac * lastIndex);
  };
  const onScrubDown = (e: React.PointerEvent<HTMLDivElement>) => {
    scrubbingRef.current = true;
    setPlaying(false);
    setCard(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubToClientX(e.clientX, e.currentTarget);
  };
  const onScrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbingRef.current) return;
    scrubToClientX(e.clientX, e.currentTarget);
  };
  const onScrubUp = (e: React.PointerEvent<HTMLDivElement>) => {
    scrubbingRef.current = false;
    if (tRef.current >= lastIndex) setEnded(true);
    else setEnded(false);
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // ── Canvas tap → dot/string overlay (pointerup + move guard; first-tap-safe) ─
  const onCanvasDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
  };
  const onCanvasUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const down = pointerDownRef.current;
    pointerDownRef.current = null;
    if (!model || !down) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 10) return; // a drag, not a tap
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const rect = canvas.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const proj = model.film.projection;
    const projX = (cssX / rect.width) * proj.width;
    const projY = (cssY / rect.height) * proj.height;
    const hit = hitTest(model, projX, projY, tRef.current);
    if (!hit) {
      setCard(null);
      return;
    }
    // Flip the card above the tap when it sits low on the board, so it never
    // clips out the bottom of the stage.
    if (cssY > rect.height * 0.5) {
      setCard({ hit, left: cssX, bottom: rect.height - cssY + 14 });
    } else {
      setCard({ hit, left: cssX, top: cssY + 14 });
    }
  };

  const beat = model ? activeBeat(model, t) : null;
  const currentDay = model ? dayAt(model, t) : null;
  const film = load.status === "ready" ? load.model.film : null;

  // The bloom's gravestone: a DOM card that lands on the board when the bloom
  // fires and stays (canvas text is unreadable at 375px). Split "Place: stats".
  const bloomLanded =
    !!model && model.firstBloomIndex !== Infinity && t >= model.firstBloomIndex - 1e-6;
  const bloomLabel = model?.blooms[0]?.bloom.label ?? null;
  const [bloomPlace, bloomStat] = useMemo(() => {
    if (!bloomLabel) return ["", ""] as const;
    const i = bloomLabel.indexOf(":");
    if (i === -1) return [bloomLabel, ""] as const;
    return [bloomLabel.slice(0, i).trim(), bloomLabel.slice(i + 1).trim()] as const;
  }, [bloomLabel]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-gray-950 px-5 py-7 text-gray-100 sm:px-10 sm:py-9">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] tracking-[0.28em] text-cyan-300/90">THE BOARD</div>
          <div className="mt-1.5 font-mono text-[11px] text-gray-500">
            a fusion, replayed as the instruments saw it &middot; every ember, string, and bloom is a recorded row
          </div>
        </div>
        <Link
          to="/"
          className="whitespace-nowrap font-mono text-[11px] tracking-[0.24em] text-gray-500 hover:text-cyan-300"
        >
          DUCK COUNTDOWN
        </Link>
      </header>

      <main className="flex flex-1 flex-col justify-center py-8">
        {load.status === "loading" && (
          <p className="font-mono text-xs text-gray-600">lighting the board&hellip;</p>
        )}

        {load.status === "absent" && (
          <div className="max-w-2xl">
            <h1 className="font-display text-2xl leading-snug text-gray-300 sm:text-3xl">
              The film is still being developed.
            </h1>
            <p className="mt-3 font-mono text-xs leading-relaxed text-gray-500">
              This board replays Winter Storm Uri as the instruments saw it coming. The reel is being
              cut from the archive now &mdash; check back shortly.
            </p>
          </div>
        )}

        {load.status === "error" && (
          <div className="max-w-2xl">
            <h1 className="font-display text-2xl leading-snug text-gray-300 sm:text-3xl">
              The board couldn&rsquo;t be reached.
            </h1>
          </div>
        )}

        {load.status === "ready" && film && (
          <div className="mx-auto w-full max-w-3xl">
            {/* Title block from the film */}
            <div className="mb-4">
              <h1 className="font-display text-[1.7rem] font-medium leading-[1.2] text-gray-50 sm:text-4xl">
                {film.title}
              </h1>
              <p className="mt-1.5 font-body text-sm leading-relaxed text-gray-400 sm:text-base">
                {film.subtitle}
              </p>
              {!load.live && (
                <p className="mt-1 font-mono text-[10px] tracking-wide text-amber-300/60">
                  dev fixture &middot; the baked archive film replaces this at fetch time
                </p>
              )}
            </div>

            {/* The stage */}
            <div
              ref={stageRef}
              className="relative w-full overflow-hidden rounded-xl ring-1 ring-white/10"
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
                  {/* tap-away dismiss layer */}
                  <button
                    aria-label="Dismiss"
                    className="absolute inset-0 z-10 cursor-default"
                    onPointerUp={() => setCard(null)}
                  />
                  <div
                    className="pointer-events-none absolute z-20 max-w-[240px] rounded-lg bg-gray-900/95 px-3 py-2.5 ring-1 ring-white/15 backdrop-blur"
                    style={{
                      left: Math.min(Math.max(8, card.left - 110), (cssWRef.current || 320) - 232),
                      ...(card.bottom !== undefined
                        ? { bottom: card.bottom }
                        : { top: Math.max(8, card.top ?? 0) }),
                    }}
                  >
                    {card.hit.type === "dot" ? (
                      <>
                        <div className="font-mono text-[11px] tracking-wide text-cyan-300/90">
                          {card.hit.dot.label}
                        </div>
                        {card.hit.dot.sublabel && (
                          <div className="mt-0.5 font-mono text-[10px] text-gray-500">
                            {card.hit.dot.sublabel}
                          </div>
                        )}
                        <div className="mt-1.5 font-body text-[13px] leading-snug text-gray-200">
                          {readingFor(card.hit)}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="font-mono text-[10px] tracking-wide text-cyan-300/80">
                          the string&rsquo;s receipt
                        </div>
                        <div className="mt-1.5 font-body text-[13px] leading-snug text-gray-200">
                          {card.hit.str.receipt}
                        </div>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* The gravestone — lands on the board when the bloom fires and
                  stays. DOM (not canvas) so it's crisp and readable at 375px;
                  pointer-events-none so taps still reach the dots beneath. */}
              {bloomLanded && bloomPlace && (
                <div className="board-gravestone pointer-events-none absolute inset-x-0 bottom-0 z-[5] flex justify-center px-3 pb-3">
                  <div className="max-w-[92%] rounded-md bg-gray-950/85 px-4 py-2.5 text-center shadow-lg ring-1 ring-amber-200/20 backdrop-blur-sm">
                    <div className="font-display text-sm font-semibold tracking-wide text-amber-100/90 sm:text-base">
                      {bloomPlace}
                    </div>
                    {bloomStat && (
                      <div className="mt-0.5 font-mono text-[11px] leading-relaxed text-amber-200/60 sm:text-xs">
                        {bloomStat}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Controls — minimal and quiet */}
            <div className="mt-4 flex items-center gap-4">
              <button
                onClick={togglePlay}
                className="shrink-0 rounded-full bg-cyan-400/10 px-4 py-1.5 font-mono text-[11px] tracking-wide text-cyan-200 ring-1 ring-cyan-400/40 transition hover:bg-cyan-400/20 hover:text-cyan-100"
              >
                {ended ? "↻ replay" : playing ? "❙❙ pause" : "▶ play"}
              </button>

              {/* Scrubber: 44px hit zone, 2px visual line, cyan knob */}
              <div
                className="relative flex h-11 flex-1 cursor-pointer items-center touch-none"
                onPointerDown={onScrubDown}
                onPointerMove={onScrubMove}
                onPointerUp={onScrubUp}
                role="slider"
                aria-label="Scrub the film to any day"
                aria-valuemin={0}
                aria-valuemax={lastIndex}
                aria-valuenow={Number(t.toFixed(2))}
                tabIndex={0}
              >
                <div className="pointer-events-none absolute left-0 right-0 h-0.5 rounded-full bg-white/12" />
                <div
                  className="pointer-events-none absolute h-0.5 rounded-full bg-cyan-400/70"
                  style={{ left: 0, width: `${lastIndex ? (t / lastIndex) * 100 : 0}%` }}
                />
                <div
                  className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-cyan-300 shadow-[0_0_8px_rgba(45,212,191,0.7)]"
                  style={{ left: `${lastIndex ? (t / lastIndex) * 100 : 0}%` }}
                />
              </div>

              <div className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-gray-400">
                {currentDay ? dayLabel(currentDay) : ""}
              </div>
            </div>

            {/* The porch voice — one sentence at a time, cross-fading. */}
            <div className="mt-7 min-h-[4.5rem]">
              {beat && (
                <div key={beat.key} className="board-beat">
                  <div className="font-mono text-[11px] tabular-nums text-gray-500">
                    {dayLabel(beat.date)}
                  </div>
                  <p className="mt-1.5 max-w-2xl font-display text-xl leading-snug text-gray-100 sm:text-2xl">
                    {beat.line}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="flex items-center justify-between font-mono text-[11px] text-gray-500">
        <Link to="/atlas" className="hover:text-cyan-300">
          &larr; the whole map
        </Link>
        <Link to="/morning" className="hover:text-gray-200">
          The Morning Line &rarr;
        </Link>
      </footer>

      <style>{`
        .board-beat { animation: board-beat-in ${BEAT_FADE_MS}ms ease-out both; }
        @keyframes board-beat-in {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .board-gravestone { animation: board-grave-in 700ms ease-out both; }
        @keyframes board-grave-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          .board-beat, .board-gravestone { animation: none; }
        }
      `}</style>
    </div>
  );
}
