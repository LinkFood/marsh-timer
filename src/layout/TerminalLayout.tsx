import { useMemo, type ReactNode } from 'react';
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
  calibrationByState,
  onSelectState,
  children,
}: TerminalLayoutProps) {
  const { selectedState } = useDeck();

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

        {/* Center: Map */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 relative overflow-hidden min-h-0">
            <ErrorBoundary fallback={<div className="h-full bg-red-900/10 flex items-center justify-center"><span className="text-[10px] text-red-400">Map error</span></div>}>
              <div className="absolute inset-0">
                {children}
              </div>
            </ErrorBoundary>
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
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <p className="text-[11px] font-mono text-white/20 tracking-wide">Select a state</p>
            </div>
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
