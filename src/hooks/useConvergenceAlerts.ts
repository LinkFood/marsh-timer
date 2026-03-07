import { useState, useEffect, useRef } from "react";

export interface ConvergenceAlert {
  state_abbr: string;
  alert_type: string;
  message: string;
  score_before: number;
  score_after: number;
  created_at: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const REFRESH_MS = 30 * 60 * 1000;

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export function useConvergenceAlerts() {
  const [alerts, setAlerts] = useState<ConvergenceAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    async function fetchAlerts() {
      try {
        const date = todayISO();
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/hunt_convergence_alerts?date=eq.${date}&select=*&order=created_at.desc`,
          { headers: { apikey: SUPABASE_KEY } }
        );
        if (!res.ok) return;
        const data: any[] = await res.json();

        setAlerts(
          data.map((row: any) => ({
            state_abbr: row.state_abbr,
            alert_type: row.alert_type,
            message: row.message,
            score_before: row.score_before,
            score_after: row.score_after,
            created_at: row.created_at,
          }))
        );
      } catch {
        // silent fail
      } finally {
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
