import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface CoincidenceSnapshot {
  activeStates: number;
  hotStates: Array<{ abbr: string; score: number }>;
  activeArcs: number;
  pendingOutcomes: number;
}

export function useCoincidenceSnapshot() {
  const [data, setData] = useState<CoincidenceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    Promise.all([
      // States with convergence score > 30 (meaningful activity — balanced 11-domain scoring)
      supabase
        .from('hunt_convergence_scores')
        .select('state_abbr,score')
        .gt('score', 30)
        .order('score', { ascending: false })
        .limit(50),
      // Active arcs (not closed)
      supabase
        .from('hunt_state_arcs')
        .select('state_abbr,current_act')
        .neq('current_act', 'closed')
        .limit(50),
    ]).then(([scoresRes, arcsRes]) => {
      const scores = scoresRes.data || [];
      const arcs = arcsRes.data || [];

      const pendingOutcomes = arcs.filter(a => a.current_act === 'outcome').length;

      setData({
        activeStates: scores.length,
        hotStates: scores.slice(0, 5).map(s => ({ abbr: s.state_abbr, score: s.score })),
        activeArcs: arcs.length,
        pendingOutcomes,
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return { data, loading };
}
