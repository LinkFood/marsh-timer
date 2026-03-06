import { motion } from "framer-motion";
import type { Species } from "@/data/types";
import { speciesConfig } from "@/data/speciesConfig";
import { getSeasonsForSpecies } from "@/data/seasons";
import { getSeasonStatus } from "@/lib/seasonUtils";
import { useMemo } from "react";

interface StatusBarProps {
  species: Species;
}

const StatusBar = ({ species }: StatusBarProps) => {
  const { openCount, soonCount } = useMemo(() => {
    const now = new Date();
    let open = 0, soon = 0;
    const seen = new Set<string>();
    for (const s of getSeasonsForSpecies(species)) {
      if (seen.has(s.abbreviation)) continue;
      seen.add(s.abbreviation);
      const st = getSeasonStatus(s, now);
      if (st === "open") open++;
      if (st === "soon") soon++;
    }
    return { openCount: open, soonCount: soon };
  }, [species]);

  const config = speciesConfig[species];

  return (
    <motion.div
      className="flex flex-wrap justify-center gap-3 py-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.15, duration: 0.5 }}
    >
      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-season-open/10 border border-season-open/30 glow-green text-sm font-body">
        <span className="w-2 h-2 rounded-full bg-season-open animate-pulse" />
        <span className="text-season-open font-semibold">{openCount} States Open Now</span>
      </span>
      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-season-soon/10 border border-season-soon/30 glow-amber text-sm font-body">
        <span className="w-2 h-2 rounded-full bg-season-soon" />
        <span className="text-season-soon font-semibold">{soonCount} Opening Within 30 Days</span>
      </span>
    </motion.div>
  );
};

export default StatusBar;
