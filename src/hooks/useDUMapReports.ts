import { useState, useEffect, useRef } from "react";
import type { FeatureCollection } from "geojson";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const STALE_MS = 30 * 60 * 1000; // 30 minutes

const EMPTY_FC: FeatureCollection = { type: "FeatureCollection", features: [] };

export function useDUMapReports(stateAbbr?: string | null, days = 30) {
  const [geojson, setGeojson] = useState<FeatureCollection>(EMPTY_FC);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    async function fetchReports() {
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        const cutoffISO = cutoff.toISOString();

        let url =
          `${SUPABASE_URL}/rest/v1/hunt_du_map_reports` +
          `?select=latitude,longitude,activity_level,activity_level_id,classification,submit_date,weather,city,state_abbr` +
          `&submit_date=gte.${cutoffISO}` +
          `&latitude=not.is.null` +
          `&longitude=not.is.null` +
          `&order=submit_date.desc` +
          `&limit=10000`;

        if (stateAbbr) {
          url += `&state_abbr=eq.${stateAbbr}`;
        }

        const res = await fetch(url, {
          headers: { apikey: SUPABASE_KEY },
        });
        if (!res.ok) return;

        const data: any[] = await res.json();

        const features = data.map((row) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [row.longitude, row.latitude],
          },
          properties: {
            activity_level: row.activity_level || "Unknown",
            activity_level_id: row.activity_level_id ?? 0,
            classification: row.classification || "Unknown",
            submit_date: row.submit_date || "",
            weather: row.weather || "",
            location_name: row.city || "",
            state_abbr: row.state_abbr || "",
          },
        }));

        setGeojson({ type: "FeatureCollection", features });
      } catch {
        // silent fail
      } finally {
        setLoading(false);
      }
    }

    fetchReports();
    const interval = setInterval(() => {
      fetchReports();
    }, STALE_MS);
    return () => clearInterval(interval);
  }, []);

  return { geojson, loading };
}
