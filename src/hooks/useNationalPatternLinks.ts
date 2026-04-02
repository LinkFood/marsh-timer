import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface NationalPatternLink {
  source_content_type: string;
  matched_content_type: string;
  state_abbr: string;
  similarity: number;
}

export interface BrainActivityByState {
  count: number;
  topSimilarity: number;
  domains: Set<string>;
}

export function useNationalPatternLinks() {
  const [links, setLinks] = useState<NationalPatternLink[]>([]);
  const [byState, setByState] = useState<Map<string, BrainActivityByState>>(new Map());
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current || !SUPABASE_URL || !SUPABASE_KEY) return;
    fetchedRef.current = true;

    const cutoff = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    fetch(
      `${SUPABASE_URL}/rest/v1/hunt_pattern_links?created_at=gte.${cutoff}&order=similarity.desc&limit=200&select=source_content_type,matched_content_type,state_abbr,similarity`,
      { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
    )
      .then(r => r.json())
      .then(data => {
        if (!Array.isArray(data)) return;
        setLinks(data);

        const map = new Map<string, BrainActivityByState>();
        for (const link of data) {
          const existing = map.get(link.state_abbr);
          if (existing) {
            existing.count++;
            if (link.similarity > existing.topSimilarity) existing.topSimilarity = link.similarity;
            existing.domains.add(link.source_content_type);
            existing.domains.add(link.matched_content_type);
          } else {
            map.set(link.state_abbr, {
              count: 1,
              topSimilarity: link.similarity,
              domains: new Set([link.source_content_type, link.matched_content_type]),
            });
          }
        }
        setByState(map);
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));

    return () => { controller.abort(); clearTimeout(timeout); };
  }, []);

  return { links, byState };
}
