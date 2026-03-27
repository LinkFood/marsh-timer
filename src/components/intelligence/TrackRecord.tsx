import { Minus, TrendingUp } from 'lucide-react';
import type { AggregatedSource, AggregatedState, AlertCalibration } from '@/hooks/useAlertCalibration';

interface TrackRecordProps {
  calibrations: AlertCalibration[];
  bySource: AggregatedSource[];
  byState: AggregatedState[];
  overallAccuracy: number;
  loading: boolean;
}

function AccuracyBar({ label, accuracy, total }: { label: string; accuracy: number; total: number }) {
  const barColor = accuracy >= 70 ? 'bg-emerald-400' : accuracy >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      <span className="w-28 text-white/50 truncate">{label}</span>
      <div className="flex-1 h-2 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${accuracy}%` }} />
      </div>
      <span className="w-10 text-right text-white/70">{accuracy}%</span>
      <span className="w-10 text-right text-white/30">n={total}</span>
    </div>
  );
}

export default function TrackRecord({ calibrations, bySource, byState, overallAccuracy, loading }: TrackRecordProps) {
  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={14} className="text-emerald-400" />
        <h3 className="text-xs font-mono uppercase tracking-widest text-white/50">Prediction Track Record</h3>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-4 bg-white/[0.04] rounded animate-pulse" />
          ))}
        </div>
      ) : calibrations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center">
            <Minus size={20} className="text-white/20" />
          </div>
          <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">Learning...</span>
          <p className="text-[10px] font-mono text-white/20 text-center max-w-xs leading-relaxed">
            The grading system is building its track record. Results will appear as alerts cross their outcome deadlines.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Overall accuracy */}
          <div className="flex items-center gap-4">
            <div className="text-center">
              <div className={`text-4xl font-mono font-bold ${overallAccuracy >= 60 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {overallAccuracy}%
              </div>
              <div className="text-[9px] font-mono text-white/40 uppercase">Overall Accuracy</div>
            </div>
            <div className="flex-1 text-[10px] font-mono text-white/30 leading-relaxed">
              Weighted average across {bySource.reduce((s, r) => s + r.total_alerts, 0).toLocaleString()} graded alerts
              from {bySource.length} source{bySource.length !== 1 ? 's' : ''} and {byState.length} state{byState.length !== 1 ? 's' : ''}.
            </div>
          </div>

          {/* Per-source accuracy */}
          <div>
            <h4 className="text-[10px] font-mono text-white/40 uppercase tracking-wider mb-2">By Source</h4>
            <div className="space-y-1.5">
              {bySource.map(s => (
                <AccuracyBar key={s.source} label={s.source} accuracy={s.accuracy} total={s.total_alerts} />
              ))}
            </div>
          </div>

          {/* Per-state accuracy (top 10) */}
          {byState.length > 0 && (
            <div>
              <h4 className="text-[10px] font-mono text-white/40 uppercase tracking-wider mb-2">Top States (by volume)</h4>
              <div className="space-y-1.5">
                {byState.map(s => (
                  <AccuracyBar key={s.state_abbr} label={s.state_abbr} accuracy={s.accuracy} total={s.total_alerts} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
