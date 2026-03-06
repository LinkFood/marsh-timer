import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ExternalLink, Star, X } from "lucide-react";
import { duckSeasons } from "@/data/seasonData";
import { stateFacts } from "@/data/stateFacts";
import { regulationLinks } from "@/data/regulationLinks";
import { getSeasonStatus, getCountdownTarget, getStatusColor, getStatusLabel, formatDate, SeasonStatus } from "@/lib/seasonUtils";
import CountdownTimer from "./CountdownTimer";

interface StateDetailProps {
  abbreviation: string;
  onDeselect?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (abbr: string) => void;
}

const StateDetail = ({ abbreviation, onDeselect, isFavorite, onToggleFavorite }: StateDetailProps) => {
  const season = duckSeasons.find(s => s.abbreviation === abbreviation);
  if (!season) return null;

  const status = getSeasonStatus(season);
  const { target, label } = getCountdownTarget(season);
  const facts = stateFacts[season.state] || [];
  const regLink = regulationLinks[abbreviation];

  return (
    <motion.div
      key={abbreviation}
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
            <h2 className="text-3xl md:text-4xl font-display font-bold text-gradient-gold">
              {season.state}
            </h2>
            {onToggleFavorite && (
              <button
                onClick={() => onToggleFavorite(abbreviation)}
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
            <span className="text-muted-foreground">{season.flyway} Flyway</span>
            <span className="text-muted-foreground">Bag: {season.bagLimit}</span>
            <span className="text-muted-foreground">
              {formatDate(season.seasonOpen)} — {formatDate(season.seasonClose)}
            </span>
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
            {label}: {formatDate(season.seasonOpen)}
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

        {/* Actions */}
        <div className="space-y-3">
          <ShareButton season={season} status={status} />
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

const ShareButton = ({ season, status }: { season: typeof duckSeasons[0]; status: SeasonStatus }) => {
  const [copied, setCopied] = useState(false);

  const getShareData = useCallback(() => {
    const url = `https://duckcountdown.com/${season.abbreviation}`;
    let text: string;
    if (status === "open") {
      text = `Duck season is OPEN in ${season.state}! Closes ${formatDate(season.seasonClose)}.`;
    } else {
      const days = Math.ceil((new Date(season.seasonOpen + "T00:00:00").getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      text = `Duck season in ${season.state} opens in ${days} days! ${formatDate(season.seasonOpen)}`;
    }
    return { text, url, title: `${season.state} Duck Season` };
  }, [season, status]);

  const handleShare = useCallback(async () => {
    const { text, url, title } = getShareData();

    // Try Web Share API on mobile
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch {
        // User cancelled or API failed — fall through to clipboard
      }
    }

    // Clipboard fallback
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
