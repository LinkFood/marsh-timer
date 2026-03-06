import { X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { duckSeasons } from "@/data/seasonData";
import { getSeasonStatus, getStatusColor, getCompactCountdown } from "@/lib/seasonUtils";

interface FavoritesBarProps {
  onSelectState: (abbr: string) => void;
  favorites: string[];
  onToggleFavorite: (abbr: string) => void;
}

const seasonByAbbr = Object.fromEntries(
  duckSeasons.map((s) => [s.abbreviation, s])
);

const FavoritesBar = ({ onSelectState, favorites, onToggleFavorite }: FavoritesBarProps) => {
  if (favorites.length === 0) return null;

  return (
    <div className="max-w-4xl mx-auto px-4 mt-4">
      <div className="flex flex-wrap gap-2 justify-center">
        <AnimatePresence mode="popLayout">
          {favorites.map((abbr) => {
            const season = seasonByAbbr[abbr];
            if (!season) return null;

            const status = getSeasonStatus(season);
            const color = getStatusColor(status);

            return (
              <motion.div
                key={abbr}
                layout
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.2 }}
                className="flex items-center gap-2 bg-card border border-border rounded-full px-3 py-1.5 cursor-pointer hover:bg-secondary transition-colors"
                style={{ borderLeftWidth: 3, borderLeftColor: color }}
                onClick={() => onSelectState(abbr)}
              >
                <span className="font-display font-semibold text-sm text-foreground">
                  {abbr}
                </span>
                <span className="text-xs font-body text-muted-foreground">
                  {getCompactCountdown(season)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(abbr);
                  }}
                  className="ml-0.5 p-0.5 rounded-full hover:bg-destructive/20 transition-colors text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${season.state} from favorites`}
                >
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default FavoritesBar;
