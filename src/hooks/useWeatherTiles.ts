import { useState, useEffect } from "react";

export interface WeatherTiles {
  radar: string | null;
  temperature: string | null;
}

const EMPTY: WeatherTiles = {
  radar: null,
  temperature: null,
};

export function useWeatherTiles(): WeatherTiles {
  const [tiles, setTiles] = useState<WeatherTiles>(EMPTY);

  useEffect(() => {
    let cancelled = false;
    const owmKey = import.meta.env.VITE_OWM_API_KEY;

    // OWM temperature tiles — only if key exists
    let tempUrl: string | null = null;
    if (owmKey) {
      tempUrl = `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${owmKey}`;
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
            temperature: tempUrl,
          });
        }
      } catch {
        // Still set OWM tiles even if radar fails
        if (!cancelled && tempUrl) {
          setTiles({
            radar: null,
            temperature: tempUrl,
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
