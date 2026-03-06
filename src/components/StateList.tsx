import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Star } from "lucide-react";
import type { Species } from "@/data/types";
import { speciesConfig } from "@/data/speciesConfig";
import { getSeasonsForSpecies, getPrimarySeasonForState } from "@/data/seasons";
import { getSeasonStatus, getStatusColor, getCompactCountdown, formatDate, getCountdownTarget, sortByNextEvent, getSeasonTypeLabel } from "@/lib/seasonUtils";

interface StateListProps {
  species: Species;
  onSelectState: (abbr: string) => void;
  selectedState: string | null;
  favorites?: string[];
  onToggleFavorite?: (species: Species, abbr: string) => void;
}

const StateList = ({ species, onSelectState, selectedState, favorites = [], onToggleFavorite }: StateListProps) => {
  const [showAll, setShowAll] = useState(false);
  const config = speciesConfig[species];

  // Deduplicate to one primary season per state, then sort
  const sorted = useMemo(() => {
    const all = getSeasonsForSpecies(species);
    const seen = new Set<string>();
    const primary = all.filter(s => {
      if (seen.has(s.abbreviation)) return false;
      seen.add(s.abbreviation);
      return true;
    }).map(s => getPrimarySeasonForState(species, s.abbreviation)!);
    const base = sortByNextEvent(primary);
    if (favorites.length === 0) return base;
    const favSet = new Set(favorites);
    const favs = base.filter(s => favSet.has(s.abbreviation));
    const rest = base.filter(s => !favSet.has(s.abbreviation));
    return [...favs, ...rest];
  }, [species, favorites]);

  const visible = showAll ? sorted : sorted.slice(0, 10);
  const favSet = useMemo(() => new Set(favorites), [favorites]);

  return (
    <div className="max-w-2xl mx-auto px-4 mt-12 mb-16">
      <h2 className="text-2xl font-display font-bold text-center mb-6" style={{ color: config.colors.selected }}>
        {config.emoji} All {config.label} States — Next Openers First
      </h2>
      <div className="space-y-2">
        {visible.map((season, i) => {
          const status = getSeasonStatus(season);
          const color = getStatusColor(status);
          const isSelected = season.abbreviation === selectedState;
          const isFav = favSet.has(season.abbreviation);
          const isLastFav = isFav && favorites.length > 0 && i === favorites.length - 1 && i < visible.length - 1;

          return (
            <div key={season.abbreviation}>
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => onSelectState(season.abbreviation)}
                className={`w-full text-left flex items-center justify-between p-3 md:p-4 rounded-lg border transition-colors ${
                  isSelected
                    ? "bg-primary/10 border-primary/30"
                    : "bg-card border-border hover:bg-secondary"
                }`}
                style={{ borderLeftWidth: 3, borderLeftColor: color }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {onToggleFavorite && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(species, season.abbreviation);
                      }}
                      className="flex-shrink-0 p-0.5"
                      aria-label={isFav ? `Remove ${season.state} from favorites` : `Add ${season.state} to favorites`}
                    >
                      <Star
                        className={`w-4 h-4 transition-colors ${
                          isFav
                            ? "fill-yellow-400 text-yellow-400"
                            : "text-muted-foreground hover:text-yellow-400"
                        }`}
                      />
                    </button>
                  )}
                  <span
                    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${status === "open" ? "glow-green" : ""}`}
                    style={{ background: color }}
                  />
                  <div className="min-w-0">
                    <span className="font-display font-semibold text-sm text-foreground">
                      {season.state}
                    </span>
                    <span className="text-xs text-muted-foreground ml-2">
                      {season.flyway || getSeasonTypeLabel(season.seasonType)}
                    </span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0 ml-3">
                  <div className="text-sm font-body font-semibold" style={{ color }}>
                    {getCompactCountdown(season)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {status === "open"
                      ? formatDate(season.dates[season.dates.length - 1].close)
                      : formatDate(season.dates[0].open)
                    } · Bag: {season.bagLimit}
                  </div>
                </div>
              </motion.button>
              {isLastFav && (
                <div className="border-t border-border/50 my-3" />
              )}
            </div>
          );
        })}
      </div>
      {!showAll && sorted.length > 10 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full mt-4 py-3 rounded-lg border border-border text-sm text-muted-foreground font-body hover:bg-secondary transition-colors"
        >
          Show All {sorted.length} States
        </button>
      )}
    </div>
  );
};

export default StateList;
