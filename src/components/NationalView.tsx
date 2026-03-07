import { useMemo, useEffect, useState } from "react";
import type { Species } from "@/data/types";
import { speciesConfig } from "@/data/speciesConfig";
import { getSeasonsForSpecies, getPrimarySeasonForState } from "@/data/seasons";
import { getSeasonStatus, getStatusColor, getCompactCountdown, sortByNextEvent } from "@/lib/seasonUtils";
import { Star } from "lucide-react";

interface NationalViewProps {
  species: Species;
  onSelectState: (abbr: string) => void;
  favorites: string[];
  onToggleFavorite: (species: Species, abbr: string) => void;
}

export default function NationalView({
  species,
  onSelectState,
  favorites,
  onToggleFavorite,
}: NationalViewProps) {
  const [, setTick] = useState(0);

  // Live countdown tick every second
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const config = speciesConfig[species];
  const favSet = useMemo(() => new Set(favorites), [favorites]);

  const sorted = useMemo(() => {
    const all = getSeasonsForSpecies(species);
    const seen = new Set<string>();
    const primary = all
      .filter((s) => {
        if (seen.has(s.abbreviation)) return false;
        seen.add(s.abbreviation);
        return true;
      })
      .map((s) => getPrimarySeasonForState(species, s.abbreviation)!);

    const base = sortByNextEvent(primary);
    if (favorites.length === 0) return base;
    const favs = base.filter((s) => favSet.has(s.abbreviation));
    const rest = base.filter((s) => !favSet.has(s.abbreviation));
    return [...favs, ...rest];
  }, [species, favorites, favSet]);

  const counts = useMemo(() => {
    const now = new Date();
    let open = 0;
    let soon = 0;
    let closed = 0;
    for (const s of sorted) {
      const status = getSeasonStatus(s, now);
      if (status === "open") open++;
      else if (status === "soon") soon++;
      else closed++;
    }
    return { open, soon, closed };
  }, [sorted]);

  return (
    <div>
      {/* Summary stats */}
      <div className="flex items-center gap-3 px-1 mb-3 text-[11px] font-body font-semibold">
        {counts.open > 0 && (
          <span className="text-season-open">{counts.open} Open</span>
        )}
        {counts.soon > 0 && (
          <span className="text-yellow-500">{counts.soon} Opening Soon</span>
        )}
        <span className="text-muted-foreground">{counts.closed} Closed</span>
      </div>

      {/* Horizontal scroll cards */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 -mx-1 px-1">
        {sorted.map((season) => {
          const status = getSeasonStatus(season);
          const color = getStatusColor(status);
          const isFav = favSet.has(season.abbreviation);
          const compact = getCompactCountdown(season);

          return (
            <button
              key={season.abbreviation}
              onClick={() => onSelectState(season.abbreviation)}
              className="flex-shrink-0 w-[120px] rounded-lg border border-border/50 bg-secondary/50 p-2.5 text-left transition-colors hover:bg-secondary/80 active:bg-secondary"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${status === "open" ? "animate-pulse" : ""}`}
                    style={{ background: color }}
                  />
                  <span className="font-display font-bold text-xs text-foreground truncate">
                    {season.abbreviation}
                  </span>
                </div>
                {isFav && (
                  <Star
                    size={10}
                    className="fill-yellow-400 text-yellow-400 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFavorite(species, season.abbreviation);
                    }}
                  />
                )}
              </div>
              <p className="text-[10px] text-muted-foreground font-body truncate">
                {season.state}
              </p>
              <p
                className="text-[10px] font-body font-semibold mt-1 truncate"
                style={{ color }}
              >
                {compact}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
