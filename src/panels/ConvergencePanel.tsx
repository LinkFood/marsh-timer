import { useConvergenceScores } from '@/hooks/useConvergenceScores';
import { useConvergenceHistoryAll } from '@/hooks/useConvergenceHistory';
import { useMapAction } from '@/contexts/MapActionContext';
import { useDeck } from '@/contexts/DeckContext';
import Sparkline from '@/components/charts/Sparkline';
import type { PanelComponentProps } from './PanelTypes';

function scoreColor(score: number): string {
  if (score >= 80) return 'text-red-400';
  if (score >= 60) return 'text-orange-400';
  if (score >= 40) return 'text-yellow-400';
  if (score >= 20) return 'text-blue-400';
  return 'text-gray-400';
}

function barColor(score: number): string {
  if (score >= 80) return 'bg-red-400';
  if (score >= 60) return 'bg-orange-400';
  if (score >= 40) return 'bg-yellow-400';
  if (score >= 20) return 'bg-blue-400';
  return 'bg-gray-500';
}

export default function ConvergencePanel({}: PanelComponentProps) {
  const { topStates, loading } = useConvergenceScores();
  const { historyMap } = useConvergenceHistoryAll();
  const { flyTo } = useMapAction();
  const { setSelectedState } = useDeck();

  function handleClick(abbr: string) {
    flyTo(abbr);
    setSelectedState(abbr);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading scores...
      </div>
    );
  }

  if (topStates.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        No convergence data
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto h-full p-2">
      {topStates.map((s, i) => {
        const sparkData = historyMap.get(s.state_abbr) || [];
        return (
          <button
            key={s.state_abbr}
            onClick={() => handleClick(s.state_abbr)}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] transition-colors text-left w-full"
          >
            <span className="text-[10px] text-white/40 w-4 text-right font-mono">{i + 1}</span>
            <span className="text-xs font-mono text-white/90 w-7">{s.state_abbr}</span>
            <div className="flex-1 h-2 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${barColor(s.score)}`}
                style={{ width: `${s.score}%` }}
              />
            </div>
            <span className={`text-xs font-mono w-7 text-right ${scoreColor(s.score)}`}>
              {s.score}
            </span>
            {sparkData.length >= 2 && (
              <Sparkline data={sparkData} width={48} height={16} color="#22d3ee" />
            )}
          </button>
        );
      })}
    </div>
  );
}
