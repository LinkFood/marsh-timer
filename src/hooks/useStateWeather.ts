import { useState, useEffect, useRef } from 'react';

export interface WeatherHistoryEntry {
  date: string;
  temp_high_f: number;
  temp_low_f: number;
  wind_speed_avg_mph: number;
  pressure_avg_msl: number;
  precipitation_total_mm: number;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export function useStateWeather(stateAbbr: string | null) {
  const [data, setData] = useState<WeatherHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!stateAbbr || !SUPABASE_URL || !SUPABASE_KEY) {
      setData([]);
      return;
    }

    if (fetchedRef.current === stateAbbr) return;

    setLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    fetch(
      `${SUPABASE_URL}/rest/v1/hunt_weather_history?state_abbr=eq.${stateAbbr}&order=date.desc&limit=30&select=date,temp_high_f,temp_low_f,wind_speed_avg_mph,pressure_avg_msl,precipitation_total_mm`,
      { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
    )
      .then(r => r.json())
      .then((rows: any[]) => {
        if (Array.isArray(rows)) {
          setData(
            rows
              .map(r => ({
                date: r.date,
                temp_high_f: r.temp_high_f ?? 0,
                temp_low_f: r.temp_low_f ?? 0,
                wind_speed_avg_mph: r.wind_speed_avg_mph ?? 0,
                pressure_avg_msl: r.pressure_avg_msl ?? 0,
                precipitation_total_mm: r.precipitation_total_mm ?? 0,
              }))
              .reverse() // chronological order
          );
          fetchedRef.current = stateAbbr;
        }
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [stateAbbr]);

  return { data, loading };
}
