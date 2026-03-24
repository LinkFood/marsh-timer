import { useState, useEffect, useRef } from 'react';
import type { FeatureCollection, Feature } from 'geojson';

// METAR station locations (subset — major airports for environmental monitoring)
// These are the stations the nws-monitor function tracks
const STATION_COORDS: Record<string, [number, number]> = {
  // Format: ICAO -> [lng, lat]
  KLIT: [-92.224, 34.729], // Little Rock AR
  KMEM: [-89.977, 35.042], // Memphis TN
  KJAN: [-90.076, 32.311], // Jackson MS
  KSHV: [-93.826, 32.447], // Shreveport LA
  KMSY: [-90.258, 29.993], // New Orleans LA
  KIAH: [-95.342, 29.980], // Houston TX
  KDFW: [-97.038, 32.897], // Dallas TX
  KOKC: [-97.601, 35.393], // Oklahoma City OK
  KSTL: [-90.370, 38.749], // St Louis MO
  KDSM: [-93.663, 41.534], // Des Moines IA
  KMSP: [-93.222, 44.882], // Minneapolis MN
  KORD: [-87.904, 41.979], // Chicago IL
  KDTW: [-83.353, 42.212], // Detroit MI
  KCLT: [-80.943, 35.214], // Charlotte NC
  KATL: [-84.428, 33.637], // Atlanta GA
  KJAX: [-81.688, 30.494], // Jacksonville FL
  KBNA: [-86.678, 36.124], // Nashville TN
  KIND: [-86.295, 39.717], // Indianapolis IN
  KCVG: [-84.668, 39.049], // Cincinnati OH
  KMCI: [-94.714, 39.298], // Kansas City MO
  KDEN: [-104.673, 39.862], // Denver CO
  KSLC: [-111.969, 40.789], // Salt Lake City UT
  KBOI: [-116.223, 43.564], // Boise ID
  KPDX: [-122.597, 45.589], // Portland OR
  KSEA: [-122.309, 47.449], // Seattle WA
  KPHX: [-112.012, 33.434], // Phoenix AZ
  KABQ: [-106.609, 35.040], // Albuquerque NM
};

interface WeatherEvent {
  station: string;
  type: string;
  details: string;
  severity: 'high' | 'medium' | 'low';
  timestamp: string;
  lng: number;
  lat: number;
}

const REFRESH_MS = 5 * 60 * 1000; // 5 minutes

export function useWeatherEvents() {
  const [eventsGeoJSON, setEventsGeoJSON] = useState<FeatureCollection | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) return;

    async function fetchEvents() {
      try {
        // Fetch last 6 hours of weather-realtime entries from hunt_knowledge
        const threeHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(
          `${supabaseUrl}/rest/v1/hunt_knowledge?select=title,content,content_type,created_at&content_type=eq.weather-realtime&created_at=gte.${threeHoursAgo}&order=created_at.desc&limit=100`,
          {
            headers: {
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`,
            },
            signal: controller.signal,
          }
        );
        clearTimeout(timeout);
        if (!res.ok) return;

        const rows = await res.json();
        if (cancelled || !Array.isArray(rows)) return;

        const features: Feature[] = [];

        for (const row of rows) {
          // Parse station from title (e.g., "METAR Alert: KLIT - Temperature Drop")
          const stationMatch = (row.title || '').match(/([A-Z]{4})/);
          const station = stationMatch?.[1];
          if (!station || !STATION_COORDS[station]) continue;

          const [lng, lat] = STATION_COORDS[station];

          // Determine severity from content
          const content = (row.content || '').toLowerCase();
          let severity = 'low';
          if (content.includes('front passage') || content.includes('rapid') || content.includes('severe')) {
            severity = 'high';
          } else if (content.includes('significant') || content.includes('wind shift') || content.includes('temperature drop')) {
            severity = 'medium';
          }

          // Determine event type
          let eventType = 'weather-event';
          if (content.includes('front passage') || content.includes('front')) {
            eventType = 'front-passage';
          } else if (content.includes('temperature drop') || content.includes('temp drop')) {
            eventType = 'temp-drop';
          } else if (content.includes('wind shift')) {
            eventType = 'wind-shift';
          } else if (content.includes('pressure')) {
            eventType = 'pressure-change';
          }

          features.push({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {
              station,
              eventType,
              severity,
              title: row.title || '',
              content: (row.content || '').slice(0, 200),
              timestamp: row.created_at,
            },
          });
        }

        // Deduplicate — keep latest event per station
        const byStation = new Map<string, Feature>();
        for (const f of features) {
          const s = f.properties?.station;
          if (!byStation.has(s)) byStation.set(s, f);
        }

        setEventsGeoJSON({
          type: 'FeatureCollection',
          features: Array.from(byStation.values()),
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          console.warn('Request timed out: weather events');
        }
      }
    }

    fetchEvents();
    timerRef.current = setInterval(fetchEvents, REFRESH_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return { eventsGeoJSON };
}
