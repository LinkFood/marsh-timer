import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface IntelItem {
  id: string;
  title: string;
  content: string;
  content_type: string;
  state_abbr: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function useIntelligenceFeed(filterType?: string) {
  const [items, setItems] = useState<IntelItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchFeed() {
      try {
        const body: Record<string, unknown> = { limit: 50 };
        if (filterType) body.content_type = filterType;

        const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-intelligence-feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: SUPABASE_KEY },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const data = await res.json();
        if (Array.isArray(data)) {
          setItems(data);
          setError(null);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch feed');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    fetchFeed();
    intervalRef.current = setInterval(fetchFeed, 2 * 60 * 1000); // 2min refresh

    return () => {
      controller.abort();
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [filterType]);

  return { items, loading, error };
}
