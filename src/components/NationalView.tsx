import { useMemo, useEffect, useState } from "react";
import type { Species } from "@/data/types";
import type { HuntAlert } from "@/hooks/useHuntAlerts";
import { speciesConfig } from "@/data/speciesConfig";
import { getSeasonsForSpecies, getPrimarySeasonForState } from "@/data/seasons";
import { getSeasonStatus, getStatusColor, getCompactCountdown, sortByNextEvent } from "@/lib/seasonUtils";
import { Star, Calendar, CloudRain, Eye } from "lucide-react";

interface NationalViewProps {
  species: Species;
  onSelectState: (abbr: string) => void;
  favorites: string[];
  onToggleFavorite: (species: Species, abbr: string) => void;
  alerts?: HuntAlert[];
  weatherSnapshot?: Map<string, { temp: number; wind: number }>;
}

export default function NationalView({
  species,
  onSelectState,
  favorites,
  onToggleFavorite,
  alerts,
  weatherSnapshot,
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

  // Find next opening season across all states
  const nextOpening = useMemo(() => {
    const now = new Date();
    let earliest: { days: number; state: string; abbr: string } | null = null;

    for (const season of sorted) {
      for (const dr of season.dates) {
        const start = new Date(dr.start);
        if (start > now) {
          const days = Math.ceil((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          if (!earliest || days < earliest.days) {
            earliest = { days, state: season.state, abbr: season.abbreviation };
          }
        }
      }
    }
    return earliest;
  }, [sorted]);

  // Scouting conditions: states with low wind (<10mph) and no precip
  const scoutingStates = useMemo(() => {
    if (!weatherSnapshot || weatherSnapshot.size === 0) return [];
    const good: string[] = [];
    weatherSnapshot.forEach((wx, abbr) => {
      if (wx.wind < 10) {
        good.push(abbr);
      }
    });
    return good.slice(0, 5);
  }, [weatherSnapshot]);

  // Off-season: all closed
  if (counts.open === 0 && counts.soon === 0) {
    const topAlerts = (alerts ?? []).slice(0, 3);

    return (
      <div className="px-1 py-1 max-h-[120px] overflow-y-auto scrollbar-hide space-y-2">
        {/* Header */}
        <span className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-body font-semibold">
          Off-Season Intel
        </span>

        {/* Next season countdown */}
        {nextOpening && (
          <button
            onClick={() => onSelectState(nextOpening.abbr)}
            className="flex items-center gap-1.5 text-left group"
          >
            <Calendar size={12} className="text-cyan-400/70 flex-shrink-0" />
            <span className="text-[11px] text-white/80 font-body">
              Next season opens in{" "}
              <span className="text-cyan-400 font-semibold">{nextOpening.days}d</span>
              {" "}&mdash; {nextOpening.state}
            </span>
          </button>
        )}

        {/* Weather alerts */}
        {topAlerts.length > 0 && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1">
              <CloudRain size={11} className="text-cyan-400/70 flex-shrink-0" />
              <span className="text-[10px] text-white/40 font-body">Conditions worth watching:</span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {topAlerts.map((a) => (
                <button
                  key={a.stateAbbr}
                  onClick={() => onSelectState(a.stateAbbr)}
                  className="text-[10px] px-2 py-0.5 rounded-full border border-cyan-500/20 bg-cyan-500/[0.06] text-white/70 font-body hover:bg-cyan-500/[0.12] transition-colors truncate max-w-[160px]"
                  title={a.forecastSummary}
                >
                  <span className="text-cyan-400 font-semibold">{a.stateAbbr}</span>{" "}
                  {a.forecastSummary}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Scouting suggestion */}
        {scoutingStates.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Eye size={11} className="text-cyan-400/70 flex-shrink-0" />
            <span className="text-[10px] text-white/60 font-body">
              Good scouting conditions today:{" "}
              <span className="text-white/80">
                {scoutingStates.join(", ")}
              </span>
            </span>
          </div>
        )}

        {/* Fallback if no data at all */}
        {!nextOpening && topAlerts.length === 0 && scoutingStates.length === 0 && (
          <span className="text-[10px] text-white/30 font-body">
            All {sorted.length} seasons closed
          </span>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Alert strip above cards when alerts exist */}
      {alerts && alerts.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide mb-2 -mx-1 px-1 pb-1">
          {alerts.slice(0, 4).map((a) => (
            <button
              key={a.stateAbbr}
              onClick={() => onSelectState(a.stateAbbr)}
              className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-cyan-500/20 bg-cyan-500/[0.06] text-white/70 font-body hover:bg-cyan-500/[0.12] transition-colors"
              title={a.forecastSummary}
            >
              <CloudRain size={10} className="inline mr-1 text-cyan-400/70" />
              <span className="text-cyan-400 font-semibold">{a.stateAbbr}</span>{" "}
              {a.forecastSummary}
            </button>
          ))}
        </div>
      )}

      {/* Summary stats */}
      <div className="flex items-center gap-3 px-1 mb-3 text-[11px] font-body font-semibold">
        {counts.open > 0 && (
          <span className="text-season-open">{counts.open} Open</span>
        )}
        {counts.soon > 0 && (
          <span className="text-yellow-500">{counts.soon} Opening Soon</span>
        )}
        <span className="text-white/40">{counts.closed} Closed</span>
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
              className="flex-shrink-0 w-[120px] rounded-lg border border-white/[0.06] bg-white/[0.03] p-2.5 text-left transition-colors hover:bg-white/[0.06] active:bg-white/[0.08]"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${status === "open" ? "animate-pulse" : ""}`}
                    style={{ background: color }}
                  />
                  <span className="font-display font-bold text-xs text-white/90 truncate">
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
              <p className="text-[10px] text-white/40 font-body truncate">
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
