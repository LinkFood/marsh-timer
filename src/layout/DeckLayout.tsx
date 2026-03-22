import type { ReactNode } from 'react';
import type { ConvergenceAlert } from '@/hooks/useConvergenceAlerts';
import type { PatternAlert } from '@/hooks/usePatternAlerts';
import type { FeatureCollection } from 'geojson';
import ErrorBoundary from '@/components/ErrorBoundary';
import BrainHeartbeat from '@/components/BrainHeartbeat';
import EventTicker from '@/components/EventTicker';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useDeck } from '@/contexts/DeckContext';
import MapRegion from './MapRegion';
import PanelDock from './PanelDock';
import PanelDockMobile from './PanelDockMobile';
import BottomBar from './BottomBar';
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

interface DeckLayoutProps {
  convergenceAlerts: ConvergenceAlert[];
  weatherEventsGeoJSON: FeatureCollection | null;
  nwsAlertsGeoJSON: FeatureCollection | null;
  huntAlerts: PatternAlert[];
  murmurationIndex: MurmurationData | null;
  children: ReactNode;
}

export default function DeckLayout({
  convergenceAlerts,
  weatherEventsGeoJSON,
  nwsAlertsGeoJSON,
  huntAlerts,
  murmurationIndex,
  children,
}: DeckLayoutProps) {
  const isMobile = useIsMobile();
  const { gridPreset, panelsCollapsed, mapHeight } = useDeck();

  // Side-by-side: map left (60%), panels right (40%) — desktop only
  if (gridPreset === 'side-by-side' && !isMobile) {
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

        {/* Main: Map left (60%) + Panels right (40%) */}
        <div className="flex-1 flex overflow-hidden">
          <div className="w-[60%] relative overflow-hidden">
            <ErrorBoundary fallback={<div className="h-full bg-red-900/10 flex items-center justify-center"><span className="text-[10px] text-red-400">Map region error</span></div>}>
              <MapRegion>{children}</MapRegion>
            </ErrorBoundary>
          </div>
          <div className="w-[40%] overflow-hidden border-l border-white/[0.06]">
            <ErrorBoundary fallback={<div className="h-full flex items-center justify-center"><span className="text-[10px] text-red-400">Panel dock error</span></div>}>
              <PanelDock />
            </ErrorBoundary>
          </div>
        </div>

        {/* Bottom bar */}
        <BottomBar />

        {/* Overlays */}
        <ChatPanel />
        <ErrorBoundary fallback={<div />}>
          <LayerPicker />
        </ErrorBoundary>
      </div>
    );
  }

  // Explicit grid: heartbeat 28px, ticker 32px, map, panels fill rest, bottom bar 40px
  const mapRow = (() => {
    if (gridPreset === 'equal-grid') return '0px';
    if (panelsCollapsed) return '1fr';
    if (gridPreset === 'map-focus') return isMobile ? '50%' : '65%';
    if (gridPreset === 'side-by-side') return '100%';
    return `${mapHeight}px`;
  })();
  const panelRow = panelsCollapsed ? '0px' : '1fr';
  const gridRows = `28px 32px ${mapRow} ${panelRow} 40px`;

  return (
    <div
      className="h-full w-full overflow-hidden bg-[#0a0f1a]"
      style={{ display: 'grid', gridTemplateRows: gridRows }}
    >
      {/* Row 1: BrainHeartbeat */}
      <div className="overflow-hidden">
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
      <div className="overflow-hidden">
        <EventTicker
          convergenceAlerts={convergenceAlerts}
          weatherEventsGeoJSON={weatherEventsGeoJSON}
          nwsAlertsGeoJSON={nwsAlertsGeoJSON}
        />
      </div>

      {/* Row 3: Map */}
      <div className="overflow-hidden relative">
        <ErrorBoundary fallback={<div className="h-full bg-red-900/10 flex items-center justify-center"><span className="text-[10px] text-red-400">Map region error</span></div>}>
          <MapRegion>{children}</MapRegion>
        </ErrorBoundary>
      </div>

      {/* Row 4: Panel dock */}
      <div className="overflow-hidden">
        <ErrorBoundary fallback={<div className="h-full flex items-center justify-center"><span className="text-[10px] text-red-400">Panel dock error</span></div>}>
          {isMobile ? <PanelDockMobile /> : <PanelDock />}
        </ErrorBoundary>
      </div>

      {/* Row 5: Bottom bar */}
      <BottomBar />

      {/* Slide-out overlays (positioned absolutely, outside grid flow) */}
      <ChatPanel />
      <ErrorBoundary fallback={<div />}>
        <LayerPicker />
      </ErrorBoundary>
    </div>
  );
}
