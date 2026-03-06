import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, Star, X, ShieldCheck, AlertTriangle } from "lucide-react";
import type { Species, HuntingSeason } from "@/data/types";
import { speciesConfig } from "@/data/speciesConfig";
import { getSeasonsByState, getPrimarySeasonForState, getAllSpeciesForState } from "@/data/seasons";
import { regulationLinks } from "@/data/regulationLinks";
import { stateFacts } from "@/data/stateFacts";
import { getSeasonStatus, getCountdownTarget, getStatusColor, getStatusLabel, getDateDisplay, formatDate, getSeasonTypeLabel, SeasonStatus } from "@/lib/seasonUtils";
import CountdownTimer from "./CountdownTimer";
import EBirdSightings from "./EBirdSightings";

interface StateDetailProps {
  species: Species;
  abbreviation: string;
  onDeselect?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (species: Species, abbr: string) => void;
  onSwitchSpecies?: (species: Species) => void;
}

const StateDetail = ({ species, abbreviation, onDeselect, isFavorite, onToggleFavorite, onSwitchSpecies }: StateDetailProps) => {
  const seasons = getSeasonsByState(species, abbreviation);
  const [activeSeasonType, setActiveSeasonType] = useState(seasons[0]?.seasonType || "regular");

  const season = useMemo(
    () => seasons.find(s => s.seasonType === activeSeasonType) || seasons[0],
    [seasons, activeSeasonType]
  );

  // Reset active tab when species changes
  useEffect(() => {
    const primaryType = getPrimarySeasonForState(species, abbreviation)?.seasonType;
    if (primaryType) setActiveSeasonType(primaryType);
  }, [species, abbreviation]);

  if (!season) return null;

  const status = getSeasonStatus(season);
  const { target, label } = getCountdownTarget(season);
  const facts = stateFacts[species]?.[season.state] || [];
  const regLink = regulationLinks[species]?.[abbreviation];
  const otherSpecies = getAllSpeciesForState(abbreviation).filter(s => s !== species);
  const config = speciesConfig[species];

  return (
    <motion.div
      key={`${species}-${abbreviation}`}
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="max-w-2xl mx-auto px-4 mt-8"
    >
      <div className="bg-card border border-border rounded-xl p-6 md:p-8 relative">
        {/* Close button */}
        {onDeselect && (
          <button
            onClick={onDeselect}
            className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            aria-label="Close state detail"
          >
            <X size={18} />
          </button>
        )}

        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-2">
            <h2 className="text-3xl md:text-4xl font-display font-bold" style={{ color: config.colors.selected }}>
              {season.state}
            </h2>
            {onToggleFavorite && (
              <button
                onClick={() => onToggleFavorite(species, abbreviation)}
                className="p-1 transition-colors"
                aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
              >
                <Star
                  size={22}
                  className={isFavorite ? "text-primary fill-primary" : "text-muted-foreground hover:text-primary"}
                />
              </button>
            )}
          </div>

          {/* Season type tabs */}
          {seasons.length > 1 && (
            <div className="flex justify-center gap-1 mt-3">
              {seasons.map(s => (
                <button
                  key={s.seasonType}
                  onClick={() => setActiveSeasonType(s.seasonType)}
                  className={`px-3 py-1.5 rounded-full text-xs font-body font-semibold transition-colors ${
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

          <div className="flex flex-wrap items-center justify-center gap-3 mt-3 text-sm font-body">
            <span
              className="px-3 py-1 rounded-full text-xs font-semibold"
              style={{
                background: `${getStatusColor(status)}20`,
                color: getStatusColor(status),
                border: `1px solid ${getStatusColor(status)}40`,
              }}
            >
              {getStatusLabel(status)}
            </span>
            {season.flyway && (
              <span className="text-muted-foreground">{season.flyway} Flyway</span>
            )}
            {season.weapon && (
              <span className="text-muted-foreground">{season.weapon}</span>
            )}
            <span className="text-muted-foreground">Bag: {season.bagLimit}</span>
          </div>

          {/* Date display — handles split seasons */}
          <div className="mt-2 text-sm text-muted-foreground">
            {season.dates.length === 1 ? (
              <span>{formatDate(season.dates[0].open)} — {formatDate(season.dates[0].close)}</span>
            ) : (
              <div className="space-y-0.5">
                {season.dates.map((range, i) => (
                  <div key={i} className="text-xs">
                    Split {i + 1}: {formatDate(range.open)} — {formatDate(range.close)}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Verification badge */}
          <div className="flex items-center justify-center gap-1 mt-2">
            {season.verified ? (
              <>
                <ShieldCheck size={14} className="text-green-500" />
                <span className="text-xs text-green-500 font-body">Verified {season.seasonYear}</span>
              </>
            ) : (
              <>
                <AlertTriangle size={14} className="text-yellow-500" />
                <span className="text-xs text-yellow-500 font-body">Unverified — check official regs</span>
              </>
            )}
          </div>

          {season.notes && (
            <p className="text-xs text-muted-foreground mt-2 italic">{season.notes}</p>
          )}
        </div>

        {/* Status message */}
        {status === "open" ? (
          <p className="text-center text-season-open font-display text-lg font-bold mb-4">
            IT'S OPEN — GET OUT THERE
          </p>
        ) : status !== "closed" ? (
          <p className="text-center text-muted-foreground font-body text-sm mb-4">
            {label}: {formatDate(season.dates[0].open)}
          </p>
        ) : null}

        {/* Countdown */}
        {status !== "closed" && (
          <div className="mb-6">
            <p className="text-center text-xs text-muted-foreground mb-3 uppercase tracking-wider">
              {status === "open" ? "Closes in" : "Opens in"}
            </p>
            <CountdownTimer target={target} />
          </div>
        )}

        {status === "closed" && (
          <p className="text-center text-muted-foreground font-body text-sm mb-4">
            Season is currently closed. Check back for next year's dates.
          </p>
        )}

        {/* Facts */}
        {facts.length > 0 && <FactRotator facts={facts} />}

        {/* eBird sightings */}
        <EBirdSightings species={species} stateAbbr={abbreviation} />

        {/* Cross-species nav */}
        {otherSpecies.length > 0 && onSwitchSpecies && (
          <div className="flex flex-wrap items-center justify-center gap-2 mb-6 text-sm">
            <span className="text-muted-foreground text-xs">Also in {season.state}:</span>
            {otherSpecies.map(s => (
              <button
                key={s}
                onClick={() => onSwitchSpecies(s)}
                className="px-2.5 py-1 rounded-full text-xs font-body bg-secondary border border-border hover:bg-primary/10 transition-colors"
              >
                {speciesConfig[s].emoji} {speciesConfig[s].label}
              </button>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <ShareButton season={season} status={status} config={config} />
          {regLink && (
            <a
              href={regLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-lg font-body text-sm font-semibold bg-secondary/50 text-muted-foreground border border-border hover:bg-secondary hover:text-foreground transition-colors min-h-[44px]"
            >
              <ExternalLink size={16} />
              Official Regulations
            </a>
          )}
          {(species === "duck" || species === "goose" || species === "dove") && (
            <a
              href={`https://dashboard.birdcast.info/region/US-${abbreviation}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-lg font-body text-sm font-semibold bg-secondary/50 text-muted-foreground border border-border hover:bg-secondary hover:text-foreground transition-colors min-h-[44px]"
            >
              <ExternalLink size={16} />
              Migration Forecast
            </a>
          )}
        </div>
      </div>
    </motion.div>
  );
};

const FactRotator = ({ facts }: { facts: string[] }) => {
  const [index, setIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    timerRef.current = setInterval(() => {
      setIndex(i => (i + 1) % facts.length);
    }, 8000);
    return () => clearInterval(timerRef.current);
  }, [facts.length]);

  return (
    <div className="border-l-2 border-primary/50 bg-secondary/50 rounded-r-lg p-4 mb-6 min-h-[60px]">
      <p className="text-xs text-primary font-semibold mb-1">Local Intel:</p>
      <AnimatePresence mode="wait">
        <motion.p
          key={index}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="text-sm text-foreground/80 font-body"
        >
          {facts[index]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
};

const ShareButton = ({ season, status, config }: { season: HuntingSeason; status: SeasonStatus; config: typeof speciesConfig["duck"] }) => {
  const [copied, setCopied] = useState(false);

  const getShareData = useCallback(() => {
    const url = `https://duckcountdown.com/${season.species}/${season.abbreviation}`;
    const speciesLabel = config.label.toLowerCase();
    let text: string;
    if (status === "open") {
      text = `${config.label} season is OPEN in ${season.state}! Closes ${formatDate(season.dates[season.dates.length - 1].close)}.`;
    } else {
      const days = Math.ceil((new Date(season.dates[0].open + "T00:00:00").getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      text = `${config.label} season in ${season.state} opens in ${days} days! ${formatDate(season.dates[0].open)}`;
    }
    return { text, url, title: `${season.state} ${config.label} Season` };
  }, [season, status, config]);

  const handleShare = useCallback(async () => {
    const { text, url, title } = getShareData();

    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        // User cancelled or API failed
      }
    }

    await navigator.clipboard.writeText(`${text} ${url}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [getShareData]);

  return (
    <motion.button
      onClick={handleShare}
      whileTap={{ scale: 0.95 }}
      className={`w-full py-3 rounded-lg font-body text-sm font-semibold transition-colors min-h-[44px] ${
        copied
          ? "bg-season-open/20 text-season-open border border-season-open/30"
          : "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
      }`}
    >
      {copied ? "Copied! Send it!" : "Text Your Hunting Buddies"}
    </motion.button>
  );
};

export default StateDetail;
