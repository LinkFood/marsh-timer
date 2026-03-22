import { useMemo, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { ConvergenceAlert } from '@/hooks/useConvergenceAlerts';
import type { PatternAlert } from '@/hooks/usePatternAlerts';
import type { FeatureCollection } from 'geojson';
import { useBrainActivity } from '@/hooks/useBrainActivity';
import { useDataSourceHealth, type DataSourceStatus } from '@/hooks/useDataSourceHealth';

interface MurmurationData {
  index: number;
  change_pct: number;
  direction: 'up' | 'down' | 'flat';
  top_states: string[];
  spike_count: number;
  active_states: number;
}

interface BrainHeartbeatProps {
  convergenceAlerts: ConvergenceAlert[];
  weatherEventsGeoJSON: FeatureCollection | null;
  nwsAlertsGeoJSON: FeatureCollection | null;
  huntAlerts: PatternAlert[];
  murmurationIndex: MurmurationData | null;
}

function cronTimeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function timeAgo(iso: string | null): string {
  if (!iso) return '\u2014';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return '<1m';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
  return `${Math.floor(ms / 86400000)}d`;
}

function dotColor(status: string): string {
  if (status === 'success') return 'bg-emerald-400';
  if (status === 'error') return 'bg-red-400';
  return 'bg-white/30';
}

function statusDotColor(status: DataSourceStatus['status']): string {
  if (status === 'online') return 'bg-emerald-400';
  if (status === 'stale') return 'bg-amber-400';
  if (status === 'error') return 'bg-red-400';
  if (status === 'static') return 'bg-blue-400/50';
  return 'bg-white/20';
}

function statusTextColor(status: DataSourceStatus['status']): string {
  if (status === 'online') return 'text-emerald-400';
  if (status === 'stale') return 'text-amber-400';
  if (status === 'error') return 'text-red-400';
  if (status === 'static') return 'text-blue-400/50';
  return 'text-white/20';
}

const CATEGORY_LABELS: Record<string, string> = {
  weather: 'WEATHER',
  migration: 'MIGRATION',
  intelligence: 'INTELLIGENCE',
  environment: 'ENVIRONMENT',
  satellite: 'SATELLITE',
  government: 'GOVERNMENT',
};

const CATEGORY_ORDER = ['weather', 'migration', 'intelligence', 'environment', 'satellite', 'government'];

function HealthDropdown({
  sources,
  summary,
  loading: healthLoading,
  onClose,
}: {
  sources: DataSourceStatus[];
  summary: { total: number; online: number; stale: number; error: number; static: number; unknown: number };
  loading: boolean;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleCategory = useCallback((cat: string) => {
    setCollapsed(prev => ({ ...prev, [cat]: !prev[cat] }));
  }, []);

  // Close on ESC
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const grouped = useMemo(() => {
    const map: Record<string, DataSourceStatus[]> = {};
    for (const s of sources) {
      if (!map[s.category]) map[s.category] = [];
      map[s.category].push(s);
    }
    return map;
  }, [sources]);

  const providerCount = useMemo(() => {
    return new Set(sources.map(s => s.provider)).size;
  }, [sources]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[999]"
        onClick={onClose}
      />
      {/* Dropdown */}
      <div
        className="fixed z-[1000] left-0 right-0 mx-auto"
        style={{ top: 60, maxWidth: 600 }}
      >
        <div className="bg-[#0a0f1a]/95 backdrop-blur-sm border border-white/[0.06] rounded-lg shadow-2xl max-h-[70vh] overflow-y-auto mx-2 sm:mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <div>
              <div className="text-[11px] font-mono text-white/70 tracking-wider">BRAIN DATA SOURCES</div>
              {!healthLoading && (
                <div className="text-[10px] font-mono text-white/30">
                  {summary.total} sources from {providerCount} providers
                </div>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-white/30 hover:text-white/60 text-xs font-mono px-1"
            >
              X
            </button>
          </div>

          {/* Summary bar */}
          {!healthLoading && (
            <div className="flex flex-wrap gap-2 px-4 py-2 border-y border-white/[0.06]">
              <span className="text-[10px] font-mono text-white/50">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/40 mr-1 align-middle" />
                {summary.total} TOTAL
              </span>
              <span className="text-[10px] font-mono text-emerald-400/80">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-1 align-middle" />
                {summary.online} ONLINE
              </span>
              {summary.stale > 0 && (
                <span className="text-[10px] font-mono text-amber-400/80">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-1 align-middle" />
                  {summary.stale} STALE
                </span>
              )}
              {summary.error > 0 && (
                <span className="text-[10px] font-mono text-red-400/80">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 mr-1 align-middle" />
                  {summary.error} ERROR
                </span>
              )}
              <span className="text-[10px] font-mono text-blue-400/50">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400/50 mr-1 align-middle" />
                {summary.static} STATIC
              </span>
              {summary.unknown > 0 && (
                <span className="text-[10px] font-mono text-white/20">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/20 mr-1 align-middle" />
                  {summary.unknown} UNKNOWN
                </span>
              )}
            </div>
          )}

          {/* Loading state */}
          {healthLoading && (
            <div className="px-4 py-6 text-center text-[10px] font-mono text-white/30 tracking-widest">
              Loading health data...
            </div>
          )}

          {/* Categories */}
          {!healthLoading && CATEGORY_ORDER.map(cat => {
            const items = grouped[cat];
            if (!items || items.length === 0) return null;
            const isCollapsed = collapsed[cat] ?? false;
            return (
              <div key={cat} className="border-b border-white/[0.04] last:border-b-0">
                <button
                  onClick={() => toggleCategory(cat)}
                  className="w-full flex items-center gap-2 px-4 py-1.5 hover:bg-white/[0.03] transition-colors"
                >
                  <span className="text-[10px] font-mono text-white/30">
                    {isCollapsed ? '\u25B6' : '\u25BC'}
                  </span>
                  <span className="text-[10px] font-mono text-white/50 tracking-wider">
                    {CATEGORY_LABELS[cat] || cat.toUpperCase()} ({items.length})
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="pb-1">
                    {items.map(source => (
                      <div
                        key={source.id}
                        className="flex items-center gap-2 px-4 py-0.5 mx-2"
                      >
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDotColor(source.status)}`} />
                        <span className="text-xs text-white/70 min-w-0 truncate flex-1">
                          {source.name}
                        </span>
                        <span className="text-[10px] text-white/30 shrink-0 hidden sm:block w-20 text-right">
                          {source.provider}
                        </span>
                        <span className="text-[10px] text-white/20 shrink-0 w-14 text-right">
                          {source.refreshInterval}
                        </span>
                        <span className={`text-[10px] shrink-0 w-8 text-right font-mono ${statusTextColor(source.status)}`}>
                          {timeAgo(source.lastUpdated)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

const BrainHeartbeat = ({
  convergenceAlerts: _ca,
  weatherEventsGeoJSON: _wx,
  nwsAlertsGeoJSON: _nws,
  huntAlerts: _ha,
  murmurationIndex: _mi,
}: BrainHeartbeatProps) => {
  const { activity, loading } = useBrainActivity();
  const { sources, summary, loading: healthLoading } = useDataSourceHealth();
  const [healthOpen, setHealthOpen] = useState(false);

  const cronDots = useMemo(() => {
    return activity.recentCrons.map((cron, i) => {
      const embeds = cron.summary?.embeddings_created ?? cron.summary?.embedded ?? 0;
      const label = `${cron.function_name}\n${cronTimeAgo(cron.created_at)}${embeds ? `\n${embeds} embeddings` : ''}${cron.duration_ms ? `\n${cron.duration_ms}ms` : ''}`;
      return { key: `${cron.function_name}-${i}`, status: cron.status, label };
    });
  }, [activity.recentCrons]);

  const cronsHealthy = activity.activeCrons >= 25;
  const hasErrors = summary.error > 0;

  return (
    <div className="h-7 glass-panel border-b border-white/[0.06] overflow-hidden relative flex items-center">
      {/* LIVE indicator */}
      <div className="flex items-center gap-1.5 px-3 shrink-0 z-10 border-r border-white/[0.06]">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        <span className="text-[9px] font-mono text-white/40 tracking-wider">LIVE</span>
      </div>

      {/* Activity dots strip */}
      <div className="flex-1 flex items-center gap-[3px] px-3 overflow-hidden min-w-0">
        {loading ? (
          <span className="text-[10px] font-body text-white/20 tracking-widest uppercase">
            Syncing brain...
          </span>
        ) : cronDots.length === 0 ? (
          <span className="text-[10px] font-body text-white/20 tracking-widest uppercase">
            No activity yet today
          </span>
        ) : (
          cronDots.map((dot) => (
            <div
              key={dot.key}
              className={`w-[6px] h-3 rounded-[1px] shrink-0 ${dotColor(dot.status)} opacity-80 hover:opacity-100 transition-opacity cursor-default`}
              title={dot.label}
            />
          ))
        )}
      </div>

      {/* Stats section — clickable to open health dropdown */}
      <button
        onClick={() => setHealthOpen(prev => !prev)}
        className="hidden sm:flex items-center gap-3 px-3 shrink-0 border-l border-white/[0.06] h-full hover:bg-white/[0.04] transition-colors cursor-pointer"
      >
        <span className="text-[10px] font-mono text-cyan-400">
          EMB: {activity.totalEmbeddingsToday}
        </span>
        <span className="relative">
          <span className={`text-[10px] font-mono ${cronsHealthy ? 'text-emerald-400' : 'text-amber-400'}`}>
            CRONS: {activity.activeCrons}/25
          </span>
          {hasErrors && (
            <span className="absolute -top-0.5 -right-2 w-1.5 h-1.5 rounded-full bg-red-500" />
          )}
        </span>
        {activity.lastActivity && (
          <span className="text-[10px] font-mono text-white/40">
            {cronTimeAgo(activity.lastActivity)}
          </span>
        )}
      </button>

      {/* Mobile tap target */}
      <button
        onClick={() => setHealthOpen(prev => !prev)}
        className="sm:hidden flex items-center px-2 shrink-0 border-l border-white/[0.06] h-full hover:bg-white/[0.04] transition-colors"
      >
        <span className="relative">
          <span className={`text-[9px] font-mono ${cronsHealthy ? 'text-emerald-400' : 'text-amber-400'}`}>
            SRC
          </span>
          {hasErrors && (
            <span className="absolute -top-0.5 -right-2 w-1.5 h-1.5 rounded-full bg-red-500" />
          )}
        </span>
      </button>

      {/* Health dropdown via portal */}
      {healthOpen && createPortal(
        <HealthDropdown
          sources={sources}
          summary={summary}
          loading={healthLoading}
          onClose={() => setHealthOpen(false)}
        />,
        document.body
      )}
    </div>
  );
};

export default BrainHeartbeat;
