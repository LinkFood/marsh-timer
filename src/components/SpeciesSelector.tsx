import { motion } from "framer-motion";
import type { Species } from "@/data/types";
import { speciesConfig, SPECIES_ORDER } from "@/data/speciesConfig";
import { getSeasonsForSpecies } from "@/data/seasons";
import { getSeasonStatus } from "@/lib/seasonUtils";
import { useMemo } from "react";

interface SpeciesSelectorProps {
  selected: Species;
  onSelect: (species: Species) => void;
}

const SpeciesSelector = ({ selected, onSelect }: SpeciesSelectorProps) => {
  const counts = useMemo(() => {
    const now = new Date();
    const result: Record<Species, number> = { duck: 0, goose: 0, deer: 0, turkey: 0, dove: 0 };
    for (const species of SPECIES_ORDER) {
      const seasons = getSeasonsForSpecies(species);
      const seen = new Set<string>();
      for (const s of seasons) {
        if (!seen.has(s.abbreviation) && getSeasonStatus(s, now) === "open") {
          seen.add(s.abbreviation);
          result[species]++;
        }
      }
    }
    return result;
  }, []);

  return (
    <motion.div
      className="max-w-3xl mx-auto px-4 mt-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.1, duration: 0.4 }}
    >
      <div className="flex justify-center gap-1 sm:gap-2 bg-secondary/50 rounded-full p-1 border border-border">
        {SPECIES_ORDER.map(species => {
          const config = speciesConfig[species];
          const isActive = species === selected;
          const count = counts[species];

          return (
            <button
              key={species}
              onClick={() => onSelect(species)}
              className={`relative flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-body font-semibold transition-all min-h-[36px] ${
                isActive
                  ? "bg-card border border-border text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className="text-sm sm:text-base">{config.emoji}</span>
              <span className="hidden sm:inline">{config.label}</span>
              {count > 0 && (
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: `${config.colors.open}20`,
                    color: config.colors.open,
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
};

export default SpeciesSelector;
