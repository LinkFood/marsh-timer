import { useState, useEffect, useRef, useCallback } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const FILTER_PRESETS: Record<string, string[]> = {
  all: ['compound-risk-alert', 'convergence-score', 'anomaly-alert', 'correlation-discovery', 'alert-grade', 'arc-grade-reasoning', 'arc-fingerprint', 'state-brief', 'disaster-watch', 'migration-spike-extreme', 'migration-spike-significant', 'nws-alert', 'weather-event', 'bio-absence-signal', 'wildfire-perimeter', 'ocean-buoy', 'air-quality', 'pollen-data', 'space-weather', 'soil-conditions', 'river-discharge'],
  brain: ['compound-risk-alert', 'convergence-score', 'anomaly-alert', 'correlation-discovery', 'state-brief', 'arc-grade-reasoning', 'arc-fingerprint'],
  weather: ['weather-event', 'nws-alert', 'wildfire-perimeter', 'space-weather'],
  migration: ['migration-spike-extreme', 'migration-spike-significant', 'bio-absence-signal'],
  alerts: ['nws-alert', 'disaster-watch', 'compound-risk-alert'],
  grades: ['alert-grade', 'arc-grade-reasoning', 'arc-fingerprint'],
  environmental: ['air-quality', 'pollen-data', 'soil-conditions', 'river-discharge', 'ocean-buoy', 'wildfire-perimeter', 'space-weather'],
};

export interface JournalEntry {
  id: string;
  title: string;
  content: string;
  content_type: string;
  state_abbr: string | null;
  metadata: Record<string, unknown> | null;
  effective_date: string | null;
  signal_weight: number;
  created_at: string;
}

export function useBrainJournal(stateFilter: string | null, typeFilter: string = 'brain', limit = 100) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevKey = useRef<string>('');

  const fetchJournal = useCallback(async (signal?: AbortSignal) => {
    const key = `${stateFilter || 'all'}-${typeFilter}-${limit}`;
    const isNewQuery = key !== prevKey.current;
    if (isNewQuery) {
      setLoading(true);
      prevKey.current = key;
    }

    try {
      const types = FILTER_PRESETS[typeFilter] || FILTER_PRESETS.all;
      const typeClause = types.map(t => `"${t}"`).join(',');
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      let url = `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=in.(${typeClause})&created_at=gte.${cutoff}&order=signal_weight.desc,created_at.desc&limit=${limit}&select=id,title,content,content_type,state_abbr,metadata,effective_date,signal_weight,created_at`;

      if (stateFilter) {
        url += `&state_abbr=eq.${stateFilter}`;
      }

      const res = await fetch(url, {
        headers: { apikey: SUPABASE_KEY },
        signal,
      });
      const data = await res.json();
      if (Array.isArray(data)) {
        setEntries(data);
        setHasMore(data.length >= limit);
      }
    } catch { /* abort */ }
    finally { setLoading(false); }
  }, [stateFilter, typeFilter, limit]);

  useEffect(() => {
    const controller = new AbortController();
    fetchJournal(controller.signal);

    // Refresh every 45s
    intervalRef.current = setInterval(() => fetchJournal(), 45_000);

    return () => {
      controller.abort();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchJournal]);

  return { entries, loading, hasMore, refetch: fetchJournal };
}
