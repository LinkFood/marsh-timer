import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { duckSeasons } from "@/data/seasonData";
import { stateFacts } from "@/data/stateFacts";
import { getSeasonStatus, getCountdownTarget, getStatusColor, getStatusLabel, formatDate, SeasonStatus } from "@/lib/seasonUtils";
import CountdownTimer from "./CountdownTimer";

interface StateDetailProps {
  abbreviation: string;
}

const StateDetail = ({ abbreviation }: StateDetailProps) => {
  const season = duckSeasons.find(s => s.abbreviation === abbreviation);
  if (!season) return null;

  const status = getSeasonStatus(season);
  const { target, label } = getCountdownTarget(season);
  const facts = stateFacts[season.state] || [];

  return (
    <motion.div
      key={abbreviation}
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 40 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="max-w-2xl mx-auto px-4 mt-8"
    >
      <div className="bg-card border border-border rounded-xl p-6 md:p-8">
        {/* Header */}
        <div className="text-center mb-6">
          <h2 className="text-3xl md:text-4xl font-display font-bold text-gradient-gold">
            {season.state}
          </h2>
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
        </div>

        {/* Status message */}
        {status === "open" ? (
          <p className="text-center text-season-open font-display text-lg font-bold mb-4">
            🟢 IT'S OPEN — GET OUT THERE
          </p>
        ) : status !== "closed" ? (
          <p className="text-center text-muted-foreground font-body text-sm mb-4">
            {label}: {formatDate(status === "open" ? season.seasonClose : season.seasonOpen)}
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

        {/* Share */}
        <ShareButton season={season} status={status} />
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
      <p className="text-xs text-primary font-semibold mb-1">🎯 Local Intel:</p>
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

  const handleShare = useCallback(() => {
    let msg: string;
    if (status === "open") {
      msg = `🦆 Duck season is OPEN in ${season.state}! Closes ${formatDate(season.seasonClose)}. Check it: duckcountdown.com`;
    } else {
      const days = Math.ceil((new Date(season.seasonOpen + "T00:00:00").getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      msg = `🦆 Duck season in ${season.state} opens in ${days} days! 📅 ${formatDate(season.seasonOpen)} — duckcountdown.com`;
    }
    navigator.clipboard.writeText(msg);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }, [season, status]);

  return (
    <motion.button
      onClick={handleShare}
      whileTap={{ scale: 0.95 }}
      className={`w-full py-3 rounded-lg font-body text-sm font-semibold transition-colors ${
        copied
          ? "bg-season-open/20 text-season-open border border-season-open/30"
          : "bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
      }`}
    >
      {copied ? "✅ Copied! Send it!" : "📤 Text Your Hunting Buddies"}
    </motion.button>
  );
};

export default StateDetail;
