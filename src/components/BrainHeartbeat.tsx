import { useMemo } from 'react';
import type { ConvergenceAlert } from '@/hooks/useConvergenceAlerts';
import type { HuntAlert } from '@/hooks/useHuntAlerts';
import type { FeatureCollection } from 'geojson';
import { useBrainActivity } from '@/hooks/useBrainActivity';

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
  huntAlerts: HuntAlert[];
  murmurationIndex: MurmurationData | null;
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function dotColor(status: string): string {
  if (status === 'success') return 'bg-emerald-400';
  if (status === 'error') return 'bg-red-400';
  return 'bg-white/30';
}

const BrainHeartbeat = ({
  // Accept LiveTicker props for backwards compat — unused internally
  convergenceAlerts: _ca,
  weatherEventsGeoJSON: _wx,
  nwsAlertsGeoJSON: _nws,
  huntAlerts: _ha,
  murmurationIndex: _mi,
}: BrainHeartbeatProps) => {
  const { activity, loading } = useBrainActivity();

  const cronDots = useMemo(() => {
    return activity.recentCrons.map((cron, i) => {
      const embeds = cron.summary?.embeddings_created ?? cron.summary?.embedded ?? 0;
      const label = `${cron.function_name}\n${timeAgo(cron.created_at)}${embeds ? `\n${embeds} embeddings` : ''}${cron.duration_ms ? `\n${cron.duration_ms}ms` : ''}`;
      return { key: `${cron.function_name}-${i}`, status: cron.status, label };
    });
  }, [activity.recentCrons]);

  const cronsHealthy = activity.activeCrons >= 14;

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

      {/* Stats section — hidden on mobile */}
      <div className="hidden sm:flex items-center gap-3 px-3 shrink-0 border-l border-white/[0.06]">
        <span className="text-[10px] font-mono text-cyan-400">
          EMB: {activity.totalEmbeddingsToday}
        </span>
        <span className={`text-[10px] font-mono ${cronsHealthy ? 'text-emerald-400' : 'text-amber-400'}`}>
          CRONS: {activity.activeCrons}/14
        </span>
        {activity.lastActivity && (
          <span className="text-[10px] font-mono text-white/40">
            {timeAgo(activity.lastActivity)}
          </span>
        )}
      </div>
    </div>
  );
};

export default BrainHeartbeat;
