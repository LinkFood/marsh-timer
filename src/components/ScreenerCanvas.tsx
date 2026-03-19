import { useState, useMemo, useCallback } from 'react';
import { Filter, RotateCcw, ChevronDown } from 'lucide-react';
import type { Species } from '@/data/types';
import { stateFlyways, type FlywayName } from '@/data/flyways';
import { useConvergenceHistoryAll } from '@/hooks/useConvergenceHistory';
import Sparkline from '@/components/charts/Sparkline';

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

type SortField = 'rank' | 'state' | 'score' | 'change' | 'weather' | 'migration' | 'solunar' | 'pattern';
type SortDir = 'asc' | 'desc';
type StatusFilter = 'HOT' | 'WARM' | 'MILD' | 'COOL';
type ViewMode = 'TABLE' | 'HEAT';

function getStatus(score: number): StatusFilter {
  if (score >= 80) return 'HOT';
  if (score >= 60) return 'WARM';
  if (score >= 40) return 'MILD';
  return 'COOL';
}

function scoreColor(score: number): string {
  if (score >= 80) return 'text-cyan-400';
  if (score >= 60) return 'text-orange-400';
  if (score >= 40) return 'text-yellow-400';
  return 'text-white/30';
}

function statusBadge(status: StatusFilter): { bg: string; text: string } {
  switch (status) {
    case 'HOT': return { bg: 'bg-red-500/20', text: 'text-red-400' };
    case 'WARM': return { bg: 'bg-orange-500/20', text: 'text-orange-400' };
    case 'MILD': return { bg: 'bg-yellow-500/20', text: 'text-yellow-400' };
    case 'COOL': return { bg: 'bg-blue-500/20', text: 'text-blue-400' };
  }
}

function heatColor(score: number): string {
  if (score >= 80) return 'bg-red-500/60';
  if (score >= 70) return 'bg-orange-500/50';
  if (score >= 60) return 'bg-orange-400/40';
  if (score >= 50) return 'bg-yellow-500/35';
  if (score >= 40) return 'bg-yellow-400/25';
  if (score >= 30) return 'bg-cyan-500/25';
  if (score >= 20) return 'bg-blue-500/25';
  return 'bg-blue-900/30';
}

function componentBar(value: number, max: number, color: string): JSX.Element {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-1">
      <div className="flex-1 h-1 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[9px] font-mono text-white/40 w-4 text-right">{value}</span>
    </div>
  );
}

const FLYWAY_OPTIONS: Array<{ value: FlywayName | 'All'; label: string }> = [
  { value: 'All', label: 'All Flyways' },
  { value: 'Atlantic', label: 'Atlantic' },
  { value: 'Mississippi', label: 'Mississippi' },
  { value: 'Central', label: 'Central' },
  { value: 'Pacific', label: 'Pacific' },
];

const STATUS_OPTIONS: StatusFilter[] = ['HOT', 'WARM', 'MILD', 'COOL'];

export default function ScreenerCanvas({
  species,
  convergenceScores,
  onSelectState,
  isMobile,
}: ScreenerCanvasProps) {
  const [sortField, setSortField] = useState<SortField>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [minScore, setMinScore] = useState(0);
  const [statusFilters, setStatusFilters] = useState<Set<StatusFilter>>(new Set());
  const [flywayFilter, setFlywayFilter] = useState<FlywayName | 'All'>('All');
  const [viewMode, setViewMode] = useState<ViewMode>('TABLE');

  const { historyMap } = useConvergenceHistoryAll(7);

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDir(field === 'rank' || field === 'state' ? 'asc' : 'desc');
    }
  }, [sortField]);

  const toggleStatus = useCallback((status: StatusFilter) => {
    setStatusFilters(prev => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setMinScore(0);
    setStatusFilters(new Set());
    setFlywayFilter('All');
  }, []);

  // Compute change deltas from sparkline data
  const changeMap = useMemo(() => {
    const map = new Map<string, number>();
    historyMap.forEach((scores, abbr) => {
      if (scores.length >= 2) {
        map.set(abbr, scores[scores.length - 1] - scores[0]);
      }
    });
    return map;
  }, [historyMap]);

  const rows = useMemo(() => {
    const entries: Array<{ abbr: string; data: ConvergenceData; change: number; sparkData: number[] }> = [];
    convergenceScores.forEach((data, abbr) => {
      // Min score filter
      if (data.score < minScore) return;
      // Status filter
      if (statusFilters.size > 0 && !statusFilters.has(getStatus(data.score))) return;
      // Flyway filter
      if (flywayFilter !== 'All' && stateFlyways[abbr] !== flywayFilter) return;

      entries.push({
        abbr,
        data,
        change: changeMap.get(abbr) ?? 0,
        sparkData: historyMap.get(abbr) ?? [],
      });
    });

    const dir = sortDir === 'desc' ? -1 : 1;
    entries.sort((a, b) => {
      let av: number | string, bv: number | string;
      switch (sortField) {
        case 'rank': av = a.data.national_rank; bv = b.data.national_rank; break;
        case 'state': av = a.abbr; bv = b.abbr; break;
        case 'score': av = a.data.score; bv = b.data.score; break;
        case 'change': av = a.change; bv = b.change; break;
        case 'weather': av = a.data.weather_component; bv = b.data.weather_component; break;
        case 'migration': av = a.data.migration_component; bv = b.data.migration_component; break;
        case 'solunar': av = a.data.solunar_component; bv = b.data.solunar_component; break;
        case 'pattern': av = a.data.pattern_component; bv = b.data.pattern_component; break;
        default: av = a.data.score; bv = b.data.score;
      }
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * dir;
      }
      if (sortField === 'rank') return ((av as number) - (bv as number)) * dir;
      return ((bv as number) - (av as number)) * dir;
    });

    return entries;
  }, [convergenceScores, sortField, sortDir, minScore, statusFilters, flywayFilter, changeMap, historyMap]);

  const totalStates = convergenceScores.size;

  const SortArrow = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return <span className="text-[8px] ml-0.5">{sortDir === 'desc' ? '\u25BC' : '\u25B2'}</span>;
  };

  const colHeaderClass = (field: SortField) =>
    `cursor-pointer select-none text-[9px] font-mono uppercase tracking-wider transition-colors ${
      sortField === field ? 'text-cyan-400' : 'text-white/30 hover:text-white/50'
    }`;

  return (
    <div
      className={`fixed z-10 glass-panel flex flex-col overflow-hidden ${
        isMobile
          ? 'top-[76px] left-0 right-0 bottom-11'
          : 'top-[112px] left-80 right-0 bottom-0'
      }`}
    >
      {/* Filter Bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] shrink-0 flex-wrap">
        <Filter size={12} className="text-cyan-400 shrink-0" />

        {/* Min Score */}
        <div className="flex items-center gap-1">
          <label className="text-[9px] font-mono text-white/30">MIN</label>
          <input
            type="number"
            min={0}
            max={100}
            value={minScore || ''}
            onChange={e => setMinScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            placeholder="0"
            className="w-10 h-5 bg-white/[0.05] border border-white/[0.08] rounded text-[10px] font-mono text-white/70 text-center focus:outline-none focus:border-cyan-400/40"
          />
        </div>

        {/* Status Buttons */}
        <div className="flex items-center gap-0.5">
          {STATUS_OPTIONS.map(s => {
            const badge = statusBadge(s);
            const active = statusFilters.size === 0 || statusFilters.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleStatus(s)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-mono transition-colors ${
                  active
                    ? `${badge.bg} ${badge.text}`
                    : 'bg-white/[0.02] text-white/15'
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>

        {/* Flyway Dropdown */}
        <div className="relative">
          <select
            value={flywayFilter}
            onChange={e => setFlywayFilter(e.target.value as FlywayName | 'All')}
            className="h-5 pl-1.5 pr-5 bg-white/[0.05] border border-white/[0.08] rounded text-[9px] font-mono text-white/50 appearance-none focus:outline-none focus:border-cyan-400/40 cursor-pointer"
          >
            {FLYWAY_OPTIONS.map(o => (
              <option key={o.value} value={o.value} className="bg-gray-900">{o.label}</option>
            ))}
          </select>
          <ChevronDown size={8} className="absolute right-1 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
        </div>

        {/* Reset */}
        <button
          onClick={resetFilters}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-mono text-white/25 hover:text-white/50 transition-colors"
        >
          <RotateCcw size={8} />
          Reset
        </button>

        {/* Count */}
        <span className="text-[9px] font-mono text-white/20 ml-auto">
          Showing {rows.length} of {totalStates}
        </span>

        {/* View Toggle */}
        <div className="flex items-center bg-white/[0.04] rounded overflow-hidden border border-white/[0.06]">
          <button
            onClick={() => setViewMode('TABLE')}
            className={`px-2 py-0.5 text-[9px] font-mono transition-colors ${
              viewMode === 'TABLE' ? 'bg-cyan-400/15 text-cyan-400' : 'text-white/30 hover:text-white/50'
            }`}
          >
            TABLE
          </button>
          <button
            onClick={() => setViewMode('HEAT')}
            className={`px-2 py-0.5 text-[9px] font-mono transition-colors ${
              viewMode === 'HEAT' ? 'bg-cyan-400/15 text-cyan-400' : 'text-white/30 hover:text-white/50'
            }`}
          >
            HEAT
          </button>
        </div>
      </div>

      {viewMode === 'TABLE' ? (
        <>
          {/* Table Header */}
          <div className={`grid items-center px-3 py-1.5 border-b border-white/[0.06] shrink-0 bg-white/[0.02] ${
            isMobile
              ? 'grid-cols-[28px_32px_42px_48px_42px_56px_56px_48px]'
              : 'grid-cols-[32px_36px_48px_60px_48px_1fr_1fr_1fr_1fr_56px]'
          }`}>
            <button onClick={() => handleSort('rank')} className={colHeaderClass('rank')}>
              #<SortArrow field="rank" />
            </button>
            <button onClick={() => handleSort('state')} className={colHeaderClass('state')}>
              St<SortArrow field="state" />
            </button>
            <button onClick={() => handleSort('score')} className={`${colHeaderClass('score')} text-center`}>
              Score<SortArrow field="score" />
            </button>
            <div className="text-[9px] font-mono text-white/20 text-center">Trend</div>
            <button onClick={() => handleSort('change')} className={`${colHeaderClass('change')} text-center`}>
              Chg<SortArrow field="change" />
            </button>
            <button onClick={() => handleSort('weather')} className={colHeaderClass('weather')}>
              Wx<SortArrow field="weather" />
            </button>
            <button onClick={() => handleSort('migration')} className={colHeaderClass('migration')}>
              Migr<SortArrow field="migration" />
            </button>
            {!isMobile && (
              <>
                <button onClick={() => handleSort('solunar')} className={colHeaderClass('solunar')}>
                  Sol<SortArrow field="solunar" />
                </button>
                <button onClick={() => handleSort('pattern')} className={colHeaderClass('pattern')}>
                  Pat<SortArrow field="pattern" />
                </button>
              </>
            )}
            <div className="text-[9px] font-mono text-white/20 text-right">Status</div>
          </div>

          {/* Table Body */}
          <div className="flex-1 overflow-y-auto scrollbar-hide">
            {rows.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-white/20 text-xs font-mono">
                No states match filters
              </div>
            ) : (
              rows.map(({ abbr, data, change, sparkData }, i) => {
                const status = getStatus(data.score);
                const badge = statusBadge(status);
                const changeColor = change > 0 ? 'text-green-400' : change < 0 ? 'text-red-400' : 'text-white/20';
                const changeArrow = change > 0 ? '\u25B2' : change < 0 ? '\u25BC' : '';
                const sparkColor = change >= 0 ? '#4ade80' : '#f87171';

                return (
                  <button
                    key={abbr}
                    onClick={() => onSelectState(abbr)}
                    className={`grid items-center w-full px-3 py-1.5 border-b border-white/[0.03] hover:bg-white/[0.04] transition-colors ${
                      i % 2 === 1 ? 'bg-white/[0.015]' : ''
                    } ${
                      isMobile
                        ? 'grid-cols-[28px_32px_42px_48px_42px_56px_56px_48px]'
                        : 'grid-cols-[32px_36px_48px_60px_48px_1fr_1fr_1fr_1fr_56px]'
                    }`}
                  >
                    {/* Rank */}
                    <span className="text-[10px] font-mono text-white/30">
                      {data.national_rank}
                    </span>

                    {/* State */}
                    <span className="text-[11px] font-mono text-white/70 font-semibold">
                      {abbr}
                    </span>

                    {/* Score */}
                    <span className={`text-sm font-mono font-bold ${scoreColor(data.score)} text-center`}>
                      {data.score}
                    </span>

                    {/* Sparkline */}
                    <div className="flex justify-center">
                      {sparkData.length >= 2 ? (
                        <Sparkline
                          data={sparkData}
                          width={isMobile ? 36 : 48}
                          height={16}
                          color={sparkColor}
                          strokeWidth={1}
                        />
                      ) : (
                        <span className="text-[8px] font-mono text-white/10">--</span>
                      )}
                    </div>

                    {/* Change */}
                    <span className={`text-[10px] font-mono ${changeColor} text-center`}>
                      {changeArrow}{change !== 0 ? Math.abs(change) : '--'}
                    </span>

                    {/* Weather bar */}
                    <div className="px-1">
                      {componentBar(data.weather_component, 30, 'bg-orange-400/60')}
                    </div>

                    {/* Migration bar */}
                    <div className="px-1">
                      {componentBar(data.migration_component, 30, 'bg-green-400/60')}
                    </div>

                    {/* Solunar bar (desktop) */}
                    {!isMobile && (
                      <div className="px-1">
                        {componentBar(data.solunar_component, 20, 'bg-purple-400/60')}
                      </div>
                    )}

                    {/* Pattern bar (desktop) */}
                    {!isMobile && (
                      <div className="px-1">
                        {componentBar(data.pattern_component, 20, 'bg-cyan-400/60')}
                      </div>
                    )}

                    {/* Status Badge */}
                    <div className="flex justify-end">
                      <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${badge.bg} ${badge.text}`}>
                        {status}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </>
      ) : (
        /* HEAT MAP VIEW */
        <div className="flex-1 overflow-y-auto scrollbar-hide p-4">
          <div className={`grid gap-1 ${
            isMobile ? 'grid-cols-5' : 'grid-cols-10'
          }`}>
            {rows.map(({ abbr, data }) => (
              <button
                key={abbr}
                onClick={() => onSelectState(abbr)}
                className={`${heatColor(data.score)} rounded px-1 py-2 text-center hover:ring-1 hover:ring-white/20 transition-all`}
              >
                <div className="text-[10px] font-mono font-bold text-white/80">{abbr}</div>
                <div className={`text-[9px] font-mono ${scoreColor(data.score)}`}>{data.score}</div>
              </button>
            ))}
          </div>
          {rows.length === 0 && (
            <div className="flex items-center justify-center py-12 text-white/20 text-xs font-mono">
              No states match filters
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-white/[0.06] shrink-0 bg-white/[0.02]">
        <span className="text-[9px] font-mono text-white/20">
          {species.toUpperCase()} · {rows.length} states · sorted by {sortField} {sortDir === 'desc' ? '\u25BC' : '\u25B2'}
        </span>
        <span className="text-[9px] font-mono text-white/20">
          avg {rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.data.score, 0) / rows.length) : 0}
        </span>
      </div>
    </div>
  );
}
