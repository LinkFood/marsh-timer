import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * useDayArchive — direct REST reads for the Archive date page.
 *
 * Everything here is a bounded indexed query: content_type IN (...) +
 * effective_date = eq + optional state_abbr. One request per domain group,
 * one estimated-count HEAD for the day total. No LLM on load.
 */

export interface ArchiveEntry {
  title: string;
  content: string;
  content_type: string;
  state_abbr: string | null;
  signal_weight: number | null;
}

export interface DomainGroupResult {
  key: string;
  label: string;
  entries: ArchiveEntry[];
}

export const DOMAIN_GROUPS: { key: string; label: string; types: string[] }[] = [
  { key: 'weather', label: 'Weather', types: ['ghcn-daily', 'weather-event', 'nws-alert'] },
  { key: 'storms', label: 'Storms', types: ['storm-event'] },
  { key: 'water', label: 'Water', types: ['river-discharge', 'usgs-water', 'tide-gauge', 'noaa-tide', 'ocean-buoy'] },
  { key: 'land', label: 'Drought & Land', types: ['drought-weekly', 'drought-index', 'soil-conditions', 'snotel-daily', 'snow-cover-monthly', 'crop-progress-weekly'] },
  { key: 'life', label: 'Life', types: ['migration-spike-extreme', 'migration-spike-significant', 'migration-daily', 'birdweather-acoustic', 'inaturalist-daily', 'bio-absence-signal', 'bio-environmental-correlation'] },
  { key: 'sky', label: 'Sky & Space', types: ['geomagnetic-kp', 'space-weather', 'astronomical', 'astronomical-event', 'nasa-daily'] },
  { key: 'climate', label: 'Climate', types: ['climate-index', 'climate-index-daily'] },
  { key: 'quakes', label: 'Quakes', types: ['earthquake-event'] },
  { key: 'air', label: 'Air', types: ['air-quality'] },
  { key: 'fire', label: 'Fire', types: ['wildfire-perimeter'] },
];

export function useDayArchive(dateStr: string | undefined, state: string | null) {
  const [groups, setGroups] = useState<DomainGroupResult[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase || !dateStr) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setGroups([]);
    setTotal(null);

    // One bounded indexed query per domain group
    const groupQueries = DOMAIN_GROUPS.map(g => {
      let q = supabase!
        .from('hunt_knowledge')
        .select('title,content,content_type,state_abbr,signal_weight')
        .eq('effective_date', dateStr)
        .in('content_type', g.types)
        .order('signal_weight', { ascending: false, nullsFirst: false })
        .limit(5);
      if (state) q = q.eq('state_abbr', state);
      return q;
    });

    Promise.all(groupQueries).then(results => {
      if (cancelled) return;
      const found: DomainGroupResult[] = [];
      results.forEach((res, i) => {
        const data = (res.data || []) as ArchiveEntry[];
        if (data.length > 0) found.push({ key: DOMAIN_GROUPS[i].key, label: DOMAIN_GROUPS[i].label, entries: data });
      });
      setGroups(found);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });

    // Day total — estimated HEAD count; omit silently on error
    let countQ = supabase
      .from('hunt_knowledge')
      .select('id', { count: 'estimated', head: true })
      .eq('effective_date', dateStr);
    if (state) countQ = countQ.eq('state_abbr', state);
    countQ.then(({ count, error }) => {
      if (!cancelled && !error && count != null && count > 0) setTotal(count);
    });

    return () => { cancelled = true; };
  }, [dateStr, state]);

  return { groups, total, loading };
}

/**
 * useArchaeologyTimeline — ±14-day presence probe around the selected date.
 *
 * 4 rare-event probes × 2 half-windows = exactly 8 REST calls, each a cheap
 * select of effective_date only. Aggregated client-side into per-day category
 * dots. If a half-window response saturates the 1000-row cap, every day in
 * that window is marked present for that probe (presence is near-certain).
 */

export interface TimelineDay {
  date: string;           // YYYY-MM-DD
  cats: string[];         // present probe categories
}

const PROBES: { cat: string; types: string[] }[] = [
  { cat: 'storm', types: ['storm-event'] },
  { cat: 'migration', types: ['migration-spike-extreme', 'migration-spike-significant'] },
  { cat: 'anomaly', types: ['anomaly-alert'] },
  { cat: 'alert', types: ['nws-alert'] },
];

export const PROBE_COLORS: Record<string, string> = {
  storm: 'bg-rose-400',
  migration: 'bg-cyan-400',
  anomaly: 'bg-violet-400',
  alert: 'bg-amber-400',
};

export const PROBE_LABELS: Record<string, string> = {
  storm: 'storms',
  migration: 'migration spikes',
  anomaly: 'anomalies',
  alert: 'NWS alerts',
};

export function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function useArchaeologyTimeline(dateStr: string | undefined, state: string | null) {
  const [days, setDays] = useState<TimelineDay[]>([]);

  useEffect(() => {
    if (!supabase || !dateStr) return;
    let cancelled = false;
    setDays([]);

    const start = shiftDate(dateStr, -14);
    const end = shiftDate(dateStr, 14);
    // Two half-windows: [start, dateStr] and [day+1, end]
    const windows: [string, string][] = [[start, dateStr], [shiftDate(dateStr, 1), end]];

    const queries = PROBES.flatMap(probe =>
      windows.map(([from, to]) => {
        let q = supabase!
          .from('hunt_knowledge')
          .select('effective_date')
          .in('content_type', probe.types)
          .gte('effective_date', from)
          .lte('effective_date', to)
          .limit(1000);
        if (state) q = q.eq('state_abbr', state);
        return q;
      })
    );

    Promise.all(queries).then(results => {
      if (cancelled) return;
      const present = new Map<string, Set<string>>();
      results.forEach((res, i) => {
        const probe = PROBES[Math.floor(i / 2)];
        const [from, to] = windows[i % 2];
        const data = (res.data || []) as { effective_date: string }[];
        if (data.length >= 1000) {
          // Saturated window — mark every day present for this probe
          for (let d = from; d <= to; d = shiftDate(d, 1)) {
            if (!present.has(d)) present.set(d, new Set());
            present.get(d)!.add(probe.cat);
          }
        } else {
          for (const row of data) {
            const d = row.effective_date?.slice(0, 10);
            if (!d) continue;
            if (!present.has(d)) present.set(d, new Set());
            present.get(d)!.add(probe.cat);
          }
        }
      });
      const out: TimelineDay[] = [];
      for (let i = -14; i <= 14; i++) {
        const d = shiftDate(dateStr, i);
        out.push({ date: d, cats: [...(present.get(d) || [])] });
      }
      setDays(out);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [dateStr, state]);

  return { days };
}
