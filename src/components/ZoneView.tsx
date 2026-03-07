import { useMemo } from "react";
import { ArrowLeft, ShieldCheck, AlertTriangle } from "lucide-react";
import type { Species } from "@/data/types";
import { speciesConfig } from "@/data/speciesConfig";
import { getSeasonsByState } from "@/data/seasons";
import {
  getSeasonStatus,
  getCountdownTarget,
  getStatusColor,
  getStatusLabel,
  formatDate,
} from "@/lib/seasonUtils";
import CountdownTimer from "./CountdownTimer";

interface ZoneViewProps {
  species: Species;
  abbreviation: string;
  zoneSlug: string;
  onBack: () => void;
}

export default function ZoneView({
  species,
  abbreviation,
  zoneSlug,
  onBack,
}: ZoneViewProps) {
  const config = speciesConfig[species];

  const season = useMemo(() => {
    const allForState = getSeasonsByState(species, abbreviation);
    return allForState.find((s) => s.zoneSlug === zoneSlug) || null;
  }, [species, abbreviation, zoneSlug]);

  if (!season) {
    return (
      <div className="text-center py-4">
        <p className="text-xs text-muted-foreground">Zone not found.</p>
        <button
          onClick={onBack}
          className="text-xs text-primary mt-2 underline"
        >
          Go back
        </button>
      </div>
    );
  }

  const status = getSeasonStatus(season);
  const { target } = getCountdownTarget(season);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2
            className="text-lg font-display font-bold"
            style={{ color: config.colors.selected }}
          >
            {season.zone}
          </h2>
          <p className="text-[10px] text-muted-foreground font-body">
            {season.state} — {config.label}
          </p>
        </div>
      </div>

      {/* Status + pills */}
      <div className="flex flex-wrap items-center gap-2 text-xs font-body">
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
          <span className="text-muted-foreground">{season.flyway} Flyway</span>
        )}
        {season.weapon && (
          <span className="text-muted-foreground">{season.weapon}</span>
        )}
        <span className="text-muted-foreground">Bag: {season.bagLimit}</span>
      </div>

      {/* Dates */}
      <div className="text-xs text-muted-foreground">
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

      {/* Verification */}
      <div className="flex items-center gap-1">
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
        <p className="text-[10px] text-muted-foreground italic">
          {season.notes}
        </p>
      )}

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
    </div>
  );
}
