import { useState, useEffect } from 'react';

interface CronEntry {
  function_name: string;
  status: string;
  duration_ms: number;
  created_at: string;
  summary: Record<string, any> | null;
}

interface BrainActivity {
  recentCrons: CronEntry[];
  totalEmbeddingsToday: number;
  totalSearchesToday: number;
  activeCrons: number;
  lastActivity: string | null;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const REFRESH_MS = 5 * 60 * 1000; // 5 min

export function useBrainActivity() {
  const [activity, setActivity] = useState<BrainActivity>({
    recentCrons: [],
    totalEmbeddingsToday: 0,
    totalSearchesToday: 0,
    activeCrons: 0,
    lastActivity: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;

    async function fetchActivity() {
      try {
        const today = new Date().toISOString().split('T')[0];
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/hunt_cron_log?select=function_name,status,duration_ms,created_at,summary&created_at=gte.${today}T00:00:00&order=created_at.desc&limit=50`,
          { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
        );
        clearTimeout(timeout);

        if (!res.ok) return;
        const rows: CronEntry[] = await res.json();
        if (!Array.isArray(rows)) return;

        // Count embeddings from summaries
        let embeddings = 0;
        const cronNames = new Set<string>();
        for (const row of rows) {
          cronNames.add(row.function_name);
          if (row.summary && typeof row.summary === 'object') {
            embeddings += (row.summary as any).embeddings_created ?? 0;
          }
        }

        setActivity({
          recentCrons: rows.slice(0, 20),
          totalEmbeddingsToday: embeddings,
          totalSearchesToday: 0, // no easy way to count searches yet
          activeCrons: cronNames.size,
          lastActivity: rows.length > 0 ? rows[0].created_at : null,
        });
      } catch {
        // silent fail
      } finally {
        setLoading(false);
      }
    }

    fetchActivity();
    const interval = setInterval(fetchActivity, REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  return { activity, loading };
}
