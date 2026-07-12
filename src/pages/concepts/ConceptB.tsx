import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  activeBeat,
  compileFilm,
  drawFrame,
  fitCanvas,
  totalDays,
  type BoardFilm,
  type BoardModel,
} from "@/lib/boardPlayer";

/**
 * Concept B — THE FILM IS THE SITE, zero chrome (a reference point for the eye).
 *
 * The Uri film full-bleed, auto-playing, with only the beats overlaid in
 * Playfair at the bottom. No title block, no doors, no explainer. At the end,
 * four words and two quiet links fade in over the held, etched board.
 */

const MS_PER_DAY = 800;

export default function ConceptB() {
  const [model, setModel] = useState<BoardModel | null>(null);
  const [beat, setBeat] = useState<{ line: string; key: number } | null>(null);
  const [ended, setEnded] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tRef = useRef(0);
  const lastRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    document.title = "Winter Storm Uri — Duck Countdown";
    let cancelled = false;
    fetch("/board/uri-2021.json", { cache: "no-cache" })
      .then((r) => r.json())
      .then((j: BoardFilm) => !cancelled && setModel(compileFilm(j)))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!model) return;
    const fit = () => {
      const c = canvasRef.current;
      const s = stageRef.current;
      if (!c || !s) return;
      fitCanvas(c, s.clientWidth, model.film.projection);
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [model]);

  useEffect(() => {
    if (!model) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const last = totalDays(model) - 1;
    lastRef.current = performance.now();
    const tick = (now: number) => {
      const dt = Math.max(0, now - lastRef.current);
      lastRef.current = now;
      if (!ended && !document.hidden) {
        const next = tRef.current + dt / MS_PER_DAY;
        if (next >= last) {
          tRef.current = last;
          setEnded(true);
        } else {
          tRef.current = next;
        }
      }
      drawFrame(ctx, model, tRef.current, now);
      const b = activeBeat(model, tRef.current);
      setBeat((prev) => (b && (!prev || prev.key !== b.key) ? { line: b.line, key: b.key } : prev));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [model, ended]);

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden bg-black">
      <div ref={stageRef} className="w-full max-w-5xl">
        <canvas ref={canvasRef} className="block w-full" />
      </div>

      {/* only the beats — nothing else above the fold */}
      {!ended && beat && (
        <p
          key={beat.key}
          className="pointer-events-none absolute inset-x-0 bottom-16 mx-auto max-w-2xl px-6 text-center font-display text-xl leading-snug text-gray-100 sm:text-2xl"
          style={{ animation: "b-fade 500ms ease-out both" }}
        >
          {beat.line}
        </p>
      )}

      {/* the end card — four words, two links */}
      {ended && (
        <div
          className="absolute inset-x-0 bottom-14 mx-auto max-w-md px-6 text-center"
          style={{ animation: "b-fade 900ms ease-out both" }}
        >
          <p className="font-display text-2xl leading-snug text-gray-50 sm:text-3xl">
            The instruments saw it.
          </p>
          <div className="mt-6 flex items-center justify-center gap-6">
            <Link to="/atlas" className="font-mono text-[12px] tracking-wide text-cyan-300/80 hover:text-cyan-200">
              your ground &rarr;
            </Link>
            <Link to="/concepts/a" className="font-mono text-[12px] tracking-wide text-cyan-300/80 hover:text-cyan-200">
              today &rarr;
            </Link>
          </div>
        </div>
      )}

      <style>{`@keyframes b-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}
