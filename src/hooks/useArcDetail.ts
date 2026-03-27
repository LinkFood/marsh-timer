import { useState, useEffect, useRef } from 'react';
import type { StateArc } from './useStateArcs';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface FingerprintEntry {
  title: string;
  content: string;
  state_abbr: string;
  metadata: Record<string, unknown>;
  effective_date: string | null;
  created_at: string;
}

export function useArcDetail(arcId: string | null) {
  const [arc, setArc] = useState<StateArc | null>(null);
  const [fingerprints, setFingerprints] = useState<FingerprintEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const prevIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!arcId) {
      setArc(null);
      setFingerprints([]);
      setLoading(false);
      prevIdRef.current = null;
      return;
    }
    if (arcId === prevIdRef.current) return;
    prevIdRef.current = arcId;

    const controller = new AbortController();
    setLoading(true);

    async function fetchDetail() {
      try {
        // Fetch the full arc row
        const arcRes = await fetch(
          `${SUPABASE_URL}/rest/v1/hunt_state_arcs?id=eq.${arcId}&select=*&limit=1`,
          { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
        );
        if (!arcRes.ok) return;
        const arcData = await arcRes.json();
        if (Array.isArray(arcData) && arcData.length > 0) {
          setArc(arcData[0]);

          // Fetch fingerprint matches — recent closed arcs from hunt_knowledge
          const stateAbbr = arcData[0].state_abbr;
          const fpRes = await fetch(
            `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.arc-fingerprint&order=created_at.desc&limit=5&select=title,content,state_abbr,metadata,effective_date,created_at`,
            { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
          );
          if (fpRes.ok) {
            const fpData = await fpRes.json();
            if (Array.isArray(fpData)) setFingerprints(fpData);
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    fetchDetail();
    return () => controller.abort();
  }, [arcId]);

  return { arc, fingerprints, loading };
}
