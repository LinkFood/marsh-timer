import { useState } from 'react';
import type { CollisionEntry, CollisionType } from '@/hooks/useCollisionFeed';

const BORDER_COLORS: Record<CollisionType, string> = {
  'compound-risk': '#ef4444',
  'correlation': '#a855f7',
  'anomaly': '#f59e0b',
  'score-spike': '#f59e0b',
  'grade-reasoning': '#5eead4',
  'convergence': '#6b7280',
  'arc-fingerprint': '#5eead4',
};

const TYPE_LABELS: Record<CollisionType, string> = {
  'compound-risk': 'RISK',
  'correlation': 'LINK',
  'anomaly': 'ANOMALY',
  'score-spike': 'SPIKE',
  'grade-reasoning': 'GRADE',
  'convergence': 'DATA',
  'arc-fingerprint': 'GRADE',
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

interface Props {
  entry: CollisionEntry;
}

export default function CollisionCard({ entry }: Props) {
  const [expanded, setExpanded] = useState(false);
  const borderColor = BORDER_COLORS[entry.type];
  const typeLabel = TYPE_LABELS[entry.type];

  return (
    <button
      onClick={() => entry.detail && setExpanded(e => !e)}
      className="w-full text-left px-2 py-1.5 transition-colors hover:bg-white/[0.02]"
      style={{ borderLeft: `2px solid ${borderColor}` }}
    >
      {/* Compact row */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-[8px] font-mono text-white/20 shrink-0 w-5 text-right">
          {timeAgo(entry.timestamp)}
        </span>
        <span
          className="text-[7px] font-mono uppercase tracking-wider px-1 py-px rounded shrink-0"
          style={{ color: borderColor, backgroundColor: `${borderColor}15` }}
        >
          {typeLabel}
        </span>
        {entry.stateAbbr && (
          <span className="text-[8px] font-mono font-semibold text-cyan-400/60 shrink-0">
            {entry.stateAbbr}
          </span>
        )}
        <span className="text-[10px] font-mono text-white/45 truncate min-w-0">
          {entry.title}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && entry.detail && (
        <div className="mt-1.5 ml-6 px-2 py-1.5 rounded bg-white/[0.02] border-l border-white/[0.04]">
          <p className="text-[9px] font-mono text-white/30 leading-relaxed italic whitespace-pre-wrap">
            {entry.detail}
          </p>
        </div>
      )}
    </button>
  );
}
