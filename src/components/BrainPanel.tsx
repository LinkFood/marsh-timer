import { useState } from 'react';
import { Database, ChevronDown, ChevronUp, X, ArrowLeft } from 'lucide-react';
import type { Species } from '@/data/types';
import type { HuntAlert } from '@/hooks/useHuntAlerts';
import HuntChat from './HuntChat';
import ScoutReport from './ScoutReport';
import HotspotRanking from './HotspotRanking';
import ConvergenceCard from './cards/ConvergenceCard';
import StateView from './StateView';
import ZoneView from './ZoneView';
import ErrorBoundary from './ErrorBoundary';

interface BrainPanelProps {
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
  isMobile?: boolean;
  onClose?: () => void;
}

export default function BrainPanel({
  species,
  selectedState,
  level,
  zoneSlug,
  onSelectState,
  onSelectZone,
  onBack,
  onSwitchSpecies,
  onToggleFavorite,
  isFavorite,
  convergenceTopStates,
  convergenceLoading,
  convergenceScore,
  scoutReport,
  scoutReportLoading,
  convergenceAlerts,
  isMobile,
  onClose,
}: BrainPanelProps) {
  const [intelOpen, setIntelOpen] = useState(true);
  const isWaterfowl = species === 'duck' || species === 'goose';

  const containerClass = isMobile
    ? 'fixed inset-0 top-12 z-40 glass-panel flex flex-col'
    : 'h-full flex flex-col';

  return (
    <div className={containerClass}>
      {/* Header */}
      <div className="h-7 flex items-center px-3 border-b border-white/[0.06] shrink-0">
        {level !== 'national' ? (
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-white/60 hover:text-white/80 transition-colors"
          >
            <ArrowLeft size={12} />
            <span className="text-[11px] font-display font-bold text-white/90 uppercase">
              {selectedState}
            </span>
          </button>
        ) : (
          <>
            <Database size={14} className="text-cyan-400" />
            <span className="text-[10px] font-display tracking-widest text-white/60 ml-1.5">
              BRAIN
            </span>
          </>
        )}
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 ml-2" />
        <div className="flex-1" />
        {isMobile && (
          <button
            onClick={() => onClose?.()}
            className="p-0.5 text-white/40 hover:text-white/70 transition-colors"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Chat Area */}
      <div className="flex-1 min-h-0 flex flex-col">
        <ErrorBoundary
          fallback={(reset) => (
            <div className="flex flex-col items-center justify-center h-full text-white/40 p-4">
              <p className="text-xs font-body mb-2">Brain temporarily unavailable</p>
              <button
                onClick={() => {
                  try { sessionStorage.removeItem('hunt-chat-messages'); } catch {}
                  reset();
                }}
                className="text-[11px] text-cyan-400 hover:text-cyan-300 mt-1"
              >
                Retry
              </button>
            </div>
          )}
        >
          <HuntChat
            species={species}
            stateAbbr={selectedState}
            isMobile={isMobile ?? false}
          />
        </ErrorBoundary>
      </div>

      {/* Intel Drawer */}
      <div
        className="h-7 flex items-center justify-between px-3 border-t border-white/[0.06] cursor-pointer shrink-0"
        onClick={() => setIntelOpen(!intelOpen)}
      >
        <span className="text-[10px] font-display tracking-widest text-white/40">
          INTEL
        </span>
        {intelOpen ? (
          <ChevronUp size={12} className="text-white/30" />
        ) : (
          <ChevronDown size={12} className="text-white/30" />
        )}
      </div>

      {intelOpen && (
        <div className="overflow-y-auto scrollbar-hide p-2 max-h-[40vh]">
          {/* National-level intel */}
          {level === 'national' && isWaterfowl && (
            <>
              <ScoutReport
                briefText={scoutReport?.brief_text}
                loading={scoutReportLoading ?? false}
              />
              <HotspotRanking
                states={convergenceTopStates || []}
                onSelectState={onSelectState}
                loading={convergenceLoading}
              />
            </>
          )}

          {level === 'national' && !isWaterfowl && (
            <div className="flex items-center justify-center py-6 text-white/30 text-xs font-body">
              {species.charAt(0).toUpperCase() + species.slice(1)} intelligence coming soon
            </div>
          )}

          {/* State-level intel */}
          {level === 'state' && selectedState && (
            <>
              {isWaterfowl && convergenceScore && (
                <ConvergenceCard
                  score={convergenceScore.score}
                  weatherComponent={convergenceScore.weather_component}
                  solunarComponent={convergenceScore.solunar_component}
                  migrationComponent={convergenceScore.migration_component}
                  birdcastComponent={convergenceScore.birdcast_component}
                  patternComponent={convergenceScore.pattern_component}
                  waterComponent={convergenceScore.water_component}
                  photoperiodComponent={convergenceScore.photoperiod_component}
                  tideComponent={convergenceScore.tide_component}
                  nationalRank={convergenceScore.national_rank}
                  reasoning={convergenceScore.reasoning}
                  stateAbbr={selectedState}
                />
              )}
              <StateView
                species={species}
                abbreviation={selectedState}
                onBack={onBack}
                onSelectZone={onSelectZone}
                onSwitchSpecies={onSwitchSpecies}
                isFavorite={isFavorite}
                onToggleFavorite={onToggleFavorite}
              />
            </>
          )}

          {/* Zone-level intel */}
          {level === 'zone' && selectedState && zoneSlug && (
            <ZoneView
              species={species}
              abbreviation={selectedState}
              zoneSlug={zoneSlug}
              onBack={onBack}
            />
          )}

          {/* Convergence alerts */}
          {convergenceAlerts && convergenceAlerts.length > 0 && (
            <div className="mt-2 space-y-1">
              {convergenceAlerts.map((alert, i) => (
                <div
                  key={`${alert.state_abbr}-${alert.created_at}-${i}`}
                  className="px-2 py-1.5 rounded border border-white/[0.06] bg-white/[0.02] text-[10px] text-white/50"
                >
                  <span className="text-cyan-400 font-medium">
                    {alert.state_abbr}
                  </span>{' '}
                  {alert.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
