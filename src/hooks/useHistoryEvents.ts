import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface HistoryEvent {
  date: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  content: string;
}

export function useHistoryEvents(days = 30) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || !SUPABASE_URL || !SUPABASE_KEY) return;

    const since = new Date();
    since.setDate(since.getDate() - days);
    const sinceStr = since.toISOString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    // Fetch weather-realtime events from hunt_knowledge for last N days
    fetch(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?select=title,content,created_at&content_type=eq.weather-realtime&created_at=gte.${sinceStr}&order=created_at.asc&limit=500`,
      {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        signal: controller.signal,
      }
    )
      .then(r => r.json())
      .then((rows: unknown) => {
        if (!Array.isArray(rows)) return;

        const parsed: HistoryEvent[] = rows.map((row: Record<string, unknown>) => {
          const contentStr = String(row.content ?? '').toLowerCase();
          let severity: 'high' | 'medium' | 'low' = 'low';
          if (contentStr.includes('front passage') || contentStr.includes('rapid') || contentStr.includes('severe')) {
            severity = 'high';
          } else if (contentStr.includes('significant') || contentStr.includes('wind shift') || contentStr.includes('temperature drop')) {
            severity = 'medium';
          }

          const createdAt = String(row.created_at ?? '');
          const date = createdAt.split('T')[0];

          return {
            date,
            severity,
            title: String(row.title ?? ''),
            content: String(row.content ?? '').slice(0, 200),
          };
        });

        setEvents(parsed);
        fetchedRef.current = true;
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout);
        setLoading(false);
      });

    return () => { controller.abort(); clearTimeout(timeout); };
  }, [days]);

  return { events, loading };
}
