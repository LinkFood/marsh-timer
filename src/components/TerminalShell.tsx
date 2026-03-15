import { useState } from 'react';
import type { Species } from '@/data/types';
import type { HuntAlert } from '@/hooks/useHuntAlerts';
import type { ConvergenceAlert } from '@/hooks/useConvergenceAlerts';
import type { FeatureCollection } from 'geojson';
import LiveTicker from './LiveTicker';
import CanvasTabs from './CanvasTabs';
import BrainPanel from './BrainPanel';

interface MurmurationData {
  index: number;
  change_pct: number;
  direction: 'up' | 'down' | 'flat';
  top_states: string[];
  spike_count: number;
  active_states: number;
}

interface TerminalShellProps {
  activeCanvas: 'map' | 'data' | 'history' | 'screener';
  onCanvasChange: (canvas: 'map' | 'data' | 'history' | 'screener') => void;

  species: Species;
  selectedState: string | null;
  level: 'national' | 'state' | 'zone';
  zoneSlug: string | null;
  onSelectState: (abbr: string) => void;
  onSelectZone: (slug: string) => void;
  onBack: () => void;
  onSwitchSpecies: (species: Species) => void;
  favorites: string[];
  onToggleFavorite: (species: Species, abbr: string) => void;
  isFavorite: boolean;
  alerts: HuntAlert[];
  weatherSnapshot?: Map<string, { temp: number; wind: number }>;
  convergenceTopStates?: Array<{
    state_abbr: string;
    score: number;
    reasoning: string;
    national_rank: number;
  }>;
  convergenceLoading?: boolean;
  convergenceScore?: {
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
  } | null;
  scoutReport?: { brief_text: string; created_at: string } | null;
  scoutReportLoading?: boolean;
  convergenceAlerts?: Array<{
    state_abbr: string;
    alert_type: string;
    message: string;
    score_before: number;
    score_after: number;
    created_at: string;
  }>;

  tickerConvergenceAlerts: ConvergenceAlert[];
  tickerWeatherEventsGeoJSON: FeatureCollection | null;
  tickerNWSAlertsGeoJSON: FeatureCollection | null;
  tickerHuntAlerts: HuntAlert[];
  tickerMurmurationIndex: MurmurationData | null;

  isMobile: boolean;

  children: React.ReactNode;
}

export default function TerminalShell({
  activeCanvas,
  onCanvasChange,
  species,
  selectedState,
  level,
  zoneSlug,
  onSelectState,
  onSelectZone,
  onBack,
  onSwitchSpecies,
  favorites,
  onToggleFavorite,
  isFavorite,
  alerts,
  weatherSnapshot,
  convergenceTopStates,
  convergenceLoading,
  convergenceScore,
  scoutReport,
  scoutReportLoading,
  convergenceAlerts,
  tickerConvergenceAlerts,
  tickerWeatherEventsGeoJSON,
  tickerNWSAlertsGeoJSON,
  tickerHuntAlerts,
  tickerMurmurationIndex,
  isMobile,
  children,
}: TerminalShellProps) {
  const [showBrain, setShowBrain] = useState(false);

  const brainPanelProps = {
    species,
    selectedState,
    level,
    zoneSlug,
    onSelectState,
    onSelectZone,
    onBack,
    onSwitchSpecies,
    favorites,
    onToggleFavorite,
    isFavorite,
    alerts,
    weatherSnapshot,
    convergenceTopStates,
    convergenceLoading,
    convergenceScore,
    scoutReport,
    scoutReportLoading,
    convergenceAlerts,
  } as const;

  const tickerProps = {
    convergenceAlerts: tickerConvergenceAlerts,
    weatherEventsGeoJSON: tickerWeatherEventsGeoJSON,
    nwsAlertsGeoJSON: tickerNWSAlertsGeoJSON,
    huntAlerts: tickerHuntAlerts,
    murmurationIndex: tickerMurmurationIndex,
  } as const;

  if (isMobile) {
    return (
      <>
        {/* Ticker — fixed bar below header */}
        <div className="fixed top-12 left-0 right-0 z-20">
          <LiveTicker {...tickerProps} />
        </div>

        {/* Canvas area — children (map overlays) float via their own fixed positioning */}
        {children}

        {/* Bottom tabs */}
        <CanvasTabs
          active={activeCanvas}
          onChange={onCanvasChange}
          isMobile={true}
          showBrain={showBrain}
          onToggleBrain={() => setShowBrain(b => !b)}
        />

        {/* Mobile brain overlay */}
        {showBrain && (
          <BrainPanel
            {...brainPanelProps}
            isMobile={true}
            onClose={() => setShowBrain(false)}
          />
        )}
      </>
    );
  }

  // Desktop
  return (
    <>
      {/* Ticker — fixed bar below header */}
      <div className="fixed top-12 left-0 right-0 z-20">
        <LiveTicker {...tickerProps} />
      </div>

      {/* Canvas tabs — fixed below ticker */}
      <div className="fixed left-0 right-0 z-20" style={{ top: 'calc(48px + 28px)' }}>
        <CanvasTabs
          active={activeCanvas}
          onChange={onCanvasChange}
          isMobile={false}
        />
      </div>

      {/* Brain panel — fixed left, below tabs */}
      <div
        className="fixed left-0 bottom-0 z-20 w-80 overflow-hidden glass-panel border-r border-white/[0.06]"
        style={{ top: 'calc(48px + 28px + 36px)' }}
      >
        <BrainPanel {...brainPanelProps} />
      </div>

      {/* Canvas area — children (map overlays) float via their own fixed positioning */}
      {children}
    </>
  );
}
