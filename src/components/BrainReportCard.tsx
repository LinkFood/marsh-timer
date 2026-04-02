import { useTrackRecord } from '@/hooks/useTrackRecord';

export default function BrainReportCard() {
  const { totalGraded, bySource, loading } = useTrackRecord();

  if (loading || totalGraded === 0) return null;

  const overallAccuracy = bySource.length > 0
    ? Math.round(bySource.reduce((sum, s) => sum + s.accuracy * s.total, 0) / bySource.reduce((sum, s) => sum + s.total, 0))
    : 0;

  const accColor = overallAccuracy >= 60 ? '#22c55e' : overallAccuracy >= 30 ? '#f59e0b' : '#ef4444';

  return (
    <div className="shrink-0 border-t border-white/[0.06] px-3 py-2">
      <div className="text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1.5">Track Record</div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-2xl font-mono font-bold" style={{ color: accColor }}>
          {overallAccuracy}%
        </span>
        <div>
          <div className="text-[9px] font-mono text-white/30">{totalGraded} graded alerts</div>
          <div className="text-[8px] font-mono text-white/15">{bySource.length} sources tracked</div>
        </div>
      </div>
      {bySource.slice(0, 3).map(s => (
        <div key={s.source} className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[8px] font-mono text-white/25 w-24 truncate">{s.source}</span>
          <div className="flex-1 h-1 bg-white/[0.04] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${s.accuracy}%`,
                backgroundColor: s.accuracy >= 60 ? '#22c55e' : s.accuracy >= 30 ? '#f59e0b' : '#ef4444',
              }}
            />
          </div>
          <span className="text-[7px] font-mono text-white/20 w-6 text-right">{s.accuracy}%</span>
        </div>
      ))}
    </div>
  );
}
