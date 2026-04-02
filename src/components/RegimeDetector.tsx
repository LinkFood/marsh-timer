import { useMemo } from 'react';
import type { ConvergenceScore } from '@/hooks/useConvergenceScores';
import type { StateArc } from '@/hooks/useStateArcs';

interface Props {
  scores: Map<string, ConvergenceScore>;
  arcs: StateArc[];
}

type Regime = 'QUIET' | 'ACTIVE' | 'SURGE';

const REGIME_COLORS: Record<Regime, string> = {
  QUIET: '#22c55e',
  ACTIVE: '#f59e0b',
  SURGE: '#ef4444',
};

export default function RegimeDetector({ scores, arcs }: Props) {
  const { regime, elevatedCount, recognitions, outcomes, grades } = useMemo(() => {
    let elevatedCount = 0;
    for (const s of scores.values()) {
      if (s.score >= 50) elevatedCount++;
    }

    let recognitions = 0;
    let outcomes = 0;
    let grades = 0;
    for (const a of arcs) {
      if (a.current_act === 'recognition') recognitions++;
      if (a.current_act === 'outcome') outcomes++;
      if (a.current_act === 'grade') grades++;
    }

    let regime: Regime = 'QUIET';
    if (arcs.length >= 20 || recognitions >= 4 || elevatedCount >= 15) regime = 'SURGE';
    else if (arcs.length >= 5 || recognitions >= 1 || elevatedCount >= 5) regime = 'ACTIVE';

    return { regime, elevatedCount, recognitions, outcomes, grades };
  }, [scores, arcs]);

  const sorted = useMemo(() => {
    return Array.from(scores.values()).sort((a, b) => b.score - a.score);
  }, [scores]);

  if (scores.size === 0) return null;

  const color = REGIME_COLORS[regime];

  return (
    <div className="shrink-0 h-6 flex items-center px-3 gap-3 border-b border-white/[0.04] bg-[#0a0f1a]">
      {/* Regime label */}
      <div className="flex items-center gap-1.5">
        <div
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}40` }}
        />
        <span className="text-[9px] font-mono font-bold tracking-widest" style={{ color }}>
          {regime}
        </span>
      </div>

      {/* Counts */}
      <div className="flex items-center gap-3 text-[9px] font-mono text-white/30">
        <span>
          <span className="text-white/50 font-semibold">{elevatedCount}</span> elevated
        </span>
        <span>
          <span className="text-white/50 font-semibold">{recognitions}</span> recognition{recognitions !== 1 ? 's' : ''}
        </span>
        <span>
          <span className="text-white/50 font-semibold">{outcomes}</span> outcome{outcomes !== 1 ? 's' : ''}
        </span>
        {grades > 0 && (
          <span>
            <span className="text-emerald-400/70 font-semibold">{grades}</span> graded
          </span>
        )}
        <span>
          <span className="text-white/50 font-semibold">{arcs.length}</span> arcs
        </span>
      </div>

      {/* 50-state LED strip */}
      <div className="flex-1" />
      <div className="flex items-center gap-px">
        {sorted.map(s => {
          const tier = s.score >= 60 ? '#ef4444' : s.score >= 50 ? '#f59e0b' : s.score >= 40 ? '#22c55e' : '#ffffff08';
          return (
            <div
              key={s.state_abbr}
              className="w-[4px] h-[4px] rounded-[1px]"
              style={{ backgroundColor: tier }}
              title={`${s.state_abbr}: ${Math.round(s.score)}`}
            />
          );
        })}
      </div>
    </div>
  );
}
