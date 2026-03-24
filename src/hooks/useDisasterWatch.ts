import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export interface DisasterWatch {
  id: string;
  title: string;
  content: string;
  state_abbr: string | null;
  effective_date: string;
  created_at: string;
  metadata: {
    disaster_type?: string;
    confidence?: number;
    conditions_met?: string[];
    historical_precedents?: string[];
    lead_time?: string;
    matched_conditions?: number;
    total_conditions?: number;
  };
  outcome_grade?: string;
}

const REFRESH_MS = 60_000;

export function useDisasterWatch() {
  const [watches, setWatches] = useState<DisasterWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function fetch() {
      try {
        // Fetch disaster-watch entries
        const { data: entries, error: err } = await supabase!
          .from('hunt_knowledge')
          .select('id, title, content, state_abbr, effective_date, created_at, metadata')
          .eq('content_type', 'disaster-watch')
          .order('created_at', { ascending: false })
          .limit(20);

        if (err || cancelled) return;

        // Fetch outcome grades for these entries
        const ids = (entries || []).map(e => e.id);
        let gradeMap: Record<string, string> = {};

        if (ids.length > 0) {
          const { data: outcomes } = await supabase!
            .from('hunt_alert_outcomes')
            .select('alert_id, grade')
            .in('alert_id', ids);

          if (outcomes) {
            for (const o of outcomes) {
              gradeMap[o.alert_id] = o.grade;
            }
          }
        }

        if (cancelled) return;

        const mapped: DisasterWatch[] = (entries || []).map(e => ({
          id: e.id,
          title: e.title || '',
          content: e.content || '',
          state_abbr: e.state_abbr,
          effective_date: e.effective_date || e.created_at,
          created_at: e.created_at,
          metadata: e.metadata || {},
          outcome_grade: gradeMap[e.id],
        }));

        setWatches(mapped);
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetch();
    const interval = setInterval(fetch, REFRESH_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return { watches, loading, error };
}
