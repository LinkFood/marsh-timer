import React, { useState, useRef, useCallback, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import type { Species } from "@/data/types";
import type { HuntAlert } from "@/hooks/useHuntAlerts";
import NationalView from "./NationalView";
import StateView from "./StateView";
import ZoneView from "./ZoneView";
import HuntChat from "./HuntChat";
import HuntAlerts from "./HuntAlerts";

type DrillLevel = "national" | "state" | "zone";

interface BottomPanelProps {
  level: DrillLevel;
  species: Species;
  stateAbbr: string | null;
  zoneSlug: string | null;
  onSelectState: (abbr: string) => void;
  onSelectZone: (slug: string) => void;
  onBack: () => void;
  onSwitchSpecies: (species: Species) => void;
  isMobile: boolean;
  favorites: string[];
  onToggleFavorite: (species: Species, abbr: string) => void;
  isFavorite: boolean;
  alerts: HuntAlert[];
}

type SnapIndex = 0 | 1 | 2;

// Snap points as fraction of viewport height
const SNAP_PEEK = 0.15;
const SNAP_HALF = 0.45;
const SNAP_FULL = 0.9;
const SNAPS = [SNAP_PEEK, SNAP_HALF, SNAP_FULL];

export default function BottomPanel({
  level,
  species,
  stateAbbr,
  zoneSlug,
  onSelectState,
  onSelectZone,
  onBack,
  onSwitchSpecies,
  isMobile,
  favorites,
  onToggleFavorite,
  isFavorite,
  alerts,
}: BottomPanelProps) {
  const [currentSnap, setCurrentSnap] = useState<SnapIndex>(1);
  const [translateY, setTranslateY] = useState<number | null>(null);
  const [desktopExpanded, setDesktopExpanded] = useState(true);
  const startY = useRef(0);
  const startTranslate = useRef(0);
  const dragging = useRef(false);

  // When drill level changes, snap to half
  useEffect(() => {
    setCurrentSnap(1);
    setTranslateY(null);
  }, [level, stateAbbr, zoneSlug]);

  const getSnapY = useCallback((snapIndex: number) => {
    return (1 - SNAPS[snapIndex]) * 100;
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      dragging.current = true;
      startY.current = e.touches[0].clientY;
      startTranslate.current = translateY ?? getSnapY(currentSnap);
    },
    [translateY, currentSnap, getSnapY],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!dragging.current) return;
      const deltaY = e.touches[0].clientY - startY.current;
      const dvhDelta = (deltaY / window.innerHeight) * 100;
      const newTranslate = Math.max(
        getSnapY(2),
        Math.min(100, startTranslate.current + dvhDelta),
      );
      setTranslateY(newTranslate);
    },
    [getSnapY],
  );

  const handleTouchEnd = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;

    const currentY = translateY ?? getSnapY(currentSnap);

    // Find nearest snap point
    let nearestSnap: SnapIndex = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < SNAPS.length; i++) {
      const snapY = getSnapY(i);
      const dist = Math.abs(currentY - snapY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestSnap = i as SnapIndex;
      }
    }

    setCurrentSnap(nearestSnap);
    setTranslateY(null);
  }, [translateY, currentSnap, getSnapY]);

  const activeTranslateY = translateY ?? getSnapY(currentSnap);

  // Content based on drill level
  const content = (() => {
    switch (level) {
      case "national":
        return (
          <>
            <HuntAlerts alerts={alerts} stateAbbr={null} onSelectState={onSelectState} />
            <NationalView
              species={species}
              onSelectState={onSelectState}
              favorites={favorites}
              onToggleFavorite={onToggleFavorite}
            />
          </>
        );
      case "state":
        if (!stateAbbr) return null;
        return (
          <>
            <HuntAlerts alerts={alerts} stateAbbr={stateAbbr} onSelectState={onSelectState} />
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
      case "zone":
        if (!stateAbbr || !zoneSlug) return null;
        return (
          <ZoneView
            species={species}
            abbreviation={stateAbbr}
            zoneSlug={zoneSlug}
            onBack={onBack}
          />
        );
    }
  })();

  // Summary bar text
  const summaryText = (() => {
    switch (level) {
      case "national":
        return `Showing all states`;
      case "state":
        return stateAbbr || "State";
      case "zone":
        return zoneSlug?.replace(/-/g, " ") || "Zone";
    }
  })();

  // Desktop: fixed bottom bar, expandable
  if (!isMobile) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-20 glass-panel border-t border-white/[0.06] transition-all duration-300 ease-out"
        style={{ height: desktopExpanded ? '280px' : '48px' }}
      >
        {/* Summary bar / toggle */}
        <button
          onClick={() => setDesktopExpanded((e) => !e)}
          className="w-full flex items-center justify-between px-4 h-12 text-xs font-medium text-white/50 hover:text-white/70 transition-colors"
        >
          <span className="uppercase tracking-widest text-[10px]">
            {summaryText}
          </span>
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${desktopExpanded ? "" : "rotate-180"}`}
          />
        </button>

        {desktopExpanded && (
          <div className="flex flex-col" style={{ height: 'calc(280px - 48px)' }}>
            {/* Content area */}
            <div className="shrink-0 overflow-x-auto scrollbar-hide px-4 pb-2 max-h-[120px]">
              {content}
            </div>
            {/* Chat area */}
            <div className="flex-1 min-h-0 border-t border-white/[0.06]">
              <HuntChat species={species} stateAbbr={stateAbbr} isMobile={false} />
            </div>
          </div>
        )}
      </div>
    );
  }

  // Mobile: draggable bottom sheet
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-20 rounded-t-2xl glass-panel border-t border-white/[0.06]"
      style={{
        height: "100dvh",
        transform: `translateY(${activeTranslateY}dvh)`,
        transition: dragging.current
          ? "none"
          : "transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)",
        willChange: "transform",
      }}
    >
      {/* Drag handle */}
      <div
        className="cursor-grab active:cursor-grabbing touch-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex justify-center py-2.5">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* Summary bar (visible at peek) */}
        <div className="px-4 pb-2 text-xs font-body text-white/50 font-semibold uppercase tracking-wider">
          {summaryText}
        </div>
      </div>

      {/* Scrollable content */}
      <div
        className="overflow-y-auto scrollbar-hide px-4 pb-8"
        style={{ height: `calc(${SNAP_FULL * 100}dvh - 3.5rem)` }}
      >
        {content}

        {/* Chat */}
        <div className="border-t border-white/[0.06] mt-4" style={{ minHeight: '300px' }}>
          <HuntChat species={species} stateAbbr={stateAbbr} isMobile={true} />
        </div>
      </div>
    </div>
  );
}
