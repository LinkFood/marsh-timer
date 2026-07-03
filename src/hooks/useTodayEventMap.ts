import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Today's REAL events, per state, for the landing event map.
 *
 * Doctrine: the map colors by events that actually happened — anomaly alerts,
 * radar migration spikes, NWS alerts, storm events. NEVER convergence scores.
 *
 * Three bounded PostgREST reads, all on the proven indexed pattern
 * (content_type + effective_date=eq.today + limit). nws-alert and storm-event
 * share one in.() query because they share a category (weather, red).
 */

export type EventCategory = 'anomaly' | 'birds' | 'weather';

export interface StateEvents {
  anomaly: number;
  birds: number;
  weather: number;
  total: number;
}

const BIRD_TYPES = ['migration-spike-extreme', 'migration-spike-significant', 'migration-spike-moderate'];
const WEATHER_TYPES = ['nws-alert', 'storm-event'];

interface EventRow {
  state_abbr: string | null;
}

export function useTodayEventMap() {
  const [byState, setByState] = useState<Record<string, StateEvents>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);

    Promise.all([
      supabase
        .from('hunt_knowledge')
        .select('state_abbr')
        .eq('content_type', 'anomaly-alert')
        .eq('effective_date', today)
        .limit(200),
      supabase
        .from('hunt_knowledge')
        .select('state_abbr')
        .in('content_type', BIRD_TYPES)
        .eq('effective_date', today)
        .limit(200),
      supabase
        .from('hunt_knowledge')
        .select('state_abbr')
        .in('content_type', WEATHER_TYPES)
        .eq('effective_date', today)
        .limit(200),
    ]).then(([anomalies, birds, weather]) => {
      if (cancelled) return;
      const map: Record<string, StateEvents> = {};
      const bump = (rows: EventRow[] | null, cat: EventCategory) => {
        for (const row of rows ?? []) {
          const abbr = row.state_abbr?.toUpperCase();
          if (!abbr || abbr.length !== 2) continue;
          map[abbr] ??= { anomaly: 0, birds: 0, weather: 0, total: 0 };
          map[abbr][cat]++;
          map[abbr].total++;
        }
      };
      bump(anomalies.data, 'anomaly');
      bump(birds.data, 'birds');
      bump(weather.data, 'weather');
      setByState(map);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, []);

  return {
    byState,
    loading,
    quiet: !loading && Object.keys(byState).length === 0,
  };
}
