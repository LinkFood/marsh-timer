import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface HistoricalEntry {
  year: number;
  title: string;
  content: string;
  content_type: string;
  state_abbr: string | null;
}

export interface ThisDayYear {
  year: number;
  entries: HistoricalEntry[];
  /** true when the entries came from the page's selected state */
  fromState: boolean;
}

// 5 years sampled evenly across 1950 → last year — one card per year, so the
// probe count matches exactly what the page renders (decade spread preserved).
const LAST_YEAR = new Date().getFullYear() - 1;
const YEARS = Array.from({ length: 5 }, (_, i) => Math.round(1950 + (i * (LAST_YEAR - 1950)) / 4));

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

interface RawRow {
  title: string | null;
  content: string | null;
  content_type: string | null;
  state_abbr: string | null;
  effective_date: string | null;
}

function toEntries(rows: RawRow[] | null, year: number): HistoricalEntry[] {
  return (rows ?? []).map(r => ({
    year,
    title: r.title || '',
    content: r.content?.slice(0, 150) || '',
    content_type: r.content_type || '',
    state_abbr: r.state_abbr || null,
  }));
}

/**
 * This day across the years — state-prioritized.
 *
 * For each sampled year: query the selected state FIRST (limit 2), then a
 * second wave of national-notable fallbacks ONLY for years where the state
 * had nothing. All queries hit the effective_date btree index. Worst case
 * 10 REST calls, typical ~5-7.
 *
 * @param dateStr   optional YYYY-MM-DD — anchor month/day (defaults to today).
 *                  The anchor's own year is excluded ("other years").
 * @param stateAbbr optional 2-letter state to prioritize.
 */
export function useThisDayInHistory(dateStr?: string, stateAbbr?: string | null) {
  const [years, setYears] = useState<ThisDayYear[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    const sb = supabase;
    let cancelled = false;
    setLoading(true);
    setYears([]);

    const now = new Date();
    const month = dateStr ? dateStr.slice(5, 7) : String(now.getMonth() + 1).padStart(2, '0');
    const day = dateStr ? dateStr.slice(8, 10) : String(now.getDate()).padStart(2, '0');
    const excludeYear = dateStr ? parseInt(dateStr.slice(0, 4), 10) : now.getFullYear();
    const sampleYears = YEARS.filter(yr => yr !== excludeYear);

    const nationalQuery = (yr: number) => sb
      .from('hunt_knowledge')
      .select('title,content,content_type,state_abbr,effective_date')
      .eq('effective_date', `${yr}-${month}-${day}`)
      .in('content_type', CONTENT_TYPES)
      .order('signal_weight', { ascending: false })
      .limit(3);

    const stateQuery = (yr: number, abbr: string) => sb
      .from('hunt_knowledge')
      .select('title,content,content_type,state_abbr,effective_date')
      .eq('effective_date', `${yr}-${month}-${day}`)
      .eq('state_abbr', abbr)
      .in('content_type', CONTENT_TYPES)
      .order('signal_weight', { ascending: false })
      .limit(2);

    (async () => {
      const byYear = new Map<number, ThisDayYear>();

      // Wave 1 — the selected state first
      if (stateAbbr) {
        const stateResults = await Promise.all(sampleYears.map(yr => stateQuery(yr, stateAbbr)));
        if (cancelled) return;
        stateResults.forEach((res, i) => {
          const entries = toEntries(res.data as RawRow[] | null, sampleYears[i]);
          if (entries.length > 0) byYear.set(sampleYears[i], { year: sampleYears[i], entries, fromState: true });
        });
      }

      // Wave 2 — national-notable fallback only for empty years
      const missing = sampleYears.filter(yr => !byYear.has(yr));
      if (missing.length > 0) {
        const nationalResults = await Promise.all(missing.map(yr => nationalQuery(yr)));
        if (cancelled) return;
        nationalResults.forEach((res, i) => {
          const entries = toEntries(res.data as RawRow[] | null, missing[i]);
          if (entries.length > 0) byYear.set(missing[i], { year: missing[i], entries, fromState: false });
        });
      }

      if (cancelled) return;
      setYears([...byYear.values()].sort((a, b) => a.year - b.year));
      setLoading(false);
    })().catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [dateStr, stateAbbr]);

  return { years, loading };
}
