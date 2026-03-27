import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface AlertCalibration {
  alert_source: string;
  state_abbr: string;
  window_days: number;
  accuracy_rate: number;
  total_alerts: number;
  confirmed_count: number;
}

export interface AggregatedSource {
  source: string;
  total_alerts: number;
  accuracy: number;
}

export interface AggregatedState {
  state_abbr: string;
  total_alerts: number;
  accuracy: number;
}

export function useAlertCalibration() {
  const [calibrations, setCalibrations] = useState<AlertCalibration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    async function fetchCalibration() {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/hunt_alert_calibration?select=*&order=total_alerts.desc`,
          {
            headers: { apikey: SUPABASE_KEY },
            signal: controller.signal,
          }
        );
        clearTimeout(timeout);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: AlertCalibration[] = await res.json();
        if (Array.isArray(data)) {
          setCalibrations(data);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setError('Request timed out');
        } else {
          setError(err instanceof Error ? err.message : 'Failed to fetch calibration');
        }
      } finally {
        setLoading(false);
      }
    }

    fetchCalibration();
  }, []);

  // Aggregate by source: weighted average accuracy
  const bySource: AggregatedSource[] = (() => {
    const map = new Map<string, { total: number; weighted: number }>();
    for (const c of calibrations) {
      const existing = map.get(c.alert_source) || { total: 0, weighted: 0 };
      existing.total += c.total_alerts;
      existing.weighted += c.accuracy_rate * c.total_alerts;
      map.set(c.alert_source, existing);
    }
    return Array.from(map.entries())
      .map(([source, v]) => ({
        source,
        total_alerts: v.total,
        accuracy: v.total > 0 ? Math.round(v.weighted / v.total) : 0,
      }))
      .sort((a, b) => b.total_alerts - a.total_alerts);
  })();

  // Aggregate by state: weighted average accuracy, top 10
  const byState: AggregatedState[] = (() => {
    const map = new Map<string, { total: number; weighted: number }>();
    for (const c of calibrations) {
      if (!c.state_abbr) continue;
      const existing = map.get(c.state_abbr) || { total: 0, weighted: 0 };
      existing.total += c.total_alerts;
      existing.weighted += c.accuracy_rate * c.total_alerts;
      map.set(c.state_abbr, existing);
    }
    return Array.from(map.entries())
      .map(([state_abbr, v]) => ({
        state_abbr,
        total_alerts: v.total,
        accuracy: v.total > 0 ? Math.round(v.weighted / v.total) : 0,
      }))
      .sort((a, b) => b.total_alerts - a.total_alerts)
      .slice(0, 10);
  })();

  // Overall accuracy: weighted average across all calibrations
  const overallAccuracy = (() => {
    let totalAlerts = 0;
    let weighted = 0;
    for (const c of calibrations) {
      totalAlerts += c.total_alerts;
      weighted += c.accuracy_rate * c.total_alerts;
    }
    return totalAlerts > 0 ? Math.round(weighted / totalAlerts) : 0;
  })();

  return { calibrations, bySource, byState, overallAccuracy, loading, error };
}
