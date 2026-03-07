import { useState, useEffect, useRef } from "react";
import type { Species } from "@/data/types";
import { fetchGeoSightings, canShowSightings } from "@/lib/ebird";
import type { EBirdGeoSighting } from "@/lib/ebird";
import type { FeatureCollection } from "geojson";

export function useEBirdMapSightings(
  species: Species,
  center: [number, number] | null,
  zoom: number,
) {
  const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
  const prevKeyRef = useRef<string>("");

  useEffect(() => {
    if (!center || zoom < 6 || !canShowSightings(species)) {
      setGeojson(null);
      return;
    }

    const key = `${species}-${center[0].toFixed(1)}-${center[1].toFixed(1)}`;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;

    let cancelled = false;

    async function load() {
      const sightings = await fetchGeoSightings(species, center![1], center![0]);
      if (cancelled) return;

      const now = Date.now();
      const features = sightings.map((s) => {
        const ageMs = now - new Date(s.obsDt).getTime();
        const ageDays = ageMs / (1000 * 60 * 60 * 24);
        let recency: string;
        if (ageDays < 1) recency = "today";
        else if (ageDays < 3) recency = "recent";
        else recency = "old";

        return {
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [s.lng, s.lat],
          },
          properties: {
            name: s.comName,
            location: s.locName,
            date: s.obsDt,
            count: s.howMany || 0,
            recency,
          },
        };
      });

      setGeojson({ type: "FeatureCollection", features });
    }

    load();
    return () => { cancelled = true; };
  }, [species, center, zoom]);

  return geojson;
}
