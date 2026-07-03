import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/**
 * Court docket hooks — direct PostgREST reads of hunt_claims / hunt_claim_fires.
 *
 * These tables may not exist yet (migration lands separately). Both hooks do a
 * SINGLE fetch per mount (no retry loop) and report status 'unavailable' on any
 * failure (404 / 42P01 / network) so the page can degrade honestly.
 */

export interface Claim {
  id: string;
  name: string | null;
  hypothesis: string | null;
  source: string | null;
  notes: string | null;
  status: string | null;
  registered_at: string | null;
  [key: string]: unknown;
}

export interface ClaimFire {
  id: string;
  claim_id: string | null;
  state_abbr: string | null;
  fired_at: string | null;
  window_end: string | null;
  evaluated: boolean | null;
  hit: boolean | null;
  control_hits: number | null;
  control_n: number | null;
  lift: number | null;
  [key: string]: unknown;
}

export type DocketStatus = 'loading' | 'ready' | 'unavailable';

function usePostgrestList<T>(path: string): { rows: T[]; status: DocketStatus } {
  const [rows, setRows] = useState<T[]>([]);
  const [status, setStatus] = useState<DocketStatus>('loading');
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    if (!SUPABASE_URL || !SUPABASE_KEY) {
      setStatus('unavailable');
      return;
    }

    fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SUPABASE_KEY } })
      .then(async res => {
        if (!res.ok) {
          // 404 / PGRST205 / 42P01 — table not created yet. Do not retry.
          setStatus('unavailable');
          return;
        }
        const data = await res.json();
        setRows(Array.isArray(data) ? data : []);
        setStatus('ready');
      })
      .catch(() => setStatus('unavailable'));
  }, [path]);

  return { rows, status };
}

export function useClaims() {
  const { rows, status } = usePostgrestList<Claim>('hunt_claims?select=*&order=registered_at.desc');
  return { claims: rows, status };
}

export function useClaimFires() {
  const { rows, status } = usePostgrestList<ClaimFire>('hunt_claim_fires?select=*&order=fired_at.desc&limit=100');
  return { fires: rows, status };
}
