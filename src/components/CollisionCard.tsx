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
  'environmental': '#22c55e',
};

const TYPE_LABELS: Record<CollisionType, string> = {
  'compound-risk': 'RISK',
  'correlation': 'LINK',
  'anomaly': 'ANOMALY',
  'score-spike': 'SPIKE',
  'grade-reasoning': 'GRADE',
  'convergence': 'DATA',
  'arc-fingerprint': 'GRADE',
  'environmental': 'ENV',
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
      className={`w-full text-left px-2 py-1.5 transition-colors ${entry.severity === 'high' ? 'hover:bg-white/[0.04] bg-white/[0.01]' : 'hover:bg-white/[0.02]'}`}
      style={{ borderLeft: `${entry.severity === 'high' ? 3 : entry.severity === 'low' ? 1 : 2}px solid ${borderColor}` }}
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
        {/* Inline grade badge for GRADE entries */}
        {(entry.type === 'grade-reasoning' || entry.type === 'arc-fingerprint') && entry.detail && (() => {
          const d = entry.detail.toLowerCase();
          const g = d.includes('confirmed') ? { label: 'CONFIRMED', color: '#22c55e' }
            : d.includes('missed') ? { label: 'MISSED', color: '#ef4444' }
            : d.includes('false') ? { label: 'FALSE ALARM', color: '#ef4444' }
            : d.includes('partial') ? { label: 'PARTIAL', color: '#f59e0b' }
            : null;
          return g ? (
            <span className="text-[7px] font-mono px-1 py-px rounded shrink-0" style={{ color: g.color, backgroundColor: `${g.color}15` }}>
              {g.label}
            </span>
          ) : null;
        })()}
        <span className={`text-[10px] font-mono truncate min-w-0 ${entry.severity === 'high' ? 'text-white/55' : 'text-white/45'}`}>
          {entry.title}
        </span>
        {/* Inline domain dots for compound-risk */}
        {entry.type === 'compound-risk' && entry.domains && entry.domains.length > 0 && (
          <div className="flex items-center gap-px shrink-0 ml-0.5">
            {entry.domains.slice(0, 5).map(d => (
              <div key={d} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: DOMAIN_COLORS[d] || '#6b7280' }} title={d} />
            ))}
          </div>
        )}
        {/* Similarity badge for correlations */}
        {entry.type === 'correlation' && entry.similarity != null && (
          <span className="text-[7px] font-mono text-purple-400/60 shrink-0 ml-0.5">
            {Math.round(entry.similarity * 100)}%
          </span>
        )}
        {/* Z-score badge for anomalies */}
        {entry.type === 'anomaly' && entry.zScore != null && (
          <span className={`text-[7px] font-mono shrink-0 ml-0.5 ${Math.abs(entry.zScore) >= 3 ? 'text-red-400/60' : 'text-amber-400/40'}`}>
            {Math.abs(entry.zScore).toFixed(1)}σ
          </span>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mt-1.5 ml-6 space-y-1.5">
          {/* Domain pills + convergence count for compound-risk entries */}
          {entry.domains && entry.domains.length > 0 && (
            <div>
              <div className="text-[8px] font-mono text-white/20 uppercase tracking-wider mb-0.5">
                What connected ({entry.convergingCount || entry.domains.length} domains)
              </div>
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

          {/* Structured detail for LINK entries */}
          {entry.type === 'correlation' && entry.similarity != null && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-[9px] font-mono">
                <span className="text-white/25">{entry.seedType}</span>
                <span className="text-purple-400/60">→ {Math.round(entry.similarity * 100)}% →</span>
                <span className="text-white/25">{entry.matchType}</span>
              </div>
              {entry.seedTitle && (
                <div className="text-[8px] font-mono text-white/20 truncate">Seed: {entry.seedTitle.replace(/\*\*/g, '')}</div>
              )}
              {entry.matchTitle && (
                <div className="text-[8px] font-mono text-white/20 truncate">Match: {entry.matchTitle}</div>
              )}
              {entry.crossDomainMatches != null && entry.crossDomainMatches > 0 && (
                <div className="text-[8px] font-mono text-purple-400/30">{entry.crossDomainMatches} cross-domain matches found</div>
              )}
            </div>
          )}

          {/* Structured detail for ANOMALY entries */}
          {entry.type === 'anomaly' && entry.zScore != null && (
            <div className="flex items-center gap-3 text-[9px] font-mono">
              <span className={entry.direction === 'above' ? 'text-red-400/50' : 'text-blue-400/50'}>
                {Math.abs(entry.zScore).toFixed(1)}σ {entry.direction}
              </span>
              <span className="text-white/15">|</span>
              <span className="text-white/20">statistical outlier detected</span>
            </div>
          )}

          {/* Brain narration */}
          {entry.detail && (
            <div className="px-2 py-1.5 rounded bg-white/[0.02] border-l border-cyan-400/20">
              <p className="text-[9px] font-mono text-white/30 leading-relaxed italic whitespace-pre-wrap line-clamp-6">
                {entry.detail.replace(/\*\*/g, '').replace(/^##\s+/gm, '').replace(/\|/g, ' · ')}
              </p>
            </div>
          )}
        </div>
      )}
    </button>
  );
}
