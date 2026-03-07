import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ExternalLink, Star, ShieldCheck, AlertTriangle, Brain, ChevronRight, CalendarPlus } from "lucide-react";
import type { Species, HuntingSeason } from "@/data/types";
import { speciesConfig } from "@/data/speciesConfig";
import { getSeasonsByState, getPrimarySeasonForState, getAllSpeciesForState } from "@/data/seasons";
import { regulationLinks } from "@/data/regulationLinks";
import { stateFacts } from "@/data/stateFacts";
import {
  getSeasonStatus,
  getCountdownTarget,
  getStatusColor,
  getStatusLabel,
  formatDate,
  getSeasonTypeLabel,
  type SeasonStatus,
} from "@/lib/seasonUtils";
import { useStateIntel } from "@/hooks/useStateIntel";
import { downloadICS } from "@/lib/icsExport";
import CountdownTimer from "./CountdownTimer";
import EBirdSightings from "./EBirdSightings";
import WeatherBrief from "./WeatherBrief";

interface StateViewProps {
  species: Species;
  abbreviation: string;
  onBack: () => void;
  onSelectZone: (slug: string) => void;
  onSwitchSpecies: (species: Species) => void;
  isFavorite: boolean;
  onToggleFavorite: (species: Species, abbr: string) => void;
}

export default function StateView({
  species,
  abbreviation,
  onBack,
  onSelectZone,
  onSwitchSpecies,
  isFavorite,
  onToggleFavorite,
}: StateViewProps) {
  const seasons = getSeasonsByState(species, abbreviation);
  const [activeSeasonType, setActiveSeasonType] = useState(
    seasons[0]?.seasonType || "regular",
  );

  const season = useMemo(
    () => seasons.find((s) => s.seasonType === activeSeasonType) || seasons[0],
    [seasons, activeSeasonType],
  );

  useEffect(() => {
    const primaryType = getPrimarySeasonForState(
      species,
      abbreviation,
    )?.seasonType;
    if (primaryType) setActiveSeasonType(primaryType);
  }, [species, abbreviation]);

  if (!season) return null;

  const status = getSeasonStatus(season);
  const { target, label } = getCountdownTarget(season);
  const facts = stateFacts[species]?.[season.state] || [];
  const regLink = regulationLinks[species]?.[abbreviation];
  const otherSpecies = getAllSpeciesForState(abbreviation).filter(
    (s) => s !== species,
  );
  const config = speciesConfig[species];
  const { data: intel } = useStateIntel(species, abbreviation);

  // Find distinct zones for this species+state
  const zones = useMemo(() => {
    const allForState = getSeasonsByState(species, abbreviation);
    const seen = new Set<string>();
    return allForState.filter((s) => {
      if (s.zoneSlug === "statewide" || seen.has(s.zoneSlug)) return false;
      seen.add(s.zoneSlug);
      return true;
    });
  }, [species, abbreviation]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-2">
          <h2
            className="text-2xl font-display font-bold"
            style={{ color: config.colors.selected }}
          >
            {season.state}
          </h2>
          <button
            onClick={() => onToggleFavorite(species, abbreviation)}
            className="p-1 transition-colors"
          >
            <Star
              size={20}
              className={
                isFavorite
                  ? "text-primary fill-primary"
                  : "text-muted-foreground hover:text-primary"
              }
            />
          </button>
        </div>

        {/* Season type tabs */}
        {seasons.length > 1 && (
          <div className="flex justify-center gap-1 mt-2 flex-wrap">
            {seasons.map((s) => (
              <button
                key={s.seasonType}
                onClick={() => setActiveSeasonType(s.seasonType)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-body font-semibold transition-colors ${
                  s.seasonType === activeSeasonType
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`}
              >
                {getSeasonTypeLabel(s.seasonType)}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-2 mt-2 text-xs font-body">
          <span
            className="px-2.5 py-0.5 rounded-full font-semibold"
            style={{
              background: `${getStatusColor(status)}20`,
              color: getStatusColor(status),
              border: `1px solid ${getStatusColor(status)}40`,
            }}
          >
            {getStatusLabel(status)}
          </span>
          {season.flyway && (
            <span className="text-muted-foreground">
              {season.flyway} Flyway
            </span>
          )}
          {season.weapon && (
            <span className="text-muted-foreground">{season.weapon}</span>
          )}
          <span className="text-muted-foreground">
            Bag: {season.bagLimit}
          </span>
        </div>

        {/* Date display */}
        <div className="mt-1.5 text-xs text-muted-foreground">
          {season.dates.length === 1 ? (
            <span>
              {formatDate(season.dates[0].open)} —{" "}
              {formatDate(season.dates[0].close)}
            </span>
          ) : (
            <div className="space-y-0.5">
              {season.dates.map((range, i) => (
                <div key={i}>
                  Split {i + 1}: {formatDate(range.open)} —{" "}
                  {formatDate(range.close)}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Verification badge */}
        <div className="flex items-center justify-center gap-1 mt-1.5">
          {season.verified ? (
            <>
              <ShieldCheck size={12} className="text-green-500" />
              <span className="text-[10px] text-green-500 font-body">
                Verified {season.seasonYear}
              </span>
            </>
          ) : (
            <>
              <AlertTriangle size={12} className="text-yellow-500" />
              <span className="text-[10px] text-yellow-500 font-body">
                Unverified — check official regs
              </span>
            </>
          )}
        </div>

        {season.notes && (
          <p className="text-[10px] text-muted-foreground mt-1 italic">
            {season.notes}
          </p>
        )}
      </div>

      {/* Status message */}
      {status === "open" ? (
        <p className="text-center text-season-open font-display text-base font-bold">
          IT'S OPEN — GET OUT THERE
        </p>
      ) : status !== "closed" ? (
        <p className="text-center text-muted-foreground font-body text-xs">
          {label}: {formatDate(season.dates[0].open)}
        </p>
      ) : null}

      {/* Countdown */}
      {status !== "closed" && (
        <div>
          <p className="text-center text-[10px] text-muted-foreground mb-2 uppercase tracking-wider">
            {status === "open" ? "Closes in" : "Opens in"}
          </p>
          <CountdownTimer target={target} />
        </div>
      )}

      {status === "closed" && (
        <p className="text-center text-muted-foreground font-body text-xs">
          Season is currently closed. Check back for next year's dates.
        </p>
      )}

      {/* Current Conditions */}
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
          Current Conditions
        </p>
        <WeatherBrief stateAbbr={abbreviation} />
      </div>

      {/* Facts */}
      {facts.length > 0 && <FactRotator facts={facts} />}

      {/* eBird sightings */}
      <EBirdSightings species={species} stateAbbr={abbreviation} />

      {/* AI Intel */}
      {intel && intel.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Brain size={12} className="text-primary" />
            Intel
          </p>
          {intel.map((item, i) => (
            <div
              key={i}
              className="border-l-2 border-primary/30 bg-secondary/50 rounded-r-lg p-3"
            >
              <p className="text-xs text-foreground/80 font-body">{item.content}</p>
              {item.content_type === "weather-pattern" && (
                <p className="text-[9px] text-primary/60 mt-1 font-body">Based on 5 years of data</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Zone list */}
      {zones.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1.5">
            Zones
          </p>
          <div className="space-y-1">
            {zones.map((z) => {
              const zStatus = getSeasonStatus(z);
              const zColor = getStatusColor(zStatus);
              return (
                <button
                  key={z.zoneSlug}
                  onClick={() => onSelectZone(z.zoneSlug)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-secondary/50 border border-border/30 hover:bg-secondary transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ background: zColor }}
                    />
                    <span className="text-xs font-body text-foreground truncate">
                      {z.zone}
                    </span>
                  </div>
                  <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Cross-species nav */}
      {otherSpecies.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs">
          <span className="text-muted-foreground text-[10px]">
            Also in {season.state}:
          </span>
          {otherSpecies.map((s) => (
            <button
              key={s}
              onClick={() => onSwitchSpecies(s)}
              className="px-2 py-0.5 rounded-full text-[10px] font-body bg-secondary border border-border hover:bg-primary/10 transition-colors"
            >
              {speciesConfig[s].emoji} {speciesConfig[s].label}
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="space-y-2">
        <ShareButton season={season} status={status} config={config} />
        <button
          onClick={() => downloadICS(seasons, `${species}-${abbreviation}-seasons.ics`)}
          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-body text-xs font-semibold bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors min-h-[44px]"
        >
          <CalendarPlus size={14} />
          Add to Calendar
        </button>
        {regLink && (
          <a
            href={regLink}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-body text-xs font-semibold bg-secondary/50 text-muted-foreground border border-border hover:bg-secondary hover:text-foreground transition-colors min-h-[44px]"
          >
            <ExternalLink size={14} />
            Official Regulations
          </a>
        )}
        {(species === "duck" || species === "goose" || species === "dove") && (
          <a
            href={`https://dashboard.birdcast.info/region/US-${abbreviation}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-body text-xs font-semibold bg-secondary/50 text-muted-foreground border border-border hover:bg-secondary hover:text-foreground transition-colors min-h-[44px]"
          >
            <ExternalLink size={14} />
            Migration Forecast
          </a>
        )}
      </div>
    </div>
  );
}

function FactRotator({ facts }: { facts: string[] }) {
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setIndex((i) => (i + 1) % facts.length);
    }, 8000);
    return () => clearInterval(timerRef.current);
  }, [facts.length]);

  return (
    <div className="border-l-2 border-primary/50 bg-secondary/50 rounded-r-lg p-3">
      <p className="text-[10px] text-primary font-semibold mb-0.5">
        Local Intel:
      </p>
      <p className="text-xs text-foreground/80 font-body">{facts[index]}</p>
    </div>
  );
}

function ShareButton({
  season,
  status,
  config,
}: {
  season: HuntingSeason;
  status: SeasonStatus;
  config: (typeof speciesConfig)["duck"];
}) {
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async () => {
    const url = `https://duckcountdown.com/${season.species}/${season.abbreviation}`;
    let text: string;
    if (status === "open") {
      text = `${config.label} season is OPEN in ${season.state}! Closes ${formatDate(season.dates[season.dates.length - 1].close)}.`;
    } else {
      const days = Math.ceil(
        (new Date(season.dates[0].open + "T00:00:00").getTime() -
          Date.now()) /
          (1000 * 60 * 60 * 24),
      );
      text = `${config.label} season in ${season.state} opens in ${days} days! ${formatDate(season.dates[0].open)}`;
    }

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${season.state} ${config.label} Season`,
          text,
          url,
        });
        return;
      } catch {
        /* cancelled */
      }
    }

    await navigator.clipboard.writeText(`${text} ${url}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [season, status, config]);

  return (
    <button
      onClick={handleShare}
      className={`w-full py-2.5 rounded-lg font-body text-xs font-semibold transition-colors min-h-[44px] ${
        copied
          ? "bg-season-open/20 text-season-open border border-season-open/30"
          : "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
      }`}
    >
      {copied ? "Copied! Send it!" : "Text Your Hunting Buddies"}
    </button>
  );
}
