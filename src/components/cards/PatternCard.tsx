import { useState } from 'react';
import { Fingerprint } from 'lucide-react';

interface PatternMatch {
  title: string;
  content: string;
  similarity: number;
  content_type: string;
}

interface PatternCardProps {
  data: Record<string, unknown>;
}

function similarityColor(sim: number): string {
  if (sim >= 0.7) return 'bg-green-500/20 text-green-400';
  if (sim >= 0.5) return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-white/10 text-white/50';
}

export default function PatternCard({ data }: PatternCardProps) {
  const patterns = (data.patterns as PatternMatch[]) || [];
  const [expanded, setExpanded] = useState(false);

  if (patterns.length === 0) {
    return (
      <div className="rounded-lg bg-amber-950/30 border border-amber-500/20 p-2.5">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Fingerprint size={12} className="text-amber-400/50" />
          <span className="text-[10px] font-semibold text-amber-300/50 uppercase tracking-wider">
            Patterns
          </span>
        </div>
        <p className="text-[10px] text-white/40">No matching patterns found in brain</p>
        <p className="text-[9px] text-white/20 mt-1">Brain searched — 0 patterns matched</p>
      </div>
    );
  }

  const visible = expanded ? patterns : patterns.slice(0, 2);
  const hiddenCount = patterns.length - 2;

  return (
    <div className="rounded-lg bg-amber-950/30 border border-amber-500/20 p-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Fingerprint size={12} className="text-amber-400" />
        <span className="text-[10px] font-semibold text-amber-300 uppercase tracking-wider">
          Based on {patterns.length} matching pattern{patterns.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-1.5">
        {visible.map((p, i) => (
          <div key={i} className="flex gap-2 items-start">
            <span className={`shrink-0 mt-0.5 text-[9px] font-mono px-1 py-0.5 rounded ${similarityColor(p.similarity)}`}>
              {Math.round(p.similarity * 100)}%
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold text-white/80 truncate">{p.title}</p>
              <p className="text-[10px] text-white/50 line-clamp-2">{p.content}</p>
              <span className="inline-block mt-0.5 text-[8px] px-1 py-0.5 rounded bg-white/5 text-white/30">
                {p.content_type}
              </span>
            </div>
          </div>
        ))}
      </div>
      {hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1.5 text-[10px] text-amber-400/70 hover:text-amber-400 transition-colors"
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      )}
      <p className="text-[9px] text-white/20 mt-1.5">Brain searched — {patterns.length} pattern{patterns.length !== 1 ? 's' : ''} matched</p>
    </div>
  );
}
