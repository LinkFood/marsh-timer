import { History, RefreshCw } from 'lucide-react';
import { usePatternTimeline } from '@/hooks/usePatternTimeline';
import { useMapAction } from '@/contexts/MapActionContext';
import type { PanelComponentProps } from './PanelTypes';

function similarityColor(sim: number): string {
  if (sim >= 0.85) return 'text-emerald-400 bg-emerald-400/10';
  if (sim >= 0.7) return 'text-cyan-400 bg-cyan-400/10';
  if (sim >= 0.5) return 'text-amber-400 bg-amber-400/10';
  return 'text-white/40 bg-white/[0.06]';
}

function typeColor(ct: string): string {
  if (ct.includes('pattern') || ct.includes('correlation')) return 'text-purple-400 bg-purple-400/10';
  if (ct.includes('weather')) return 'text-amber-400 bg-amber-400/10';
  if (ct.includes('migration') || ct.includes('ebird')) return 'text-cyan-400 bg-cyan-400/10';
  if (ct.includes('convergence')) return 'text-red-400 bg-red-400/10';
  return 'text-white/40 bg-white/[0.06]';
}

export default function PatternTimelinePanel({ isFullscreen }: PanelComponentProps) {
  const { matches, loading, queryDescription, refetch } = usePatternTimeline();
  const { flyTo } = useMapAction();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-white/20">
        <History size={20} className="animate-pulse" />
        <span className="text-[10px]">{queryDescription || 'Searching patterns...'}</span>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-white/20">
        <History size={20} />
        <span className="text-[10px]">Select a state or wait for convergence data to find pattern matches</span>
        <span className="text-[9px] text-white/15">The brain searches for similar past conditions</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header with query description and refresh */}
      <div className="shrink-0 flex items-center justify-between px-2.5 py-1.5 border-b border-white/[0.06]">
        <span className="text-[9px] font-mono text-white/40 truncate">{queryDescription}</span>
        <button
          onClick={refetch}
          className="p-1 rounded hover:bg-white/[0.06] transition-colors"
          title="Refresh"
        >
          <RefreshCw size={10} className="text-white/30" />
        </button>
      </div>

      {/* Timeline */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {matches.map((match, i) => (
          <button
            key={i}
            onClick={() => match.state_abbr && flyTo(match.state_abbr)}
            className="w-full text-left px-2.5 py-2 border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors"
          >
            {/* Timeline dot + date */}
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="w-2 h-2 rounded-full border border-cyan-400/40 bg-cyan-400/20 shrink-0" />
              {match.effective_date && (
                <span className="text-[9px] font-mono text-white/50">{match.effective_date}</span>
              )}
              <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${typeColor(match.content_type)}`}>
                {match.content_type}
              </span>
              {match.state_abbr && (
                <span className="text-[9px] font-mono text-white/30">{match.state_abbr}</span>
              )}
              <span className={`text-[8px] font-mono px-1 py-0.5 rounded ml-auto ${similarityColor(match.similarity)}`}>
                {(match.similarity * 100).toFixed(0)}%
              </span>
            </div>

            {/* Content preview */}
            <p className="text-[10px] text-white/60 leading-relaxed line-clamp-3 ml-3.5">
              {match.content.slice(0, isFullscreen ? 500 : 200)}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
