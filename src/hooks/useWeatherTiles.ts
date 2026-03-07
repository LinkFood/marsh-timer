import { useState, useEffect } from "react";

export interface WeatherTiles {
  radar: string | null;
  temperature: string | null;
  wind: string | null;
  clouds: string | null;
  pressure: string | null;
}

const EMPTY: WeatherTiles = {
  radar: null,
  temperature: null,
  wind: null,
  clouds: null,
  pressure: null,
};

const OWM_LAYERS: Record<keyof WeatherTiles, string> = {
  radar: "precipitation_new",
  temperature: "temp_new",
  wind: "wind_new",
  clouds: "clouds_new",
  pressure: "pressure_new",
};

export function useWeatherTiles(): WeatherTiles {
  const [tiles, setTiles] = useState<WeatherTiles>(EMPTY);

  useEffect(() => {
    const owmKey = import.meta.env.VITE_OWM_API_KEY;

    if (owmKey) {
      // OWM Weather Maps 1.0 — tiles update server-side every 3h, no polling needed
      const result: WeatherTiles = {} as WeatherTiles;
      for (const [key, layer] of Object.entries(OWM_LAYERS)) {
        result[key as keyof WeatherTiles] =
          `https://tile.openweathermap.org/map/${layer}/{z}/{x}/{y}.png?appid=${owmKey}`;
      }
      setTiles(result);
      return;
    }

    // Fallback: RainViewer for radar only (no API key needed)
    let cancelled = false;

    async function fetchRadar() {
      try {
        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        if (!res.ok) return;
        const data = await res.json();
        const frames = data?.radar?.past;
        if (!frames || frames.length === 0) return;
        const latest = frames[frames.length - 1];
        const url = `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
        if (!cancelled) setTiles({ ...EMPTY, radar: url });
      } catch {
        // silent fail
      }
    }

    fetchRadar();
    const interval = setInterval(fetchRadar, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return tiles;
}
