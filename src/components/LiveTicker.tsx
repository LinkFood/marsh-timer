import { useMemo } from "react";
import type { Species } from "@/data/types";
import { getSeasonsForSpecies, getPrimarySeasonForState } from "@/data/seasons";
import { getSeasonStatus, getCompactCountdown, sortByNextEvent } from "@/lib/seasonUtils";

interface LiveTickerProps {
  species: Species;
}

const LiveTicker = ({ species }: LiveTickerProps) => {
  const tickerText = useMemo(() => {
    const now = new Date();
    const all = getSeasonsForSpecies(species);

    // Deduplicate by state — use primary season per state
    const seen = new Set<string>();
    const uniqueAbbrs: string[] = [];
    for (const s of all) {
      if (!seen.has(s.abbreviation)) {
        seen.add(s.abbreviation);
        uniqueAbbrs.push(s.abbreviation);
      }
    }

    const primarySeasons = uniqueAbbrs
      .map(abbr => getPrimarySeasonForState(species, abbr))
      .filter(Boolean) as NonNullable<ReturnType<typeof getPrimarySeasonForState>>[];

    const sorted = sortByNextEvent(primarySeasons, now);

    // Filter to "soon" or "upcoming" only
    const upcoming = sorted.filter(s => {
      const status = getSeasonStatus(s, now);
      return status === "soon" || status === "upcoming";
    });

    if (upcoming.length > 0) {
      return upcoming
        .map(s => {
          const countdown = getCompactCountdown(s, now);
          return `${s.abbreviation} opens in ${countdown.replace(/Opens in /, "")}`;
        })
        .join("  \u00B7  ");
    }

    // Fallback: count open states
    const openCount = sorted.filter(s => getSeasonStatus(s, now) === "open").length;
    if (openCount > 0) {
      return `${openCount} state${openCount !== 1 ? "s" : ""} open now`;
    }

    return "All seasons closed";
  }, [species]);

  return (
    <div className="w-full overflow-hidden whitespace-nowrap group">
      <div
        className="inline-flex ticker-scroll group-hover:[animation-play-state:paused]"
      >
        <span className="text-xs text-muted-foreground font-body px-4">
          {tickerText}
        </span>
        <span className="text-xs text-muted-foreground font-body px-4" aria-hidden>
          {tickerText}
        </span>
      </div>
    </div>
  );
};

export default LiveTicker;
