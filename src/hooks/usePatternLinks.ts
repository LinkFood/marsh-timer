import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface PatternLink {
  id: string;
  similarity: number;
  source_content_type: string;
  matched_content_type: string;
  state_abbr: string;
  created_at: string;
}

export function usePatternLinks(stateAbbr: string | null) {
  const [links, setLinks] = useState<PatternLink[]>([]);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!stateAbbr) { setLinks([]); return; }
    if (fetchedRef.current === stateAbbr) return;

    const controller = new AbortController();
    fetchedRef.current = stateAbbr;
    setLoading(true);

    const cutoff = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
    fetch(
      `${SUPABASE_URL}/rest/v1/hunt_pattern_links?state_abbr=eq.${stateAbbr}&created_at=gte.${cutoff}&order=created_at.desc&limit=15&select=id,similarity,source_content_type,matched_content_type,state_abbr,created_at`,
      { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
    )
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setLinks(data);
      })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });

    return () => controller.abort();
  }, [stateAbbr]);

  return { links, loading };
}
