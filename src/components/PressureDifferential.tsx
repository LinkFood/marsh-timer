import { useMemo } from 'react';
import type { ConvergenceScore } from '@/hooks/useConvergenceScores';
import type { StateArc } from '@/hooks/useStateArcs';

const ARC_COLORS: Record<string, string> = {
  buildup: '#f59e0b',
  recognition: '#f97316',
  outcome: '#ef4444',
  grade: '#22c55e',
};

interface Props {
  scores: Map<string, ConvergenceScore>;
  historyMap: Map<string, number[]>;
  arcMap: Map<string, StateArc>;
  selectedState: string | null;
  onSelectState: (abbr: string) => void;
}

export default function PressureDifferential({ scores, historyMap, arcMap, selectedState, onSelectState }: Props) {
  const points = useMemo(() => {
    const pts: Array<{ abbr: string; score: number; delta: number; arc?: StateArc }> = [];
    for (const s of scores.values()) {
      const hist = historyMap.get(s.state_abbr);
      let delta = 0;
      if (hist && hist.length >= 4) {
        delta = hist[hist.length - 1] - hist[hist.length - 4];
      } else if (hist && hist.length >= 2) {
        delta = hist[hist.length - 1] - hist[0];
      }
      pts.push({ abbr: s.state_abbr, score: s.score, delta, arc: arcMap.get(s.state_abbr) });
    }
    return pts;
  }, [scores, historyMap, arcMap]);

  if (points.length === 0) return null;

  const W = 248, H = 200;
  const PAD = { top: 12, right: 8, bottom: 16, left: 24 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const maxScore = 135;
  const maxDelta = Math.max(20, ...points.map(p => Math.abs(p.delta)));

  const scaleX = (score: number) => PAD.left + (score / maxScore) * plotW;
  const scaleY = (delta: number) => PAD.top + plotH / 2 - (delta / maxDelta) * (plotH / 2);

  const midX = scaleX(50);
  const midY = scaleY(0);

  return (
    <div className="h-full flex flex-col">
      <svg width={W} height={H} className="font-mono">
        {/* Background quadrants */}
        <rect x={PAD.left} y={PAD.top} width={midX - PAD.left} height={midY - PAD.top} fill="#22c55e" opacity={0.02} />
        <rect x={midX} y={PAD.top} width={PAD.left + plotW - midX} height={midY - PAD.top} fill="#ef4444" opacity={0.04} />
        <rect x={PAD.left} y={midY} width={midX - PAD.left} height={PAD.top + plotH - midY} fill="#ffffff" opacity={0.01} />
        <rect x={midX} y={midY} width={PAD.left + plotW - midX} height={PAD.top + plotH - midY} fill="#f59e0b" opacity={0.02} />

        {/* Axes */}
        <line x1={PAD.left} y1={midY} x2={PAD.left + plotW} y2={midY} stroke="#ffffff10" strokeDasharray="2,2" />
        <line x1={midX} y1={PAD.top} x2={midX} y2={PAD.top + plotH} stroke="#ffffff10" strokeDasharray="2,2" />

        {/* Quadrant labels */}
        <text x={PAD.left + 2} y={PAD.top + 8} fill="#22c55e" opacity={0.2} fontSize={7}>RAMPING</text>
        <text x={PAD.left + plotW - 2} y={PAD.top + 8} fill="#ef4444" opacity={0.25} fontSize={7} textAnchor="end">ACTIVE</text>
        <text x={PAD.left + 2} y={PAD.top + plotH - 2} fill="#ffffff" opacity={0.1} fontSize={7}>QUIET</text>
        <text x={PAD.left + plotW - 2} y={PAD.top + plotH - 2} fill="#f59e0b" opacity={0.15} fontSize={7} textAnchor="end">PASSING</text>

        {/* Axis labels */}
        <text x={PAD.left + plotW / 2} y={H - 2} fill="#ffffff30" fontSize={7} textAnchor="middle">Score</text>
        <text x={4} y={PAD.top + plotH / 2} fill="#ffffff30" fontSize={7} textAnchor="middle" transform={`rotate(-90, 4, ${PAD.top + plotH / 2})`}>Δ3d</text>

        {/* State dots */}
        {points.map(p => {
          const cx = scaleX(p.score);
          const cy = scaleY(p.delta);
          const isSelected = p.abbr === selectedState;
          const arcColor = p.arc ? ARC_COLORS[p.arc.current_act] || '#ffffff30' : '#ffffff15';
          const r = isSelected ? 5 : p.arc ? 3.5 : 2.5;

          return (
            <g key={p.abbr} onClick={() => onSelectState(p.abbr)} className="cursor-pointer">
              <circle cx={cx} cy={cy} r={r} fill={arcColor} opacity={isSelected ? 0.9 : 0.6} stroke={isSelected ? '#5eead4' : 'none'} strokeWidth={isSelected ? 1.5 : 0} />
              {(isSelected || p.score >= 70 || Math.abs(p.delta) >= 10) && (
                <text x={cx} y={cy - r - 2} fill={isSelected ? '#5eead4' : '#ffffff40'} fontSize={7} textAnchor="middle" fontWeight={isSelected ? 'bold' : 'normal'}>
                  {p.abbr}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
