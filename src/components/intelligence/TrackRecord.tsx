import { TrendingUp } from 'lucide-react';
import { useTrackRecord } from '@/hooks/useTrackRecord';

const GRADE_ICON: Record<string, { symbol: string; color: string; label: string }> = {
  confirmed: { symbol: '\u2713', color: 'text-emerald-400', label: 'CONFIRMED' },
  partially_confirmed: { symbol: '\u25D0', color: 'text-amber-400', label: 'PARTIAL' },
  missed: { symbol: '\u2717', color: 'text-red-400', label: 'MISSED' },
  false_alarm: { symbol: '\u25CB', color: 'text-gray-400', label: 'FALSE ALARM' },
};

function AccuracyBar({ label, accuracy, detail }: { label: string; accuracy: number; detail: string }) {
  const barColor = accuracy >= 70 ? 'bg-emerald-400' : accuracy >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      <span className="w-28 sm:w-36 text-white/50 truncate">{label}</span>
      <div className="flex-1 h-2 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${accuracy}%` }} />
      </div>
      <span className="w-10 text-right text-white/70">{accuracy}%</span>
      <span className="w-16 text-right text-white/30 hidden sm:inline">{detail}</span>
    </div>
  );
}

export default function TrackRecord() {
  const { totalGraded, bySource, byState, recentGrades, loading } = useTrackRecord();

  // Overall accuracy (weighted from bySource)
  const overallAccuracy = (() => {
    let totalAlerts = 0;
    let weightedAcc = 0;
    for (const s of bySource) {
      totalAlerts += s.total;
      weightedAcc += s.accuracy * s.total;
    }
    return totalAlerts > 0 ? Math.round(weightedAcc / totalAlerts) : 0;
  })();

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={14} className="text-emerald-400" />
        <h3 className="text-xs font-mono uppercase tracking-widest text-white/50">Track Record</h3>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-4 bg-white/[0.04] rounded animate-pulse" />
          ))}
        </div>
      ) : totalGraded < 10 ? (
        /* ── Learning State ── */
        <div className="space-y-4">
          <div className="flex flex-col items-center justify-center py-6 gap-3">
            <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider italic">Learning...</span>
            <span className="text-[10px] font-mono text-white/20">
              {totalGraded} graded, need 10+
            </span>
            <p className="text-[10px] font-mono text-white/20 text-center max-w-xs leading-relaxed">
              The brain is still calibrating. Reliable accuracy stats require 50+ graded arcs. Results will appear as alerts cross their outcome deadlines.
            </p>
          </div>

          {/* Still show recent grades even in learning state */}
          {recentGrades.length > 0 && (
            <div>
              <h4 className="text-[10px] font-mono text-white/40 uppercase tracking-wider mb-2">Recent Grades</h4>
              <div className="space-y-1">
                {recentGrades.slice(0, 5).map((g, i) => {
                  const style = GRADE_ICON[g.outcome_grade] || GRADE_ICON.false_alarm;
                  return (
                    <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className={`w-4 text-center ${style.color}`}>{style.symbol}</span>
                      <span className="text-white/30 w-16">
                        {new Date(g.graded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <span className="text-white/50 w-8">{g.state_abbr}</span>
                      <span className="text-white/30 truncate flex-1">{g.alert_source}</span>
                      <span className={`${style.color} shrink-0`}>{style.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── Full Track Record ── */
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
              Weighted average across {totalGraded.toLocaleString()} graded alerts
              from {bySource.length} source{bySource.length !== 1 ? 's' : ''} and {byState.length} state{byState.length !== 1 ? 's' : ''}.
            </div>
          </div>

          {/* Per-source accuracy */}
          {bySource.length > 0 && (
            <div>
              <h4 className="text-[10px] font-mono text-white/40 uppercase tracking-wider mb-2">By Source</h4>
              <div className="space-y-1.5">
                {bySource.map(s => (
                  <AccuracyBar
                    key={s.source}
                    label={s.source}
                    accuracy={s.accuracy}
                    detail={`${s.confirmed}/${s.total}`}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Per-state counts (top 10) */}
          {byState.length > 0 && (
            <div>
              <h4 className="text-[10px] font-mono text-white/40 uppercase tracking-wider mb-2">By State</h4>
              <div className="space-y-1">
                {byState.map(s => (
                  <div key={s.state} className="flex items-center gap-2 text-[10px] font-mono">
                    <span className="text-white/50 w-8">{s.state}</span>
                    <span className="text-white/30">
                      {s.total} graded ({s.confirmed} confirmed)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent grades */}
          {recentGrades.length > 0 && (
            <div>
              <h4 className="text-[10px] font-mono text-white/40 uppercase tracking-wider mb-2">Recent Grades</h4>
              <div className="space-y-1">
                {recentGrades.map((g, i) => {
                  const style = GRADE_ICON[g.outcome_grade] || GRADE_ICON.false_alarm;
                  return (
                    <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className={`w-4 text-center ${style.color}`}>{style.symbol}</span>
                      <span className="text-white/30 w-16">
                        {new Date(g.graded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </span>
                      <span className="text-white/50 w-8">{g.state_abbr}</span>
                      <span className="text-white/30 truncate flex-1">{g.alert_source}</span>
                      <span className={`${style.color} shrink-0`}>{style.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
