import type { ConvergenceScore } from '@/hooks/useArcDetail';
import { BarChart3 } from 'lucide-react';

interface ArcConvergenceProps {
  scores: ConvergenceScore[];
}

interface ComponentDef {
  key: keyof ConvergenceScore;
  label: string;
  max: number;
}

const COMPONENTS: ComponentDef[] = [
  { key: 'weather_component', label: 'Weather', max: 25 },
  { key: 'migration_component', label: 'Migration', max: 25 },
  { key: 'birdcast_component', label: 'BirdCast', max: 20 },
  { key: 'solunar_component', label: 'Solunar', max: 15 },
  { key: 'water_component', label: 'Water', max: 15 },
  { key: 'pattern_component', label: 'Pattern', max: 15 },
  { key: 'photoperiod_component', label: 'Photoperiod', max: 10 },
  { key: 'tide_component', label: 'Tide', max: 10 },
];

function barColor(pct: number): string {
  if (pct >= 0.75) return 'bg-emerald-400';
  if (pct >= 0.5) return 'bg-cyan-400';
  if (pct >= 0.25) return 'bg-amber-400';
  return 'bg-white/20';
}

export default function ArcConvergence({ scores }: ArcConvergenceProps) {
  if (scores.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 gap-2">
        <BarChart3 size={20} className="text-white/15" />
        <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">
          No convergence data yet
        </span>
      </div>
    );
  }

  const latest = scores[0];
  const prev = scores.length > 1 ? scores[1] : null;

  return (
    <div className="space-y-2">
      {/* Total score */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg font-mono font-bold text-cyan-400">{latest.total_score}</span>
        <span className="text-[10px] font-mono text-white/30">/ 135</span>
        {prev && (
          <span className={`text-[10px] font-mono ${latest.total_score > prev.total_score ? 'text-emerald-400' : latest.total_score < prev.total_score ? 'text-red-400' : 'text-white/30'}`}>
            {latest.total_score > prev.total_score ? '+' : ''}{latest.total_score - prev.total_score} from yesterday
          </span>
        )}
      </div>

      {/* Component bars */}
      {COMPONENTS.map(({ key, label, max }) => {
        const value = (latest[key] as number) || 0;
        const pct = max > 0 ? value / max : 0;
        const prevValue = prev ? ((prev[key] as number) || 0) : null;
        const delta = prevValue !== null ? value - prevValue : null;

        return (
          <div key={key} className="flex items-center gap-2 text-[10px] font-mono">
            <span className="w-20 text-white/50 truncate">{label}</span>
            <div className="flex-1 h-2 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className={`h-full ${barColor(pct)} rounded-full transition-all`}
                style={{ width: `${Math.min(pct * 100, 100)}%` }}
              />
            </div>
            <span className="w-12 text-right text-white/70">{value}/{max}</span>
            {delta !== null && delta !== 0 && (
              <span className={`w-8 text-right ${delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {delta > 0 ? '+' : ''}{delta}
              </span>
            )}
          </div>
        );
      })}

      {/* Date label */}
      <div className="text-[9px] font-mono text-white/20 text-right mt-1">
        {latest.date}
      </div>
    </div>
  );
}
