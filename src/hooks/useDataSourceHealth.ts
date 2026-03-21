import { useState, useEffect, useCallback } from 'react';
import { DATA_SOURCE_CATALOG, type DataSourceDef } from '@/data/dataSourceCatalog';

export interface DataSourceStatus extends DataSourceDef {
  status: 'online' | 'stale' | 'error' | 'static' | 'unknown';
  lastUpdated: string | null;
  lastDuration: number | null;
}

export function useDataSourceHealth() {
  const [sources, setSources] = useState<DataSourceStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch(
        'https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-cron-health'
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const cronHealth = await res.json();

      const joined: DataSourceStatus[] = DATA_SOURCE_CATALOG.map(source => {
        if (!source.cronFunction) {
          return {
            ...source,
            status: source.refreshInterval === 'static' || source.refreshInterval === 'on-demand' ? 'static' as const : 'online' as const,
            lastUpdated: null,
            lastDuration: null,
          };
        }

        const health = cronHealth?.[source.cronFunction] || cronHealth?.crons?.[source.cronFunction];
        if (!health) {
          return { ...source, status: 'unknown' as const, lastUpdated: null, lastDuration: null };
        }

        let status: DataSourceStatus['status'] = 'online';
        if (health.status === 'error') status = 'error';
        else if (health.status === 'late' || health.status === 'never_run') status = 'stale';

        return {
          ...source,
          status,
          lastUpdated: health.last_run || health.last_success || null,
          lastDuration: health.duration_ms || null,
        };
      });

      setSources(joined);
    } catch (err) {
      console.error('[DataSourceHealth] Failed to fetch:', err);
      setSources(DATA_SOURCE_CATALOG.map(s => ({
        ...s,
        status: 'unknown' as const,
        lastUpdated: null,
        lastDuration: null,
      })));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const summary = {
    total: sources.length,
    online: sources.filter(s => s.status === 'online').length,
    stale: sources.filter(s => s.status === 'stale').length,
    error: sources.filter(s => s.status === 'error').length,
    static: sources.filter(s => s.status === 'static').length,
    unknown: sources.filter(s => s.status === 'unknown').length,
  };

  return { sources, summary, loading, refetch: fetchHealth };
}
