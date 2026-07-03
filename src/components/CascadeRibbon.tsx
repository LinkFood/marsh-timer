import { useLayoutEffect, useRef, useState, useMemo } from 'react';
import {
  CASCADE_ROWS,
  LAYER_LEADS,
  CASCADE_RECEIPTS,
  PEAK_DATE,
  PEAK_LABEL,
  type CascadeRow,
  type LayerKey,
} from '@/data/cascade';
import Denominator from '@/components/Denominator';

/**
 * CascadeRibbon — the lead-lag ribbon. Pure inline SVG, no chart lib.
 *
 * Four horizontal bands stacked top → bottom (DROUGHT · OCEAN · BIRDS ·
 * THERMOMETER) share one time axis (06-08 → 07-03). A bold vertical 0-line
 * sits at 07-02 — "103°F, the heat arrives". Each band gets its lead-day
 * annotation at the point it first broke normal. The drama is the ORDER: the
 * ground, the ocean, and the birds all move first; the thermometer is flat and
 * boring until the very end, then goes vertical.
 *
 * Renders at exact container-pixel width (measured) so mono labels stay crisp
 * and correctly sized down to 375px. `mini` renders the four lines only —
 * ~64px tall, no labels — for the landing teaser.
 */

const COLORS: Record<LayerKey, string> = {
  drought: 'rgb(245 158 11)',      // amber-500
  ocean: 'rgb(45 212 191)',        // teal-400
  birds: 'rgb(167 139 250)',       // violet-400
  thermometer: 'rgb(248 113 113)', // red-400
};

const ROWS = CASCADE_ROWS;
const N = ROWS.length;

/** value → normalized 0..1 within a [min,max] domain, clamped. */
function norm(v: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

/** Per-layer domain + accessor. Higher normalized = higher on the band. */
const LAYER_VALUE: Record<LayerKey, { get: (r: CascadeRow) => number; n: (r: CascadeRow) => number }> = {
  drought: { get: r => r.droughtDe2Pct, n: r => norm(r.droughtDe2Pct, 0, 100) },
  ocean: { get: r => r.sstAnomalySigma, n: r => norm(r.sstAnomalySigma, 0, 4.5) },
  birds: { get: r => r.birdActivityPct, n: r => norm(r.birdActivityPct, 0, 100) },
  thermometer: { get: r => r.tempHighF, n: r => norm(r.tempHighF, 80, 108) },
};

function useMeasuredWidth(fallback = 375) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(Math.max(280, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

/* ------------------------------------------------------------------ */
/* Mini variant — four stacked lanes, lines only, for the teaser strip */
/* ------------------------------------------------------------------ */

function MiniRibbon({ height = 64 }: { height?: number }) {
  const { ref, w } = useMeasuredWidth();
  const padX = 4;
  const plotW = w - padX * 2;
  const laneH = height / 4;
  const xFor = (i: number) => padX + (i / (N - 1)) * plotW;

  const lanes: LayerKey[] = ['drought', 'ocean', 'birds', 'thermometer'];

  return (
    <div ref={ref} className="w-full">
      <svg width={w} height={height} className="block" aria-hidden>
        {lanes.map((key, li) => {
          const top = li * laneH;
          const pad = 3;
          const h = laneH - pad * 2;
          const acc = LAYER_VALUE[key].n;
          const pts = ROWS.map((r, i) => `${xFor(i).toFixed(1)},${(top + pad + (1 - acc(r)) * h).toFixed(1)}`).join(' ');
          return (
            <polyline
              key={key}
              points={pts}
              fill="none"
              stroke={COLORS[key]}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.85}
            />
          );
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Full ribbon                                                         */
/* ------------------------------------------------------------------ */

export default function CascadeRibbon({ mini = false }: { mini?: boolean }) {
  const { ref, w } = useMeasuredWidth();

  if (mini) return <MiniRibbon />;

  // Layout (px, 1 unit = 1 device-independent px at container width).
  const marginL = 6;
  const marginR = 10;
  const plotW = w - marginL - marginR;
  const axisTop = 20;      // month/date tick + peak label headroom
  const bandH = 78;
  const bandGap = 8;
  const bands = LAYER_LEADS;
  const plotTop = axisTop;
  const plotH = bands.length * bandH + (bands.length - 1) * bandGap;
  const axisBottom = 16;   // date tick labels
  const totalH = plotTop + plotH + axisBottom;

  const xFor = (i: number) => marginL + (i / (N - 1)) * plotW;
  const indexOfDate = (d: string) => ROWS.findIndex(r => r.date === d);
  const peakX = xFor(indexOfDate(PEAK_DATE));

  const bandTop = (bi: number) => plotTop + bi * (bandH + bandGap);

  // Small helper: point y within a band for a normalized value (0 bottom → 1 top).
  const yIn = (bi: number, n: number, inset = 16) => bandTop(bi) + inset + (1 - n) * (bandH - inset - 8);

  // Date ticks along the bottom.
  const tickDates = useMemo(() => ['2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29', PEAK_DATE], []);

  return (
    <div ref={ref} className="w-full">
      <svg width={w} height={totalH} className="block" role="img" aria-label="The cascade: four environmental layers led the July 2026 heat wave by 3 weeks to 4 days.">
        {/* ---- 0-LINE: the heat arrives ---- */}
        <line x1={peakX} y1={plotTop - 4} x2={peakX} y2={plotTop + plotH} stroke="rgb(248 113 113)" strokeWidth={1.6} opacity={0.9} />
        <text
          x={peakX - 6}
          y={12}
          textAnchor="end"
          className="font-mono"
          fontSize={10}
          fill="rgb(248 113 113)"
        >
          {PEAK_LABEL}
        </text>

        {/* ---- Bands ---- */}
        {bands.map((layer, bi) => {
          const key = layer.key;
          const color = COLORS[key];
          const top = bandTop(bi);
          const acc = LAYER_VALUE[key].n;
          const pointY = (r: CascadeRow) => yIn(bi, acc(r));

          // Data geometry
          const linePts = ROWS.map((r, i) => `${xFor(i).toFixed(1)},${pointY(r).toFixed(1)}`).join(' ');

          // Amber drought = filled area to band floor.
          const floorY = bandTop(bi) + bandH - 8;
          const areaPath =
            key === 'drought'
              ? `M ${xFor(0).toFixed(1)} ${pointY(ROWS[0]).toFixed(1)} ` +
                ROWS.slice(1).map((r, i) => `H ${xFor(i + 1).toFixed(1)} V ${pointY(r).toFixed(1)}`).join(' ') +
                ` L ${xFor(N - 1).toFixed(1)} ${floorY} L ${xFor(0).toFixed(1)} ${floorY} Z`
              : null;

          // Birds = shade the absence gap between the expected baseline and the fallen line.
          const baselineY = yIn(bi, 1); // birdActivity = 100 baseline
          const gapPath =
            key === 'birds'
              ? `M ${xFor(0).toFixed(1)} ${baselineY.toFixed(1)} ` +
                ROWS.map((r, i) => `L ${xFor(i).toFixed(1)} ${pointY(r).toFixed(1)}`).join(' ') +
                ` L ${xFor(N - 1).toFixed(1)} ${baselineY.toFixed(1)} Z`
              : null;

          const anomIdx = indexOfDate(layer.anomalyDate);
          const anomX = xFor(anomIdx);
          const anomR = ROWS[anomIdx];
          // Keep the note inside the plot: pick a side, then clamp the anchor edge.
          const noteAnchor: 'start' | 'end' = anomX > w * 0.5 ? 'end' : 'start';
          const noteW = layer.note.length * 4.7; // ~8.5px mono char advance
          const loBound = marginL + 6;
          const hiBound = w - marginR - 6;
          let noteX = noteAnchor === 'end' ? anomX - 5 : anomX + 5;
          if (noteAnchor === 'end') noteX = Math.max(noteX, loBound + noteW);
          else noteX = Math.min(noteX, hiBound - noteW);

          return (
            <g key={key}>
              {/* band frame */}
              <rect x={marginL} y={top} width={plotW} height={bandH} rx={4} fill="rgb(255 255 255 / 0.015)" stroke="rgb(255 255 255 / 0.05)" />

              {/* band title */}
              <text x={marginL + 8} y={top + 13} className="font-mono" fontSize={9} letterSpacing="0.12em" fill={color} opacity={0.9}>
                {layer.title}
              </text>
              <text x={marginL + 8} y={top + bandH - 6} className="font-mono" fontSize={7.5} fill="rgb(255 255 255 / 0.28)">
                {layer.leadWord}
              </text>

              {/* absence gap (birds) */}
              {gapPath && <path d={gapPath} fill={color} opacity={0.12} />}

              {/* drought area */}
              {areaPath && <path d={areaPath} fill={color} opacity={0.16} />}

              {/* the line */}
              <polyline points={linePts} fill="none" stroke={color} strokeWidth={key === 'thermometer' ? 2 : 1.6} strokeLinejoin="round" strokeLinecap="round" opacity={0.95} />

              {/* per-point dots — interpolated dimmer */}
              {ROWS.map((r, i) => (
                <circle
                  key={r.date}
                  cx={xFor(i)}
                  cy={pointY(r)}
                  r={r.interpolated ? 1.1 : 1.9}
                  fill={color}
                  opacity={r.interpolated ? 0.3 : 0.95}
                />
              ))}

              {/* anomaly marker + lead annotation */}
              <line x1={anomX} y1={top + 4} x2={anomX} y2={top + bandH - 4} stroke={color} strokeWidth={0.8} strokeDasharray="2 2" opacity={0.5} />
              <circle cx={anomX} cy={pointY(anomR)} r={3} fill="none" stroke={color} strokeWidth={1.2} />
              <text x={noteX} y={top + 26} textAnchor={noteAnchor} className="font-mono" fontSize={8.5} fill="rgb(255 255 255 / 0.72)">
                {layer.note}
              </text>
            </g>
          );
        })}

        {/* ---- Date ticks ---- */}
        {tickDates.map(d => {
          const i = indexOfDate(d);
          if (i < 0) return null;
          const x = xFor(i);
          const isPeak = d === PEAK_DATE;
          return (
            <text
              key={d}
              x={x}
              y={totalH - 4}
              textAnchor={i === 0 ? 'start' : i === N - 1 ? 'end' : 'middle'}
              className="font-mono tabular-nums"
              fontSize={8}
              fill={isPeak ? 'rgb(248 113 113 / 0.8)' : 'rgb(255 255 255 / 0.35)'}
            >
              {d.slice(5)}
            </text>
          );
        })}
      </svg>

      {/* ---- Receipts ---- */}
      <div className="mt-4 border-t border-white/[0.06] pt-3 space-y-1.5">
        <p className="text-[10px] font-mono text-white/45 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-white/30">This event class appeared</span>
          <Denominator n={CASCADE_RECEIPTS.denominator.n} k={CASCADE_RECEIPTS.denominator.k} base={CASCADE_RECEIPTS.denominator.base} label="in state-years" />
        </p>
        <p className="text-[10px] font-body text-white/40 leading-relaxed">{CASCADE_RECEIPTS.fingerprintLine}</p>
        <p className="text-[10px] font-body text-white/40 leading-relaxed">{CASCADE_RECEIPTS.windowLine}</p>
        <p className="text-[10px] font-mono text-white/30">{CASCADE_RECEIPTS.sourceLine}</p>
      </div>
    </div>
  );
}
