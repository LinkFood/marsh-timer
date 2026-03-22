import { useState, useEffect, useCallback } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export interface OpsData {
  brain: {
    total: number;
    growth_today: number;
    growth_by_day: { day: string; count: number }[];
    content_types: { type: string; count: number; latest: string }[];
  };
  crons: {
    crons: any[];
    healthy_count: number;
    error_count: number;
    late_count: number;
    unknown_count: number;
  };
  alerts: {
    total_30d: number;
    confirmed: number;
    partial: number;
    missed: number;
    false_alarm: number;
    pending: number;
    accuracy: number;
  };
  discoveries: {
    pending: number;
    embedded: number;
    skipped: number;
  };
  scans: any[];
}

const EMPTY_DATA: OpsData = {
  brain: { total: 0, growth_today: 0, growth_by_day: [], content_types: [] },
  crons: { crons: [], healthy_count: 0, error_count: 0, late_count: 0, unknown_count: 0 },
  alerts: { total_30d: 0, confirmed: 0, partial: 0, missed: 0, false_alarm: 0, pending: 0, accuracy: 0 },
  discoveries: { pending: 0, embedded: 0, skipped: 0 },
  scans: [],
};

export function useOpsData() {
  const [data, setData] = useState<OpsData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!SUPABASE_URL) {
      setError('No Supabase URL configured');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-ops-dashboard`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (err: any) {
      console.error('[useOpsData] Error:', err);
      setError(err.message || 'Failed to fetch ops data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
