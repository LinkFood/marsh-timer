import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * v2 court grades — matched-control regrades of alert outcomes.
 *
 * The court block lives inside hunt_alert_outcomes.outcome_signals_found as
 * { signals, court } where court.grade_version === 2 marks an honest grade.
 * jsonb-path filters are awkward via PostgREST, so we fetch recent graded rows
 * (limit 200) and filter client-side. Single fetch per mount.
 */

export interface V2Grades {
  loading: boolean;
  v2Total: number;
  discriminatingHits: number; // confirmed AND lift > 1 against matched controls
}

interface OutcomeRow {
  outcome_grade: string | null;
  outcome_signals_found: { court?: { grade_version?: number; lift?: number } } | null;
}

export function useV2Grades(): V2Grades {
  const [state, setState] = useState<V2Grades>({ loading: true, v2Total: 0, discriminatingHits: 0 });
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      setState({ loading: false, v2Total: 0, discriminatingHits: 0 });
      return;
    }

    fetch(
      `${SUPABASE_URL}/rest/v1/hunt_alert_outcomes?select=outcome_grade,outcome_signals_found&outcome_grade=not.is.null&order=graded_at.desc&limit=200`,
      { headers: { apikey: SUPABASE_KEY } }
    )
      .then(async res => {
        if (!res.ok) {
          setState({ loading: false, v2Total: 0, discriminatingHits: 0 });
          return;
        }
        const rows: OutcomeRow[] = await res.json();
        if (!Array.isArray(rows)) {
          setState({ loading: false, v2Total: 0, discriminatingHits: 0 });
          return;
        }
        const v2Rows = rows.filter(r => r.outcome_signals_found?.court?.grade_version === 2);
        const discriminatingHits = v2Rows.filter(
          r => r.outcome_grade === 'confirmed' && Number(r.outcome_signals_found?.court?.lift) > 1
        ).length;
        setState({ loading: false, v2Total: v2Rows.length, discriminatingHits });
      })
      .catch(() => setState({ loading: false, v2Total: 0, discriminatingHits: 0 }));
  }, []);

  return state;
}
