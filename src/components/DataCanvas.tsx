import { useMemo, useState } from 'react';
import type { Species } from '@/data/types';
import type { HuntAlert } from '@/hooks/useHuntAlerts';
import { Target, Activity, TrendingUp, Zap, Layers, ChevronDown, ChevronUp } from 'lucide-react';
import Sparkline from '@/components/charts/Sparkline';
import StackedArea from '@/components/charts/StackedArea';
import { useConvergenceHistoryAll, useConvergenceHistory } from '@/hooks/useConvergenceHistory';
import { useBrainActivity } from '@/hooks/useBrainActivity';

interface DataCanvasProps {
  species: Species;
  selectedState: string | null;
  convergenceScores: Map<string, {
    score: number;
    weather_component: number;
    solunar_component: number;
    migration_component: number;
    pattern_component: number;
    national_rank: number;
    reasoning: string;
  }>;
  convergenceTopStates: Array<{
    state_abbr: string;
    score: number;
    reasoning: string;
    national_rank: number;
  }>;
  convergenceAlerts: Array<{
    state_abbr: string;
    alert_type: string;
    message: string;
    score_before: number;
    score_after: number;
    created_at: string;
  }>;
  huntAlerts: HuntAlert[];
  scoutReport: { brief_text: string; created_at: string } | null;
  murmurationIndex: {
    index: number;
    change_pct: number;
    direction: 'up' | 'down' | 'flat';
    top_states: string[];
    spike_count: number;
    active_states: number;
  } | null;
  isMobile: boolean;
  onSelectState: (abbr: string) => void;
}

function CardHeader({ icon: Icon, title, right }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={14} className="text-cyan-400" />
      <span className="text-[10px] font-display tracking-widest text-white/40 uppercase flex-1">
        {title}
      </span>
      {right}
    </div>
  );
}

// ─── Migration Index (kept — it's good) ──────────────────────
function MigrationIndexCard({ data, sparkData }: {
  data: DataCanvasProps['murmurationIndex'];
  sparkData: number[];
}) {
  if (!data) return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <CardHeader icon={Activity} title="MIGRATION INDEX" />
      <p className="text-[11px] text-white/20 text-center py-4">No migration data</p>
    </div>
  );

  const arrow = data.direction === 'up' ? '▲' : data.direction === 'down' ? '▼' : '—';
  const color = data.direction === 'up' ? 'text-green-400' : data.direction === 'down' ? 'text-red-400' : 'text-white/30';

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <CardHeader icon={Activity} title="MIGRATION INDEX" />
      <div className="flex items-end justify-between">
        <div>
          <div className="text-3xl font-mono text-white/90">{data.index}</div>
          <div className={`text-sm font-mono mt-1 ${color}`}>
            {arrow} {data.change_pct.toFixed(1)}%
          </div>
        </div>
        {sparkData.length > 1 && (
          <Sparkline
            data={sparkData}
            width={90}
            height={32}
            color={data.direction === 'up' ? '#4ade80' : data.direction === 'down' ? '#f87171' : '#22d3ee'}
            fillColor={data.direction === 'up' ? '#4ade80' : data.direction === 'down' ? '#f87171' : '#22d3ee'}
          />
        )}
      </div>
      <div className="text-[10px] font-body text-white/30 mt-2">
        {data.active_states} active &middot; {data.spike_count} spikes &middot; {data.top_states.slice(0, 3).join(', ')}
      </div>
    </div>
  );
}

// ─── Hotspots with sparklines ────────────────────────────────
function HotspotsCard({ topStates, sparkMap, onSelectState }: {
  topStates: DataCanvasProps['convergenceTopStates'];
  sparkMap: Map<string, number[]>;
  onSelectState: (abbr: string) => void;
}) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <CardHeader icon={Target} title="WHERE TO HUNT TODAY" />
      {topStates.length === 0 ? (
        <p className="text-[11px] text-white/20 text-center py-4">No hotspot data</p>
      ) : (
        <div className="space-y-1">
          {topStates.slice(0, 10).map((st) => {
            const spark = sparkMap.get(st.state_abbr) || [];
            const scoreColor = st.score >= 80 ? '#22d3ee' : st.score >= 60 ? '#fb923c' : st.score >= 40 ? '#fbbf24' : 'rgba(255,255,255,0.15)';
            return (
              <button
                key={st.state_abbr}
                onClick={() => onSelectState(st.state_abbr)}
                className="flex items-center gap-2 w-full text-left hover:bg-white/[0.04] rounded px-1.5 py-1 transition-colors group"
              >
                <span className="text-[9px] font-mono text-white/25 w-4 text-right">#{st.national_rank}</span>
                <span className="text-[11px] font-mono text-white/80 w-7 group-hover:text-cyan-400 transition-colors">{st.state_abbr}</span>
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${st.score}%`, backgroundColor: scoreColor }}
                  />
                </div>
                {spark.length > 1 && (
                  <Sparkline data={spark} width={48} height={16} color={scoreColor} strokeWidth={1} />
                )}
                <span className="text-[10px] font-mono text-white/50 w-6 text-right">{st.score}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Convergence Decomposition Chart ─────────────────────────
function ConvergenceDecompCard({ selectedState, convergenceScores }: {
  selectedState: string | null;
  convergenceScores: DataCanvasProps['convergenceScores'];
}) {
  const targetState = selectedState || (convergenceScores.size > 0
    ? [...convergenceScores.entries()].sort((a, b) => b[1].score - a[1].score)[0]?.[0]
    : null);

  const { history } = useConvergenceHistory(targetState);

  const chartData = useMemo(() => {
    return history.map(h => ({
      label: new Date(h.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      values: {
        weather: h.weather_component,
        migration: h.migration_component,
        solunar: h.solunar_component,
        pattern: h.pattern_component,
        birdcast: h.birdcast_component,
        water: h.water_component,
      },
    }));
  }, [history]);

  const keys = ['weather', 'migration', 'solunar', 'pattern', 'birdcast', 'water'];
  const colors: Record<string, string> = {
    weather: '#f97316',
    migration: '#22c55e',
    solunar: '#3b82f6',
    pattern: '#a855f7',
    birdcast: '#eab308',
    water: '#06b6d4',
  };

  const currentScore = targetState ? convergenceScores.get(targetState) : null;

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4 col-span-full">
      <CardHeader
        icon={Layers}
        title={`CONVERGENCE BREAKDOWN${targetState ? ` — ${targetState}` : ''}`}
        right={currentScore ? (
          <span className="text-lg font-mono text-cyan-400">{currentScore.score}</span>
        ) : null}
      />

      <StackedArea
        data={chartData}
        keys={keys}
        colors={colors}
        width={600}
        height={140}
        className="w-full"
      />

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {keys.map(k => (
          <div key={k} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: colors[k] }} />
            <span className="text-[9px] font-mono text-white/40 capitalize">{k}</span>
            {currentScore && (
              <span className="text-[9px] font-mono text-white/60">
                {(currentScore as any)[`${k}_component`] ?? 0}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Signal Feed (replaces boring alerts card) ───────────────
function SignalFeedCard({ convergenceAlerts, huntAlerts }: {
  convergenceAlerts: DataCanvasProps['convergenceAlerts'];
  huntAlerts: HuntAlert[];
}) {
  const [expanded, setExpanded] = useState(false);
  const hasSignals = convergenceAlerts.length > 0 || huntAlerts.length > 0;

  // Merge and sort by recency
  const signals = useMemo(() => {
    const all: Array<{ type: 'convergence' | 'hunt'; text: string; detail: string; severity: string; time: Date }> = [];

    for (const alert of convergenceAlerts) {
      const delta = alert.score_after - alert.score_before;
      all.push({
        type: 'convergence',
        text: `${alert.state_abbr} ${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)} → ${alert.score_after}`,
        detail: alert.message,
        severity: delta >= 15 ? 'high' : delta >= 8 ? 'medium' : 'info',
        time: new Date(alert.created_at),
      });
    }

    for (const alert of huntAlerts) {
      all.push({
        type: 'hunt',
        text: `${alert.stateAbbr}: ${alert.forecastSummary.slice(0, 50)}`,
        detail: alert.forecastSummary,
        severity: alert.severity,
        time: new Date(),
      });
    }

    all.sort((a, b) => b.time.getTime() - a.time.getTime());
    return all;
  }, [convergenceAlerts, huntAlerts]);

  const visible = expanded ? signals : signals.slice(0, 5);

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <CardHeader
        icon={Zap}
        title={`SIGNALS (${signals.length})`}
        right={signals.length > 5 ? (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-[9px] font-mono text-white/30 hover:text-white/50 flex items-center gap-0.5"
          >
            {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {expanded ? 'less' : 'more'}
          </button>
        ) : null}
      />
      {!hasSignals ? (
        <p className="text-[11px] text-white/20 text-center py-4">No signals right now</p>
      ) : (
        <div className="space-y-1.5">
          {visible.map((sig, i) => {
            const dotColor = sig.severity === 'high' ? 'bg-red-500' : sig.severity === 'medium' ? 'bg-amber-500' : 'bg-cyan-500';
            return (
              <div key={i} className="flex items-start gap-2">
                <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
                <div className="min-w-0 flex-1">
                  <span className="text-[11px] font-mono text-white/70">{sig.text}</span>
                  <span className="text-[10px] text-white/25 ml-2">
                    {sig.time.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Brain Stats Card (replaces useless Quick Stats) ─────────
function BrainStatsCard() {
  const { activity, loading } = useBrainActivity();

  if (loading) {
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
        <CardHeader icon={TrendingUp} title="BRAIN ACTIVITY" />
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-3 bg-white/[0.04] rounded" />)}
        </div>
      </div>
    );
  }

  const timeAgo = (ts: string) => {
    const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ago`;
  };

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <CardHeader icon={TrendingUp} title="BRAIN ACTIVITY" />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center">
          <div className="text-lg font-mono text-cyan-400">{activity.totalEmbeddingsToday.toLocaleString()}</div>
          <div className="text-[9px] text-white/30 uppercase">Embeddings</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-mono text-green-400">{activity.activeCrons}</div>
          <div className="text-[9px] text-white/30 uppercase">Crons Active</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-mono text-white/60">{activity.lastActivity ? timeAgo(activity.lastActivity) : '—'}</div>
          <div className="text-[9px] text-white/30 uppercase">Last Run</div>
        </div>
      </div>

      {/* Recent cron runs as mini timeline */}
      <div className="flex gap-0.5 flex-wrap">
        {activity.recentCrons.slice(0, 30).map((cron, i) => {
          const bgColor = cron.status === 'success' ? 'bg-green-500/60' : cron.status === 'error' ? 'bg-red-500/60' : 'bg-white/10';
          const embedCount = cron.summary && typeof cron.summary === 'object' ? ((cron.summary as any).embeddings_created ?? 0) : 0;
          return (
            <div
              key={i}
              className={`w-2 h-4 rounded-sm ${bgColor} cursor-default`}
              title={`${cron.function_name}\n${cron.status} · ${timeAgo(cron.created_at)}${embedCount > 0 ? ` · ${embedCount} embeddings` : ''}`}
            />
          );
        })}
      </div>
      {activity.recentCrons.length === 0 && (
        <p className="text-[10px] text-white/20 text-center">No activity today</p>
      )}
    </div>
  );
}

// ─── Main DataCanvas ─────────────────────────────────────────
export default function DataCanvas({
  species,
  selectedState,
  convergenceScores,
  convergenceTopStates,
  convergenceAlerts,
  huntAlerts,
  scoutReport,
  murmurationIndex,
  isMobile,
  onSelectState,
}: DataCanvasProps) {
  const { historyMap } = useConvergenceHistoryAll(14);

  // Fake sparkline for migration index from top state scores
  const migrationSpark = useMemo(() => {
    if (!murmurationIndex) return [];
    // Use average of top states' sparklines as proxy
    const allScores: number[][] = [];
    for (const [, scores] of historyMap) {
      if (scores.length > 0) allScores.push(scores);
    }
    if (allScores.length === 0) return [];
    const maxLen = Math.max(...allScores.map(s => s.length));
    const avgs: number[] = [];
    for (let i = 0; i < maxLen; i++) {
      let sum = 0, count = 0;
      for (const scores of allScores) {
        if (i < scores.length) { sum += scores[i]; count++; }
      }
      avgs.push(count > 0 ? sum / count : 0);
    }
    return avgs;
  }, [historyMap, murmurationIndex]);

  return (
    <div
      className={`fixed z-10 overflow-y-auto scrollbar-hide p-4 glass-panel ${
        isMobile
          ? 'top-[76px] left-0 right-0 bottom-11'
          : 'top-[112px] left-80 right-0 bottom-0'
      }`}
    >
      <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-3'}`}>
        {/* Row 1: Migration Index + Hotspots + Signals */}
        <MigrationIndexCard data={murmurationIndex} sparkData={migrationSpark} />
        <HotspotsCard topStates={convergenceTopStates} sparkMap={historyMap} onSelectState={onSelectState} />
        <SignalFeedCard convergenceAlerts={convergenceAlerts} huntAlerts={huntAlerts} />

        {/* Row 2: Convergence Decomposition (full width) */}
        <ConvergenceDecompCard selectedState={selectedState} convergenceScores={convergenceScores} />

        {/* Row 3: Brain Activity */}
        <BrainStatsCard />
      </div>
    </div>
  );
}
