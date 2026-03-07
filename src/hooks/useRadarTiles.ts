import { useState, useEffect } from "react";

export function useRadarTiles() {
  const [tileUrl, setTileUrl] = useState<string | null>(null);

  useEffect(() => {
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
        if (!cancelled) setTileUrl(url);
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

  return tileUrl;
}
