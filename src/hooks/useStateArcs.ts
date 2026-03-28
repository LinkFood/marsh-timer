import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

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

export function useStateArcs(enabled = true) {
  const [arcs, setArcs] = useState<StateArc[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchArcs = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/hunt_state_arcs?current_act=neq.closed&order=updated_at.desc&select=*`,
        { headers: { apikey: SUPABASE_KEY }, signal }
      );
      const data = await res.json();
      if (Array.isArray(data)) setArcs(data);
    } catch { /* abort */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetchArcs(controller.signal);

    // Realtime subscription (requires supabase client)
    const channel = supabase
      ? supabase
          .channel('state-arcs-realtime')
          .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'hunt_state_arcs',
          }, (payload) => {
            const { eventType, new: newRow, old: oldRow } = payload;

            if (eventType === 'INSERT') {
              const row = newRow as StateArc;
              if (row.current_act !== 'closed') {
                setArcs(prev => [row, ...prev.filter(a => a.id !== row.id)]);
              }
            } else if (eventType === 'UPDATE') {
              const row = newRow as StateArc;
              if (row.current_act === 'closed') {
                setArcs(prev => prev.filter(a => a.id !== row.id));
              } else {
                setArcs(prev => prev.map(a => a.id === row.id ? row : a));
              }
            } else if (eventType === 'DELETE') {
              const row = oldRow as { id: string };
              setArcs(prev => prev.filter(a => a.id !== row.id));
            }
          })
          .subscribe()
      : null;

    // Safety fallback poll every 60s
    const interval = setInterval(() => fetchArcs(), 60_000);

    return () => {
      controller.abort();
      clearInterval(interval);
      if (channel && supabase) supabase.removeChannel(channel);
    };
  }, [fetchArcs, enabled]);

  return { arcs, loading };
}
