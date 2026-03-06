import { useState, useEffect } from "react";
import { ExternalLink } from "lucide-react";
import type { Species } from "@/data/types";
import { canShowSightings, fetchRecentSightings, getEBirdRegionUrl, type EBirdSighting } from "@/lib/ebird";

interface Props {
  species: Species;
  stateAbbr: string;
}

const EBirdSightings = ({ species, stateAbbr }: Props) => {
  const [sightings, setSightings] = useState<EBirdSighting[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!canShowSightings(species)) return;
    setLoading(true);
    fetchRecentSightings(species, stateAbbr)
      .then(setSightings)
      .finally(() => setLoading(false));
  }, [species, stateAbbr]);

  if (!canShowSightings(species)) return null;

  if (loading) {
    return (
      <div className="border border-border rounded-lg p-4 mb-6">
        <p className="text-xs text-muted-foreground animate-pulse">Loading recent sightings...</p>
      </div>
    );
  }

  if (sightings.length === 0) return null;

  return (
    <div className="border border-border rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-primary">Recent Sightings (7 days)</p>
        <a
          href={getEBirdRegionUrl(stateAbbr)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          eBird <ExternalLink size={10} />
        </a>
      </div>
      <div className="space-y-2">
        {sightings.map((s, i) => (
          <div key={`${s.speciesCode}-${i}`} className="flex items-baseline justify-between text-sm">
            <span className="font-body text-foreground/80">{s.comName}</span>
            <span className="text-xs text-muted-foreground ml-2 shrink-0">
              {s.howMany ? `${s.howMany}x` : ""} {s.locName.length > 25 ? s.locName.slice(0, 25) + "\u2026" : s.locName}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EBirdSightings;
