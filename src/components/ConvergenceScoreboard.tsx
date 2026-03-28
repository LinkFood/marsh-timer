import { useMemo } from 'react';
import type { ConvergenceScore } from '@/hooks/useConvergenceScores';

const DOMAINS = [
  { key: 'weather_component' as const, color: '#ef4444', label: 'Weather' },
  { key: 'migration_component' as const, color: '#3b82f6', label: 'Migration' },
  { key: 'birdcast_component' as const, color: '#22c55e', label: 'BirdCast' },
  { key: 'solunar_component' as const, color: '#f59e0b', label: 'Solunar' },
  { key: 'water_component' as const, color: '#06b6d4', label: 'Water' },
  { key: 'pattern_component' as const, color: '#a855f7', label: 'Pattern' },
  { key: 'photoperiod_component' as const, color: '#6b7280', label: 'Photo' },
  { key: 'tide_component' as const, color: '#9ca3af', label: 'Tide' },
];

const MAX_SCORE = 135;

interface Props {
  scores: Map<string, ConvergenceScore>;
  selectedState: string | null;
  onSelectState: (abbr: string) => void;
}

export default function ConvergenceScoreboard({ scores, selectedState, onSelectState }: Props) {
  const sorted = useMemo(() => {
    return Array.from(scores.values()).sort((a, b) => b.score - a.score);
  }, [scores]);

  if (sorted.length === 0) {
    return (
      <div className="h-full flex flex-col bg-[#0a0f1a] border-r border-white/[0.06]">
        <div className="px-3 py-2 border-b border-white/[0.06]">
          <h2 className="text-[10px] font-mono uppercase tracking-widest text-white/40">Convergence</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-[10px] font-mono text-white/20 animate-pulse">Loading scores...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0a0f1a] border-r border-white/[0.06]">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between">
        <h2 className="text-[10px] font-mono uppercase tracking-widest text-white/40">Convergence</h2>
        <span className="text-[10px] font-mono text-white/20">{sorted.length} states</span>
      </div>

      {/* Domain legend */}
      <div className="px-3 py-1.5 border-b border-white/[0.04] flex flex-wrap gap-x-2 gap-y-0.5">
        {DOMAINS.map(d => (
          <div key={d.key} className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.color, opacity: 0.8 }} />
            <span className="text-[8px] font-mono text-white/25">{d.label}</span>
          </div>
        ))}
      </div>

      {/* State list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.map((s, i) => {
          const isSelected = s.state_abbr === selectedState;
          const tier = s.score >= 80 ? 'critical' : s.score >= 50 ? 'elevated' : 'normal';

          return (
            <button
              key={s.state_abbr}
              onClick={() => onSelectState(s.state_abbr)}
              className={`w-full flex items-center gap-1.5 px-2 py-[5px] text-left transition-colors ${
                isSelected
                  ? 'bg-cyan-400/[0.08] border-l-2 border-l-cyan-400'
                  : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
              }`}
            >
              {/* Rank */}
              <span className="text-[10px] font-mono text-white/25 w-5 text-right shrink-0">
                {i + 1}
              </span>

              {/* State abbreviation */}
              <span className={`text-[11px] font-mono font-semibold w-6 shrink-0 ${
                tier === 'critical' ? 'text-red-400' :
                tier === 'elevated' ? 'text-amber-400' : 'text-white/50'
              }`}>
                {s.state_abbr}
              </span>

              {/* Mini-bars */}
              <div className="flex-1 h-3 flex gap-px rounded-sm overflow-hidden bg-white/[0.03]">
                {DOMAINS.map(d => {
                  const val = s[d.key] || 0;
                  if (val <= 0) return null;
                  return (
                    <div
                      key={d.key}
                      className="h-full"
                      style={{
                        width: `${(val / MAX_SCORE) * 100}%`,
                        backgroundColor: d.color,
                        opacity: isSelected ? 0.9 : 0.7,
                      }}
                      title={`${d.label}: ${val.toFixed(1)}`}
                    />
                  );
                })}
              </div>

              {/* Score */}
              <span className={`text-[11px] font-mono font-bold w-7 text-right shrink-0 ${
                tier === 'critical' ? 'text-red-400' :
                tier === 'elevated' ? 'text-amber-400' : 'text-white/40'
              }`}>
                {Math.round(s.score)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
