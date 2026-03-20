import type { ReactNode } from 'react';
import type { ConvergenceAlert } from '@/hooks/useConvergenceAlerts';
import type { HuntAlert } from '@/hooks/useHuntAlerts';
import type { FeatureCollection } from 'geojson';
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
        <BrainHeartbeat
          convergenceAlerts={convergenceAlerts}
          weatherEventsGeoJSON={weatherEventsGeoJSON}
          nwsAlertsGeoJSON={nwsAlertsGeoJSON}
          huntAlerts={huntAlerts}
          murmurationIndex={murmurationIndex}
        />
      </div>

      {/* Map region — resizable height */}
      <MapRegion>{children}</MapRegion>

      {/* Panel dock — fills remaining space */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {isMobile ? <PanelDockMobile /> : <PanelDock />}
      </div>

      {/* Bottom bar */}
      <BottomBar />

      {/* Slide-out panels */}
      <ChatPanel />
      <LayerPicker />
    </div>
  );
}
