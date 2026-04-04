import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { getTypesForGroup } from '@/data/contentTypeGroups';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface BrainResult {
  title: string;
  content: string;
  content_type: string;
  state_abbr: string | null;
  effective_date: string | null;
  similarity: number;
  metadata?: Record<string, unknown>;
}

interface FusionSearchParams {
  query?: string;
  contentTypeGroup?: string | null;
  stateAbbr?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

interface FusionSearchResults {
  primary: BrainResult[];
  fusion: BrainResult[];
  stats: {
    totalMatched: number;
    domainsRepresented: string[];
    statesRepresented: string[];
  };
}

const EMPTY_RESULTS: FusionSearchResults = {
  primary: [],
  fusion: [],
  stats: { totalMatched: 0, domainsRepresented: [], statesRepresented: [] },
};

function buildQueryFromFilters(
  group: string | null | undefined,
  state: string | null | undefined,
  dateFrom: string | null | undefined,
  dateTo: string | null | undefined,
): string {
  const parts: string[] = [];
  if (group && group !== 'all') parts.push(group.replace(/_/g, ' '));
  else parts.push('environmental data');
  if (state) parts.push(`in ${state}`);
  if (dateFrom) parts.push(`from ${dateFrom}`);
  if (dateTo) parts.push(`to ${dateTo}`);
  return parts.join(' ');
}

function shiftDate(date: string, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function parseBrainResult(r: Record<string, unknown>): BrainResult {
  return {
    title: (r.title as string) || '',
    content: (r.content as string) || '',
    content_type: (r.content_type as string) || '',
    state_abbr: (r.state_abbr as string) || null,
    effective_date: (r.effective_date as string) || null,
    similarity: (r.similarity as number) || 0,
    metadata: r.metadata as Record<string, unknown> | undefined,
  };
}

export function useFusionSearch() {
  const [results, setResults] = useState<FusionSearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setResults(EMPTY_RESULTS);
    setLoading(false);
  }, []);

  const search = useCallback(async (params: FusionSearchParams) => {
    const { query, contentTypeGroup, stateAbbr, dateFrom, dateTo } = params;
    if (!SUPABASE_URL) return;

    // Build a query string from filters if none provided
    const searchQuery = query?.trim() || buildQueryFromFilters(contentTypeGroup, stateAbbr, dateFrom, dateTo);
    if (!searchQuery) return;

    // Abort any in-flight search
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);

    try {
      // --- Primary search via hunt-search edge function ---
      const contentTypes = getTypesForGroup(contentTypeGroup ?? null);

      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_KEY}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({
          query: searchQuery,
          species: null,
          state_abbr: stateAbbr || null,
          content_types: contentTypes,
          date_from: dateFrom || null,
          date_to: dateTo || null,
          limit: 20,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        setResults(EMPTY_RESULTS);
        return;
      }

      const data = await res.json();
      const raw = Array.isArray(data.vector) ? data.vector : Array.isArray(data.results) ? data.results : [];
      const primary: BrainResult[] = raw.map(parseBrainResult);

      if (controller.signal.aborted) return;

      // --- Fusion: cross-domain context for top 3 results ---
      let fusion: BrainResult[] = [];

      const fusionCandidates = primary
        .filter(r => r.state_abbr && r.effective_date)
        .slice(0, 3);

      if (fusionCandidates.length > 0 && supabase) {
        const fusionPromises = fusionCandidates.map(candidate => {
          const primaryTypes = new Set(primary.map(r => r.content_type));
          const excludeTypes = `(${[...primaryTypes].join(',')})`;

          let q = supabase
            .from('hunt_knowledge')
            .select('title,content,content_type,state_abbr,effective_date')
            .eq('state_abbr', candidate.state_abbr!)
            .gte('effective_date', shiftDate(candidate.effective_date!, -7))
            .lte('effective_date', shiftDate(candidate.effective_date!, 7))
            .not('content_type', 'in', excludeTypes)
            .limit(20);

          return q;
        });

        const fusionResponses = await Promise.all(fusionPromises);

        if (controller.signal.aborted) return;

        const seen = new Set<string>();
        for (const resp of fusionResponses) {
          if (resp.data) {
            for (const row of resp.data) {
              const key = `${row.content_type}:${row.state_abbr}:${row.effective_date}:${(row.title || '').slice(0, 40)}`;
              if (!seen.has(key)) {
                seen.add(key);
                fusion.push({
                  title: row.title || '',
                  content: row.content || '',
                  content_type: row.content_type || '',
                  state_abbr: row.state_abbr || null,
                  effective_date: row.effective_date || null,
                  similarity: 0,
                });
              }
            }
          }
        }
      }

      // --- Build stats ---
      const allResults = [...primary, ...fusion];
      const domainsRepresented = [...new Set(allResults.map(r => r.content_type))];
      const statesRepresented = [...new Set(allResults.map(r => r.state_abbr).filter(Boolean) as string[])];

      setResults({
        primary,
        fusion,
        stats: {
          totalMatched: primary.length + fusion.length,
          domainsRepresented,
          statesRepresented,
        },
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setResults(EMPTY_RESULTS);
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  return { search, results, loading, clear };
}
