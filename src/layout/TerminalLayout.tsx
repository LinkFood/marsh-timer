import { useMemo, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { GripHorizontal } from 'lucide-react';
import type { ConvergenceAlert } from '@/hooks/useConvergenceAlerts';
import type { PatternAlert } from '@/hooks/usePatternAlerts';
import type { ConvergenceScore } from '@/hooks/useConvergenceScores';
import type { StateArc } from '@/hooks/useStateArcs';
import type { StateBrief } from '@/hooks/useStateBrief';
import type { AggregatedState } from '@/hooks/useAlertCalibration';
import type { FeatureCollection } from 'geojson';
import ErrorBoundary from '@/components/ErrorBoundary';
import BrainHeartbeat from '@/components/BrainHeartbeat';
import EventTicker from '@/components/EventTicker';
import RegimeDetector from '@/components/RegimeDetector';
import ConvergenceScoreboard from '@/components/ConvergenceScoreboard';
import StateDetailPanel from '@/components/StateDetailPanel';
import FusionPanel from '@/components/FusionPanel';
import CollisionFeed from '@/components/CollisionFeed';
import { useOpsData } from '@/hooks/useOpsData';
import { useDataSourceHealth } from '@/hooks/useDataSourceHealth';
import { useDeck } from '@/contexts/DeckContext';
import ChatPanel from '@/panels/ChatPanel';
import LayerPicker from '@/layers/LayerPicker';
import { useTrackRecord } from '@/hooks/useTrackRecord';
import BrainReportCard from '@/components/BrainReportCard';
import RecentGradesFeed from '@/components/RecentGradesFeed';
import LatestPostMortem from '@/components/LatestPostMortem';
import DailyBrief from '@/components/DailyBrief';

interface MurmurationData {
  index: number;
  change_pct: number;
  direction: 'up' | 'down' | 'flat';
  top_states: string[];
  spike_count: number;
  active_states: number;
}

interface TerminalLayoutProps {
  convergenceAlerts: ConvergenceAlert[];
  weatherEventsGeoJSON: FeatureCollection | null;
  nwsAlertsGeoJSON: FeatureCollection | null;
  huntAlerts: PatternAlert[];
  murmurationIndex: MurmurationData | null;
  convergenceScores: Map<string, ConvergenceScore>;
  stateArcs: StateArc[];
  stateBrief: StateBrief | null;
  briefLoading: boolean;
  convergenceHistoryMap: Map<string, number[]>;
  stateConvergenceHistory: Array<{ date: string; score: number; weather_component: number; solunar_component: number; migration_component: number; pattern_component: number; birdcast_component: number; water_component: number; photoperiod_component: number; tide_component: number }>;
  calibrationByState: AggregatedState[];
  onSelectState: (abbr: string) => void;
  children: ReactNode;
}

export default function TerminalLayout({
  convergenceAlerts,
  weatherEventsGeoJSON,
  nwsAlertsGeoJSON,
  huntAlerts,
  murmurationIndex,
  convergenceScores,
  stateArcs,
  stateBrief,
  briefLoading,
  convergenceHistoryMap,
  stateConvergenceHistory,
  calibrationByState,
  onSelectState,
  children,
}: TerminalLayoutProps) {
  const { selectedState } = useDeck();

  const [centerTab, setCenterTab] = useState<'timeline' | 'collisions'>('collisions');
  const [feedHeight, setFeedHeight] = useState<number>(() => {
    try { const v = localStorage.getItem('dc-feed-height'); if (v) { const n = Number(v); if (n >= 120 && n <= 600) return n; } } catch {}
    return 340;
  });
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    startY.current = e.clientY;
    startH.current = feedHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [feedHeight]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startY.current - e.clientY;
      const next = Math.max(120, Math.min(600, startH.current + delta));
      setFeedHeight(next);
    };
    const onUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('dc-feed-height', String(feedHeight)); } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [feedHeight]);

  const arcForState = useMemo(() => {
    if (!selectedState) return undefined;
    return stateArcs.find(a => a.state_abbr === selectedState);
  }, [stateArcs, selectedState]);

  const arcMap = useMemo(() => {
    const map = new Map<string, StateArc>();
    for (const a of stateArcs) map.set(a.state_abbr, a);
    return map;
  }, [stateArcs]);

  const calibrationMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of calibrationByState) map.set(s.state_abbr, s.accuracy);
    return map;
  }, [calibrationByState]);

  return (
    <div className="h-full w-full overflow-hidden bg-[#0a0f1a] flex flex-col">
      {/* Row 1: BrainHeartbeat */}
      <div className="shrink-0 overflow-hidden">
        <ErrorBoundary fallback={<div className="h-7 bg-red-900/20 flex items-center px-3"><span className="text-[10px] text-red-400">Heartbeat error</span></div>}>
          <BrainHeartbeat
            convergenceAlerts={convergenceAlerts}
            weatherEventsGeoJSON={weatherEventsGeoJSON}
            nwsAlertsGeoJSON={nwsAlertsGeoJSON}
            huntAlerts={huntAlerts}
            murmurationIndex={murmurationIndex}
          />
        </ErrorBoundary>
      </div>

      {/* Row 2: Regime Detector */}
      <RegimeDetector scores={convergenceScores} arcs={stateArcs} />

      {/* Row 3: EventTicker */}
      <div className="shrink-0 overflow-hidden">
        <EventTicker
          convergenceAlerts={convergenceAlerts}
          weatherEventsGeoJSON={weatherEventsGeoJSON}
          nwsAlertsGeoJSON={nwsAlertsGeoJSON}
        />
      </div>

      {/* Row 4: Three-column terminal */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: Convergence Scoreboard */}
        <div className="w-[280px] shrink-0 overflow-hidden">
          <ConvergenceScoreboard
            scores={convergenceScores}
            selectedState={selectedState}
            onSelectState={onSelectState}
            historyMap={convergenceHistoryMap}
            arcMap={arcMap}
            calibrationMap={calibrationMap}
          />
        </div>

        {/* Center: Map + Fusion Panel */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 relative overflow-hidden min-h-0">
            <ErrorBoundary fallback={<div className="h-full bg-red-900/10 flex items-center justify-center"><span className="text-[10px] text-red-400">Map error</span></div>}>
              <div className="absolute inset-0">
                {children}
              </div>
            </ErrorBoundary>
          </div>
          {/* Drag divider */}
          <div
            className="shrink-0 h-2 flex items-center justify-center cursor-row-resize z-20 group border-t border-white/[0.06]"
            onMouseDown={onDragStart}
          >
            <div className="w-8 h-3 flex items-center justify-center rounded-sm bg-white/[0.03] group-hover:bg-cyan-400/10 transition-colors">
              <GripHorizontal className="w-3 h-3 text-white/15 group-hover:text-cyan-400/40" />
            </div>
          </div>

          {/* Bottom: Fusion/Collision panel (resizable) */}
          <div className="shrink-0 flex flex-col overflow-hidden" style={{ height: feedHeight }}>
            {selectedState ? (
              <>
                <div className="shrink-0 flex gap-0.5 px-2 py-1 border-b border-white/[0.04]">
                  <button
                    onClick={() => setCenterTab('timeline')}
                    className={`px-2 py-0.5 rounded text-[8px] font-mono uppercase tracking-wider ${centerTab === 'timeline' ? 'bg-white/[0.08] text-white/60' : 'text-white/20 hover:text-white/35'}`}
                  >Timeline</button>
                  <button
                    onClick={() => setCenterTab('collisions')}
                    className={`px-2 py-0.5 rounded text-[8px] font-mono uppercase tracking-wider ${centerTab === 'collisions' ? 'bg-white/[0.08] text-white/60' : 'text-white/20 hover:text-white/35'}`}
                  >Collisions</button>
                </div>
                <div className="flex-1 overflow-hidden">
                  {centerTab === 'timeline' && stateConvergenceHistory.length > 0 ? (
                    <FusionPanel history={stateConvergenceHistory} state={selectedState} />
                  ) : (
                    <CollisionFeed convergenceAlerts={convergenceAlerts} stateFilter={selectedState} onSelectState={onSelectState} />
                  )}
                </div>
              </>
            ) : (
              <CollisionFeed convergenceAlerts={convergenceAlerts} onSelectState={onSelectState} />
            )}
          </div>
        </div>

        {/* Right: State Detail */}
        <div className="w-[320px] shrink-0 overflow-hidden border-l border-white/[0.06]">
          {selectedState ? (
            <StateDetailPanel
              state={selectedState}
              score={convergenceScores.get(selectedState)}
              arc={arcForState}
              brief={stateBrief}
              briefLoading={briefLoading}
              calibrationByState={calibrationByState}
            />
          ) : (
            <EmptyStatePreview
              scores={convergenceScores}
              arcs={stateArcs}
              onSelectState={onSelectState}
            />
          )}
        </div>
      </div>

      {/* Overlays */}
      <ChatPanel />
      <ErrorBoundary fallback={<div />}>
        <LayerPicker />
      </ErrorBoundary>
    </div>
  );
}

const MINI_BAR_DOMAINS = [
  { key: 'weather_component', color: '#ef4444', label: 'Weather', max: 25 },
  { key: 'migration_component', color: '#3b82f6', label: 'Migration', max: 25 },
  { key: 'birdcast_component', color: '#22c55e', label: 'BirdCast', max: 20 },
  { key: 'solunar_component', color: '#f59e0b', label: 'Solunar', max: 15 },
  { key: 'water_component', color: '#06b6d4', label: 'Water', max: 15 },
  { key: 'pattern_component', color: '#a855f7', label: 'Pattern', max: 15 },
] as const;

const ACT_COLORS: Record<string, string> = {
  buildup: '#f59e0b',
  recognition: '#f97316',
  outcome: '#ef4444',
  grade: '#22c55e',
};

function EmptyStatePreview({ scores, arcs, onSelectState }: { scores: Map<string, ConvergenceScore>; arcs: StateArc[]; onSelectState: (abbr: string) => void }) {
  const top5 = useMemo(() => {
    const sorted = Array.from(scores.values()).sort((a, b) => b.score - a.score);
    return sorted.slice(0, 5).map(s => {
      const arc = arcs.find(a => a.state_abbr === s.state_abbr);
      const outcomeCount = arc?.outcome_signals ? (arc.outcome_signals as unknown[]).length : 0;
      const expectedCount = arc?.recognition_claim ? ((arc.recognition_claim as any).expected_signals?.length || 3) : 0;
      return { ...s, arc, outcomeCount, expectedCount };
    });
  }, [scores, arcs]);

  if (top5.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[11px] font-mono text-white/20 tracking-wide">Loading...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <DailyBrief scores={scores} arcs={arcs} />
      <div className="px-3 py-2 border-b border-white/[0.06]">
        <span className="text-[9px] font-mono text-white/25 uppercase tracking-widest">Hottest States</span>
      </div>
      <div className="flex-1 overflow-y-auto min-h-0">
        {top5.map(s => {
          const tierColor = s.score >= 80 ? 'text-red-400' : s.score >= 50 ? 'text-amber-400' : 'text-white/50';
          const actColor = s.arc ? ACT_COLORS[s.arc.current_act] || '#6b7280' : undefined;
          return (
            <button
              key={s.state_abbr}
              onClick={() => onSelectState(s.state_abbr)}
              className="w-full px-3 py-2 text-left hover:bg-white/[0.03] transition-colors border-b border-white/[0.03]"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-bold text-white/80">{s.state_abbr}</span>
                  {s.arc && (
                    <span
                      className="text-[7px] font-mono uppercase tracking-wider px-1 py-px rounded"
                      style={{ color: actColor, backgroundColor: `${actColor}20` }}
                    >
                      {s.arc.current_act}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {s.arc?.current_act === 'outcome' && (
                    <span className="text-[8px] font-mono text-emerald-400/50">{s.outcomeCount}/{s.expectedCount}</span>
                  )}
                  <span className={`text-sm font-mono font-bold ${tierColor}`}>{Math.round(s.score)}</span>
                </div>
              </div>
              {/* Mini-bars */}
              <div className="h-2.5 flex gap-px rounded-sm overflow-hidden bg-white/[0.03]">
                {MINI_BAR_DOMAINS.map(d => {
                  const val = (s as any)[d.key] || 0;
                  if (val <= 0) return null;
                  return (
                    <div
                      key={d.key}
                      className="h-full"
                      style={{ width: `${(val / 135) * 100}%`, backgroundColor: d.color, opacity: 0.6 }}
                    />
                  );
                })}
              </div>
              {/* Narrative snippet */}
              {s.arc?.narrative && (
                <p className="text-[8px] font-mono text-white/20 mt-1 line-clamp-1">
                  {s.arc.narrative.replace(/\*\*/g, '').slice(0, 80)}...
                </p>
              )}
            </button>
          );
        })}
      </div>

      {/* Brain intelligence sections */}
      <BrainReportCard />
      <LatestPostMortem />
      <RecentGradesFeed />

      {/* Brain Vitals + Data Freshness */}
      <BrainVitals />

      <div className="px-3 py-2 border-t border-white/[0.06] flex items-center justify-between">
        <p className="text-[9px] font-mono text-white/15">Select a state for details</p>
        <Link to="/ops" className="text-[8px] font-mono text-cyan-400/30 hover:text-cyan-400/60 transition-colors">
          System health →
        </Link>
      </div>
    </div>
  );
}

function BrainVitals() {
  const { data: opsData } = useOpsData();
  const { sources } = useDataSourceHealth();
  const { totalGraded, bySource } = useTrackRecord();

  const brain = opsData?.brain;
  const crons = opsData?.crons;
  const staleSources = sources.filter(s => s.status === 'stale' || s.status === 'error');
  const onlineCount = sources.filter(s => s.status === 'online').length;

  if (!brain?.total) {
    return (
      <div className="shrink-0 border-t border-white/[0.06] px-3 py-2">
        <div className="text-[9px] font-mono text-white/15 animate-pulse">Loading brain vitals...</div>
      </div>
    );
  }

  const cronColor = (crons?.healthy_count || 0) > 35 ? '#22c55e' : (crons?.healthy_count || 0) > 30 ? '#f59e0b' : '#ef4444';

  return (
    <div className="shrink-0 border-t border-white/[0.06]">
      {/* Brain stats */}
      <div className="px-3 py-2 space-y-1">
        <div className="text-[9px] font-mono text-white/25 uppercase tracking-widest">Brain</div>
        <div className="text-[9px] font-mono text-white/35">
          {brain.total.toLocaleString()} entries · <span className="text-emerald-400/50">+{brain.growth_today.toLocaleString()}</span> today · {brain.content_types?.length || '?'} types
        </div>
        {totalGraded > 0 && (() => {
          const acc = bySource.length > 0 ? Math.round(bySource.reduce((s, src) => s + src.accuracy * src.total, 0) / bySource.reduce((s, src) => s + src.total, 0)) : 0;
          return (
            <div className="text-[9px] font-mono text-white/25">
              ACCURACY <span style={{ color: acc >= 60 ? '#22c55e' : '#f59e0b' }}>{acc}%</span> · {totalGraded} graded
            </div>
          );
        })()}
        <div className="text-[9px] font-mono text-white/25">
          <span style={{ color: cronColor }}>CRONS {crons?.healthy_count || 0}/{(crons?.healthy_count || 0) + (crons?.error_count || 0) + (crons?.late_count || 0)}</span>
          {crons?.error_count ? <span className="text-red-400/50 ml-2">{crons.error_count} errors</span> : null}
        </div>
      </div>

      {/* Data freshness */}
      {(staleSources.length > 0 || onlineCount > 0) && (
        <div className="px-3 pb-2 space-y-0.5">
          <div className="text-[9px] font-mono text-white/25 uppercase tracking-widest">Data Freshness</div>
          {staleSources.map(s => (
            <div key={s.name} className="flex items-center gap-1.5 text-[8px] font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
              <span className="text-red-400/50">{s.name}</span>
              <span className="text-white/15">{s.status.toUpperCase()}</span>
            </div>
          ))}
          {onlineCount > 0 && (
            <div className="flex items-center gap-1.5 text-[8px] font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
              <span className="text-emerald-400/30">{onlineCount} sources online</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
