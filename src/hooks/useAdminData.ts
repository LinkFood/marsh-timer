import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

interface CronStatus {
  name: string;
  schedule: string;
  health: string;
  last_run: string | null;
  last_status: string | null;
  last_summary: any;
  hours_ago: number | null;
}

interface WebDiscovery {
  id: string;
  query: string;
  source_url: string | null;
  title: string | null;
  curator_decision: string | null;
  quality_score: number | null;
  created_at: string;
}

interface CronFailure {
  function_name: string;
  status: string;
  summary: string;
  created_at: string;
}

interface ScanLog {
  function_name: string;
  status: string;
  summary: any;
  created_at: string;
}

interface RiskAlert {
  id: string;
  title: string;
  state_abbr: string | null;
  content_type: string;
  metadata: any;
  created_at: string;
}

export interface AdminData {
  crons: CronStatus[];
  discoveries: WebDiscovery[];
  failures: CronFailure[];
  scans: ScanLog[];
  riskAlerts: RiskAlert[];
  brainCount: number;
  loading: boolean;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

export function useAdminData(): AdminData {
  const [crons, setCrons] = useState<CronStatus[]>([]);
  const [discoveries, setDiscoveries] = useState<WebDiscovery[]>([]);
  const [failures, setFailures] = useState<CronFailure[]>([]);
  const [scans, setScans] = useState<ScanLog[]>([]);
  const [riskAlerts, setRiskAlerts] = useState<RiskAlert[]>([]);
  const [brainCount, setBrainCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      // Fetch cron health (no auth needed)
      const cronRes = await fetch(`${SUPABASE_URL}/functions/v1/hunt-cron-health`);
      if (cronRes.ok) {
        const data = await cronRes.json();
        setCrons(Array.isArray(data.crons) ? data.crons : Array.isArray(data) ? data : []);
      }

      if (supabase) {
        // Fetch web discoveries (most recent 20) — table may not exist yet
        const { data: discData, error: discErr } = await supabase
          .from('hunt_web_discoveries')
          .select('id, query, source_url, title, curator_decision, quality_score, created_at')
          .order('created_at', { ascending: false })
          .limit(20);
        if (!discErr) setDiscoveries(discData || []);

        // Fetch recent failures (last 48h)
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        const { data: failData } = await supabase
          .from('hunt_cron_log')
          .select('function_name, status, summary, created_at')
          .eq('status', 'error')
          .gt('created_at', since)
          .order('created_at', { ascending: false })
          .limit(20);
        setFailures(failData || []);

        // Fetch recent convergence scans (last 24h)
        const { data: scanData } = await supabase
          .from('hunt_cron_log')
          .select('function_name, status, summary, created_at')
          .eq('function_name', 'hunt-convergence-scan')
          .order('created_at', { ascending: false })
          .limit(20);
        setScans(scanData || []);

        // Fetch compound risk alerts
        const { data: riskData } = await supabase
          .from('hunt_knowledge')
          .select('id, title, state_abbr, content_type, metadata, created_at')
          .eq('content_type', 'compound-risk-alert')
          .order('created_at', { ascending: false })
          .limit(10);
        setRiskAlerts(riskData || []);

        // Get brain entry count
        const { count } = await supabase
          .from('hunt_knowledge')
          .select('*', { count: 'exact', head: true });
        setBrainCount(count || 0);
      }
    } catch (err) {
      console.error('[AdminData] Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { crons, discoveries, failures, scans, riskAlerts, brainCount, loading };
}
