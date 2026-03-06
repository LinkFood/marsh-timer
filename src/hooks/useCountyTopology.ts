import { useState, useEffect } from "react";
import type { Topology } from "topojson-specification";

const COUNTY_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/counties-10m.json";

let cachedTopology: Topology | null = null;
let loadingPromise: Promise<Topology | null> | null = null;

async function loadCountyTopology(): Promise<Topology | null> {
  if (cachedTopology) return cachedTopology;
  if (loadingPromise) return loadingPromise;

  loadingPromise = fetch(COUNTY_URL)
    .then(res => res.json() as Promise<Topology>)
    .then(topo => {
      cachedTopology = topo;
      return topo;
    })
    .catch(() => null);

  return loadingPromise;
}

export function useCountyTopology(shouldLoad: boolean) {
  const [topology, setTopology] = useState<Topology | null>(cachedTopology);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!shouldLoad) return;
    if (cachedTopology) {
      setTopology(cachedTopology);
      return;
    }

    setLoading(true);
    loadCountyTopology().then(topo => {
      setTopology(topo);
      setLoading(false);
    });
  }, [shouldLoad]);

  return { topology, loading };
}
