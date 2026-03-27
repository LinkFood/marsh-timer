import { useState, useEffect, useRef, useCallback } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// The content types that represent the brain "thinking" — not raw data ingestion
const JOURNAL_TYPES = [
  'compound-risk-alert',
  'convergence-score',
  'anomaly-alert',
  'correlation-discovery',
  'alert-grade',
  'arc-grade-reasoning',
  'arc-fingerprint',
  'state-brief',
  'disaster-watch',
  'migration-spike-extreme',
  'migration-spike-significant',
  'nws-alert',
  'weather-event',
  'bio-absence-signal',
];

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

export function useBrainJournal(stateFilter: string | null, limit = 100) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevKey = useRef<string>('');

  const fetchJournal = useCallback(async (signal?: AbortSignal) => {
    const key = `${stateFilter || 'all'}-${limit}`;
    const isNewQuery = key !== prevKey.current;
    if (isNewQuery) {
      setLoading(true);
      prevKey.current = key;
    }

    try {
      const typeFilter = JOURNAL_TYPES.map(t => `"${t}"`).join(',');
      let url = `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=in.(${typeFilter})&order=created_at.desc&limit=${limit}&select=id,title,content,content_type,state_abbr,metadata,effective_date,signal_weight,created_at`;

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
  }, [stateFilter, limit]);

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
