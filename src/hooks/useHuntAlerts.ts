import { useState, useEffect } from "react";

export interface HuntAlert {
  stateAbbr: string;
  stateName: string;
  severity: "high" | "medium";
  conditions: {
    tempDropF: number;
    windSpeedMph: number;
    pressureChangeMb: number;
    precipMm: number;
  };
  patterns: string[];
  forecastSummary: string;
}

const REFRESH_MS = 60 * 60 * 1000; // 60 minutes

export function useHuntAlerts() {
  const [alerts, setAlerts] = useState<HuntAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
    if (!supabaseUrl) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const url = `${supabaseUrl}/functions/v1/hunt-alerts`;

    async function fetchAlerts() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) {
          const list = Array.isArray(data?.alerts)
            ? data.alerts
            : Array.isArray(data)
              ? data
              : [];
          setAlerts(list);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          console.warn('Request timed out: hunt alerts');
        }
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchAlerts();
    const interval = setInterval(fetchAlerts, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { alerts, loading, error };
}
