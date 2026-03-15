import type { Species } from '@/data/types';
import type { HuntAlert } from '@/hooks/useHuntAlerts';
import { TrendingUp, Zap, Cloud, Target, Activity, BarChart3 } from 'lucide-react';

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

function CardHeader({ icon: Icon, title }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon size={14} className="text-cyan-400" />
      <span className="text-[10px] font-display tracking-widest text-white/40 uppercase">
        {title}
      </span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <p className="text-[11px] text-white/20 text-center py-4">{text}</p>;
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className="h-full rounded-full"
        style={{
          width: `${score}%`,
          backgroundColor: score >= 80 ? '#22d3ee' : score >= 60 ? '#fb923c' : score >= 40 ? '#fbbf24' : 'rgba(255,255,255,0.15)',
        }}
      />
    </div>
  );
}

function MigrationIndexCard({ data }: { data: DataCanvasProps['murmurationIndex'] }) {
  if (!data) return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <CardHeader icon={Activity} title="MIGRATION INDEX" />
      <EmptyState text="No migration data available" />
    </div>
  );

  const arrow = data.direction === 'up' ? '▲' : data.direction === 'down' ? '▼' : '—';
  const color = data.direction === 'up' ? 'text-green-400' : data.direction === 'down' ? 'text-red-400' : 'text-white/30';

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <CardHeader icon={Activity} title="MIGRATION INDEX" />
      <div className="text-3xl font-mono text-white/90">{data.index}</div>
      <div className={`text-sm font-mono mt-1 ${color}`}>
        {arrow} {data.change_pct.toFixed(1)}%
      </div>
      <div className="text-[11px] font-body text-white/40 mt-2">
        {data.active_states} active states &middot; {data.spike_count} spikes
      </div>
      {data.top_states.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {data.top_states.map((st) => (
            <span key={st} className="text-[9px] font-mono bg-white/[0.05] text-white/50 rounded px-1.5 py-0.5">
              {st}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function HotspotsCard({ topStates, onSelectState }: { topStates: DataCanvasProps['convergenceTopStates']; onSelectState: (abbr: string) => void }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <CardHeader icon={Target} title="HOTSPOTS" />
      {topStates.length === 0 ? (
        <EmptyState text="No hotspot data available" />
      ) : (
        <div className="space-y-1.5">
          {topStates.slice(0, 10).map((st) => (
            <button
              key={st.state_abbr}
              onClick={() => onSelectState(st.state_abbr)}
              className="flex items-center gap-2 w-full text-left hover:bg-white/[0.03] rounded px-1 py-0.5 transition-colors"
            >
              <span className="text-[9px] font-mono text-white/30 w-5 text-right">#{st.national_rank}</span>
              <span className="text-[11px] font-mono text-white/70 w-7">{st.state_abbr}</span>
              <ScoreBar score={st.score} />
              <span className="text-[10px] font-mono text-white/50 w-7 text-right">{st.score}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AlertFeedCard({ convergenceAlerts, huntAlerts }: { convergenceAlerts: DataCanvasProps['convergenceAlerts']; huntAlerts: HuntAlert[] }) {
  const hasAlerts = convergenceAlerts.length > 0 || huntAlerts.length > 0;

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <CardHeader icon={Zap} title="ALERTS" />
      {!hasAlerts ? (
        <EmptyState text="No alerts" />
      ) : (
        <div className="space-y-2 max-h-[300px] overflow-y-auto scrollbar-hide">
          {convergenceAlerts.map((alert, i) => {
            const change = alert.score_after - alert.score_before;
            const changeColor = change > 0 ? 'text-green-400' : 'text-red-400';
            return (
              <div key={`conv-${i}`} className="text-[11px] font-body text-white/50 border-b border-white/[0.04] pb-1.5">
                <span className="font-mono text-white/70">{alert.state_abbr}:</span>{' '}
                {alert.message}
                <span className={`ml-2 font-mono text-[10px] ${changeColor}`}>
                  {change > 0 ? '+' : ''}{change}
                </span>
              </div>
            );
          })}
          {huntAlerts.map((alert, i) => {
            const sevColor = alert.severity === 'high' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400';
            return (
              <div key={`hunt-${i}`} className="text-[11px] font-body text-white/50 border-b border-white/[0.04] pb-1.5">
                <span className="font-mono text-white/70">{alert.stateName}:</span>{' '}
                {alert.forecastSummary}
                <span className={`ml-2 text-[9px] font-mono rounded px-1 py-0.5 ${sevColor}`}>
                  {alert.severity}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ScoreDistributionCard({ convergenceScores }: { convergenceScores: DataCanvasProps['convergenceScores'] }) {
  const buckets = [
    { label: '0-20', min: 0, max: 20, count: 0 },
    { label: '21-40', min: 21, max: 40, count: 0 },
    { label: '41-60', min: 41, max: 60, count: 0 },
    { label: '61-80', min: 61, max: 80, count: 0 },
    { label: '81-100', min: 81, max: 100, count: 0 },
  ];

  convergenceScores.forEach((data) => {
    for (const bucket of buckets) {
      if (data.score >= bucket.min && data.score <= bucket.max) {
        bucket.count++;
        break;
      }
    }
  });

  const maxCount = Math.max(...buckets.map((b) => b.count), 1);

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <CardHeader icon={BarChart3} title="SCORE DISTRIBUTION" />
      {convergenceScores.size === 0 ? (
        <EmptyState text="No score data available" />
      ) : (
        <div className="space-y-2">
          {buckets.map((bucket) => (
            <div key={bucket.label} className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-white/40 w-10 text-right">{bucket.label}</span>
              <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-cyan-400/60"
                  style={{ width: `${(bucket.count / maxCount) * 100}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-white/50 w-5 text-right">{bucket.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ScoutBriefCard({ scoutReport }: { scoutReport: DataCanvasProps['scoutReport'] }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <CardHeader icon={Cloud} title="SCOUT REPORT" />
      {!scoutReport ? (
        <EmptyState text="No report available" />
      ) : (
        <>
          <p className="text-[11px] font-body text-white/60 leading-relaxed">{scoutReport.brief_text}</p>
          <p className="text-[9px] font-mono text-white/20 mt-2">
            {new Date(scoutReport.created_at).toLocaleString()}
          </p>
        </>
      )}
    </div>
  );
}

function QuickStatsCard({ convergenceScores }: { convergenceScores: DataCanvasProps['convergenceScores'] }) {
  if (convergenceScores.size === 0) {
    return (
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
        <CardHeader icon={TrendingUp} title="QUICK STATS" />
        <EmptyState text="No data available" />
      </div>
    );
  }

  let totalScore = 0;
  let highestScore = -1;
  let lowestScore = 101;
  let highestState = '';
  let lowestState = '';

  convergenceScores.forEach((data, abbr) => {
    totalScore += data.score;
    if (data.score > highestScore) {
      highestScore = data.score;
      highestState = abbr;
    }
    if (data.score < lowestScore) {
      lowestScore = data.score;
      lowestState = abbr;
    }
  });

  const avgScore = Math.round(totalScore / convergenceScores.size);

  const stats = [
    { label: 'States with data', value: String(convergenceScores.size) },
    { label: 'Avg score', value: String(avgScore) },
    { label: 'Highest', value: `${highestState} (${highestScore})` },
    { label: 'Lowest', value: `${lowestState} (${lowestScore})` },
  ];

  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-4">
      <CardHeader icon={TrendingUp} title="QUICK STATS" />
      <div className="space-y-2">
        {stats.map((stat) => (
          <div key={stat.label} className="flex justify-between items-center">
            <span className="text-[11px] font-body text-white/40">{stat.label}</span>
            <span className="text-[11px] font-mono text-white/70">{stat.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DataCanvas({
  convergenceScores,
  convergenceTopStates,
  convergenceAlerts,
  huntAlerts,
  scoutReport,
  murmurationIndex,
  isMobile,
  onSelectState,
}: DataCanvasProps) {
  return (
    <div
      className={`fixed z-10 overflow-y-auto scrollbar-hide p-4 glass-panel ${
        isMobile
          ? 'top-[76px] left-0 right-0 bottom-11'
          : 'top-[112px] left-80 right-0 bottom-0'
      }`}
    >
      <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-3'}`}>
        <MigrationIndexCard data={murmurationIndex} />
        <HotspotsCard topStates={convergenceTopStates} onSelectState={onSelectState} />
        <AlertFeedCard convergenceAlerts={convergenceAlerts} huntAlerts={huntAlerts} />
        <ScoreDistributionCard convergenceScores={convergenceScores} />
        <ScoutBriefCard scoutReport={scoutReport} />
        <QuickStatsCard convergenceScores={convergenceScores} />
      </div>
    </div>
  );
}
