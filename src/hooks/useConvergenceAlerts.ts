import { useState, useEffect, useRef } from "react";

export interface ConvergenceAlert {
  state_abbr: string;
  alert_type: string;
  reasoning: string;
  previous_score: number;
  score: number;
  created_at: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const REFRESH_MS = 30 * 60 * 1000;

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

export function useConvergenceAlerts() {
  const [alerts, setAlerts] = useState<ConvergenceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;

    async function fetchAlerts() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        // Try today first, fall back to yesterday (convergence alerts generated at 8:15am UTC)
        let date = todayISO();
        let res = await fetch(
          `${SUPABASE_URL}/rest/v1/hunt_convergence_alerts?date=eq.${date}&select=*&order=created_at.desc`,
          { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
        );
        clearTimeout(timeout);
        if (!res.ok) return;
        let data: any[] = await res.json();

        if (!data || data.length === 0) {
          date = yesterdayISO();
          res = await fetch(
            `${SUPABASE_URL}/rest/v1/hunt_convergence_alerts?date=eq.${date}&select=*&order=created_at.desc`,
            { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
          );
          if (!res.ok) return;
          data = await res.json();
        }

        setAlerts(
          data.map((row: any) => ({
            state_abbr: row.state_abbr,
            alert_type: row.alert_type,
            reasoning: row.reasoning,
            previous_score: row.previous_score,
            score: row.score,
            created_at: row.created_at,
          }))
        );
        fetchedRef.current = true;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          console.warn('[useConvergenceAlerts] Request timed out');
        }
      } finally {
        clearTimeout(timeout);
        setLoading(false);
      }
    }

    fetchAlerts();
    const interval = setInterval(() => {
      fetchAlerts();
    }, REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  return { alerts, loading };
}
