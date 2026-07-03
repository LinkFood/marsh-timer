import { useLayoutEffect, useRef, useState } from 'react';
import { HEATWAVE_DATASET, type RibbonDataset, type RibbonRow } from '@/data/cascade';
import Denominator from '@/components/Denominator';

/**
 * CascadeRibbon — the lead-lag ribbon. Pure inline SVG, no chart lib.
 *
 * Horizontal bands stacked top → bottom share one time axis. A bold vertical
 * 0-line marks the day the event arrived. Each band gets its lead-day
 * annotation at the point it first broke normal. The drama is the ORDER and
 * the SHAPE — which layers moved first, and how hard.
 *
 * Renders any `RibbonDataset` (defaults to the July 2026 heat wave). Renders
 * at exact container-pixel width (measured) so mono labels stay crisp and
 * correctly sized down to 375px. `mini` renders the lines only — ~64px tall,
 * no labels — for the landing teaser.
 */

/** value → normalized 0..1 within a [min,max] domain, clamped. */
function norm(v: number, min: number, max: number): number {
  return Math.max(0, Math.min(1, (v - min) / (max - min)));
}

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
/* Mini variant — stacked lanes, lines only, for the teaser strip      */
/* ------------------------------------------------------------------ */

function MiniRibbon({ dataset, height = 64 }: { dataset: RibbonDataset; height?: number }) {
  const { ref, w } = useMeasuredWidth();
  const rows = dataset.rows;
  const n = rows.length;
  const padX = 4;
  const plotW = w - padX * 2;
  const laneH = height / dataset.bands.length;
  const xFor = (i: number) => padX + (i / (n - 1)) * plotW;

  return (
    <div ref={ref} className="w-full">
      <svg width={w} height={height} className="block" aria-hidden>
        {dataset.bands.map((band, li) => {
          const top = li * laneH;
          const pad = 3;
          const h = laneH - pad * 2;
          const acc = (r: RibbonRow) => norm(r.values[band.key], band.domain[0], band.domain[1]);
          const pts = rows.map((r, i) => `${xFor(i).toFixed(1)},${(top + pad + (1 - acc(r)) * h).toFixed(1)}`).join(' ');
          return (
            <polyline
              key={band.key}
              points={pts}
              fill="none"
              stroke={band.color}
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

export default function CascadeRibbon({ mini = false, dataset = HEATWAVE_DATASET }: { mini?: boolean; dataset?: RibbonDataset }) {
  const { ref, w } = useMeasuredWidth();

  if (mini) return <MiniRibbon dataset={dataset} />;

  const rows = dataset.rows;
  const n = rows.length;
  const receipts = dataset.receipts;

  // Layout (px, 1 unit = 1 device-independent px at container width).
  const marginL = 6;
  const marginR = 10;
  const plotW = w - marginL - marginR;
  const axisTop = 20;      // month/date tick + peak label headroom
  const bandH = 78;
  const bandGap = 8;
  const bands = dataset.bands;
  const plotTop = axisTop;
  const plotH = bands.length * bandH + (bands.length - 1) * bandGap;
  const axisBottom = 16;   // date tick labels
  const totalH = plotTop + plotH + axisBottom;

  const xFor = (i: number) => marginL + (i / (n - 1)) * plotW;
  const indexOfDate = (d: string) => rows.findIndex(r => r.date === d);
  const peakX = xFor(indexOfDate(dataset.peakDate));

  const bandTop = (bi: number) => plotTop + bi * (bandH + bandGap);

  // Small helper: point y within a band for a normalized value (0 bottom → 1 top).
  const yIn = (bi: number, nv: number, inset = 16) => bandTop(bi) + inset + (1 - nv) * (bandH - inset - 8);

  return (
    <div ref={ref} className="w-full">
      <svg width={w} height={totalH} className="block" role="img" aria-label={dataset.ariaLabel}>
        {/* ---- 0-LINE: the event arrives ---- */}
        <line x1={peakX} y1={plotTop - 4} x2={peakX} y2={plotTop + plotH} stroke="rgb(248 113 113)" strokeWidth={1.6} opacity={0.9} />
        <text
          x={peakX - 6}
          y={12}
          textAnchor="end"
          className="font-mono"
          fontSize={10}
          fill="rgb(248 113 113)"
        >
          {dataset.peakLabel}
        </text>

        {/* ---- Bands ---- */}
        {bands.map((band, bi) => {
          const color = band.color;
          const top = bandTop(bi);
          const acc = (r: RibbonRow) => norm(r.values[band.key], band.domain[0], band.domain[1]);
          const pointY = (r: RibbonRow) => yIn(bi, acc(r));

          // Data geometry
          const linePts = rows.map((r, i) => `${xFor(i).toFixed(1)},${pointY(r).toFixed(1)}`).join(' ');

          // 'step-area' = step-fill to band floor (drought); 'area' = polygon under the line (snow).
          const floorY = bandTop(bi) + bandH - 8;
          const areaPath =
            band.fill === 'step-area'
              ? `M ${xFor(0).toFixed(1)} ${pointY(rows[0]).toFixed(1)} ` +
                rows.slice(1).map((r, i) => `H ${xFor(i + 1).toFixed(1)} V ${pointY(r).toFixed(1)}`).join(' ') +
                ` L ${xFor(n - 1).toFixed(1)} ${floorY} L ${xFor(0).toFixed(1)} ${floorY} Z`
              : band.fill === 'area'
                ? `M ${xFor(0).toFixed(1)} ${pointY(rows[0]).toFixed(1)} ` +
                  rows.slice(1).map((r, i) => `L ${xFor(i + 1).toFixed(1)} ${pointY(r).toFixed(1)}`).join(' ') +
                  ` L ${xFor(n - 1).toFixed(1)} ${floorY} L ${xFor(0).toFixed(1)} ${floorY} Z`
                : null;

          // 'gap' = shade the absence between the expected top baseline and the fallen line.
          const baselineY = yIn(bi, 1);
          const gapPath =
            band.fill === 'gap'
              ? `M ${xFor(0).toFixed(1)} ${baselineY.toFixed(1)} ` +
                rows.map((r, i) => `L ${xFor(i).toFixed(1)} ${pointY(r).toFixed(1)}`).join(' ') +
                ` L ${xFor(n - 1).toFixed(1)} ${baselineY.toFixed(1)} Z`
              : null;

          const anomIdx = indexOfDate(band.anomalyDate);
          const anomX = xFor(anomIdx);
          const anomR = rows[anomIdx];
          // Keep the note inside the plot: pick a side, then clamp the anchor edge.
          const noteAnchor: 'start' | 'end' = anomX > w * 0.5 ? 'end' : 'start';
          const noteW = band.note.length * 4.7; // ~8.5px mono char advance
          const loBound = marginL + 6;
          const hiBound = w - marginR - 6;
          let noteX = noteAnchor === 'end' ? anomX - 5 : anomX + 5;
          if (noteAnchor === 'end') noteX = Math.max(noteX, loBound + noteW);
          else noteX = Math.min(noteX, hiBound - noteW);

          return (
            <g key={band.key}>
              {/* band frame */}
              <rect x={marginL} y={top} width={plotW} height={bandH} rx={4} fill="rgb(255 255 255 / 0.015)" stroke="rgb(255 255 255 / 0.05)" />

              {/* band title */}
              <text x={marginL + 8} y={top + 13} className="font-mono" fontSize={9} letterSpacing="0.12em" fill={color} opacity={0.9}>
                {band.title}
              </text>
              <text x={marginL + 8} y={top + bandH - 6} className="font-mono" fontSize={7.5} fill="rgb(255 255 255 / 0.28)">
                {band.leadWord}
              </text>

              {/* absence gap */}
              {gapPath && <path d={gapPath} fill={color} opacity={0.12} />}

              {/* filled area */}
              {areaPath && <path d={areaPath} fill={color} opacity={0.16} />}

              {/* the line */}
              <polyline points={linePts} fill="none" stroke={color} strokeWidth={band.bold ? 2 : 1.6} strokeLinejoin="round" strokeLinecap="round" opacity={0.95} />

              {/* per-point dots — interpolated dimmer */}
              {rows.map((r, i) => (
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
                {band.note}
              </text>
            </g>
          );
        })}

        {/* ---- Date ticks ---- */}
        {dataset.tickDates.map(d => {
          const i = indexOfDate(d);
          if (i < 0) return null;
          const x = xFor(i);
          const isPeak = d === dataset.peakDate;
          return (
            <text
              key={d}
              x={x}
              y={totalH - 4}
              textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
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
        {receipts.denominator && (
          <p className="text-[10px] font-mono text-white/45 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-white/30">{receipts.denominator.lead}</span>
            <Denominator n={receipts.denominator.n} k={receipts.denominator.k} base={receipts.denominator.base} label={receipts.denominator.label} />
          </p>
        )}
        {receipts.bodyLines.map(line => (
          <p key={line} className="text-[10px] font-body text-white/40 leading-relaxed">{line}</p>
        ))}
        <p className="text-[10px] font-mono text-white/30">{receipts.monoLine}</p>
      </div>
    </div>
  );
}
