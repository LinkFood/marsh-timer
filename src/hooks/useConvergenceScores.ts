import { useState, useEffect, useRef } from "react";

export interface ConvergenceScore {
  state_abbr: string;
  score: number;
  weather_component: number;
  solunar_component: number;
  migration_component: number;
  pattern_component: number;
  birdcast_component: number;
  reasoning: string;
  national_rank: number;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const REFRESH_MS = 30 * 60 * 1000;

function todayISO(): string {
  return new Date().toISOString().split("T")[0];
}

export function useConvergenceScores() {
  const [scores, setScores] = useState<Map<string, ConvergenceScore>>(new Map());
  const [topStates, setTopStates] = useState<ConvergenceScore[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    async function fetchScores() {
      try {
        const date = todayISO();
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/hunt_convergence_scores?date=eq.${date}&select=*&order=score.desc`,
          { headers: { apikey: SUPABASE_KEY } }
        );
        if (!res.ok) return;
        const data: any[] = await res.json();

        const map = new Map<string, ConvergenceScore>();
        const ranked: ConvergenceScore[] = data.map((row: any, i: number) => ({
          state_abbr: row.state_abbr,
          score: row.score,
          weather_component: row.weather_component,
          solunar_component: row.solunar_component,
          migration_component: row.migration_component,
          pattern_component: row.pattern_component,
          birdcast_component: row.birdcast_component ?? 0,
          reasoning: row.reasoning,
          national_rank: i + 1,
        }));

        for (const entry of ranked) {
          map.set(entry.state_abbr, entry);
        }

        setScores(map);
        setTopStates(ranked.slice(0, 10));
      } catch {
        // silent fail
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

  return { scores, topStates, loading };
}
