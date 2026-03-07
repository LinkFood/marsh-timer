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

interface HotspotRankingProps {
  states: Array<{
    state_abbr: string;
    score: number;
    reasoning: string;
    national_rank: number;
  }>;
  onSelectState: (abbr: string) => void;
}

export default function HotspotRanking({ states, onSelectState }: HotspotRankingProps) {
  const top10 = states.slice(0, 10);

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-white/40 font-body font-semibold mb-2">
        Where to Hunt Today
      </div>

      {top10.length === 0 ? (
        <div className="text-xs text-white/30">Convergence data loading...</div>
      ) : (
        <div className="space-y-0.5">
          {top10.map((state) => {
            const color = scoreColor(state.score);
            return (
              <button
                key={state.state_abbr}
                onClick={() => onSelectState(state.state_abbr)}
                className="px-2 py-1.5 rounded-lg hover:bg-white/[0.04] transition-colors w-full text-left"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/30 w-5 text-right flex-shrink-0">
                    {state.national_rank}
                  </span>
                  <span className="text-xs font-display font-bold text-white/90 w-8 flex-shrink-0">
                    {state.state_abbr}
                  </span>
                  <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${state.score}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className={`text-xs font-body flex-shrink-0 ${scoreTextClass(state.score)}`}>
                    {state.score}
                    <span className="text-white/30">/100</span>
                  </span>
                </div>
                <div className="text-[10px] text-white/40 truncate pl-5 mt-0.5">
                  {state.reasoning}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
