import React, { useState, useEffect, useMemo } from "react";
import {
  Crosshair,
  MessageSquare,
  Bell,
  ClipboardList,
  PanelLeftClose,
  PanelLeft,
  ArrowLeft,
  Brain,
} from "lucide-react";
import type { Species } from "@/data/types";
import type { HuntAlert } from "@/hooks/useHuntAlerts";
import { useAuth } from "@/hooks/useAuth";
import { useHuntLogs } from "@/hooks/useHuntLogs";
import { getSeasonsForSpecies, getPrimarySeasonForState } from "@/data/seasons";
import { getSeasonStatus } from "@/lib/seasonUtils";
import NationalView from "./NationalView";
import StateView from "./StateView";
import ZoneView from "./ZoneView";
import HuntChat from "./HuntChat";
import HuntAlerts from "./HuntAlerts";
import ScoutReport from "./ScoutReport";
import HotspotRanking from "./HotspotRanking";
import ConvergenceCard from "./cards/ConvergenceCard";
import HuntLogForm from "./HuntLogForm";
import HuntLogList from "./HuntLogList";
import DUMigrationReports from "./DUMigrationReports";
import RecallCard from "./RecallCard";
import { useRecall } from "@/hooks/useRecall";

type DrillLevel = "national" | "state" | "zone";

type TabId = "intel" | "chat" | "alerts" | "log";

interface SidebarProps {
  level: DrillLevel;
  species: Species;
  stateAbbr: string | null;
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
  expanded: boolean;
  onToggleExpanded: () => void;
}

const TABS: { id: TabId; icon: typeof Crosshair; label: string }[] = [
  { id: "intel", icon: Crosshair, label: "Intel" },
  { id: "chat", icon: MessageSquare, label: "Chat" },
  { id: "alerts", icon: Bell, label: "Alerts" },
  { id: "log", icon: ClipboardList, label: "Log" },
];

export default function Sidebar({
  level,
  species,
  stateAbbr,
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
  expanded,
  onToggleExpanded,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<TabId>("intel");
  const { user, session } = useAuth();
  const { data: recalls, loading: recallLoading } = useRecall(stateAbbr, species);
  const { logs, loading: logsLoading, submitLog, deleteLog } = useHuntLogs(
    user?.id ?? null,
    session?.access_token ?? null
  );

  // Detect off-season: no open or soon seasons for this species
  const isOffSeason = useMemo(() => {
    const now = new Date();
    const all = getSeasonsForSpecies(species);
    const seen = new Set<string>();
    for (const s of all) {
      if (seen.has(s.abbreviation)) continue;
      seen.add(s.abbreviation);
      const primary = getPrimarySeasonForState(species, s.abbreviation);
      if (!primary) continue;
      const status = getSeasonStatus(primary, now);
      if (status === "open" || status === "soon") return false;
    }
    return true;
  }, [species]);

  // Reset to intel tab when drill level changes
  useEffect(() => {
    setActiveTab("intel");
  }, [level]);

  // --- Collapsed state ---
  if (!expanded) {
    return (
      <div className="fixed top-12 left-0 bottom-0 w-12 z-20 glass-panel border-r border-white/[0.06] flex flex-col items-center pt-3 gap-1">
        {TABS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            onClick={() => {
              setActiveTab(id);
              onToggleExpanded();
            }}
            className="w-full aspect-square flex items-center justify-center text-white/40 hover:text-white/70 transition-colors"
          >
            <Icon size={18} />
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={onToggleExpanded}
          className="w-full aspect-square flex items-center justify-center text-white/30 hover:text-white/50 transition-colors mb-2"
        >
          <PanelLeft size={16} />
        </button>
      </div>
    );
  }

  // --- Expanded state ---

  const isWaterfowl = species === 'duck' || species === 'goose';

  const renderIntelContent = () => {
    if (level === "national") {
      return (
        <>
          {isWaterfowl ? (
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
              <DUMigrationReports />
              <RecallCard recalls={recalls} loading={recallLoading} />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center px-4 py-8">
              <div className="w-12 h-12 rounded-full bg-white/[0.05] flex items-center justify-center mb-3">
                <Brain className="w-6 h-6 text-white/30" />
              </div>
              <p className="text-sm font-heading text-white/60 mb-1">
                {species.charAt(0).toUpperCase() + species.slice(1)} Intelligence
              </p>
              <p className="text-[11px] font-body text-white/40 text-center mb-2">
                Coming soon — the brain is learning {species} patterns
              </p>
              <p className="text-[10px] font-body text-white/30 text-center">
                Season dates and basic info are available now.
                Full convergence scoring, weather patterns, and migration
                tracking are being built for {species}.
              </p>
            </div>
          )}
          <NationalView
            species={species}
            onSelectState={onSelectState}
            favorites={favorites}
            onToggleFavorite={onToggleFavorite}
            alerts={alerts}
            weatherSnapshot={weatherSnapshot}
            convergenceTopStates={convergenceTopStates}
          />
        </>
      );
    }

    if (level === "state" && stateAbbr) {
      return (
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
              stateAbbr={stateAbbr}
            />
          )}
          {isWaterfowl && (
            <DUMigrationReports currentState={stateAbbr} />
          )}
          <RecallCard recalls={recalls} loading={recallLoading} />
          {!isWaterfowl && (
            <div className="flex flex-col items-center justify-center px-4 py-6 mb-3">
              <div className="w-12 h-12 rounded-full bg-white/[0.05] flex items-center justify-center mb-3">
                <Brain className="w-6 h-6 text-white/30" />
              </div>
              <p className="text-sm font-heading text-white/60 mb-1">
                {species.charAt(0).toUpperCase() + species.slice(1)} Intelligence
              </p>
              <p className="text-[11px] font-body text-white/40 text-center mb-2">
                Coming soon — the brain is learning {species} patterns
              </p>
              <p className="text-[10px] font-body text-white/30 text-center">
                Season dates and basic info are available now.
                Full convergence scoring, weather patterns, and migration
                tracking are being built for {species}.
              </p>
            </div>
          )}
          <StateView
            species={species}
            abbreviation={stateAbbr}
            onBack={onBack}
            onSelectZone={onSelectZone}
            onSwitchSpecies={onSwitchSpecies}
            isFavorite={isFavorite}
            onToggleFavorite={onToggleFavorite}
          />
        </>
      );
    }

    if (level === "zone" && stateAbbr && zoneSlug) {
      return (
        <ZoneView
          species={species}
          abbreviation={stateAbbr}
          zoneSlug={zoneSlug}
          onBack={onBack}
        />
      );
    }

    return null;
  };

  const renderAlertsContent = () => (
    <>
      <HuntAlerts
        alerts={alerts}
        stateAbbr={stateAbbr}
        onSelectState={onSelectState}
      />
      {convergenceAlerts && convergenceAlerts.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-white/40 font-medium">
            Notable Hunting Weather
          </p>
          {convergenceAlerts.map((ca, i) => (
            <div
              key={i}
              className="rounded-lg bg-white/[0.04] border border-white/[0.06] p-2.5"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-white/80">
                  {ca.state_abbr}
                </span>
                <span className="text-[10px] text-cyan-400/70">
                  {ca.score_before} → {ca.score_after}
                </span>
              </div>
              <p className="text-[11px] text-white/50 leading-snug">
                {ca.message}
              </p>
            </div>
          ))}
        </div>
      )}
    </>
  );

  const renderLogContent = () => {
    if (!user) {
      return (
        <div className="flex flex-col items-center justify-center h-40 text-white/40">
          <ClipboardList size={24} className="mb-2 text-white/20" />
          <p className="text-xs font-body">Sign in to log hunts</p>
        </div>
      );
    }

    return (
      <>
        <HuntLogForm onSubmit={submitLog} species={species} stateAbbr={stateAbbr ?? undefined} />
        <div className="mt-3">
          <HuntLogList logs={logs} loading={logsLoading} onDelete={deleteLog} />
        </div>
      </>
    );
  };

  const headerText = (() => {
    if (level === "national") return null;
    if (level === "state") return stateAbbr;
    if (level === "zone") return zoneSlug?.replace(/-/g, " ");
    return null;
  })();

  const isChatTab = activeTab === "chat";

  return (
    <div className="fixed top-12 left-0 bottom-0 w-[340px] z-20 glass-panel border-r border-white/[0.06] flex flex-col transition-all duration-300 ease-out">
      {/* Header */}
      <div className="h-10 flex items-center px-3 border-b border-white/[0.06] shrink-0">
        {level === "national" ? (
          <span className="text-xs font-display tracking-widest text-white/60">
            {isOffSeason ? "OFF-SEASON INTEL" : `${species.toUpperCase()} INTEL`}
          </span>
        ) : (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-white/60 hover:text-white/80 transition-colors"
          >
            <ArrowLeft size={14} />
            <span className="text-sm font-display font-bold text-white/90 uppercase">
              {headerText}
            </span>
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onToggleExpanded}
          className="text-white/30 hover:text-white/50 transition-colors"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/[0.06] shrink-0">
        {TABS.map(({ id, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex-1 py-2 flex justify-center transition-colors ${
              activeTab === id
                ? "border-b-2 border-cyan-400 text-cyan-400"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            <Icon size={16} />
          </button>
        ))}
      </div>

      {/* Content */}
      <div
        className={`flex-1 min-h-0 ${
          isChatTab
            ? "flex flex-col h-full"
            : "overflow-y-auto scrollbar-hide p-3"
        }`}
      >
        {activeTab === "intel" && renderIntelContent()}
        {activeTab === "chat" && (
          <HuntChat species={species} stateAbbr={stateAbbr} isMobile={false} />
        )}
        {activeTab === "alerts" && renderAlertsContent()}
        {activeTab === "log" && renderLogContent()}
      </div>
    </div>
  );
}
