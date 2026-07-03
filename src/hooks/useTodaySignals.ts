import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Today-page observed-condition signals. Direct PostgREST reads only —
 * small tables / indexed columns, zero LLM, one fetch per state change.
 */

export interface BirdDay {
  date: string;
  cumulative_birds: number | null;
  avg_direction: number | null;
  is_high: boolean | null;
}

export interface AnomalyToday {
  checkName: string;
  zScore: number;
  direction: string;
  severity: string;
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function degreesToCompass(deg: number): string {
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}

/** Last 14 days of BirdCast radar migration for a state (hunt_birdcast — small table). */
export function useBirdActivity(stateAbbr: string) {
  const [days, setDays] = useState<BirdDay[]>([]);

  useEffect(() => {
    if (!supabase || !stateAbbr) return;
    let cancelled = false;
    supabase
      .from('hunt_birdcast')
      .select('date,cumulative_birds,avg_direction,is_high')
      .eq('state_abbr', stateAbbr)
      .order('date', { ascending: false })
      .limit(14)
      .then(
        ({ data }) => { if (!cancelled && Array.isArray(data)) setDays(data as BirdDay[]); },
        () => {},
      );
    return () => { cancelled = true; };
  }, [stateAbbr]);

  return {
    latest: days[0] ?? null,
    history: [...days].reverse(), // oldest → newest for the sparkline
  };
}

/**
 * Today's 2σ anomaly for this state, if the detector wrote one.
 * hunt-anomaly-detector embeds content_type 'anomaly-alert' with
 * effective_date = today and state_abbr for state-grouped checks.
 * Bounded effective_date query — hits the btree index.
 */
export function useTodayAnomaly(stateAbbr: string) {
  const [anomaly, setAnomaly] = useState<AnomalyToday | null>(null);

  useEffect(() => {
    if (!supabase || !stateAbbr) return;
    let cancelled = false;
    setAnomaly(null);
    const today = new Date().toISOString().slice(0, 10);
    supabase
      .from('hunt_knowledge')
      .select('metadata')
      .eq('content_type', 'anomaly-alert')
      .eq('effective_date', today)
      .eq('state_abbr', stateAbbr)
      .limit(1)
      .then(
        ({ data }) => {
          if (cancelled || !Array.isArray(data) || data.length === 0) return;
          const m = (data[0].metadata ?? {}) as Record<string, unknown>;
          if (typeof m.z_score !== 'number') return;
          setAnomaly({
            checkName: String(m.check_name || 'Signal'),
            zScore: m.z_score,
            direction: String(m.direction || 'above'),
            severity: String(m.severity || 'elevated'),
          });
        },
        () => {},
      );
    return () => { cancelled = true; };
  }, [stateAbbr]);

  return anomaly;
}
