import { useMemo } from 'react';
import type { StateArc } from '@/hooks/useStateArcs';

const GRADE_CONFIG: Record<string, { label: string; color: string }> = {
  confirmed: { label: 'CONFIRMED', color: '#22c55e' },
  partially_confirmed: { label: 'PARTIAL', color: '#f59e0b' },
  missed: { label: 'MISSED', color: '#ef4444' },
  false_alarm: { label: 'FALSE ALARM', color: '#ef4444' },
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function LatestPostMortem({ arcs }: { arcs: StateArc[] }) {
  const latest = useMemo(() => {
    return arcs
      .filter(a => a.grade && a.grade_reasoning)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0] || null;
  }, [arcs]);

  if (!latest) return null;

  const gradeConfig = GRADE_CONFIG[latest.grade!] || GRADE_CONFIG.missed;
  const reasoning = latest.grade_reasoning!
    .replace(/^#.*$/gm, '')
    .replace(/\*\*/g, '')
    .replace(/\|/g, ' ')
    .replace(/---/g, '')
    .trim()
    .slice(0, 250);

  return (
    <div className="shrink-0 border-t border-white/[0.06] px-3 py-2">
      <div className="text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1.5">Latest Post-Mortem</div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono font-bold text-white/70">{latest.state_abbr}</span>
          <span
            className="text-[7px] font-mono uppercase tracking-wider px-1 py-px rounded"
            style={{ color: gradeConfig.color, backgroundColor: `${gradeConfig.color}15` }}
          >
            {gradeConfig.label}
          </span>
        </div>
        <span className="text-[8px] font-mono text-white/15">{timeAgo(latest.updated_at)}</span>
      </div>
      <p className="text-[9px] font-mono text-white/25 leading-relaxed italic line-clamp-3">
        {reasoning}
      </p>
      {latest.precedent_accuracy != null && (
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[8px] font-mono text-white/15">Historical accuracy:</span>
          <span
            className="text-[8px] font-mono"
            style={{ color: latest.precedent_accuracy >= 60 ? '#22c55e' : '#f59e0b' }}
          >
            {Math.round(latest.precedent_accuracy)}%
          </span>
        </div>
      )}
    </div>
  );
}
