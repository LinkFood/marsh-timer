import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface DailyDiscovery {
  headline: string;
  discovery: string;
  state: string | null;
  domains: string[];
  dejaVu: { date: string; similarity: number; summary: string } | null;
  date: string;
}

export function useDailyDiscovery() {
  const [data, setData] = useState<DailyDiscovery | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }

    const today = new Date().toISOString().split('T')[0];

    // Show something about the real world, not the brain grading itself.
    // Prefer bio-environmental-correlation (bridge layer — actual cross-domain
    // findings), then non-self-referential brain-narratives, then daily-discovery.
    const fetchDiscovery = async () => {
      // Try bio-environmental-correlation first — these are real cross-domain
      // findings from the bridge layer (e.g., "WA: 18 environmental signals
      // correlated with bird migration patterns")
      const { data: bridge } = await supabase
        .from('hunt_knowledge')
        .select('title,content,metadata,state_abbr,effective_date')
        .eq('content_type', 'bio-environmental-correlation')
        .order('created_at', { ascending: false })
        .limit(5);

      // Pick the one with the most env_matches — most interesting correlation
      if (bridge && bridge.length > 0) {
        const best = bridge.reduce((a, b) => {
          const aMatches = ((a.metadata as Record<string, unknown>)?.env_matches as number) || 0;
          const bMatches = ((b.metadata as Record<string, unknown>)?.env_matches as number) || 0;
          return bMatches > aMatches ? b : a;
        });
        const meta = (best.metadata || {}) as Record<string, unknown>;
        const envTypes = (meta.env_types as string[]) || [];
        const envMatches = (meta.env_matches as number) || 0;
        setData({
          headline: `${best.state_abbr}: ${envMatches} environmental signals correlating`,
          discovery: `Cross-domain pattern detected: ${envTypes.slice(0, 4).join(', ')}${envTypes.length > 4 ? ` and ${envTypes.length - 4} more` : ''} are aligning in ${best.state_abbr}. ${(best.content || '').slice(0, 200)}`,
          state: best.state_abbr || null,
          domains: envTypes,
          dejaVu: null,
          date: best.effective_date || today,
        });
        setLoading(false);
        return;
      }

      // Fall back to brain-narrative, but skip self-assessment narratives
      // (those with 'alert-grade' or 'self-assessment' in domains)
      const { data: narratives } = await supabase
        .from('hunt_knowledge')
        .select('title,content,metadata,state_abbr,effective_date')
        .eq('content_type', 'brain-narrative')
        .order('created_at', { ascending: false })
        .limit(10);

      const narrative = (narratives || []).find(n => {
        const meta = (n.metadata || {}) as Record<string, unknown>;
        const domains = (meta.domains_involved as string[]) || [];
        // Skip self-referential narratives
        return !domains.some(d => d === 'alert-grade' || d === 'self-assessment' || d === 'arc-grade-reasoning');
      });

      if (narrative) {
        const meta = (narrative.metadata || {}) as Record<string, unknown>;
        setData({
          headline: narrative.title || 'Brain Discovery',
          discovery: narrative.content || '',
          state: narrative.state_abbr || null,
          domains: (meta.domains_involved as string[]) || [],
          dejaVu: null,
          date: narrative.effective_date || today,
        });
        setLoading(false);
        return;
      }

      // Fall back to daily-discovery
      const { data: row } = await supabase
        .from('hunt_knowledge')
        .select('content,metadata,effective_date')
        .eq('content_type', 'daily-discovery')
        .order('effective_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (row?.metadata) {
        const meta = row.metadata as Record<string, unknown>;
        setData({
          headline: (meta.headline as string) || 'Daily Discovery',
          discovery: (meta.discovery as string) || row.content || '',
          state: (meta.state as string) || null,
          domains: (meta.domains as string[]) || [],
          dejaVu: (meta.deja_vu as DailyDiscovery['dejaVu']) || null,
          date: row.effective_date || today,
        });
      }
      setLoading(false);
    };

    fetchDiscovery().catch(() => setLoading(false));
  }, []);

  return { discovery: data, loading };
}
