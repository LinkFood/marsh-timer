import { useState, useEffect, useRef } from 'react';
import type { FeatureCollection, Feature } from 'geojson';

const NWS_URL = 'https://api.weather.gov/alerts/active?status=actual&message_type=alert&region_type=land';

const HUNTING_EVENTS = new Set([
  'Winter Storm Warning',
  'Winter Storm Watch',
  'Wind Advisory',
  'Tornado Warning',
  'Tornado Watch',
  'Severe Thunderstorm Warning',
  'Severe Thunderstorm Watch',
  'Flood Warning',
  'Flood Watch',
  'Dense Fog Advisory',
  'Freeze Warning',
  'Ice Storm Warning',
  'Blizzard Warning',
]);

const REFRESH_MS = 15 * 60 * 1000; // 15 minutes

export function useNWSAlerts() {
  const [alertsGeoJSON, setAlertsGeoJSON] = useState<FeatureCollection | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchAlerts() {
      try {
        const res = await fetch(NWS_URL, {
          headers: {
            'User-Agent': 'DuckCountdown/1.0 (duckcountdown.com)',
            'Accept': 'application/geo+json',
          },
        });
        if (!res.ok) return;
        const data = await res.json() as FeatureCollection;

        if (cancelled) return;

        const features: Feature[] = (data.features || []).filter((f: Feature) => {
          if (!f.geometry) return false;
          const event = f.properties?.event;
          if (!event || !HUNTING_EVENTS.has(event)) return false;
          return true;
        }).map((f: Feature) => ({
          type: 'Feature' as const,
          geometry: f.geometry,
          properties: {
            event: f.properties?.event || '',
            severity: f.properties?.severity || 'Minor',
            headline: f.properties?.headline || '',
            description: f.properties?.description || '',
            onset: f.properties?.onset || '',
            expires: f.properties?.expires || '',
          },
        }));

        setAlertsGeoJSON({ type: 'FeatureCollection', features });
      } catch {
        // Silently fail — NWS API can be flaky
      }
    }

    fetchAlerts();
    timerRef.current = setInterval(fetchAlerts, REFRESH_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return alertsGeoJSON;
}
