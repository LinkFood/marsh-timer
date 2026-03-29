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

const DOMAIN_COLORS: Record<string, string> = {
  weather: '#ef4444', birds: '#3b82f6', migration: '#3b82f6',
  birdcast: '#22c55e', solunar: '#f59e0b', water: '#06b6d4',
  climate: '#a855f7', pattern: '#a855f7', convergence: '#14b8a6',
  nws: '#ef4444', photoperiod: '#6b7280', tide: '#9ca3af',
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
  const hasDetail = !!(entry.detail || (entry.domains && entry.domains.length > 0));

  return (
    <button
      onClick={() => hasDetail && setExpanded(e => !e)}
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
      {expanded && (
        <div className="mt-1.5 ml-6 space-y-1.5">
          {/* Domain pills for compound-risk entries */}
          {entry.domains && entry.domains.length > 0 && (
            <div>
              <div className="text-[8px] font-mono text-white/20 uppercase tracking-wider mb-0.5">Converging domains</div>
              <div className="flex flex-wrap gap-1">
                {entry.domains.map(d => {
                  const color = DOMAIN_COLORS[d] || '#6b7280';
                  return (
                    <span
                      key={d}
                      className="inline-flex items-center gap-0.5 text-[8px] font-mono px-1.5 py-px rounded"
                      style={{ color, backgroundColor: `${color}15` }}
                    >
                      <span className="w-1 h-1 rounded-full" style={{ backgroundColor: color }} />
                      {d}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* Brain narration */}
          {entry.detail && (
            <div className="px-2 py-1.5 rounded bg-white/[0.02] border-l border-cyan-400/20">
              <p className="text-[9px] font-mono text-white/30 leading-relaxed italic whitespace-pre-wrap line-clamp-6">
                {entry.detail}
              </p>
            </div>
          )}
        </div>
      )}
    </button>
  );
}
