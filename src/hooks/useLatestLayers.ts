import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * LATEST FROM THE LAYERS — the 10 most recent notable entries across the
 * rare/interesting content types, last 3 days. One bounded query on the
 * effective_date btree index (gte bound + ordered by effective_date — the
 * sanctioned pattern; NEVER order hunt_knowledge unbounded).
 */

const NOTABLE_TYPES = [
  'anomaly-alert',
  'migration-spike-extreme',
  'migration-spike-significant',
  'nws-alert',
  'storm-event',
  'bio-absence-signal',
  'wildfire-perimeter',
];

export interface LayerItem {
  title: string;
  content_type: string;
  state_abbr: string | null;
  effective_date: string;
}

export function useLatestLayers() {
  const [items, setItems] = useState<LayerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let cancelled = false;

    const since = new Date(Date.now() - 3 * 86400_000).toISOString().slice(0, 10);

    supabase
      .from('hunt_knowledge')
      .select('title,content_type,state_abbr,effective_date')
      .in('content_type', NOTABLE_TYPES)
      .gte('effective_date', since)
      .order('effective_date', { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (cancelled || error || !Array.isArray(data)) { if (!cancelled) setLoading(false); return; }
        setItems((data as LayerItem[]).filter(r => r.title));
        setLoading(false);
      }, () => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  return { items, loading };
}
