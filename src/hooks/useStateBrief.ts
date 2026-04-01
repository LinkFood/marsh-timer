import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface StateBrief {
  id: string;
  state_abbr: string;
  date: string;
  content: string;
  score: number | null;
  component_breakdown: Record<string, number> | null;
  signals: unknown[] | null;
  pattern_links: unknown[] | null;
  created_at: string;
}

export function useStateBrief(stateAbbr: string | null) {
  const [brief, setBrief] = useState<StateBrief | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!stateAbbr) { setBrief(null); return; }
    if (fetchedRef.current === stateAbbr) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    async function fetchBrief() {
      setLoading(true);
      setError(null);
      fetchedRef.current = stateAbbr;

      const today = new Date().toISOString().slice(0, 10);

      try {
        // Try today's brief
        let res = await fetch(
          `${SUPABASE_URL}/rest/v1/hunt_state_briefs?state_abbr=eq.${stateAbbr}&date=eq.${today}&select=*&limit=1`,
          { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
        );
        let data = await res.json();

        if (Array.isArray(data) && data.length > 0) {
          setBrief(data[0]);
          setLoading(false);
          return;
        }

        // Try yesterday
        const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        res = await fetch(
          `${SUPABASE_URL}/rest/v1/hunt_state_briefs?state_abbr=eq.${stateAbbr}&date=eq.${yesterday}&select=*&limit=1`,
          { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
        );
        data = await res.json();

        if (Array.isArray(data) && data.length > 0) {
          setBrief(data[0]);
          setLoading(false);
          return;
        }

        // Generate on-demand
        res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-state-brief`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
          body: JSON.stringify({ state_abbr: stateAbbr }),
          signal: controller.signal,
        });
        data = await res.json();
        if (data && data.content) {
          setBrief(data);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Failed to load brief');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    fetchBrief().finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, [stateAbbr]);

  return { brief, loading, error };
}
