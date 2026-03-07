import { useState, useEffect } from "react";
import * as topojson from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection } from "geojson";
import { fipsToAbbr } from "@/data/fips";

const COUNTIES_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json";

export function useCountyGeoJSON(): FeatureCollection | null {
  const [geo, setGeo] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(COUNTIES_URL);
        if (!res.ok) return;
        const topoData = (await res.json()) as Topology;
        const fc = topojson.feature(
          topoData,
          topoData.objects.counties as GeometryCollection,
        ) as FeatureCollection;

        // Enrich each county with stateAbbr from first 2 digits of FIPS id
        for (const f of fc.features) {
          const fips = String(f.id).padStart(5, "0");
          const stateFips = fips.slice(0, 2);
          f.properties = {
            ...f.properties,
            fips,
            stateAbbr: fipsToAbbr[stateFips] || "",
          };
        }

        if (!cancelled) setGeo(fc);
      } catch {
        // silent fail
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  return geo;
}
