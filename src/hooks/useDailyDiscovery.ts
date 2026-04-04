import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface DailyDiscovery {
  headline: string;
  discovery: string;
  state: string | null;
  domains: string[];
  dejaVu: { date: string; similarity: number; summary: string } | null;
  date: string;
}

export function useDailyDiscovery() {
  const [data, setData] = useState<DailyDiscovery | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    const today = new Date().toISOString().split('T')[0];

    supabase
      .from('hunt_knowledge')
      .select('content,metadata,effective_date')
      .eq('content_type', 'daily-discovery')
      .order('effective_date', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data: row }) => {
        if (row?.metadata) {
          const meta = row.metadata as Record<string, unknown>;
          setData({
            headline: (meta.headline as string) || 'Daily Discovery',
            discovery: (meta.discovery as string) || row.content || '',
            state: (meta.state as string) || null,
            domains: (meta.domains as string[]) || [],
            dejaVu: (meta.deja_vu as DailyDiscovery['dejaVu']) || null,
            date: row.effective_date || today,
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return { discovery: data, loading };
}
