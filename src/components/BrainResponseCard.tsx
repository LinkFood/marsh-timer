import { useState, useCallback } from 'react';
import { Brain, ThumbsUp, ThumbsDown } from 'lucide-react';
import InlineStateMap, { extractStates } from './InlineStateMap';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

interface BrainResponseCardProps {
  message: { content: string; id: string };
  isStreaming: boolean;
  onFollowUp?: (query: string) => void;
}

export default function BrainResponseCard({ message, isStreaming, onFollowUp }: BrainResponseCardProps) {
  const content = message.content;
  if (!content) return null;

  const [copied, setCopied] = useState(false);
  const handleShare = useCallback(() => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, []);

  const rendered = content.split('\n').map((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) return <h3 key={i} className="text-sm font-bold text-white/80 mt-4 mb-1.5">{trimmed.slice(3)}</h3>;
    if (trimmed.startsWith('# ')) return <h2 key={i} className="text-base font-bold text-white/90 mt-4 mb-2">{trimmed.slice(2)}</h2>;
    if (trimmed === '---') return <hr key={i} className="border-white/[0.06] my-3" />;
    if (trimmed.startsWith('- ')) {
      return (
        <div key={i} className="flex gap-2 ml-2 mb-0.5">
          <span className="text-cyan-400/40 text-xs mt-0.5">-</span>
          <span className="text-xs text-white/60 leading-relaxed">{renderBold(trimmed.slice(2))}</span>
        </div>
      );
    }
    const numMatch = trimmed.match(/^(\d+)\.\s+/);
    if (numMatch) {
      return (
        <div key={i} className="flex gap-2 ml-2 mb-0.5">
          <span className="text-cyan-400/40 text-xs mt-0.5 font-mono w-3">{numMatch[1]}.</span>
          <span className="text-xs text-white/60 leading-relaxed">{renderBold(trimmed.slice(numMatch[0].length))}</span>
        </div>
      );
    }
    if (trimmed.includes('|') && trimmed.split('|').length >= 3) {
      const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.every(c => c.match(/^[-:]+$/))) return null;
      const isHeader = i === 0 || (content.split('\n')[i + 1]?.trim()?.match(/^[\|:\-\s]+$/));
      return (
        <div key={i} className={`flex gap-2 mb-px px-2 py-1 rounded ${isHeader ? 'bg-white/[0.03]' : 'hover:bg-white/[0.02]'}`}>
          {cells.map((cell, ci) => {
            const lower = cell.toLowerCase();
            let extraClass = '';
            if (lower === 'extreme' || lower === 'critical') extraClass = 'text-red-400/70';
            else if (lower === 'high') extraClass = 'text-amber-400/60';
            else if (lower === 'moderate') extraClass = 'text-yellow-400/50';
            else if (lower === 'low' || lower === 'baseline') extraClass = 'text-white/25';
            else if (lower.includes('confirmed')) extraClass = 'text-emerald-400/60';
            return (
              <span key={ci} className={`text-[10px] font-mono ${ci === 0 ? 'text-white/60 w-28 shrink-0' : extraClass || 'text-white/40 flex-1'} ${isHeader ? 'font-semibold text-white/50' : ''}`}>
                {renderBold(cell)}
              </span>
            );
          })}
        </div>
      );
    }
    if (!trimmed) return <div key={i} className="h-2" />;
    return <p key={i} className="text-xs text-white/60 leading-relaxed mb-1">{renderBold(trimmed)}</p>;
  });

  // Extract follow-up questions
  const followUps: string[] = [];
  if (!isStreaming && onFollowUp) {
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/\*"([^"]+)"\*/);
      if (match && match[1].length > 15 && match[1].endsWith('?')) {
        followUps.push(match[1]);
      }
    }
  }

  return (
    <div className={`rounded-xl bg-white/[0.015] border border-white/[0.05] p-4 sm:p-5 mb-4 ${isStreaming ? 'border-cyan-400/10' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain size={14} className={`${isStreaming ? 'text-cyan-400 animate-pulse' : 'text-cyan-400/50'}`} />
          <span className="text-[9px] font-mono text-white/30 tracking-wider">
            {isStreaming ? 'THINKING...' : 'BRAIN'}
          </span>
        </div>
        {!isStreaming && (
          <button
            onClick={handleShare}
            className={`text-[9px] font-mono transition-colors px-2 py-1 rounded hover:bg-white/[0.03] ${copied ? 'text-emerald-400/60' : 'text-white/20 hover:text-cyan-400/60'}`}
          >
            {copied ? 'COPIED!' : 'SHARE'}
          </button>
        )}
      </div>
      <div>{rendered}</div>

      {/* Inline map showing mentioned states */}
      {!isStreaming && (() => {
        const states = extractStates(content);
        return states.length >= 2 ? <InlineStateMap highlightedStates={states} /> : null;
      })()}

      {/* Follow-up questions */}
      {followUps.length > 0 && onFollowUp && (
        <div className="mt-4 pt-3 border-t border-white/[0.04]">
          <p className="text-[9px] font-mono text-white/20 mb-2">DIG DEEPER</p>
          <div className="flex flex-wrap gap-1.5">
            {followUps.map((q, idx) => (
              <button
                key={idx}
                onClick={() => onFollowUp(q)}
                className="text-[10px] font-body text-cyan-400/50 hover:text-cyan-400 bg-cyan-400/[0.04] hover:bg-cyan-400/[0.08] border border-cyan-400/10 rounded-lg px-2.5 py-1.5 transition-colors text-left"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Feedback */}
      {!isStreaming && <ResponseFeedback messageId={message.id} content={content} />}
    </div>
  );
}

function ResponseFeedback({ messageId, content }: { messageId: string; content: string }) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [surprising, setSurprising] = useState(false);

  const submitFeedback = useCallback((r: 'up' | 'down') => {
    setRating(r);
    if (!SUPABASE_URL) return;
    fetch(`${SUPABASE_URL}/functions/v1/hunt-embed-interaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
      body: JSON.stringify({
        content: `User rated brain response ${r === 'up' ? 'USEFUL' : 'NOT USEFUL'}${surprising ? ' and SURPRISING' : ''}. Response: ${content.slice(0, 200)}`,
        content_type: 'query-feedback',
        title: `Feedback: ${r} ${surprising ? '+ surprising' : ''}`,
        metadata: { rating: r, surprising, response_length: content.length, message_id: messageId, timestamp: new Date().toISOString() },
      }),
    }).catch(() => {});
  }, [content, messageId, surprising]);

  if (rating) {
    return (
      <div className="mt-3 pt-2 border-t border-white/[0.03] flex items-center gap-2">
        <span className={`text-[9px] font-mono ${rating === 'up' ? 'text-emerald-400/50' : 'text-red-400/50'}`}>
          {rating === 'up' ? 'Marked useful' : 'Marked not useful'}{surprising ? ' + surprising' : ''}
        </span>
        <span className="text-[8px] text-white/15">— the brain learns from this</span>
      </div>
    );
  }

  return (
    <div className="mt-3 pt-2 border-t border-white/[0.03] flex items-center gap-3">
      <span className="text-[8px] font-mono text-white/15">Was this useful?</span>
      <button onClick={() => submitFeedback('up')} className="p-1 rounded hover:bg-emerald-400/10 transition-colors">
        <ThumbsUp size={12} className="text-white/20 hover:text-emerald-400/60" />
      </button>
      <button onClick={() => submitFeedback('down')} className="p-1 rounded hover:bg-red-400/10 transition-colors">
        <ThumbsDown size={12} className="text-white/20 hover:text-red-400/60" />
      </button>
      <button
        onClick={() => setSurprising(!surprising)}
        className={`text-[9px] font-mono px-2 py-0.5 rounded-full border transition-colors ${
          surprising ? 'border-purple-400/30 text-purple-400/60 bg-purple-400/[0.06]' : 'border-white/[0.06] text-white/20 hover:text-purple-400/40'
        }`}
      >
        Surprising?
      </button>
    </div>
  );
}

function renderBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      const inner = part.slice(2, -2);
      const scoreMatch = inner.match(/^(\d+)\/(\d+)$/);
      if (scoreMatch) {
        const val = parseInt(scoreMatch[1], 10);
        const max = parseInt(scoreMatch[2], 10);
        const pct = max > 0 ? (val / max) * 100 : 0;
        const color = pct >= 80 ? 'bg-emerald-400' : pct >= 50 ? 'bg-cyan-400' : pct >= 25 ? 'bg-amber-400' : pct > 0 ? 'bg-red-400' : 'bg-white/10';
        return (
          <span key={i} className="inline-flex items-center gap-1.5 mx-0.5">
            <span className="text-white/80 font-semibold text-[10px] font-mono">{inner}</span>
            <span className="inline-block w-12 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <span className={`block h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
            </span>
          </span>
        );
      }
      const pctMatch = inner.match(/^(\d+(?:\.\d+)?)%$/);
      if (pctMatch) {
        const val = parseFloat(pctMatch[1]);
        const color = val >= 100 ? 'text-emerald-400' : val >= 50 ? 'text-cyan-400' : val >= 25 ? 'text-amber-400' : 'text-red-400';
        return <span key={i} className={`font-semibold font-mono text-[11px] ${color}`}>{inner}</span>;
      }
      return <strong key={i} className="text-white/80 font-semibold">{inner}</strong>;
    }
    return part;
  });
}
