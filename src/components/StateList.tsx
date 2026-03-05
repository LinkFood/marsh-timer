import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { duckSeasons } from "@/data/seasonData";
import { getSeasonStatus, getStatusColor, getCompactCountdown, formatDate, getCountdownTarget, sortByNextEvent } from "@/lib/seasonUtils";

interface StateListProps {
  onSelectState: (abbr: string) => void;
  selectedState: string | null;
}

const StateList = ({ onSelectState, selectedState }: StateListProps) => {
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => sortByNextEvent(duckSeasons), []);
  const visible = showAll ? sorted : sorted.slice(0, 10);

  return (
    <div className="max-w-2xl mx-auto px-4 mt-12 mb-16">
      <h2 className="text-2xl font-display font-bold text-gradient-gold text-center mb-6">
        🗓️ All States — Next Openers First
      </h2>
      <div className="space-y-2">
        {visible.map((season, i) => {
          const status = getSeasonStatus(season);
          const color = getStatusColor(status);
          const { target } = getCountdownTarget(season);
          const isSelected = season.abbreviation === selectedState;

          return (
            <motion.button
              key={season.abbreviation}
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
                <span
                  className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${status === "open" ? "glow-green" : ""}`}
                  style={{ background: color }}
                />
                <div className="min-w-0">
                  <span className="font-display font-semibold text-sm text-foreground">
                    {season.state}
                  </span>
                  <span className="text-xs text-muted-foreground ml-2">{season.flyway}</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0 ml-3">
                <div className="text-sm font-body font-semibold" style={{ color }}>
                  {getCompactCountdown(season)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {formatDate(status === "open" ? season.seasonClose : season.seasonOpen)} · Bag: {season.bagLimit}
                </div>
              </div>
            </motion.button>
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
