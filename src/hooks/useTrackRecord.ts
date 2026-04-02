import { useState, useEffect, useRef } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface SourceStat {
  source: string;
  total: number;
  confirmed: number;
  accuracy: number;
}

export interface StateStat {
  state: string;
  total: number;
  confirmed: number;
}

export interface RecentGrade {
  state_abbr: string;
  alert_source: string;
  outcome_grade: string;
  graded_at: string;
}

interface AlertCalibrationRow {
  alert_source: string;
  state_abbr: string;
  total_alerts: number;
  confirmed_count: number;
  accuracy_rate: number;
}

interface AlertOutcomeRow {
  state_abbr: string;
  alert_source: string;
  outcome_grade: string;
  graded_at: string;
}

export function useTrackRecord() {
  const [totalGraded, setTotalGraded] = useState(0);
  const [bySource, setBySource] = useState<SourceStat[]>([]);
  const [byState, setByState] = useState<StateStat[]>([]);
  const [recentGrades, setRecentGrades] = useState<RecentGrade[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    async function fetchData() {
      try {
        const [calRes, outRes] = await Promise.all([
          fetch(
            `${SUPABASE_URL}/rest/v1/hunt_alert_calibration?select=alert_source,state_abbr,total_alerts,confirmed_count,accuracy_rate&order=total_alerts.desc`,
            { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
          ),
          fetch(
            `${SUPABASE_URL}/rest/v1/hunt_alert_outcomes?outcome_grade=neq.null&order=graded_at.desc&limit=20&select=state_abbr,alert_source,outcome_grade,graded_at`,
            { headers: { apikey: SUPABASE_KEY }, signal: controller.signal }
          ),
        ]);

        // Process calibration data
        let totalFromCal = 0;
        if (calRes.ok) {
          const calData: AlertCalibrationRow[] = await calRes.json();
          if (Array.isArray(calData) && calData.length > 0) {
            // Aggregate by source
            const sourceMap = new Map<string, { total: number; confirmed: number; weighted: number }>();
            let total = 0;

            for (const row of calData) {
              total += row.total_alerts;
              const existing = sourceMap.get(row.alert_source) || { total: 0, confirmed: 0, weighted: 0 };
              existing.total += row.total_alerts;
              existing.confirmed += row.confirmed_count;
              existing.weighted += row.accuracy_rate * row.total_alerts;
              sourceMap.set(row.alert_source, existing);
            }

            totalFromCal = total;
            setTotalGraded(total);
            setBySource(
              Array.from(sourceMap.entries())
                .map(([source, v]) => ({
                  source,
                  total: v.total,
                  confirmed: v.confirmed,
                  accuracy: v.total > 0 ? Math.round(v.weighted / v.total) : 0,
                }))
                .sort((a, b) => b.total - a.total)
            );

            // Aggregate by state (top 10)
            const stateMap = new Map<string, { total: number; confirmed: number }>();
            for (const row of calData) {
              if (!row.state_abbr) continue;
              const existing = stateMap.get(row.state_abbr) || { total: 0, confirmed: 0 };
              existing.total += row.total_alerts;
              existing.confirmed += row.confirmed_count;
              stateMap.set(row.state_abbr, existing);
            }

            setByState(
              Array.from(stateMap.entries())
                .map(([state, v]) => ({ state, total: v.total, confirmed: v.confirmed }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 10)
            );
          }
        }

        // Process recent grades
        if (outRes.ok) {
          const outData: AlertOutcomeRow[] = await outRes.json();
          if (Array.isArray(outData)) {
            setRecentGrades(
              outData.map(r => ({
                state_abbr: r.state_abbr,
                alert_source: r.alert_source,
                outcome_grade: r.outcome_grade,
                graded_at: r.graded_at,
              }))
            );

            // Derive totals from outcomes when calibration table is empty
            if (totalFromCal === 0 && outData.length > 0) {
              setTotalGraded(outData.length);
              const sourceAgg = new Map<string, { total: number; confirmed: number }>();
              for (const r of outData) {
                const existing = sourceAgg.get(r.alert_source) || { total: 0, confirmed: 0 };
                existing.total += 1;
                if (r.outcome_grade === 'confirmed') existing.confirmed += 1;
                sourceAgg.set(r.alert_source, existing);
              }
              setBySource(
                Array.from(sourceAgg.entries())
                  .map(([source, v]) => ({
                    source,
                    total: v.total,
                    confirmed: v.confirmed,
                    accuracy: v.total > 0 ? Math.round((v.confirmed / v.total) * 100) : 0,
                  }))
                  .sort((a, b) => b.total - a.total)
              );
            }
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    fetchData().finally(() => clearTimeout(timeout));
    return () => { clearTimeout(timeout); controller.abort(); };
  }, []);

  return { totalGraded, bySource, byState, recentGrades, loading };
}
