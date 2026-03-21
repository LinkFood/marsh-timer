import { useState, useEffect, useCallback } from 'react';
import { useDeck } from '@/contexts/DeckContext';
import { useConvergenceScores } from '@/hooks/useConvergenceScores';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface PatternMatch {
  title: string;
  content: string;
  content_type: string;
  state_abbr: string | null;
  effective_date: string | null;
  similarity: number;
}

export function usePatternTimeline() {
  const { species, selectedState } = useDeck();
  const { topStates } = useConvergenceScores();
  const [matches, setMatches] = useState<PatternMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [queryDescription, setQueryDescription] = useState('');

  const fetchPatterns = useCallback(async () => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;

    // Build a query from current conditions
    const targetState = selectedState || (topStates.length > 0 ? topStates[0].state_abbr : null);
    if (!targetState) return;

    const topScore = topStates.find(s => s.state_abbr === targetState);
    const query = `Historical pattern match: ${targetState} convergence score ${topScore?.score || 'unknown'}, ${species} conditions, environmental signals aligning`;
    setQueryDescription(`Searching patterns for ${targetState}...`);
    setLoading(true);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({
          query,
          species,
          state: targetState,
          limit: 12,
        }),
      });

      if (!res.ok) { setMatches([]); return; }
      const data = await res.json();
      const entries = Array.isArray(data.vector) ? data.vector : Array.isArray(data.results) ? data.results : [];

      // Filter to pattern-like content types and sort by date
      const patternTypes = ['pattern', 'correlation', 'convergence', 'weather-event', 'migration-spike', 'anomaly'];
      const filtered = entries
        .filter((r: any) => {
          const ct = r.content_type || '';
          return patternTypes.some(pt => ct.includes(pt)) || r.similarity > 0.7;
        })
        .map((r: any) => ({
          title: r.title || '',
          content: r.content || '',
          content_type: r.content_type || '',
          state_abbr: r.state_abbr || null,
          effective_date: r.effective_date || null,
          similarity: r.similarity || 0,
        }))
        .sort((a: PatternMatch, b: PatternMatch) => {
          if (!a.effective_date || !b.effective_date) return 0;
          return new Date(b.effective_date).getTime() - new Date(a.effective_date).getTime();
        });

      setMatches(filtered);
      setQueryDescription(`${filtered.length} pattern matches for ${targetState}`);
    } catch (err) {
      console.error('[PatternTimeline] Error:', err);
      setMatches([]);
    } finally {
      setLoading(false);
    }
  }, [species, selectedState, topStates]);

  useEffect(() => {
    fetchPatterns();
  }, [fetchPatterns]);

  return { matches, loading, queryDescription, refetch: fetchPatterns };
}
