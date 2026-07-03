import { useState, useEffect } from 'react';
import { SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';

/**
 * useDaysLikeToday — the "days like today" precedent engine.
 *
 * Tries hunt-days-like-today (portrait → Voyage embedding → vector search →
 * aftermath lookups). Any timeout, fetch failure, or { degraded: true }
 * lands on status 'degraded' and the landing keeps its this-day-in-history
 * fallback exactly as-is. Self-activating: while the IVFFlat rebuild runs
 * this degrades; when the new index lands it lights up on its own.
 */

export interface PrecedentEntry {
  title: string | null;
  content_type: string | null;
  state_abbr: string | null;
}

export interface PrecedentAftermath extends PrecedentEntry {
  date: string | null;
}

export interface DayPrecedent {
  date: string;
  similarity: number;
  source_count: number;
  entries: PrecedentEntry[];
  aftermath: PrecedentAftermath[];
}

export type DaysLikeTodayStatus = 'loading' | 'ready' | 'degraded';

const FETCH_TIMEOUT_MS = 12_000; // the function's own hard cap is ~10s

export function useDaysLikeToday(stateAbbr: string | null) {
  const [status, setStatus] = useState<DaysLikeTodayStatus>('loading');
  const [precedents, setPrecedents] = useState<DayPrecedent[]>([]);

  useEffect(() => {
    if (!SUPABASE_FUNCTIONS_URL || !stateAbbr) { setStatus('degraded'); return; }
    let cancelled = false;
    setStatus('loading');
    setPrecedents([]);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    fetch(`${SUPABASE_FUNCTIONS_URL}/hunt-days-like-today?state=${stateAbbr}`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '' },
      signal: controller.signal,
    })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then(json => {
        if (cancelled) return;
        const list = Array.isArray(json?.precedents) ? (json.precedents as DayPrecedent[]) : [];
        if (json?.degraded !== false || list.length === 0) {
          setStatus('degraded');
          return;
        }
        setPrecedents(list.filter(p => p.date && Array.isArray(p.entries)));
        setStatus('ready');
      })
      .catch(() => { if (!cancelled) setStatus('degraded'); })
      .finally(() => clearTimeout(timer));

    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [stateAbbr]);

  return { status, precedents };
}
