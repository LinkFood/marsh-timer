import { useState, useEffect, useRef } from 'react';

interface ConvergenceHistoryEntry {
  date: string;
  score: number;
  weather_component: number;
  solunar_component: number;
  migration_component: number;
  pattern_component: number;
  birdcast_component: number;
  water_component: number;
  photoperiod_component: number;
  tide_component: number;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export function useConvergenceHistory(stateAbbr: string | null, days = 30) {
  const [history, setHistory] = useState<ConvergenceHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!stateAbbr || !SUPABASE_URL || !SUPABASE_KEY) {
      setHistory([]);
      return;
    }

    // Don't refetch for same state
    if (fetchedRef.current === stateAbbr) return;

    setLoading(true);

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    fetch(
      `${SUPABASE_URL}/rest/v1/hunt_convergence_scores?state_abbr=eq.${stateAbbr}&date=gte.${sinceStr}&select=date,score,weather_component,solunar_component,migration_component,pattern_component,birdcast_component,water_component,photoperiod_component,tide_component&order=date.asc`,
      { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
    )
      .then(r => r.json())
      .then((rows: any[]) => {
        if (Array.isArray(rows)) {
          setHistory(rows.map(r => ({
            date: r.date,
            score: r.score ?? 0,
            weather_component: r.weather_component ?? 0,
            solunar_component: r.solunar_component ?? 0,
            migration_component: r.migration_component ?? 0,
            pattern_component: r.pattern_component ?? 0,
            birdcast_component: r.birdcast_component ?? 0,
            water_component: r.water_component ?? 0,
            photoperiod_component: r.photoperiod_component ?? 0,
            tide_component: r.tide_component ?? 0,
          })));
          fetchedRef.current = stateAbbr;
        }
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    return () => { controller.abort(); clearTimeout(timeout); };
  }, [stateAbbr, days]);

  return { history, loading };
}

/** Fetch convergence history for ALL states (last N days), returns Map<state, scores[]> */
export function useConvergenceHistoryAll(days = 14) {
  const [historyMap, setHistoryMap] = useState<Map<string, number[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || !SUPABASE_URL || !SUPABASE_KEY) return;

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    fetch(
      `${SUPABASE_URL}/rest/v1/hunt_convergence_scores?date=gte.${sinceStr}&select=state_abbr,date,score&order=date.asc&limit=1000`,
      { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
    )
      .then(r => r.json())
      .then((rows: any[]) => {
        if (!Array.isArray(rows)) return;
        const map = new Map<string, number[]>();
        for (const row of rows) {
          const arr = map.get(row.state_abbr) || [];
          arr.push(row.score);
          map.set(row.state_abbr, arr);
        }
        setHistoryMap(map);
        fetchedRef.current = true;
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    return () => { controller.abort(); clearTimeout(timeout); };
  }, [days]);

  return { historyMap, loading };
}
