import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  compileFilm,
  drawFrame,
  fitCanvas,
  totalDays,
  type BoardFilm,
  type BoardModel,
} from "@/lib/boardPlayer";

/**
 * THE FRONT DOOR (`/`). A stranger landing on duckcountdown.com meets the
 * product's crown demo first: THE BOARD's Uri film, playing itself, over one
 * true sentence and four quiet doors into the ground. Apple restraint,
 * mobile-first at 375px. No chat, no panels, no forecast.
 *
 * The hero is a LIVE embed of the same film that lives at /board/uri — it
 * reuses the hand-rolled canvas engine (src/lib/boardPlayer.ts), never forks
 * it. It auto-plays once, holds on the etched board, and the whole stage is a
 * link into the full player (scrubber, tap-a-dot readings, the porch beats).
 *
 * The old chat-first ExplorerLanding still lives, at /explore.
 */

const FILM_URL = "/board/uri-2021.json";
const MS_PER_DAY = 800; // same cadence as the full player

/** A compact, self-playing embed of THE BOARD's first film. Reuses the shared
 *  engine; renders only the board — no scrubber, cards, or beats. */
function BoardEmbed() {
  const [model, setModel] = useState<BoardModel | null>(null);
  const [failed, setFailed] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastMsRef = useRef(0);
  const tRef = useRef(0);
  const playingRef = useRef(true);

  const lastIndex = model ? Math.max(0, totalDays(model) - 1) : 0;

  // Fetch the baked film. If it can't be reached, fall back to a quiet
  // tap-to-watch still (never spinner theater).
  useEffect(() => {
    let cancelled = false;
    fetch(FILM_URL, { cache: "no-cache" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as BoardFilm;
        if (cancelled) return;
        setModel(compileFilm(json));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fit crisply to the container; redraw once at the current cursor.
  const refit = useCallback(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage || !model) return;
    const cssW = stage.clientWidth;
    if (cssW <= 0) return;
    fitCanvas(canvas, cssW, model.film.projection);
    const ctx = canvas.getContext("2d");
    if (ctx) drawFrame(ctx, model, tRef.current, performance.now());
  }, [model]);

  useEffect(() => {
    refit();
    window.addEventListener("resize", refit);
    return () => window.removeEventListener("resize", refit);
  }, [refit]);

  // Auto-play once, then hold on the etched board. The full film (replay,
  // scrub, tap) lives one tap away at /board/uri.
  useEffect(() => {
    if (!model) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return;
    lastMsRef.current = performance.now();
    const tick = (nowMs: number) => {
      const dt = Math.max(0, nowMs - lastMsRef.current);
      lastMsRef.current = nowMs;
      if (playingRef.current && !document.hidden) {
        const next = tRef.current + dt / MS_PER_DAY;
        if (next >= lastIndex) {
          tRef.current = lastIndex;
          playingRef.current = false; // hold on the etched board
        } else {
          tRef.current = next;
        }
      }
      drawFrame(ctx, model, tRef.current, nowMs);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [model, lastIndex]);

  if (failed) {
    // Quiet fallback: an honest still, still a door into the full film.
    return (
      <div
        className="flex aspect-[975/610] w-full items-center justify-center rounded-xl ring-1 ring-white/10"
        style={{ background: "#0a0f14" }}
      >
        <span className="font-mono text-[11px] tracking-wide text-cyan-300/80">
          watch the film &rarr;
        </span>
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className="relative w-full overflow-hidden rounded-xl ring-1 ring-white/10"
      style={{ background: "#0a0f14", aspectRatio: "975 / 610" }}
    >
      <canvas ref={canvasRef} className="block w-full select-none" />
      {/* Quiet affordance: the whole stage is a link (parent), this just names it. */}
      <div className="pointer-events-none absolute bottom-2.5 right-3 font-mono text-[10px] tracking-wide text-cyan-200/70">
        the full film &rarr;
      </div>
    </div>
  );
}

interface DoorProps {
  to: string;
  title: string;
  line: string;
}

function Door({ to, title, line }: DoorProps) {
  const navigate = useNavigate();
  return (
    <button
      onPointerUp={() => navigate(to)}
      className="group flex w-full flex-col items-start rounded-lg border border-white/8 bg-gray-900/30 px-4 py-3.5 text-left transition-colors hover:border-cyan-400/30 hover:bg-gray-900/60"
    >
      <span className="font-display text-base text-gray-100 transition-colors group-hover:text-cyan-200 sm:text-lg">
        {title} <span className="text-cyan-400/70">&rarr;</span>
      </span>
      <span className="mt-1 font-body text-[13px] leading-snug text-gray-400">{line}</span>
    </button>
  );
}

export default function HomeLanding() {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Duck Countdown — the honest memory of American ground";
  }, []);

  return (
    <div className="flex min-h-screen w-full flex-col bg-gray-950 px-5 py-7 text-gray-100 sm:px-8 sm:py-10">
      {/* Brand, quiet */}
      <header className="mx-auto w-full max-w-3xl">
        <div className="font-mono text-[11px] tracking-[0.3em] text-cyan-300/90">
          DUCK COUNTDOWN
        </div>
        <div className="mt-1 font-mono text-[10px] tracking-[0.24em] text-gray-500">
          ENVIRONMENTAL INTELLIGENCE
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center py-8">
        {/* The one true sentence */}
        <h1 className="max-w-2xl font-display text-[1.6rem] font-medium leading-[1.25] text-gray-50 sm:text-4xl">
          The honest memory of American ground — what today is, what it rhymes with,
          and what followed.
        </h1>
        <p className="mt-2.5 font-body text-sm text-gray-400 sm:text-base">
          Every sentence traceable to a row. Never a forecast.
        </p>

        {/* HERO — the live Uri film, tappable into the full player */}
        <div className="mt-7">
          <button
            onPointerUp={() => navigate("/board/uri")}
            aria-label="Watch the full film — THE BOARD, Winter Storm Uri"
            className="block w-full cursor-pointer text-left"
          >
            <BoardEmbed />
          </button>
          <p className="mt-2.5 font-mono text-[11px] leading-relaxed text-gray-500">
            THE BOARD &middot; Winter Storm Uri, as the instruments saw it coming &middot;
            every ember, string, and bloom is a recorded row
          </p>
        </div>

        {/* FOUR quiet doors */}
        <div className="mt-8 grid gap-2.5 sm:grid-cols-2">
          <Door
            to="/atlas"
            title="Fall into your ground"
            line="Drop into any state and read what today is on this ground."
          />
          <Door
            to="/morning"
            title="The Morning Line"
            line="Today, ranked against every day the archive remembers."
          />
          <Door
            to="/born"
            title="The night you were born"
            line="Find your date and see the ground you were born onto."
          />
          <Door
            to="/court"
            title="The Court — every claim graded"
            line="Every call the brain makes, scored against what actually followed."
          />
        </div>
      </main>

      {/* Footer, quiet */}
      <footer className="mx-auto w-full max-w-3xl">
        <p className="font-mono text-[11px] leading-relaxed text-gray-600">
          Duck Countdown &middot; the archive holds millions of recorded rows &middot;
          never a forecast
        </p>
      </footer>
    </div>
  );
}
