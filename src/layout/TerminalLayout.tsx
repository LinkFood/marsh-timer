import { type ReactNode } from 'react';
import type { ConvergenceAlert } from '@/hooks/useConvergenceAlerts';
import type { PatternAlert } from '@/hooks/usePatternAlerts';
import type { ConvergenceScore } from '@/hooks/useConvergenceScores';
import type { FeatureCollection } from 'geojson';
import ErrorBoundary from '@/components/ErrorBoundary';
import BrainHeartbeat from '@/components/BrainHeartbeat';
import EventTicker from '@/components/EventTicker';
import ConvergenceScoreboard from '@/components/ConvergenceScoreboard';
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
  onSelectState,
  children,
}: TerminalLayoutProps) {
  const { selectedState } = useDeck();

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

      {/* Row 2: EventTicker */}
      <div className="shrink-0 overflow-hidden">
        <EventTicker
          convergenceAlerts={convergenceAlerts}
          weatherEventsGeoJSON={weatherEventsGeoJSON}
          nwsAlertsGeoJSON={nwsAlertsGeoJSON}
        />
      </div>

      {/* Row 3: Three-column terminal */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: Convergence Scoreboard */}
        <div className="w-[280px] shrink-0 overflow-hidden">
          <ConvergenceScoreboard
            scores={convergenceScores}
            selectedState={selectedState}
            onSelectState={onSelectState}
          />
        </div>

        {/* Center: Map + Fusion Panel (Phase 3) */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="flex-1 relative overflow-hidden min-h-0">
            <ErrorBoundary fallback={<div className="h-full bg-red-900/10 flex items-center justify-center"><span className="text-[10px] text-red-400">Map error</span></div>}>
              <div className="absolute inset-0">
                {children}
              </div>
            </ErrorBoundary>
          </div>
        </div>

        {/* Right: State Detail (Phase 2 placeholder) */}
        <div className="w-[320px] shrink-0 overflow-y-auto border-l border-white/[0.06]">
          {selectedState ? (
            <StateDetailPlaceholder
              state={selectedState}
              score={convergenceScores.get(selectedState)}
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

function StateDetailPlaceholder({ state, score }: { state: string; score?: ConvergenceScore }) {
  if (!score) {
    return (
      <div className="p-3">
        <div className="text-lg font-mono font-bold text-white/90">{state}</div>
        <div className="text-[10px] font-mono text-white/30 mt-1">No convergence data</div>
      </div>
    );
  }

  const tier = score.score >= 80 ? 'CRITICAL' : score.score >= 50 ? 'ELEVATED' : 'NORMAL';
  const tierColor = score.score >= 80 ? 'text-red-400' : score.score >= 50 ? 'text-amber-400' : 'text-white/50';

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="text-lg font-mono font-bold text-white/90">{state}</div>
        <div className="text-right">
          <div className={`text-2xl font-mono font-bold ${tierColor}`}>{Math.round(score.score)}</div>
          <div className={`text-[9px] font-mono tracking-widest ${tierColor}`}>{tier}</div>
        </div>
      </div>

      {/* Arc Phase placeholder */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">Arc</span>
        <div className="flex gap-1">
          {['Buildup', 'Recognition', 'Outcome', 'Grade'].map((phase, i) => (
            <div key={phase} className="flex items-center gap-1">
              <div className={`w-2 h-2 rounded-full ${i === 0 ? 'bg-cyan-400' : 'bg-white/10'}`} />
              <span className="text-[8px] font-mono text-white/20">{phase}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 8-Component Grid */}
      <div>
        <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-2">Components</div>
        <div className="grid grid-cols-2 gap-1">
          {[
            { label: 'Weather', value: score.weather_component, max: 25, color: '#ef4444' },
            { label: 'Migration', value: score.migration_component, max: 25, color: '#3b82f6' },
            { label: 'BirdCast', value: score.birdcast_component, max: 20, color: '#22c55e' },
            { label: 'Solunar', value: score.solunar_component, max: 15, color: '#f59e0b' },
            { label: 'Water', value: score.water_component, max: 15, color: '#06b6d4' },
            { label: 'Pattern', value: score.pattern_component, max: 15, color: '#a855f7' },
            { label: 'Photoperiod', value: score.photoperiod_component, max: 10, color: '#6b7280' },
            { label: 'Tide', value: score.tide_component, max: 10, color: '#9ca3af' },
          ].map(d => (
            <div key={d.label} className="flex items-center gap-1.5 py-0.5">
              <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
              <span className="text-[10px] font-mono text-white/40 w-16 truncate">{d.label}</span>
              <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${(d.value / d.max) * 100}%`,
                    backgroundColor: d.color,
                    opacity: 0.7,
                  }}
                />
              </div>
              <span className="text-[10px] font-mono text-white/30 w-4 text-right">{Math.round(d.value)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Reasoning */}
      {score.reasoning && (
        <div>
          <div className="text-[9px] font-mono text-white/30 uppercase tracking-widest mb-1">Analysis</div>
          <p className="text-[11px] font-mono text-white/50 leading-relaxed">{score.reasoning}</p>
        </div>
      )}
    </div>
  );
}
