import { useState, useEffect, useRef } from 'react';
import type { FeatureCollection, Feature } from 'geojson';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// NDBC buoy positions [lng, lat]
const BUOY_COORDS: Record<string, [number, number]> = {
  // Gulf of Mexico
  '42001': [-89.668, 25.888],
  '42002': [-93.666, 25.790],
  '42003': [-85.612, 25.925],
  '42019': [-95.353, 27.907],
  '42020': [-96.695, 26.966],
  '42035': [-94.413, 29.232],
  '42036': [-84.508, 28.500],
  '42039': [-86.008, 28.791],
  '42040': [-88.226, 29.212],
  // Great Lakes
  '45001': [-87.066, 48.064],
  '45002': [-86.411, 45.344],
  '45003': [-87.313, 45.351],
  '45004': [-87.024, 44.088],
  '45005': [-82.398, 41.677],
  '45006': [-87.576, 42.677],
  '45007': [-83.740, 42.674],
  '45008': [-82.828, 44.283],
  '45012': [-80.600, 42.479],
  // Atlantic
  '41001': [-72.734, 34.700],
  '41002': [-75.415, 32.309],
  '41004': [-79.099, 32.501],
  '41008': [-80.871, 31.400],
  '41009': [-80.166, 28.519],
  '44009': [-74.703, 38.461],
  '44013': [-70.651, 42.346],
  '44025': [-73.164, 40.251],
};

export function useOceanBuoys(): { geoJSON: FeatureCollection | null } {
  const [geoJSON, setGeoJSON] = useState<FeatureCollection | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || !SUPABASE_URL || !SUPABASE_KEY) return;
    fetchedRef.current = true;

    const today = new Date().toISOString().slice(0, 10);

    fetch(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.ocean-buoy&effective_date=eq.${today}&select=title,content,metadata,state_abbr&limit=30`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    )
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return;

        const features: Feature[] = [];
        for (const entry of data) {
          const meta = entry.metadata || {};
          const stationId = meta.station_id;
          const coords = BUOY_COORDS[stationId];
          if (!coords) continue;

          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: coords },
            properties: {
              stationId,
              region: meta.region || '',
              state: entry.state_abbr || '',
              sstF: meta.sst_f ?? null,
              sstC: meta.sst_c ?? null,
              waveHeightFt: meta.wave_height_ft ?? null,
              waveHeightM: meta.wave_height_m ?? null,
              wavePeriod: meta.wave_period_s ?? null,
              pressureMb: meta.pressure_mb ?? null,
              windSpeedMph: meta.wind_speed_mph ?? null,
              windDir: meta.wind_dir_deg ?? null,
              airTempF: meta.air_temp_f ?? null,
              obsTime: meta.obs_time ?? null,
              content: entry.content,
            },
          });
        }

        setGeoJSON({ type: 'FeatureCollection', features });
      })
      .catch(() => {});

    // Refresh every 10 minutes
    const interval = setInterval(() => { fetchedRef.current = false; }, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return { geoJSON };
}
