import { useState, useMemo, useCallback } from 'react';
import { Filter, SortAsc, SortDesc, MapPin, Zap, Thermometer, Bird, Droplets, Sun } from 'lucide-react';
import type { Species } from '@/data/types';

interface ConvergenceData {
  score: number;
  weather_component: number;
  solunar_component: number;
  migration_component: number;
  pattern_component: number;
  national_rank: number;
  reasoning: string;
  birdcast_component?: number;
  water_component?: number;
  photoperiod_component?: number;
  tide_component?: number;
}

interface ScreenerCanvasProps {
  species: Species;
  convergenceScores: Map<string, ConvergenceData>;
  onSelectState: (abbr: string) => void;
  isMobile: boolean;
}

type SortField = 'score' | 'weather' | 'migration' | 'solunar' | 'pattern' | 'rank';
type SortDir = 'asc' | 'desc';

interface FilterState {
  minScore: number;
  maxScore: number;
  minWeather: number;
  minMigration: number;
}

const DEFAULT_FILTERS: FilterState = {
  minScore: 0,
  maxScore: 100,
  minWeather: 0,
  minMigration: 0,
};

function getComponentValue(data: ConvergenceData, field: SortField): number {
  switch (field) {
    case 'score': return data.score;
    case 'weather': return data.weather_component;
    case 'migration': return data.migration_component;
    case 'solunar': return data.solunar_component;
    case 'pattern': return data.pattern_component;
    case 'rank': return data.national_rank;
  }
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-red-400';
  if (score >= 60) return 'text-orange-400';
  if (score >= 40) return 'text-yellow-400';
  if (score >= 20) return 'text-blue-400';
  return 'text-white/30';
}

function scoreBg(score: number): string {
  if (score >= 80) return 'bg-red-400/20';
  if (score >= 60) return 'bg-orange-400/20';
  if (score >= 40) return 'bg-yellow-400/20';
  if (score >= 20) return 'bg-blue-400/20';
  return 'bg-white/[0.03]';
}

function componentBar(value: number, max: number = 30): JSX.Element {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="w-full h-1 rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className="h-full rounded-full bg-cyan-400/50"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function ScreenerCanvas({
  species,
  convergenceScores,
  onSelectState,
  isMobile,
}: ScreenerCanvasProps) {
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }, [sortField]);

  const rows = useMemo(() => {
    const entries: Array<{ abbr: string; data: ConvergenceData }> = [];
    convergenceScores.forEach((data, abbr) => {
      // Apply filters
      if (data.score < filters.minScore || data.score > filters.maxScore) return;
      if (data.weather_component < filters.minWeather) return;
      if (data.migration_component < filters.minMigration) return;
      entries.push({ abbr, data });
    });

    // Sort
    const dir = sortDir === 'desc' ? -1 : 1;
    entries.sort((a, b) => {
      const av = getComponentValue(a.data, sortField);
      const bv = getComponentValue(b.data, sortField);
      // Rank is inverted — lower rank = better
      if (sortField === 'rank') return (av - bv) * dir;
      return (bv - av) * dir;
    });

    return entries;
  }, [convergenceScores, sortField, sortDir, filters]);

  const SortIcon = sortDir === 'desc' ? SortDesc : SortAsc;

  const colHeaders: Array<{ field: SortField; label: string; icon: typeof Zap; hideOnMobile?: boolean }> = [
    { field: 'rank', label: '#', icon: MapPin },
    { field: 'score', label: 'Score', icon: Zap },
    { field: 'weather', label: 'Wx', icon: Thermometer },
    { field: 'migration', label: 'Migr', icon: Bird },
    { field: 'solunar', label: 'Sol', icon: Sun, hideOnMobile: true },
    { field: 'pattern', label: 'Pat', icon: Droplets, hideOnMobile: true },
  ];

  return (
    <div
      className={`fixed z-10 glass-panel flex flex-col overflow-hidden ${
        isMobile
          ? 'top-[76px] left-0 right-0 bottom-11'
          : 'top-[112px] left-80 right-0 bottom-0'
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06] shrink-0">
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-cyan-400" />
          <span className="text-[10px] font-display tracking-widest text-white/40 uppercase">
            Screener
          </span>
          <span className="text-[10px] text-white/20 font-mono">
            {rows.length}/{convergenceScores.size}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`px-2 py-1 rounded text-[10px] font-mono transition-colors ${
              showFilters ? 'bg-cyan-400/20 text-cyan-400' : 'text-white/40 hover:text-white/60'
            }`}
          >
            Filters
          </button>
          <button
            onClick={() => setFilters(DEFAULT_FILTERS)}
            className="px-2 py-1 rounded text-[10px] font-mono text-white/30 hover:text-white/50 transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="px-4 py-3 border-b border-white/[0.06] shrink-0 space-y-2">
          <div className="flex items-center gap-4">
            <label className="text-[10px] font-body text-white/40 w-20">Min Score</label>
            <input
              type="range"
              min={0}
              max={100}
              value={filters.minScore}
              onChange={e => setFilters(f => ({ ...f, minScore: +e.target.value }))}
              className="flex-1 h-1 accent-cyan-400"
            />
            <span className="text-[10px] font-mono text-white/50 w-6 text-right">{filters.minScore}</span>
          </div>
          <div className="flex items-center gap-4">
            <label className="text-[10px] font-body text-white/40 w-20">Min Weather</label>
            <input
              type="range"
              min={0}
              max={30}
              value={filters.minWeather}
              onChange={e => setFilters(f => ({ ...f, minWeather: +e.target.value }))}
              className="flex-1 h-1 accent-cyan-400"
            />
            <span className="text-[10px] font-mono text-white/50 w-6 text-right">{filters.minWeather}</span>
          </div>
          <div className="flex items-center gap-4">
            <label className="text-[10px] font-body text-white/40 w-20">Min Migration</label>
            <input
              type="range"
              min={0}
              max={30}
              value={filters.minMigration}
              onChange={e => setFilters(f => ({ ...f, minMigration: +e.target.value }))}
              className="flex-1 h-1 accent-cyan-400"
            />
            <span className="text-[10px] font-mono text-white/50 w-6 text-right">{filters.minMigration}</span>
          </div>
        </div>
      )}

      {/* Table header */}
      <div className="flex items-center px-4 py-2 border-b border-white/[0.06] shrink-0 bg-white/[0.02]">
        <div className="w-12 text-[9px] font-mono text-white/30">State</div>
        {colHeaders.map(col => {
          if (col.hideOnMobile && isMobile) return null;
          const isActive = sortField === col.field;
          return (
            <button
              key={col.field}
              onClick={() => handleSort(col.field)}
              className={`flex-1 flex items-center justify-center gap-1 text-[9px] font-mono uppercase tracking-wider transition-colors ${
                isActive ? 'text-cyan-400' : 'text-white/30 hover:text-white/50'
              }`}
            >
              {col.label}
              {isActive && <SortIcon size={8} />}
            </button>
          );
        })}
        <div className="w-16" />
      </div>

      {/* Table body */}
      <div className="flex-1 overflow-y-auto scrollbar-hide">
        {rows.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-white/20 text-xs font-body">
            No states match filters
          </div>
        ) : (
          rows.map(({ abbr, data }) => (
            <button
              key={abbr}
              onClick={() => onSelectState(abbr)}
              className="flex items-center w-full px-4 py-2 border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors group"
            >
              {/* State */}
              <div className="w-12 text-[11px] font-mono text-white/70 font-semibold text-left">
                {abbr}
              </div>

              {/* Rank */}
              <div className="flex-1 text-center">
                <span className="text-[10px] font-mono text-white/30">
                  #{data.national_rank}
                </span>
              </div>

              {/* Score */}
              <div className="flex-1 text-center">
                <span className={`text-sm font-mono font-bold ${scoreColor(data.score)}`}>
                  {data.score}
                </span>
              </div>

              {/* Weather */}
              <div className="flex-1 px-1">
                <div className="text-center text-[10px] font-mono text-white/50 mb-0.5">
                  {data.weather_component}
                </div>
                {componentBar(data.weather_component)}
              </div>

              {/* Migration */}
              <div className="flex-1 px-1">
                <div className="text-center text-[10px] font-mono text-white/50 mb-0.5">
                  {data.migration_component}
                </div>
                {componentBar(data.migration_component)}
              </div>

              {/* Solunar (desktop only) */}
              {!isMobile && (
                <div className="flex-1 px-1">
                  <div className="text-center text-[10px] font-mono text-white/50 mb-0.5">
                    {data.solunar_component}
                  </div>
                  {componentBar(data.solunar_component)}
                </div>
              )}

              {/* Pattern (desktop only) */}
              {!isMobile && (
                <div className="flex-1 px-1">
                  <div className="text-center text-[10px] font-mono text-white/50 mb-0.5">
                    {data.pattern_component}
                  </div>
                  {componentBar(data.pattern_component)}
                </div>
              )}

              {/* Score badge */}
              <div className="w-16 flex justify-end">
                <span className={`text-[9px] font-mono px-2 py-0.5 rounded ${scoreBg(data.score)} ${scoreColor(data.score)}`}>
                  {data.score >= 80 ? 'HOT' : data.score >= 60 ? 'WARM' : data.score >= 40 ? 'MILD' : 'COOL'}
                </span>
              </div>
            </button>
          ))
        )}
      </div>

      {/* Footer stats */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-white/[0.06] shrink-0 bg-white/[0.02]">
        <span className="text-[9px] font-mono text-white/20">
          {species.toUpperCase()} · {rows.length} states · sorted by {sortField}
        </span>
        <span className="text-[9px] font-mono text-white/20">
          avg {rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.data.score, 0) / rows.length) : 0}
        </span>
      </div>
    </div>
  );
}
