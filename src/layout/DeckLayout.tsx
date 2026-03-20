import type { ReactNode } from 'react';
import type { ConvergenceAlert } from '@/hooks/useConvergenceAlerts';
import type { HuntAlert } from '@/hooks/useHuntAlerts';
import type { FeatureCollection } from 'geojson';
import ErrorBoundary from '@/components/ErrorBoundary';
import BrainHeartbeat from '@/components/BrainHeartbeat';
import { useIsMobile } from '@/hooks/useIsMobile';
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
  huntAlerts: HuntAlert[];
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

  // Explicit grid: heartbeat 28px, map 45%, panels fill rest, bottom bar 40px
  const gridRows = isMobile
    ? '28px 40% 1fr 40px'
    : '28px 45% 1fr 40px';

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

      {/* Row 2: Map */}
      <div className="overflow-hidden relative">
        <ErrorBoundary fallback={<div className="h-full bg-red-900/10 flex items-center justify-center"><span className="text-[10px] text-red-400">Map region error</span></div>}>
          <MapRegion>{children}</MapRegion>
        </ErrorBoundary>
      </div>

      {/* Row 3: Panel dock */}
      <div className="overflow-hidden">
        <ErrorBoundary fallback={<div className="h-full flex items-center justify-center"><span className="text-[10px] text-red-400">Panel dock error</span></div>}>
          {isMobile ? <PanelDockMobile /> : <PanelDock />}
        </ErrorBoundary>
      </div>

      {/* Row 4: Bottom bar */}
      <BottomBar />

      {/* Slide-out overlays (positioned absolutely, outside grid flow) */}
      <ChatPanel />
      <LayerPicker />
    </div>
  );
}
