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

    // Convergence engine scores at 8am UTC. After midnight UTC and before the
    // next run, "today" in UTC is a date with no scores yet. Use yesterday as
    // fallback so the display never shows 0 states in that window.
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);

    Promise.all([
      // Try today first, fall back to yesterday
      supabase
        .from('hunt_convergence_scores')
        .select('state_abbr,score')
        .gte('date', yesterday)
        .gt('score', 30)
        .order('date', { ascending: false })
        .order('score', { ascending: false })
        .limit(50),
      // Active arcs (not closed)
      supabase
        .from('hunt_state_arcs')
        .select('state_abbr,current_act')
        .neq('current_act', 'closed')
        .limit(50),
    ]).then(([scoresRes, arcsRes]) => {
      const rawScores = scoresRes.data || [];
      const arcs = arcsRes.data || [];

      // Dedup by state_abbr — ordered by date desc so the most recent wins
      const seen = new Set<string>();
      const scores: typeof rawScores = [];
      for (const s of rawScores) {
        if (!seen.has(s.state_abbr)) {
          seen.add(s.state_abbr);
          scores.push(s);
        }
      }

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
