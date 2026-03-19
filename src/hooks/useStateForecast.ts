import { useState, useEffect, useRef } from 'react';

export interface ForecastEntry {
  date: string;
  temp_high_f: number;
  temp_low_f: number;
  wind_speed_max_mph: number;
  precipitation_mm: number;
  weather_code: number;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

export function useStateForecast(stateAbbr: string | null) {
  const [data, setData] = useState<ForecastEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!stateAbbr || !SUPABASE_URL || !SUPABASE_KEY) {
      setData([]);
      return;
    }

    if (fetchedRef.current === stateAbbr) return;
    fetchedRef.current = stateAbbr;

    setLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const today = todayISO();

    fetch(
      `${SUPABASE_URL}/rest/v1/hunt_weather_forecast?state_abbr=eq.${stateAbbr}&date=gte.${today}&order=date.asc&limit=16&select=date,temp_high_f,temp_low_f,wind_speed_max_mph,precipitation_mm,weather_code`,
      { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
    )
      .then(r => r.json())
      .then((rows: any[]) => {
        if (Array.isArray(rows)) {
          setData(
            rows.map(r => ({
              date: r.date,
              temp_high_f: r.temp_high_f ?? 0,
              temp_low_f: r.temp_low_f ?? 0,
              wind_speed_max_mph: r.wind_speed_max_mph ?? 0,
              precipitation_mm: r.precipitation_mm ?? 0,
              weather_code: r.weather_code ?? 0,
            }))
          );
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
