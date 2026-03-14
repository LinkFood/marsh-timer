import { useState, useEffect } from 'react';
import { SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';

interface MurmurationData {
  index: number;
  change_pct: number;
  direction: 'up' | 'down' | 'flat';
  top_states: string[];
  spike_count: number;
  active_states: number;
}

export function useMurmurationIndex() {
  const [data, setData] = useState<MurmurationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await window.fetch(`${SUPABASE_FUNCTIONS_URL}/hunt-murmuration-index`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
          },
          body: '{}',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) setData(await res.json());
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          console.warn('Request timed out: murmuration index');
        }
        setError(true);
      }
      setLoading(false);
    }
    fetchData();
    const interval = setInterval(fetchData, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return { data, loading, error };
}
