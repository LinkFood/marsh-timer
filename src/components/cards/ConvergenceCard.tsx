function scoreColor(score: number): string {
  if (score >= 81) return '#ef4444';
  if (score >= 61) return '#fb923c';
  if (score >= 41) return '#facc15';
  if (score >= 21) return '#3b82f6';
  return 'rgba(100,100,100,0.5)';
}

function scoreTextClass(score: number): string {
  if (score >= 81) return 'text-red-400';
  if (score >= 61) return 'text-orange-400';
  if (score >= 41) return 'text-yellow-400';
  if (score >= 21) return 'text-blue-400';
  return 'text-white/40';
}

interface ConvergenceCardProps {
  score: number;
  weatherComponent: number;
  solunarComponent: number;
  migrationComponent: number;
  patternComponent: number;
  nationalRank: number;
  reasoning: string;
}

const COMPONENTS = [
  { label: 'Weather', max: 30, key: 'weatherComponent' },
  { label: 'Solunar', max: 20, key: 'solunarComponent' },
  { label: 'Migration', max: 30, key: 'migrationComponent' },
  { label: 'Pattern', max: 20, key: 'patternComponent' },
] as const;

export default function ConvergenceCard({
  score,
  weatherComponent,
  solunarComponent,
  migrationComponent,
  patternComponent,
  nationalRank,
  reasoning,
}: ConvergenceCardProps) {
  const values: Record<string, number> = {
    weatherComponent,
    solunarComponent,
    migrationComponent,
    patternComponent,
  };

  const color = scoreColor(score);

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-3 space-y-3">
      <div className="flex items-baseline justify-between">
        <div>
          <span className={`text-3xl font-display font-bold ${scoreTextClass(score)}`}>
            {score}
          </span>
          <span className="text-sm text-white/40">/100</span>
        </div>
        <span className="text-xs text-white/50">#{nationalRank} of 50</span>
      </div>

      <div className="space-y-2">
        {COMPONENTS.map(({ label, max, key }) => {
          const value = values[key];
          const pct = Math.round((value / max) * 100);
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] text-white/50">{label}</span>
                <span className="text-[10px] text-white/50">
                  {value}/{max}
                </span>
              </div>
              <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-white/50 italic line-clamp-2">{reasoning}</p>
    </div>
  );
}
