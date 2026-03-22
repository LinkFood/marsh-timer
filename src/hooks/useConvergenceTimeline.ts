import { useState, useEffect, useRef, useMemo } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface DailyStateScore {
  state_abbr: string;
  date: string;
  score: number;
}

export interface DailyAverage {
  date: string;
  avg: number;
}

export interface TopMover {
  state: string;
  change: number;
  sparkline: number[];
}

export function useConvergenceTimeline(days = 30) {
  const [raw, setRaw] = useState<DailyStateScore[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef<number | null>(null);

  useEffect(() => {
    if (fetchedRef.current === days || !SUPABASE_URL || !SUPABASE_KEY) return;

    setLoading(true);

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString().split('T')[0];

    const controller = new AbortController();
    // Longer timeout for 365-day fetches
    const timeout = setTimeout(() => controller.abort(), days > 90 ? 30000 : 15000);

    // 50 states x days — scale limit accordingly
    const limit = Math.min(50 * days + 500, 20000);
    fetch(
      `${SUPABASE_URL}/rest/v1/hunt_convergence_scores?date=gte.${sinceStr}&select=state_abbr,date,score&order=date.asc&limit=${limit}`,
      { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
    )
      .then(r => r.json())
      .then((rows: unknown) => {
        if (Array.isArray(rows)) {
          setRaw(rows.map((r: Record<string, unknown>) => ({
            state_abbr: String(r.state_abbr ?? ''),
            date: String(r.date ?? ''),
            score: Number(r.score ?? 0),
          })));
          fetchedRef.current = days;
        }
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    return () => { controller.abort(); clearTimeout(timeout); };
  }, [days]);

  // Compute national daily averages
  const dailyAverages = useMemo<DailyAverage[]>(() => {
    if (raw.length === 0) return [];
    const byDate = new Map<string, number[]>();
    for (const r of raw) {
      const arr = byDate.get(r.date) || [];
      arr.push(r.score);
      byDate.set(r.date, arr);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, scores]) => ({
        date,
        avg: Math.round(scores.reduce((s, v) => s + v, 0) / scores.length),
      }));
  }, [raw]);

  // Compute top movers between two dates
  const getTopMovers = useMemo(() => {
    return (fromDate: string, toDate: string): TopMover[] => {
      if (raw.length === 0) return [];

      // Get scores per state for the from and to dates
      const stateScores = new Map<string, Map<string, number>>();
      for (const r of raw) {
        if (!stateScores.has(r.state_abbr)) stateScores.set(r.state_abbr, new Map());
        stateScores.get(r.state_abbr)!.set(r.date, r.score);
      }

      const movers: TopMover[] = [];
      for (const [state, dateMap] of stateScores) {
        const fromScore = dateMap.get(fromDate);
        const toScore = dateMap.get(toDate);
        if (fromScore == null || toScore == null) continue;

        // Build sparkline from all dates in range
        const sparkline: number[] = [];
        for (const da of dailyAverages) {
          if (da.date >= fromDate && da.date <= toDate) {
            const s = dateMap.get(da.date);
            if (s != null) sparkline.push(s);
          }
        }

        movers.push({
          state,
          change: toScore - fromScore,
          sparkline,
        });
      }

      // Sort by absolute change descending, take top 5
      movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
      return movers.slice(0, 5);
    };
  }, [raw, dailyAverages]);

  return { dailyAverages, getTopMovers, loading };
}
