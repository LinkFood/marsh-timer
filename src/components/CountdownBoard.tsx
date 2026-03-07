import { useState, useMemo, useEffect } from "react";
import { Star, ChevronLeft, ChevronRight, X, Timer } from "lucide-react";
import type { Species } from "@/data/types";
import { speciesConfig } from "@/data/speciesConfig";
import { getSeasonsForSpecies, getPrimarySeasonForState } from "@/data/seasons";
import { getSeasonStatus, getStatusColor, getCompactCountdown, sortByNextEvent, getSeasonTypeLabel } from "@/lib/seasonUtils";

interface CountdownBoardProps {
  species: Species;
  selectedState: string | null;
  onSelectState: (abbr: string) => void;
  favorites: string[];
  onToggleFavorite: (species: Species, abbr: string) => void;
  isMobile: boolean;
}

export default function CountdownBoard({
  species,
  selectedState,
  onSelectState,
  favorites,
  onToggleFavorite,
  isMobile,
}: CountdownBoardProps) {
  const [isOpen, setIsOpen] = useState(!isMobile);
  const [, setTick] = useState(0);

  // Live countdown tick every second
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [isOpen]);

  // Close on mobile by default
  useEffect(() => {
    setIsOpen(!isMobile);
  }, [isMobile]);

  const config = speciesConfig[species];
  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const sorted = useMemo(() => {
    const all = getSeasonsForSpecies(species);
    const seen = new Set<string>();
    const primary = all
      .filter(s => {
        if (seen.has(s.abbreviation)) return false;
        seen.add(s.abbreviation);
        return true;
      })
      .map(s => getPrimarySeasonForState(species, s.abbreviation)!);

    const base = sortByNextEvent(primary);
    if (favorites.length === 0) return base;
    const favs = base.filter(s => favSet.has(s.abbreviation));
    const rest = base.filter(s => !favSet.has(s.abbreviation));
    return [...favs, ...rest];
  }, [species, favorites, favSet]);

  const openCount = useMemo(() => {
    const now = new Date();
    return sorted.filter(s => getSeasonStatus(s, now) === "open").length;
  }, [sorted]);

  // FAB for mobile
  if (isMobile && !isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 left-4 z-20 w-12 h-12 rounded-full map-overlay-panel border border-border/50 flex items-center justify-center shadow-lg"
        aria-label="Show countdown board"
      >
        <Timer size={18} className="text-primary" />
        {openCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-green-500 text-[10px] font-bold text-black w-5 h-5 rounded-full flex items-center justify-center">
            {openCount}
          </span>
        )}
      </button>
    );
  }

  const panelContent = (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <h3 className="font-display font-bold text-sm" style={{ color: config.colors.selected }}>
          {config.emoji} {config.label} Openers
        </h3>
        {isMobile && (
          <button onClick={() => setIsOpen(false)} className="p-1 text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        )}
      </div>

      {/* State list */}
      <div className="overflow-y-auto scrollbar-hide" style={{ maxHeight: isMobile ? "70dvh" : "calc(100dvh - 120px)" }}>
        {sorted.map((season, i) => {
          const status = getSeasonStatus(season);
          const color = getStatusColor(status);
          const isSelected = season.abbreviation === selectedState;
          const isFav = favSet.has(season.abbreviation);
          const isLastFav = isFav && favorites.length > 0 && i === favorites.length - 1 && i < sorted.length - 1;

          return (
            <div key={season.abbreviation}>
              <button
                onClick={() => {
                  onSelectState(season.abbreviation);
                  if (isMobile) setIsOpen(false);
                }}
                className={`w-full text-left flex items-center justify-between px-4 py-2.5 transition-colors ${
                  isSelected ? "bg-primary/10" : "hover:bg-secondary/50"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(species, season.abbreviation);
                    }}
                    className="flex-shrink-0 p-0.5"
                    aria-label={isFav ? "Remove from favorites" : "Add to favorites"}
                  >
                    <Star
                      className={`w-3.5 h-3.5 transition-colors ${
                        isFav ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground/40 hover:text-yellow-400"
                      }`}
                    />
                  </button>
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${status === "open" ? "animate-pulse" : ""}`}
                    style={{ background: color }}
                  />
                  <div className="min-w-0 truncate">
                    <span className="font-display font-semibold text-xs text-foreground">
                      {season.state}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-1.5">
                      {season.flyway || getSeasonTypeLabel(season.seasonType)}
                    </span>
                  </div>
                </div>
                <span className="text-xs font-body font-semibold flex-shrink-0 ml-2" style={{ color }}>
                  {getCompactCountdown(season)}
                </span>
              </button>
              {isLastFav && <div className="border-t border-border/30 mx-4" />}
            </div>
          );
        })}
      </div>
    </>
  );

  // Mobile: bottom overlay
  if (isMobile) {
    return (
      <>
        <div className="fixed inset-0 z-30 bg-black/30" onClick={() => setIsOpen(false)} />
        <div className="fixed bottom-0 left-0 right-0 z-40 rounded-t-2xl map-overlay-panel border-t border-border/50">
          {panelContent}
        </div>
      </>
    );
  }

  // Desktop: left sidebar
  return (
    <div
      className={`fixed top-12 left-0 z-20 h-[calc(100dvh-48px)] transition-transform duration-300 ${
        isOpen ? "translate-x-0" : "-translate-x-full"
      }`}
      style={{ width: 320 }}
    >
      <div className="h-full map-overlay-panel rounded-r-xl border-r border-border/50">
        {panelContent}
      </div>
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className="absolute top-1/2 -translate-y-1/2 -right-8 w-8 h-12 rounded-r-lg map-overlay-panel border border-l-0 border-border/50 flex items-center justify-center text-muted-foreground hover:text-foreground"
      >
        {isOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>
    </div>
  );
}
