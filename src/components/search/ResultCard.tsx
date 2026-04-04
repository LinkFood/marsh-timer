import { useState } from 'react';
import { typeColor } from '@/data/contentTypeGroups';

export interface BrainResult {
  title: string;
  content: string;
  content_type: string;
  state_abbr: string | null;
  effective_date: string | null;
  similarity: number;
}

interface ResultCardProps {
  result: BrainResult;
  onStateClick?: (abbr: string) => void;
}

export default function ResultCard({ result, onStateClick }: ResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = result.content.length > 200;
  const displayContent = expanded ? result.content : result.content.slice(0, 200);

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg p-3 hover:bg-white/[0.04] transition-colors">
      {/* Top row: badges + metadata */}
      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${typeColor(result.content_type)}`}>
          {result.content_type}
        </span>
        {result.state_abbr && (
          <button
            onClick={() => onStateClick?.(result.state_abbr!)}
            className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-white/60 hover:text-white/80 hover:bg-white/[0.1] transition-colors"
          >
            {result.state_abbr}
          </button>
        )}
        {result.effective_date && (
          <span className="text-[9px] font-mono text-white/30">
            {result.effective_date}
          </span>
        )}
        <span className="text-[9px] font-mono text-cyan-400/50 ml-auto">
          {(result.similarity * 100).toFixed(0)}%
        </span>
      </div>

      {/* Content */}
      <p className="text-[11px] font-body text-white/60 leading-relaxed">
        {displayContent}
        {needsTruncation && !expanded && '...'}
      </p>

      {needsTruncation && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[9px] font-mono text-cyan-400/60 hover:text-cyan-400 mt-1 transition-colors"
        >
          {expanded ? 'show less' : 'show more'}
        </button>
      )}
    </div>
  );
}
