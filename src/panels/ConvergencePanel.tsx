import { useState, useMemo } from 'react';
import { useConvergenceScores } from '@/hooks/useConvergenceScores';
import { useConvergenceHistoryAll } from '@/hooks/useConvergenceHistory';
import { useMapAction } from '@/contexts/MapActionContext';
import { useDeck } from '@/contexts/DeckContext';
import { stateFlyways, type FlywayName } from '@/data/flyways';
import Sparkline from '@/components/charts/Sparkline';
import PanelTabs from '@/components/PanelTabs';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { PanelComponentProps } from './PanelTypes';

const FLYWAYS: FlywayName[] = ['Atlantic', 'Mississippi', 'Central', 'Pacific'];

const COMPONENTS = [
  { key: 'weather_component', label: 'Weather', max: 25, color: 'bg-amber-400' },
  { key: 'migration_component', label: 'Migration', max: 25, color: 'bg-cyan-400' },
  { key: 'birdcast_component', label: 'BirdCast', max: 20, color: 'bg-emerald-400' },
  { key: 'solunar_component', label: 'Solunar', max: 15, color: 'bg-yellow-400' },
  { key: 'pattern_component', label: 'Pattern', max: 15, color: 'bg-purple-400' },
  { key: 'water_component', label: 'Water', max: 15, color: 'bg-blue-400' },
  { key: 'photoperiod_component', label: 'Photoperiod', max: 10, color: 'bg-orange-400' },
  { key: 'tide_component', label: 'Tide', max: 10, color: 'bg-teal-400' },
] as const;

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

export default function ConvergencePanel({ isFullscreen }: PanelComponentProps) {
  const { scores, topStates, loading } = useConvergenceScores();
  const { historyMap } = useConvergenceHistoryAll();
  const { flyTo } = useMapAction();
  const { selectedState, setSelectedState } = useDeck();
  const [activeTab, setActiveTab] = useState(isFullscreen ? 'all' : 'top10');
  const [expandedState, setExpandedState] = useState<string | null>(null);
  const [flywayFilter, setFlywayFilter] = useState<FlywayName | null>(null);

  const allStates = useMemo(() => {
    return Array.from(scores.values()).sort((a, b) => b.score - a.score);
  }, [scores]);

  const tabStates = activeTab === 'top10' ? topStates : allStates;

  const displayStates = useMemo(() => {
    if (!flywayFilter) return tabStates;
    return tabStates.filter(s => stateFlyways[s.state_abbr] === flywayFilter);
  }, [tabStates, flywayFilter]);

  function handleClick(abbr: string) {
    setExpandedState(prev => prev === abbr ? null : abbr);
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
    <div className="flex flex-col h-full overflow-hidden">
      <PanelTabs
        tabs={[
          { id: 'top10', label: 'TOP 10', count: topStates.length },
          { id: 'all', label: 'ALL 50', count: allStates.length },
        ]}
        active={activeTab}
        onChange={setActiveTab}
      />

      {/* Flyway filter */}
      <div className="flex gap-1 px-2 py-1 border-b border-white/[0.06]">
        <button
          onClick={() => setFlywayFilter(null)}
          className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${!flywayFilter ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/30 hover:text-white/50'}`}
        >
          ALL
        </button>
        {FLYWAYS.map(fw => (
          <button
            key={fw}
            onClick={() => setFlywayFilter(fw)}
            className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${flywayFilter === fw ? 'bg-cyan-500/20 text-cyan-400' : 'text-white/30 hover:text-white/50'}`}
          >
            {fw.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Header row */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/[0.06]">
        <span className="text-[10px] font-mono text-white/30 w-4 text-right">#</span>
        <span className="text-[10px] font-mono text-white/30 w-7">STATE</span>
        <span className="text-[10px] font-mono text-white/30 flex-1">SIGNAL</span>
        <span className="text-[10px] font-mono text-white/30 w-7 text-right"></span>
        <span className="text-[10px] font-mono text-white/30 w-12 text-right">TREND</span>
      </div>

      {/* Rows */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {displayStates.map((s, i) => {
          const sparkData = historyMap.get(s.state_abbr) || [];
          const isExpanded = isFullscreen || expandedState === s.state_abbr;
          return (
            <div key={s.state_abbr}>
              <button
                onClick={() => handleClick(s.state_abbr)}
                className={`flex items-center gap-2 px-2 py-1.5 transition-colors text-left w-full
                  hover:bg-gradient-to-r hover:from-white/[0.06] hover:to-transparent
                  ${selectedState === s.state_abbr ? 'border-l-2 border-cyan-400 bg-cyan-400/[0.04]' : ''}`}
              >
                {isExpanded
                  ? <ChevronDown className="w-3 h-3 text-white/30 shrink-0" />
                  : <ChevronRight className="w-3 h-3 text-white/30 shrink-0" />}
                <span className="text-[10px] text-white/40 w-4 text-right font-mono">{i + 1}</span>
                <span className="text-xs font-mono text-white/90 w-7">{s.state_abbr}</span>
                <div className="flex-1 h-2 bg-white/[0.06] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${barColor(s.score)}`}
                    style={{ width: `${s.score}%` }}
                  />
                </div>
                <span className={`text-sm font-mono font-bold w-7 text-right tabular-nums ${scoreColor(s.score)}`}>
                  {s.score}
                </span>
                <span className="w-12 flex justify-end">
                  {sparkData.length >= 2 && (
                    <Sparkline data={sparkData} width={48} height={16} color="#22d3ee" />
                  )}
                </span>
              </button>

              {isExpanded && (
                <div className="px-3 py-2 bg-white/[0.02] border-b border-white/[0.06]">
                  <div className="space-y-1 mb-2">
                    {COMPONENTS.map(comp => {
                      const value = (s as any)[comp.key] || 0;
                      const pct = (value / comp.max) * 100;
                      return (
                        <div key={comp.key} className="flex items-center gap-2">
                          <span className="text-[9px] font-mono text-white/40 w-20 text-right">{comp.label}</span>
                          <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${comp.color}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[9px] font-mono text-white/40 w-8">{value}/{comp.max}</span>
                        </div>
                      );
                    })}
                  </div>

                  {s.reasoning && (
                    <p className="text-[9px] text-white/50 italic mb-2 leading-relaxed">"{s.reasoning}"</p>
                  )}

                  <button
                    onClick={(e) => { e.stopPropagation(); flyTo(s.state_abbr); }}
                    className="text-[9px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
                  >
                    View on Map →
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
