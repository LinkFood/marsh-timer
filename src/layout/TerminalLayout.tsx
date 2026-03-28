import { useMemo, useState, type ReactNode } from 'react';
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
import { useDeck } from '@/contexts/DeckContext';
import ChatPanel from '@/panels/ChatPanel';
import LayerPicker from '@/layers/LayerPicker';

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
          {/* Bottom: Fusion/Collision toggle (state selected) or national feed (no state) */}
          <div className="h-[200px] shrink-0 flex flex-col border-t border-white/[0.06]">
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
                    <CollisionFeed convergenceAlerts={convergenceAlerts} stateFilter={selectedState} />
                  )}
                </div>
              </>
            ) : (
              <CollisionFeed convergenceAlerts={convergenceAlerts} />
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

const DOMAIN_KEYS = [
  { key: 'weather_component', label: 'Weather' },
  { key: 'migration_component', label: 'Migration' },
  { key: 'birdcast_component', label: 'BirdCast' },
  { key: 'solunar_component', label: 'Solunar' },
  { key: 'water_component', label: 'Water' },
  { key: 'pattern_component', label: 'Pattern' },
] as const;

function EmptyStatePreview({ scores, arcs, onSelectState }: { scores: Map<string, ConvergenceScore>; arcs: StateArc[]; onSelectState: (abbr: string) => void }) {
  const top3 = useMemo(() => {
    const sorted = Array.from(scores.values()).sort((a, b) => b.score - a.score);
    return sorted.slice(0, 3).map(s => {
      const arc = arcs.find(a => a.state_abbr === s.state_abbr);
      let dominant = 'Weather';
      let maxVal = 0;
      for (const d of DOMAIN_KEYS) {
        const val = (s as any)[d.key] || 0;
        if (val > maxVal) { maxVal = val; dominant = d.label; }
      }
      return { ...s, arc, dominant };
    });
  }, [scores, arcs]);

  if (top3.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[11px] font-mono text-white/20 tracking-wide">Loading...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-white/[0.06]">
        <span className="text-[9px] font-mono text-white/25 uppercase tracking-widest">Hottest States</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {top3.map((s, i) => {
          const tierColor = s.score >= 80 ? 'text-red-400' : s.score >= 50 ? 'text-amber-400' : 'text-white/50';
          return (
            <button
              key={s.state_abbr}
              onClick={() => onSelectState(s.state_abbr)}
              className="w-full px-3 py-2.5 text-left hover:bg-white/[0.03] transition-colors border-b border-white/[0.03]"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-sm font-mono font-bold text-white/80">{s.state_abbr}</span>
                <span className={`text-sm font-mono font-bold ${tierColor}`}>{Math.round(s.score)}</span>
              </div>
              <div className="flex items-center gap-2 text-[9px] font-mono text-white/25">
                <span>Top: {s.dominant}</span>
                {s.arc && <span className="text-cyan-400/40">{s.arc.current_act}</span>}
              </div>
            </button>
          );
        })}
      </div>
      <div className="px-3 py-2 border-t border-white/[0.06]">
        <p className="text-[9px] font-mono text-white/15 text-center">Select a state for details</p>
      </div>
    </div>
  );
}
