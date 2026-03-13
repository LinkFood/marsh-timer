import { useState } from 'react';
import { ThumbsUp, ThumbsDown } from 'lucide-react';
import { useFeedback } from '../../hooks/useFeedback';

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
  birdcastComponent: number;
  patternComponent: number;
  nationalRank: number;
  reasoning: string;
  stateAbbr?: string;
}

const COMPONENTS = [
  { label: 'Weather', max: 25, key: 'weatherComponent', color: '#60a5fa' },
  { label: 'Solunar', max: 15, key: 'solunarComponent', color: '#a78bfa' },
  { label: 'Migration', max: 25, key: 'migrationComponent', color: '#34d399' },
  { label: 'BirdCast', max: 20, key: 'birdcastComponent', color: '#06b6d4' },
  { label: 'Pattern', max: 15, key: 'patternComponent', color: '#f59e0b' },
] as const;

export default function ConvergenceCard({
  score,
  weatherComponent,
  solunarComponent,
  migrationComponent,
  birdcastComponent,
  patternComponent,
  nationalRank,
  reasoning,
  stateAbbr,
}: ConvergenceCardProps) {
  const values: Record<string, number> = {
    weatherComponent,
    solunarComponent,
    migrationComponent,
    birdcastComponent,
    patternComponent,
  };

  const [showGuide, setShowGuide] = useState(false);
  const color = scoreColor(score);

  const allZero = score === 0 && weatherComponent === 0 && solunarComponent === 0 && migrationComponent === 0 && birdcastComponent === 0 && patternComponent === 0;

  if (allZero) {
    return (
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-4 text-center space-y-1.5">
        <span className="text-2xl font-display font-bold text-white/20">--</span>
        <p className="text-xs text-white/40 font-body">No score data yet</p>
        <p className="text-[10px] text-white/30 font-body leading-snug">
          Convergence scores update daily at 8AM UTC using weather, solunar, migration, and pattern data.
        </p>
      </div>
    );
  }

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
        {COMPONENTS.map(({ label, max, key, color: barColor }) => {
          const value = values[key];
          const pct = Math.min(100, Math.round((value / max) * 100));
          return (
            <div key={key}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] text-white/50">{label}</span>
                <span className="text-[10px] text-white/50">
                  {Math.min(value, max)}/{max}
                </span>
              </div>
              <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden relative">
                {value === 0 ? (
                  <span className="absolute inset-0 flex items-center justify-center text-[7px] text-white/30">No data</span>
                ) : (
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: barColor }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-white/50 italic line-clamp-2">{reasoning}</p>

      <div>
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="text-[10px] text-white/40 hover:text-white/60 transition-colors"
        >
          Score Guide {showGuide ? '\u25B2' : '\u25BC'}
        </button>
        {showGuide && (
          <div className="mt-1.5 space-y-1">
            {[
              { color: '#ef4444', label: '80-100 \u2014 Outstanding. Drop everything and go.' },
              { color: '#fb923c', label: '60-79 \u2014 Strong. Solid day, worth the trip.' },
              { color: '#facc15', label: '40-59 \u2014 Fair. Average conditions.' },
              { color: '#3b82f6', label: '20-39 \u2014 Poor. Tough hunting.' },
              { color: 'rgba(100,100,100,0.5)', label: '0-19 \u2014 Skip it. Stay home.' },
            ].map(({ color: dotColor, label }) => (
              <div key={dotColor} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: dotColor }} />
                <span className="text-xs text-white/50">{label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {stateAbbr && <ConvergenceFeedbackRow stateAbbr={stateAbbr} />}
    </div>
  );
}

function ConvergenceFeedbackRow({ stateAbbr }: { stateAbbr: string }) {
  const { submitFeedback, getFeedback, isLoading, isAuthenticated } = useFeedback();
  const today = new Date().toISOString().split('T')[0];
  const current = getFeedback('convergence_score', today, stateAbbr);
  const loading = isLoading('convergence_score', today, stateAbbr);

  if (!isAuthenticated) return null;

  return (
    <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
      <span className="text-[10px] text-white/30 font-body">Accurate?</span>
      <button
        onClick={() => submitFeedback('convergence_score', today, true, stateAbbr)}
        disabled={loading}
        className="p-0.5 transition-colors"
      >
        <ThumbsUp
          className={`w-3.5 h-3.5 ${current === true ? 'text-green-400' : 'text-white/40 hover:text-white/60'}`}
        />
      </button>
      <button
        onClick={() => submitFeedback('convergence_score', today, false, stateAbbr)}
        disabled={loading}
        className="p-0.5 transition-colors"
      >
        <ThumbsDown
          className={`w-3.5 h-3.5 ${current === false ? 'text-red-400' : 'text-white/40 hover:text-white/60'}`}
        />
      </button>
    </div>
  );
}
