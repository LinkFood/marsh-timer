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

  return (
    <div className="h-full w-full overflow-hidden flex flex-col bg-[#0a0f1a]">
      {/* BrainHeartbeat — fixed height */}
      <div className="shrink-0">
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

      {/* Map region — resizable height */}
      <ErrorBoundary fallback={<div className="h-64 bg-red-900/10 flex items-center justify-center"><span className="text-[10px] text-red-400">Map region error</span></div>}>
        <MapRegion>{children}</MapRegion>
      </ErrorBoundary>

      {/* Panel dock — fills remaining space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ErrorBoundary fallback={<div className="h-full flex items-center justify-center"><span className="text-[10px] text-red-400">Panel dock error</span></div>}>
          {isMobile ? <PanelDockMobile /> : <PanelDock />}
        </ErrorBoundary>
      </div>

      {/* Bottom bar */}
      <BottomBar />

      {/* Slide-out panels */}
      <ChatPanel />
      <LayerPicker />
    </div>
  );
}
