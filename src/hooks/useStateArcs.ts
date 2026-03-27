import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface StateArc {
  id: string;
  state_abbr: string;
  arc_id: string;
  current_act: 'buildup' | 'recognition' | 'outcome' | 'grade' | 'closed';
  act_started_at: string;
  opened_at: string;
  closed_at: string | null;
  buildup_signals: Record<string, unknown>;
  recognition_claim: Record<string, unknown>;
  outcome_deadline: string | null;
  outcome_signals: unknown[];
  grade: string | null;
  grade_reasoning: string | null;
  precedent_accuracy: number | null;
  narrative: string | null;
  updated_at: string;
}

export function useStateArcs() {
  const [arcs, setArcs] = useState<StateArc[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function fetch_() {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/hunt_state_arcs?current_act=neq.closed&order=updated_at.desc&select=*`,
          { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
        );
        const data = await res.json();
        if (Array.isArray(data)) setArcs(data);
      } catch { /* abort */ }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    fetch_();
    intervalRef.current = setInterval(fetch_, 30_000);
    return () => { controller.abort(); if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  return { arcs, loading };
}
