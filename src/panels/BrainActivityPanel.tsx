import { useBrainActivity } from '@/hooks/useBrainActivity';
import { Brain, Activity, Clock } from 'lucide-react';
import type { PanelComponentProps } from './PanelTypes';

function statusDot(status: string): string {
  if (status === 'success') return 'bg-green-400 shadow-[0_0_4px_rgba(74,222,128,0.5)]';
  if (status === 'error') return 'bg-red-400 shadow-[0_0_4px_rgba(248,113,113,0.5)]';
  return 'bg-gray-500';
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function shortName(fn: string): string {
  return fn.replace(/^hunt-/, '').replace(/-/g, ' ');
}

export default function BrainActivityPanel({}: PanelComponentProps) {
  const { activity, loading } = useBrainActivity();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading brain activity...
      </div>
    );
  }

  // Deduplicate crons by function_name (show latest per function)
  const cronMap = new Map<string, typeof activity.recentCrons[0]>();
  for (const cron of activity.recentCrons) {
    if (!cronMap.has(cron.function_name)) {
      cronMap.set(cron.function_name, cron);
    }
  }
  const uniqueCrons = Array.from(cronMap.values());

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
      {/* Big numbers */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded border border-white/[0.06] bg-white/[0.02] p-2 text-center">
          <Brain size={14} className="text-cyan-400 mx-auto mb-1" />
          <div className="text-xl font-mono font-bold text-cyan-400 tabular-nums">{activity.totalEmbeddingsToday}</div>
          <div className="text-[8px] font-mono tracking-wider text-white/30">EMBEDS 24H</div>
        </div>
        <div className="rounded border border-white/[0.06] bg-white/[0.02] p-2 text-center">
          <Activity size={14} className="text-green-400 mx-auto mb-1" />
          <div className="text-xl font-mono font-bold text-green-400 tabular-nums">{activity.activeCrons}</div>
          <div className="text-[8px] font-mono tracking-wider text-white/30">ACTIVE CRONS</div>
        </div>
        <div className="rounded border border-white/[0.06] bg-white/[0.02] p-2 text-center">
          <Clock size={14} className="text-white/40 mx-auto mb-1" />
          <div className="text-sm font-mono text-white/60 tabular-nums mt-0.5">
            {activity.lastActivity ? timeAgo(activity.lastActivity) : '--'}
          </div>
          <div className="text-[8px] font-mono tracking-wider text-white/30">LAST ACTIVITY</div>
        </div>
      </div>

      {/* Cron status grid */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-display tracking-widest text-white/30 uppercase">
            CRON STATUS
          </span>
          <span className="text-[8px] font-mono text-white/20">
            {activity.lastActivity ? `Updated ${timeAgo(activity.lastActivity)}` : ''}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          {uniqueCrons.map(cron => (
            <div
              key={cron.function_name}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-white/[0.02] border border-white/[0.04]"
            >
              <div className={`w-2 h-2 rounded-full shrink-0 ${statusDot(cron.status)}`} />
              <span className="text-[9px] font-mono text-white/60 truncate flex-1">
                {shortName(cron.function_name)}
              </span>
              <span className="text-[8px] font-mono text-white/20 shrink-0">
                {timeAgo(cron.created_at)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
