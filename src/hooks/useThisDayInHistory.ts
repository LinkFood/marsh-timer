import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface HistoricalEntry {
  year: number;
  title: string;
  content: string;
  content_type: string;
  state_abbr: string | null;
}

// Every 5 years from 1950-2025
const YEARS = Array.from({ length: 16 }, (_, i) => 1950 + i * 5);

// High-value content types with deep historical effective_date coverage
const CONTENT_TYPES = [
  'storm-event',
  'climate-index',
  'climate-index-daily',
  'earthquake-event',
  'drought-weekly',
  'drought-index',
  'ghcn-daily',
  'astronomical',
  'astronomical-event',
  'space-weather',
  'noaa-tide',
  'tide-gauge',
  'ocean-buoy',
  'river-discharge',
  'usgs-water',
  'soil-conditions',
  'snotel-daily',
  'crop-progress',
  'crop-progress-weekly',
  'snow-cover-monthly',
  'glerl-ice-cover',
  'geomagnetic-kp',
  'nasa-daily',
  'air-quality',
];

const MAX_ENTRIES = 15;

export function useThisDayInHistory() {
  const [entries, setEntries] = useState<HistoricalEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    // One lightweight query per year — each hits the effective_date index
    const queries = YEARS.map(yr => {
      const dateStr = `${yr}-${month}-${day}`;
      return supabase
        .from('hunt_knowledge')
        .select('title,content,content_type,state_abbr,effective_date')
        .eq('effective_date', dateStr)
        .in('content_type', CONTENT_TYPES)
        .order('signal_weight', { ascending: false })
        .limit(3);
    });

    Promise.all(queries).then(results => {
      const found: HistoricalEntry[] = [];
      const seenTypes = new Set<string>();

      for (const { data } of results) {
        if (!data || data.length === 0) continue;
        // Pick the best entry per year that adds content_type diversity
        for (const entry of data) {
          const yr = parseInt(entry.effective_date?.slice(0, 4) || '0', 10);
          const key = `${yr}-${entry.content_type}`;
          if (seenTypes.has(key)) continue;
          seenTypes.add(key);
          found.push({
            year: yr,
            title: entry.title || '',
            content: entry.content?.slice(0, 150) || '',
            content_type: entry.content_type || '',
            state_abbr: entry.state_abbr || null,
          });
          break; // one entry per year
        }
      }

      // Sort by year, cap total
      setEntries(found.sort((a, b) => a.year - b.year).slice(0, MAX_ENTRIES));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return { entries, loading };
}
