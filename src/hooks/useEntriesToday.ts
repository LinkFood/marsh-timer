import { useState, useEffect } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Estimates today's brain entry count from cron_log summaries.
 * The old approach (count(*) on hunt_knowledge WHERE created_at >= today)
 * times out on 7M rows. Instead, sum up the embedded/inserted counts
 * that each cron function reports in its log entries — same approach
 * the daily digest uses.
 */
export function useEntriesToday() {
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const fetchCount = () => {
    if (!SUPABASE_URL) return Promise.resolve(0);

    const today = new Date().toISOString().slice(0, 10);
    const url = `${SUPABASE_URL}/rest/v1/hunt_cron_log?select=summary&status=eq.success&created_at=gte.${today}&limit=500`;

    return fetch(url, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY!,
      },
    })
      .then(r => r.ok ? r.json() : [])
      .then((rows: Array<{ summary: Record<string, unknown> | null }>) => {
        let total = 0;
        const EMBED_KEYS = ['embedded', 'embeddings_created', 'inserted', 'states_embedded'];
        for (const row of rows) {
          const s = row.summary || {};
          for (const key of EMBED_KEYS) {
            const v = s[key];
            if (typeof v === 'number' && v > 0) {
              total += v;
              break; // one key per log entry to avoid double-counting
            }
          }
        }
        return total;
      })
      .catch(() => 0);
  };

  useEffect(() => {
    fetchCount().then(v => { setCount(v); setLoading(false); });

    // Refresh every 5 minutes
    const interval = setInterval(() => {
      fetchCount().then(v => setCount(v));
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  return { count, loading };
}
