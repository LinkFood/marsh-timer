import { useEffect, useRef, useState } from "react";
import {
  albersXRange,
  drawRibbon,
  fetchFrames,
  fetchInstruments,
  isoDaysBefore,
  longDate,
  porchLine,
  resolveDay,
  shortDate,
  todayIso,
  type Instrument,
  type ResolvedInstrument,
} from "@/lib/board/frameStore";

/**
 * Concept C — THE BRAID (a reference point for the eye). The scroll-of-days
 * gesture, in its pure form: an honest ledger you fall down through, today at
 * top, each row a day's heat-ribbon and its one line. In the shipped design this
 * gesture lives inside the room (concept A); C keeps it standalone for contrast.
 */

const DAYS = 45;

function Ribbon({ resolved, xMin, xMax }: { resolved: ResolvedInstrument[]; xMin: number; xMax: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const draw = () => drawRibbon(c, resolved, xMin, xMax);
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [resolved, xMin, xMax]);
  return <canvas ref={ref} className="block h-8 w-full" />;
}

export default function ConceptC() {
  const [rows, setRows] = useState<
    { day: string; resolved: ResolvedInstrument[]; lead: string; swelled: boolean }[] | null
  >(null);
  const [range, setRange] = useState<[number, number]>([0, 975]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = "The Braid — Duck Countdown";
    let cancelled = false;
    (async () => {
      try {
        const today = todayIso();
        const [instruments, frames] = await Promise.all([
          fetchInstruments(),
          fetchFrames(isoDaysBefore(today, DAYS - 1), today),
        ]);
        if (cancelled) return;
        setRange(albersXRange(instruments as Instrument[]));
        setRows(
          frames.map((f) => {
            const resolved = resolveDay(f, instruments);
            const p = porchLine(f.day, resolved, f);
            return { day: f.day, resolved, lead: p.lead, swelled: p.swollen.length > 0 };
          }),
        );
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 px-5 py-16 text-gray-100 sm:px-8">
      <div className="mx-auto max-w-2xl">
        {failed && <p className="font-display text-xl text-gray-400">The ledger can&rsquo;t be reached.</p>}
        {!rows && !failed && <p className="font-mono text-xs text-gray-600">unrolling the ledger&hellip;</p>}
        {rows?.map((r, i) => (
          <div key={r.day} className="border-b border-white/5 py-4">
            <div className="flex items-baseline justify-between">
              <span className={`font-mono text-[11px] tabular-nums ${r.swelled ? "text-gray-400" : "text-gray-600"}`}>
                {i === 0 ? longDate(r.day) : shortDate(r.day)}
              </span>
              {i === 0 && <span className="font-mono text-[10px] tracking-[0.28em] text-gray-600">TODAY</span>}
            </div>
            <div className="mt-2">
              <Ribbon resolved={r.resolved} xMin={range[0]} xMax={range[1]} />
            </div>
            {r.swelled && <p className="mt-2 font-body text-[13px] leading-snug text-gray-400">{r.lead}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
