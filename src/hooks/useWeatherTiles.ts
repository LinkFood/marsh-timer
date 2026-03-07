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

export function useWeatherTiles(): WeatherTiles {
  const [tiles, setTiles] = useState<WeatherTiles>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const owmKey = import.meta.env.VITE_OWM_API_KEY;

    // OWM layers (temp, wind, clouds, pressure) — only if key exists
    const owmTiles: Partial<WeatherTiles> = {};
    if (owmKey) {
      const layers: Record<string, string> = {
        temperature: "temp_new",
        wind: "wind_new",
        clouds: "clouds_new",
        pressure: "pressure_new",
      };
      for (const [key, layer] of Object.entries(layers)) {
        owmTiles[key as keyof WeatherTiles] =
          `https://tile.openweathermap.org/map/${layer}/{z}/{x}/{y}.png?appid=${owmKey}`;
      }
    }

    // Always use RainViewer for radar (free, no key, updates every 10min)
    async function fetchRadar() {
      try {
        const res = await fetch("https://api.rainviewer.com/public/weather-maps.json");
        if (!res.ok) return;
        const data = await res.json();
        const frames = data?.radar?.past;
        if (!frames || frames.length === 0) return;
        const latest = frames[frames.length - 1];
        const url = `https://tilecache.rainviewer.com${latest.path}/256/{z}/{x}/{y}/2/1_1.png`;
        if (!cancelled) {
          setTiles({
            radar: url,
            temperature: owmTiles.temperature || null,
            wind: owmTiles.wind || null,
            clouds: owmTiles.clouds || null,
            pressure: owmTiles.pressure || null,
          });
        }
      } catch {
        // Still set OWM tiles even if radar fails
        if (!cancelled && owmKey) {
          setTiles({
            radar: null,
            temperature: owmTiles.temperature || null,
            wind: owmTiles.wind || null,
            clouds: owmTiles.clouds || null,
            pressure: owmTiles.pressure || null,
          });
        }
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
