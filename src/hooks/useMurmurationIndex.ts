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

  useEffect(() => {
    async function fetch() {
      try {
        const res = await window.fetch(`${SUPABASE_FUNCTIONS_URL}/hunt-murmuration-index`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
          },
          body: '{}',
        });
        if (res.ok) setData(await res.json());
      } catch { /* silent */ }
      setLoading(false);
    }
    fetch();
    const interval = setInterval(fetch, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return { data, loading };
}
