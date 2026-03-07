import { useQuery } from '@tanstack/react-query';
import { SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';

interface WeatherData {
  hourly: {
    time: string[];
    temperature_2m: number[];
    wind_speed_10m: number[];
    wind_direction_10m: number[];
    pressure_msl: number[];
    precipitation: number[];
    cloud_cover: number[];
  };
}

export function useWeather(lat: number | null, lng: number | null, stateAbbr: string | null) {
  return useQuery({
    queryKey: ['weather', stateAbbr, lat, lng],
    queryFn: async (): Promise<WeatherData | null> => {
      if (!lat || !lng || !stateAbbr || !SUPABASE_FUNCTIONS_URL) return null;

      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/hunt-weather`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat, lng, state_abbr: stateAbbr }),
      });

      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!lat && !!lng && !!stateAbbr,
    staleTime: 30 * 60 * 1000, // 30 min
  });
}
