import { useState, useEffect, useCallback } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface HuntLog {
  id: string;
  date: string;
  state_abbr: string;
  county?: string;
  species: string;
  harvest_count: number;
  notes?: string;
  weather?: Record<string, unknown>;
  solunar?: Record<string, unknown>;
  created_at: string;
}

export interface HuntLogInput {
  date: string;
  state_abbr: string;
  county?: string;
  species: string;
  harvest_count: number;
  notes?: string;
  lat?: number;
  lng?: number;
}

export function useHuntLogs(userId: string | null, accessToken: string | null) {
  const [logs, setLogs] = useState<HuntLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    if (!userId || !SUPABASE_URL || !SUPABASE_KEY || !accessToken) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/hunt_logs?user_id=eq.${userId}&order=date.desc&limit=50&select=id,date,state_abbr,county,species,harvest_count,notes,weather,solunar,created_at`,
        {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs');
    } finally {
      setLoading(false);
    }
  }, [userId, accessToken]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const submitLog = useCallback(async (input: HuntLogInput): Promise<HuntLog | null> => {
    if (!SUPABASE_URL || !SUPABASE_KEY || !accessToken) {
      setError('Not authenticated');
      return null;
    }

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify(input),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const newLog = data.log as HuntLog;
      setLogs(prev => [newLog, ...prev]);
      return newLog;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to submit log';
      setError(msg);
      return null;
    }
  }, [accessToken]);

  const deleteLog = useCallback(async (id: string): Promise<boolean> => {
    if (!SUPABASE_URL || !SUPABASE_KEY || !accessToken) return false;

    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/hunt_logs?id=eq.${id}`,
        {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLogs(prev => prev.filter(l => l.id !== id));
      return true;
    } catch {
      setError('Failed to delete log');
      return false;
    }
  }, [accessToken]);

  return { logs, loading, error, fetchLogs, submitLog, deleteLog };
}
