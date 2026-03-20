import { useState, useEffect, useRef } from "react";

export interface ConvergenceScore {
  state_abbr: string;
  score: number;
  weather_component: number;
  solunar_component: number;
  migration_component: number;
  pattern_component: number;
  birdcast_component: number;
  water_component: number;
  photoperiod_component: number;
  tide_component: number;
  reasoning: string;
  national_rank: number;
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

export function useConvergenceScores() {
  const [scores, setScores] = useState<Map<string, ConvergenceScore>>(new Map());
  const [topStates, setTopStates] = useState<ConvergenceScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    async function fetchScores() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        // Try today first, fall back to yesterday if empty (convergence engine runs at 8am UTC)
        let date = todayISO();
        let res = await fetch(
          `${SUPABASE_URL}/rest/v1/hunt_convergence_scores?date=eq.${date}&select=*&order=score.desc`,
          { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
        );
        clearTimeout(timeout);
        if (!res.ok) return;
        let data: any[] = await res.json();

        if (!data || data.length === 0) {
          date = yesterdayISO();
          const controller2 = new AbortController();
          const timeout2 = setTimeout(() => controller2.abort(), 10000);
          res = await fetch(
            `${SUPABASE_URL}/rest/v1/hunt_convergence_scores?date=eq.${date}&select=*&order=score.desc`,
            { headers: { apikey: SUPABASE_KEY }, signal: controller2.signal }
          );
          clearTimeout(timeout2);
          if (!res.ok) return;
          data = await res.json();
        }

        const map = new Map<string, ConvergenceScore>();
        const ranked: ConvergenceScore[] = data.map((row: any, i: number) => ({
          state_abbr: row.state_abbr,
          score: row.score,
          weather_component: row.weather_component,
          solunar_component: row.solunar_component,
          migration_component: row.migration_component,
          pattern_component: row.pattern_component,
          birdcast_component: row.birdcast_component ?? 0,
          water_component: row.water_component ?? 0,
          photoperiod_component: row.photoperiod_component ?? 0,
          tide_component: row.tide_component ?? 0,
          reasoning: row.reasoning,
          national_rank: i + 1,
        }));

        for (const entry of ranked) {
          map.set(entry.state_abbr, entry);
        }

        setScores(map);
        setTopStates(ranked.slice(0, 10));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          console.warn('Request timed out: convergence scores');
        }
        setError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchScores();
    const interval = setInterval(() => {
      fetchScores();
    }, REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  return { scores, topStates, loading, error };
}
