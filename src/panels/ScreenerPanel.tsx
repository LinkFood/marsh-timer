import { useState, useMemo } from 'react';
import { useConvergenceScores, type ConvergenceScore } from '@/hooks/useConvergenceScores';
import { useConvergenceHistoryAll } from '@/hooks/useConvergenceHistory';
import { useMapAction } from '@/contexts/MapActionContext';
import { useDeck } from '@/contexts/DeckContext';
import Sparkline from '@/components/charts/Sparkline';
import { ChevronUp, ChevronDown } from 'lucide-react';
import type { PanelComponentProps } from './PanelTypes';

type SortKey = 'rank' | 'state' | 'score' | 'weather' | 'migration' | 'solunar' | 'pattern';
type Tier = 'ALL' | 'HOT' | 'WARM' | 'MILD' | 'COOL';

const TIERS: Tier[] = ['ALL', 'HOT', 'WARM', 'MILD', 'COOL'];

function tierFilter(score: number, tier: Tier): boolean {
  if (tier === 'ALL') return true;
  if (tier === 'HOT') return score >= 50;
  if (tier === 'WARM') return score >= 60 && score < 80;
  if (tier === 'MILD') return score >= 40 && score < 60;
  return score < 40; // COOL
}

function tierColor(tier: Tier): string {
  if (tier === 'HOT') return 'text-red-400';
  if (tier === 'WARM') return 'text-orange-400';
  if (tier === 'MILD') return 'text-yellow-400';
  if (tier === 'COOL') return 'text-blue-400';
  return 'text-white/70';
}

function scoreBg(score: number): string {
  if (score >= 50) return 'bg-red-400/10';
  if (score >= 60) return 'bg-orange-400/10';
  if (score >= 40) return 'bg-yellow-400/10';
  if (score >= 20) return 'bg-blue-400/10';
  return '';
}

function scoreText(score: number): string {
  if (score >= 50) return 'text-red-400';
  if (score >= 60) return 'text-orange-400';
  if (score >= 40) return 'text-yellow-400';
  if (score >= 20) return 'text-blue-400';
  return 'text-gray-500';
}

function getSortValue(s: ConvergenceScore, key: SortKey): number | string {
  switch (key) {
    case 'rank': return s.national_rank;
    case 'state': return s.state_abbr;
    case 'score': return s.score;
    case 'weather': return s.weather_component;
    case 'migration': return s.migration_component;
    case 'solunar': return s.solunar_component;
    case 'pattern': return s.pattern_component;
  }
}

const COLUMNS: { key: SortKey; label: string; width: string }[] = [
  { key: 'rank', label: '#', width: 'w-6' },
  { key: 'state', label: 'ST', width: 'w-8' },
  { key: 'score', label: 'Score', width: 'w-10' },
  { key: 'weather', label: 'Wx', width: 'w-8' },
  { key: 'migration', label: 'Mig', width: 'w-8' },
  { key: 'solunar', label: 'Sol', width: 'w-8' },
  { key: 'pattern', label: 'Pat', width: 'w-8' },
];

export default function ScreenerPanel({}: PanelComponentProps) {
  const { scores, loading } = useConvergenceScores();
  const { historyMap } = useConvergenceHistoryAll();
  const { flyTo } = useMapAction();
  const { selectedState, setSelectedState } = useDeck();

  const [sortKey, setSortKey] = useState<SortKey>('rank');
  const [sortAsc, setSortAsc] = useState(true);
  const [tier, setTier] = useState<Tier>('ALL');

  const allScores = useMemo(() => Array.from(scores.values()), [scores]);

  const sorted = useMemo(() => {
    const filtered = allScores.filter(s => tierFilter(s.score, tier));
    return filtered.sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [allScores, sortKey, sortAsc, tier]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === 'rank' || key === 'state');
    }
  }

  function handleClick(abbr: string) {
    flyTo(abbr);
    setSelectedState(abbr);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading screener...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tier filter */}
      <div className="flex gap-1 px-2 py-1.5 border-b border-white/[0.06]">
        {TIERS.map(t => (
          <button
            key={t}
            onClick={() => setTier(t)}
            className={`text-[10px] font-mono px-1.5 py-0.5 rounded transition-colors ${
              tier === t
                ? `${tierColor(t)} bg-white/[0.08]`
                : 'text-white/30 hover:text-white/50'
            }`}
          >
            {t}
          </button>
        ))}
        <span className="text-[10px] text-white/20 ml-auto font-mono tabular-nums">{sorted.length}</span>
      </div>

      {/* Sticky header */}
      <div className="flex items-center px-2 py-1.5 border-b border-white/[0.06] gap-1 bg-black/40 sticky top-0 z-10">
        {COLUMNS.map(col => (
          <button
            key={col.key}
            onClick={() => toggleSort(col.key)}
            className={`${col.width} text-[10px] font-mono flex items-center gap-0.5 transition-colors ${
              sortKey === col.key ? 'text-cyan-400' : 'text-white/40 hover:text-white/60'
            }`}
          >
            {col.label}
            {sortKey === col.key && (
              sortAsc ? <ChevronUp size={8} /> : <ChevronDown size={8} />
            )}
          </button>
        ))}
        <span className="w-12 text-[10px] font-mono text-white/40">Trend</span>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-y-auto">
        {sorted.map((s, i) => {
          const sparkData = historyMap.get(s.state_abbr) || [];
          return (
            <button
              key={s.state_abbr}
              onClick={() => handleClick(s.state_abbr)}
              className={`flex items-center px-2 py-1 gap-1 w-full transition-colors text-left
                hover:bg-white/[0.06] ${selectedState === s.state_abbr ? 'border-l-2 border-cyan-400 bg-cyan-400/[0.04]' : i % 2 === 1 ? 'bg-white/[0.02]' : ''}`}
            >
              <span className="w-6 text-[10px] font-mono text-white/40 text-right tabular-nums">{s.national_rank}</span>
              <span className="w-8 text-[10px] font-mono text-white/90">{s.state_abbr}</span>
              <span className={`w-10 text-[10px] font-mono font-bold text-right tabular-nums rounded px-0.5 ${scoreText(s.score)} ${scoreBg(s.score)}`}>
                {s.score}
              </span>
              <span className="w-8 text-[10px] font-mono text-white/50 text-right tabular-nums">{s.weather_component}</span>
              <span className="w-8 text-[10px] font-mono text-white/50 text-right tabular-nums">{s.migration_component}</span>
              <span className="w-8 text-[10px] font-mono text-white/50 text-right tabular-nums">{s.solunar_component}</span>
              <span className="w-8 text-[10px] font-mono text-white/50 text-right tabular-nums">{s.pattern_component}</span>
              <span className="w-12 flex justify-end">
                {sparkData.length >= 2 && (
                  <Sparkline data={sparkData} width={40} height={14} color="#22d3ee" />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
