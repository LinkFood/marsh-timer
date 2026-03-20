import { useMemo } from 'react';
import { useDeck } from '@/contexts/DeckContext';
import { useConvergenceHistory, useConvergenceHistoryAll } from '@/hooks/useConvergenceHistory';
import { useConvergenceTimeline } from '@/hooks/useConvergenceTimeline';
import Sparkline from '@/components/charts/Sparkline';
import type { PanelComponentProps } from './PanelTypes';

export default function ConvergenceHistoryPanel({}: PanelComponentProps) {
  const { selectedState } = useDeck();
  const { history, loading: stateLoading } = useConvergenceHistory(selectedState);
  const { dailyAverages, loading: natLoading } = useConvergenceTimeline();

  const loading = selectedState ? stateLoading : natLoading;

  // State-level stats
  const stateStats = useMemo(() => {
    if (!history || history.length === 0) return null;
    const scores = history.map(h => h.score);
    const current = scores[scores.length - 1];
    const avg7 = scores.length >= 7
      ? Math.round(scores.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, scores.length))
      : null;
    const avg30 = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    return { current, avg7, avg30, scores };
  }, [history]);

  // National stats
  const natStats = useMemo(() => {
    if (dailyAverages.length === 0) return null;
    const scores = dailyAverages.map(d => d.avg);
    const current = scores[scores.length - 1];
    const avg7 = scores.length >= 7
      ? Math.round(scores.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, scores.length))
      : null;
    const avg30 = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    return { current, avg7, avg30, scores };
  }, [dailyAverages]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading history...
      </div>
    );
  }

  const stats = selectedState ? stateStats : natStats;

  if (!stats || stats.scores.length < 2) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        {selectedState ? `No history for ${selectedState}` : 'No convergence history'}
      </div>
    );
  }

  const trendColor = stats.current >= (stats.avg7 ?? stats.avg30) ? '#22d3ee' : '#fb923c';

  return (
    <div className="flex flex-col gap-3 p-3 h-full">
      <div className="text-[10px] font-display tracking-widest text-white/30 uppercase">
        {selectedState ? `${selectedState} CONVERGENCE` : 'NATIONAL CONVERGENCE'}
      </div>

      {/* Sparkline */}
      <Sparkline
        data={stats.scores}
        width={300}
        height={48}
        color={trendColor}
        fillColor={trendColor}
        className="w-full"
      />

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white/[0.03] rounded-lg p-2 text-center border border-white/[0.06]">
          <div className="text-xl font-mono font-bold text-cyan-400">{stats.current}</div>
          <div className="text-[8px] font-mono text-white/30 tracking-wider">CURRENT</div>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-2 text-center border border-white/[0.06]">
          <div className="text-xl font-mono font-bold text-white/70">{stats.avg7 ?? '--'}</div>
          <div className="text-[8px] font-mono text-white/30 tracking-wider">7D AVG</div>
        </div>
        <div className="bg-white/[0.03] rounded-lg p-2 text-center border border-white/[0.06]">
          <div className="text-xl font-mono font-bold text-white/50">{stats.avg30}</div>
          <div className="text-[8px] font-mono text-white/30 tracking-wider">30D AVG</div>
        </div>
      </div>

      {/* Trend indicator */}
      <div className="text-center">
        {stats.avg7 !== null && (
          <span className={`text-[10px] font-mono ${stats.current > stats.avg7 ? 'text-green-400' : stats.current < stats.avg7 ? 'text-red-400' : 'text-white/40'}`}>
            {stats.current > stats.avg7 ? '^ ' : stats.current < stats.avg7 ? 'v ' : '= '}
            {Math.abs(stats.current - stats.avg7)} pts vs 7d avg
          </span>
        )}
      </div>
    </div>
  );
}
