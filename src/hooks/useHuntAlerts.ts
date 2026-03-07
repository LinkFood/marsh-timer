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
        const res = await fetch(url);
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
      } catch {
        // Graceful — return empty, don't crash
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

  return { alerts, loading };
}
