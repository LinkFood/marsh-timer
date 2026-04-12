import { useState, useEffect } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Fetches today's brain entry count via the hunt_entries_today RPC.
 * Fast (~300ms) — uses the created_at index directly.
 * The today-briefing function can't include this because an in-function
 * count with date filter on 7M rows takes 23+ seconds.
 */
export function useEntriesToday() {
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!SUPABASE_URL) { setLoading(false); return; }

    fetch(`${SUPABASE_URL}/rest/v1/rpc/hunt_entries_today`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
      .then(r => r.ok ? r.json() : 0)
      .then((val: number) => {
        setCount(typeof val === 'number' ? val : 0);
      })
      .catch(() => setCount(0))
      .finally(() => setLoading(false));

    // Refresh every 5 minutes
    const interval = setInterval(() => {
      fetch(`${SUPABASE_URL}/rest/v1/rpc/hunt_entries_today`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey': SUPABASE_KEY,
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
        .then(r => r.ok ? r.json() : null)
        .then((val: number) => {
          if (typeof val === 'number') setCount(val);
        })
        .catch(() => {});
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  return { count, loading };
}
