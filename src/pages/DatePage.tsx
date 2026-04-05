import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Brain, Settings, Calendar, Loader2, RotateCcw, Send, ChevronLeft, ThumbsUp, ThumbsDown } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import UserMenu from '@/components/UserMenu';
import ErrorBoundary from '@/components/ErrorBoundary';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function formatDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  const monthIdx = parseInt(m, 10) - 1;
  const day = parseInt(d, 10);
  return `${MONTHS[monthIdx]} ${day}, ${y}`;
}

export default function DatePage() {
  const { dateStr } = useParams<{ dateStr: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isGrade = searchParams.get('grade') === 'true';
  const compareDate = searchParams.get('compare');
  const [followUp, setFollowUp] = useState('');
  const [brainCount, setBrainCount] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoFiredRef = useRef(false);

  const { messages, loading, streaming, sendMessage, clearMessages } = useChat({
    species: 'all',
    stateAbbr: null,
    onMapAction: () => {},
  });

  // Fetch brain count
  useEffect(() => {
    if (!SUPABASE_URL) return;
    fetch(`${SUPABASE_URL}/functions/v1/hunt-suggested-prompts`, { headers: { apikey: SUPABASE_KEY } })
      .then(r => r.json())
      .then(data => { if (data.stats?.total_entries) setBrainCount(data.stats.total_entries); })
      .catch(() => {});
  }, []);

  // Auto-fire the date query on mount
  useEffect(() => {
    if (autoFiredRef.current || !dateStr) return;
    autoFiredRef.current = true;
    const formatted = formatDateStr(dateStr);

    if (isGrade) {
      sendMessage(`Grade ${formatted} as an environmental day. Score it A+ through F based on how unusual or extreme the conditions were across all domains. Show a report card with each domain scored. Make it fun and shareable — like a personality quiz for a date. Include one surprising fact about this date that nobody would expect.`);
    } else if (compareDate) {
      const formatted2 = formatDateStr(compareDate);
      sendMessage(`Compare the environmental conditions on ${formatted} vs ${formatted2}. What was the same across all domains? What was different? Rate the overall environmental similarity as a percentage. Include climate indices, weather, storms, migration, tides, moon phase, and any other domains with data for both dates.`);
    } else {
      sendMessage(`What was happening on ${formatted}? Cross-reference every domain you have — weather, climate indices, storms, migration, tides, earthquakes, moon phase, everything. Show me the full picture of that date.`);
    }
  }, [dateStr, sendMessage, isGrade, compareDate]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0 && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streaming]);

  // Embed responses back into brain
  const embeddedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.content && msg.content.length > 50 && !embeddedRef.current.has(msg.id)) {
        if (loading || streaming) continue;
        embeddedRef.current.add(msg.id);
        const msgIndex = messages.indexOf(msg);
        const userMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
        const queryText = userMsg?.role === 'user' ? userMsg.content : dateStr || 'date query';
        fetch(`${SUPABASE_URL}/functions/v1/hunt-embed-interaction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
          body: JSON.stringify({
            content: `User explored date ${dateStr}: "${queryText.slice(0, 100)}" — Brain responded with ${msg.content.length} chars.`,
            content_type: 'query-signal',
            title: `Date Page: ${dateStr}`,
            metadata: { date: dateStr, response_length: msg.content.length, timestamp: new Date().toISOString() },
          }),
        }).catch(() => {});
      }
    }
  }, [messages, loading, streaming, dateStr]);

  const handleFollowUp = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!followUp.trim() || loading || streaming) return;
    sendMessage(followUp.trim());
    setFollowUp('');
  }, [followUp, loading, streaming, sendMessage]);

  const formattedDate = dateStr ? formatDateStr(dateStr) : 'Unknown Date';

  // Update page title for SEO/sharing
  useEffect(() => {
    const mode = isGrade ? 'Report Card' : compareDate ? `vs ${formatDateStr(compareDate)}` : 'Environmental Portrait';
    document.title = `${formattedDate} — ${mode} | Duck Countdown`;
    // Update meta description
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', `Cross-domain environmental analysis for ${formattedDate}. Weather, climate, storms, migration, tides, moon phase — everything the brain knows.`);
    return () => { document.title = 'Duck Countdown | Environmental Intelligence Platform'; };
  }, [formattedDate, isGrade, compareDate]);

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#0a0f1a] flex flex-col">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 h-12 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <ChevronLeft size={14} className="text-white/40" />
            <span className="text-sm font-bold text-white tracking-wider">DUCK COUNTDOWN</span>
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {brainCount && (
            <div className="hidden sm:flex items-center gap-1.5">
              <Brain size={12} className="text-cyan-400/40" />
              <span className="text-[9px] font-mono text-white/30">{brainCount.toLocaleString()}</span>
              <span className="text-[8px] font-mono text-emerald-400/40">LIVE</span>
            </div>
          )}
          <Link to="/dashboard" className="p-1.5 rounded hover:bg-white/[0.06] transition-colors" title="Dashboard">
            <Settings size={14} className="text-white/40" />
          </Link>
          <UserMenu />
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6">
          {/* Date header */}
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Calendar size={18} className="text-cyan-400/50" />
              <h1 className="font-display text-xl sm:text-2xl text-white/90">{formattedDate}</h1>
            </div>
            <p className="text-xs text-white/30 font-body">
              {isGrade ? 'Environmental Report Card' : compareDate ? `Compared with ${formatDateStr(compareDate)}` : 'Cross-domain environmental portrait'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-3">
              <button
                onClick={() => navigate('/')}
                className="px-3 py-1.5 rounded-lg border border-white/[0.06] hover:bg-white/[0.04] transition-colors inline-flex items-center gap-1.5"
              >
                <RotateCcw size={12} className="text-white/30" />
                <span className="font-body text-xs text-white/30">New query</span>
              </button>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                }}
                className="px-3 py-1.5 rounded-lg border border-white/[0.06] hover:bg-white/[0.04] transition-colors text-xs font-body text-white/30"
              >
                Share
              </button>
            </div>
          </div>

          {/* Brain Responses */}
          <ErrorBoundary fallback={<p className="text-xs text-white/40 text-center py-8">Error loading.</p>}>
            {messages.map((msg, i) => {
              if (msg.role === 'user' && i === 0) return null; // hide the auto-fired query
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="mb-3 text-right">
                    <span className="inline-block text-xs font-body text-white/70 bg-cyan-400/[0.08] rounded-lg px-3 py-2 max-w-[85%] text-left">
                      {msg.content}
                    </span>
                  </div>
                );
              }
              if (msg.role === 'assistant' && msg.content) {
                return <BrainResponse key={msg.id} message={msg} isStreaming={streaming && i === messages.length - 1} onFollowUp={sendMessage} />;
              }
              return null;
            })}

            {loading && !streaming && (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 size={16} className="text-cyan-400/60 animate-spin" />
                <span className="text-xs font-mono text-cyan-400/40">Loading {formattedDate}...</span>
              </div>
            )}
          </ErrorBoundary>

          {/* Follow-up */}
          {!loading && !streaming && messages.filter(m => m.role === 'assistant').length > 0 && (
            <form onSubmit={handleFollowUp} className="mt-4 mb-8">
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#0d1117] border border-white/10 focus-within:border-cyan-400/30 transition-colors">
                <input
                  value={followUp}
                  onChange={e => setFollowUp(e.target.value)}
                  placeholder="Ask a follow-up about this date..."
                  className="flex-1 bg-transparent text-sm font-body text-white/90 placeholder:text-white/25 outline-none"
                />
                <button type="submit" disabled={!followUp.trim()} className="p-1.5 rounded hover:bg-white/[0.06] transition-colors disabled:opacity-20">
                  <Send size={14} className="text-cyan-400" />
                </button>
              </div>
            </form>
          )}

          <div ref={bottomRef} className="h-8" />
        </div>
      </main>

      <div className="grain-overlay" />
    </div>
  );
}

/** Reused BrainResponse — same as ExplorerLanding but standalone */
function BrainResponse({ message, isStreaming, onFollowUp }: {
  message: { content: string; id: string };
  isStreaming: boolean;
  onFollowUp?: (query: string) => void;
}) {
  const content = message.content;
  if (!content) return null;

  const [copied, setCopied] = useState(false);

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
      return (
        <div key={i} className="flex gap-3 mb-0.5 ml-2">
          {cells.map((cell, ci) => (
            <span key={ci} className={`text-[10px] font-mono ${ci === 0 ? 'text-white/60 w-24' : 'text-white/40 flex-1'}`}>
              {renderBold(cell)}
            </span>
          ))}
        </div>
      );
    }
    if (!trimmed) return <div key={i} className="h-2" />;
    return <p key={i} className="text-xs text-white/60 leading-relaxed mb-1">{renderBold(trimmed)}</p>;
  });

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
            onClick={() => {
              navigator.clipboard.writeText(window.location.href);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className={`text-[9px] font-mono transition-colors px-2 py-1 rounded hover:bg-white/[0.03] ${copied ? 'text-emerald-400/60' : 'text-white/20 hover:text-cyan-400/60'}`}
          >
            {copied ? 'COPIED!' : 'SHARE'}
          </button>
        )}
      </div>
      <div>{rendered}</div>
    </div>
  );
}

function renderBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-white/80 font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
