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

export interface ConvergenceScore {
  date: string;
  total_score: number;
  weather_component: number;
  migration_component: number;
  birdcast_component: number;
  solunar_component: number;
  water_component: number;
  pattern_component: number;
  photoperiod_component: number;
  tide_component: number;
}

export function useArcDetail(arcId: string | null) {
  const [arc, setArc] = useState<StateArc | null>(null);
  const [fingerprints, setFingerprints] = useState<FingerprintEntry[]>([]);
  const [convergence, setConvergence] = useState<ConvergenceScore[]>([]);
  const [loading, setLoading] = useState(false);
  const prevIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!arcId) {
      setArc(null);
      setFingerprints([]);
      setConvergence([]);
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
        if (!Array.isArray(arcData) || arcData.length === 0) return;

        const arcRow = arcData[0] as StateArc;
        setArc(arcRow);

        const stateAbbr = arcRow.state_abbr;

        // Fetch fingerprints + convergence scores in parallel
        const [fpRes, convRes] = await Promise.all([
          fetch(
            `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.arc-fingerprint&order=created_at.desc&limit=5&select=title,content,state_abbr,metadata,effective_date,created_at`,
            { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
          ),
          fetch(
            `${SUPABASE_URL}/rest/v1/hunt_convergence_scores?state_abbr=eq.${stateAbbr}&order=date.desc&limit=3&select=date,total_score,weather_component,migration_component,birdcast_component,solunar_component,water_component,pattern_component,photoperiod_component,tide_component`,
            { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
          ),
        ]);

        if (fpRes.ok) {
          const fpData = await fpRes.json();
          if (Array.isArray(fpData)) setFingerprints(fpData);
        }

        if (convRes.ok) {
          const convData = await convRes.json();
          if (Array.isArray(convData)) setConvergence(convData);
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

  return { arc, convergence, fingerprints, loading };
}
