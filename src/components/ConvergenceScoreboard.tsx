import { useMemo, useState } from 'react';
import { List, ChartScatter, Play } from 'lucide-react';
import type { ConvergenceScore } from '@/hooks/useConvergenceScores';
import type { StateArc } from '@/hooks/useStateArcs';
import { useDeck } from '@/contexts/DeckContext';
import { useConvergenceTimeline } from '@/hooks/useConvergenceTimeline';
import PressureDifferential from '@/components/PressureDifferential';

const DOMAINS = [
  { key: 'weather_component' as const, color: '#ef4444', label: 'Weather' },
  { key: 'migration_component' as const, color: '#3b82f6', label: 'Migration' },
  { key: 'birdcast_component' as const, color: '#22c55e', label: 'BirdCast' },
  { key: 'solunar_component' as const, color: '#f59e0b', label: 'Solunar' },
  { key: 'water_component' as const, color: '#06b6d4', label: 'Water' },
  { key: 'pattern_component' as const, color: '#a855f7', label: 'Pattern' },
  { key: 'photoperiod_component' as const, color: '#6b7280', label: 'Photo' },
  { key: 'tide_component' as const, color: '#9ca3af', label: 'Tide' },
];

const MAX_SCORE = 135;

function Spark({ data, w = 32, h = 10 }: { data: number[]; w?: number; h?: number }) {
  if (!data || data.length < 2) return null;
  const mx = Math.max(...data), mn = Math.min(...data), rg = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - mn) / rg) * h}`).join(' ');
  const trending = data[data.length - 1] > data[0];
  const color = trending ? '#5eead4' : '#f59e0b';
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    </svg>
  );
}

function ConvictionDot({ arc, calibrationAccuracy }: { arc?: StateArc; calibrationAccuracy?: number }) {
  const accuracy = arc?.precedent_accuracy ?? calibrationAccuracy;
  if (accuracy == null) return <div className="w-[6px] h-[6px] rounded-full bg-white/[0.06] shrink-0" title="No history" />;
  const color = accuracy >= 60 ? '#22c55e' : accuracy >= 30 ? '#f59e0b' : '#ef4444';
  return (
    <div
      className="w-[6px] h-[6px] rounded-full shrink-0"
      style={{ backgroundColor: color, opacity: 0.8 }}
      title={`Conviction: ${Math.round(accuracy)}%`}
    />
  );
}

interface Props {
  scores: Map<string, ConvergenceScore>;
  selectedState: string | null;
  onSelectState: (abbr: string) => void;
  historyMap?: Map<string, number[]>;
  arcMap?: Map<string, StateArc>;
  calibrationMap?: Map<string, number>;
}

export default function ConvergenceScoreboard({ scores, selectedState, onSelectState, historyMap, arcMap, calibrationMap }: Props) {
  const [viewMode, setViewMode] = useState<'list' | 'scatter'>('list');
  const { timelapseActive, timelapseIndex, setTimelapseActive, setTimelapseIndex } = useDeck();
  const { availableDates, getScoresForDate } = useConvergenceTimeline(30);

  // When timelapse is active, build override scores from timeline data
  const effectiveScores = useMemo(() => {
    if (!timelapseActive || !availableDates.length || !getScoresForDate) return scores;
    const date = availableDates[timelapseIndex];
    if (!date) return scores;
    const stateScores = getScoresForDate(date);
    if (stateScores.size === 0) return scores;
    const map = new Map<string, ConvergenceScore>();
    let rank = 0;
    const entries = Array.from(stateScores.entries()).sort((a, b) => b[1] - a[1]);
    for (const [abbr, score] of entries) {
      rank++;
      map.set(abbr, {
        state_abbr: abbr,
        score,
        weather_component: 0,
        solunar_component: 0,
        migration_component: 0,
        pattern_component: 0,
        birdcast_component: 0,
        water_component: 0,
        photoperiod_component: 0,
        tide_component: 0,
        reasoning: '',
        national_rank: rank,
      });
    }
    return map;
  }, [timelapseActive, timelapseIndex, availableDates, getScoresForDate, scores]);

  const sorted = useMemo(() => {
    return Array.from(effectiveScores.values()).sort((a, b) => b.score - a.score);
  }, [effectiveScores]);

  if (sorted.length === 0) {
    return (
      <div className="h-full flex flex-col bg-[#0a0f1a] border-r border-white/[0.06]">
        <div className="px-3 py-2 border-b border-white/[0.06]">
          <h2 className="text-[10px] font-mono uppercase tracking-widest text-white/40" title="How many environmental signals are aligning in each state right now">Convergence</h2>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-[10px] font-mono text-white/20 animate-pulse">Loading scores...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0a0f1a] border-r border-white/[0.06]">
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between">
        <h2 className="text-[10px] font-mono uppercase tracking-widest text-white/40" title="How many environmental signals are aligning in each state right now">
          {timelapseActive && availableDates[timelapseIndex]
            ? <>Convergence <span className="text-cyan-400/60">{new Date(availableDates[timelapseIndex] + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span></>
            : 'Convergence'}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('list')}
            className={`p-0.5 rounded ${viewMode === 'list' ? 'text-white/50' : 'text-white/15 hover:text-white/30'}`}
            title="List view"
          >
            <List className="w-3 h-3" />
          </button>
          <button
            onClick={() => setViewMode('scatter')}
            className={`p-0.5 rounded ${viewMode === 'scatter' ? 'text-white/50' : 'text-white/15 hover:text-white/30'}`}
            title="Scatter view"
          >
            <ChartScatter className="w-3 h-3" />
          </button>
          <button
            onClick={() => {
              if (timelapseActive) {
                setTimelapseActive(false);
                setTimelapseIndex(0);
              } else {
                setTimelapseActive(true);
                setTimelapseIndex(0);
              }
            }}
            className={`p-0.5 rounded ${timelapseActive ? 'text-cyan-400/80' : 'text-white/15 hover:text-white/30'}`}
            title="Timelapse scrubber"
          >
            <Play className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Domain legend */}
      <div className="px-3 py-1.5 border-b border-white/[0.04] flex flex-wrap gap-x-2 gap-y-0.5">
        {DOMAINS.map(d => (
          <div key={d.key} className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: d.color, opacity: 0.8 }} />
            <span className="text-[8px] font-mono text-white/25">{d.label}</span>
          </div>
        ))}
      </div>

      {/* Scatter view */}
      {viewMode === 'scatter' && historyMap && arcMap && (
        <div className="flex-1 overflow-y-auto flex items-start justify-center pt-2">
          <PressureDifferential
            scores={effectiveScores}
            historyMap={historyMap}
            arcMap={arcMap}
            selectedState={selectedState}
            onSelectState={onSelectState}
          />
        </div>
      )}

      {/* State list */}
      <div className={`flex-1 overflow-y-auto ${viewMode === 'scatter' ? 'hidden' : ''}`}>
        {sorted.map((s, i) => {
          const isSelected = s.state_abbr === selectedState;
          const tier = s.score >= 80 ? 'critical' : s.score >= 50 ? 'elevated' : 'normal';
          const sparkData = historyMap?.get(s.state_abbr);
          const arc = arcMap?.get(s.state_abbr);
          const calAccuracy = calibrationMap?.get(s.state_abbr);

          return (
            <button
              key={s.state_abbr}
              onClick={() => onSelectState(s.state_abbr)}
              className={`w-full flex items-center gap-1 px-2 py-[5px] text-left transition-colors ${
                isSelected
                  ? 'bg-cyan-400/[0.08] border-l-2 border-l-cyan-400'
                  : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
              }`}
            >
              {/* Rank */}
              <span className="text-[10px] font-mono text-white/25 w-4 text-right shrink-0">
                {i + 1}
              </span>

              {/* Conviction dot */}
              <ConvictionDot arc={arc} calibrationAccuracy={calAccuracy} />

              {/* State abbreviation + arc phase dot */}
              <span className={`text-[11px] font-mono font-semibold shrink-0 ${
                tier === 'critical' ? 'text-red-400' :
                tier === 'elevated' ? 'text-amber-400' : 'text-white/50'
              }`}>
                {s.state_abbr}
                {arc && (
                  <span
                    className="inline-block w-1 h-1 rounded-full ml-0.5 align-super"
                    style={{ backgroundColor: arc.current_act === 'outcome' ? '#ef4444' : arc.current_act === 'recognition' ? '#f97316' : arc.current_act === 'buildup' ? '#f59e0b' : '#22c55e' }}
                    title={arc.current_act}
                  />
                )}
              </span>

              {/* Mini-bars */}
              <div className="flex-1 h-3 flex gap-px rounded-sm overflow-hidden bg-white/[0.03]">
                {DOMAINS.map(d => {
                  const val = s[d.key] || 0;
                  if (val <= 0) return null;
                  return (
                    <div
                      key={d.key}
                      className="h-full"
                      style={{
                        width: `${(val / MAX_SCORE) * 100}%`,
                        backgroundColor: d.color,
                        opacity: isSelected ? 0.9 : 0.7,
                      }}
                      title={`${d.label}: ${val.toFixed(1)}`}
                    />
                  );
                })}
              </div>

              {/* Sparkline */}
              <Spark data={sparkData || []} />

              {/* Score */}
              <span className={`text-[11px] font-mono font-bold w-7 text-right shrink-0 ${
                tier === 'critical' ? 'text-red-400' :
                tier === 'elevated' ? 'text-amber-400' : 'text-white/40'
              }`}>
                {Math.round(s.score)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
