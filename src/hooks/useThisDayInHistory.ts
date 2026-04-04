import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface HistoricalEntry {
  year: number;
  title: string;
  content: string;
  content_type: string;
  state_abbr: string | null;
}

export function useThisDayInHistory() {
  const [entries, setEntries] = useState<HistoricalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    // Query storm events and notable entries for this calendar date across years
    // Pick a spread of years to show variety
    const years = [1995, 2000, 2005, 2010, 2015, 2020];
    const queries = years.map(yr => {
      const dateStr = `${yr}-${month}-${day}`;
      return supabase
        .from('hunt_knowledge')
        .select('title,content,content_type,state_abbr,effective_date')
        .eq('effective_date', dateStr)
        .in('content_type', ['storm-event', 'climate-index', 'earthquake-event', 'drought-weekly'])
        .order('signal_weight', { ascending: false })
        .limit(1);
    });

    Promise.all(queries).then(results => {
      const found: HistoricalEntry[] = [];
      for (const { data } of results) {
        if (data && data.length > 0) {
          const entry = data[0];
          const yr = parseInt(entry.effective_date?.slice(0, 4) || '0', 10);
          found.push({
            year: yr,
            title: entry.title || '',
            content: entry.content?.slice(0, 150) || '',
            content_type: entry.content_type || '',
            state_abbr: entry.state_abbr || null,
          });
        }
      }
      setEntries(found.sort((a, b) => a.year - b.year));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return { entries, loading };
}
