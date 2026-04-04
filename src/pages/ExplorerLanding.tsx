import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Settings, ChevronUp, ChevronDown, Search, Calendar, Loader2, Sparkles, RotateCcw } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import { useAuth } from '@/hooks/useAuth';
import UserMenu from '@/components/UserMenu';
import ErrorBoundary from '@/components/ErrorBoundary';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_IN_MONTH = [31,29,31,30,31,30,31,31,30,31,30,31];

export default function ExplorerLanding() {
  const [month, setMonth] = useState(3);
  const [day, setDay] = useState(4);
  const [year, setYear] = useState(2026);
  const [question, setQuestion] = useState('');
  const [brainCount, setBrainCount] = useState<number | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);

  // Chat hook — this IS the brain interface
  const { messages, loading, streaming, sendMessage, clearMessages } = useChat({
    species: 'all',
    stateAbbr: null,
    onMapAction: () => {},
  });

  // Fetch brain count
  useEffect(() => {
    if (!SUPABASE_URL) return;
    fetch(`${SUPABASE_URL}/functions/v1/hunt-suggested-prompts`, {
      headers: { apikey: SUPABASE_KEY },
    })
      .then(r => r.json())
      .then(data => { if (data.stats?.total_entries) setBrainCount(data.stats.total_entries); })
      .catch(() => {});
  }, []);

  // Auto-scroll to results when brain responds
  useEffect(() => {
    if (messages.length > 0 && resultsRef.current) {
      resultsRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [messages.length]);

  // Embed every completed assistant response back into the brain
  const embeddedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.content && msg.content.length > 50 && !embeddedRef.current.has(msg.id)) {
        if (loading || streaming) continue; // wait until response is complete
        embeddedRef.current.add(msg.id);
        // Find the user message that triggered this response
        const msgIndex = messages.indexOf(msg);
        const userMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
        const queryText = userMsg?.role === 'user' ? userMsg.content : 'unknown query';
        // Fire and forget — embed the interaction
        fetch(`${SUPABASE_URL}/functions/v1/hunt-embed-interaction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
          body: JSON.stringify({
            content: `User asked: "${queryText}" — Brain responded with ${msg.content.length} chars of cross-domain analysis.`,
            content_type: 'query-signal',
            title: `Query: ${queryText.slice(0, 80)}`,
            metadata: { query: queryText, response_length: msg.content.length, timestamp: new Date().toISOString() },
          }),
        }).catch(() => {});
      }
    }
  }, [messages, loading, streaming]);

  // Send date query through the dispatcher
  const handleDateQuery = useCallback(() => {
    if (loading || streaming) return;
    const dateStr = `${MONTHS[month]} ${day}, ${year}`;
    const msg = question.trim()
      ? `On ${dateStr}: ${question.trim()}`
      : `What was happening on ${dateStr}? Cross-reference every domain you have — weather, climate indices, storms, migration, tides, earthquakes, moon phase, everything. Show me the full picture of that date.`;
    setHasSearched(true);
    sendMessage(msg);
  }, [month, day, year, question, loading, streaming, sendMessage]);

  // Send freeform question through the dispatcher
  const handleFreeformSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || loading || streaming) return;
    setHasSearched(true);
    sendMessage(question.trim());
    setQuestion('');
  }, [question, loading, streaming, sendMessage]);

  const handleNewQuery = useCallback(() => {
    clearMessages();
    setHasSearched(false);
    setQuestion('');
  }, [clearMessages]);

  const dateStr = `${MONTHS[month]} ${day}, ${year}`;
  const spinMonth = (dir: number) => setMonth(m => (m + dir + 12) % 12);
  const spinDay = (dir: number) => setDay(d => {
    const max = DAYS_IN_MONTH[month];
    const next = d + dir;
    if (next < 1) return max;
    if (next > max) return 1;
    return next;
  });
  const spinYear = (dir: number) => setYear(y => Math.max(1950, Math.min(2026, y + dir)));

  // Get the latest assistant message for display
  const assistantMessages = messages.filter(m => m.role === 'assistant' && m.content);

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#0a0f1a] flex flex-col">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between px-4 sm:px-6 h-12 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <Link to="/" onClick={handleNewQuery} className="hover:opacity-80 transition-opacity">
            <span className="text-sm font-bold text-white tracking-wider">DUCK COUNTDOWN</span>
          </Link>
          <span className="text-[9px] font-mono text-cyan-400/60 tracking-widest hidden sm:inline">
            ENVIRONMENTAL INTELLIGENCE
          </span>
        </div>
        <div className="flex items-center gap-2">
          {brainCount && (
            <div className="hidden sm:flex items-center gap-1.5">
              <Brain size={12} className="text-cyan-400/40" />
              <span className="text-[9px] font-mono text-white/30">
                {brainCount.toLocaleString()}
              </span>
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
        <div className="max-w-3xl mx-auto px-4 sm:px-6">

          {/* Search area — compact when results showing */}
          <div className={`text-center transition-all duration-300 ${hasSearched ? 'pt-4 pb-4' : 'pt-10 sm:pt-16 pb-6'}`}>

            {!hasSearched && (
              <h1 className="font-display text-2xl sm:text-3xl text-white/90 mb-2 leading-tight">
                Pick a date. See everything.
              </h1>
            )}

            {!hasSearched && (
              <p className="text-sm text-white/30 mb-8 font-body">
                Cross-reference any date across every domain in the brain.
              </p>
            )}

            {/* Date Spinners */}
            <div className="flex items-center justify-center gap-2 sm:gap-4 mb-4">
              <Spinner label="MONTH" value={MONTHS[month]} onUp={() => spinMonth(1)} onDown={() => spinMonth(-1)} wide />
              <Spinner label="DAY" value={String(day)} onUp={() => spinDay(1)} onDown={() => spinDay(-1)} />
              <Spinner label="YEAR" value={String(year)} onUp={() => spinYear(1)} onDown={() => spinYear(-1)} />
            </div>

            {/* Question input + actions */}
            <div className="max-w-lg mx-auto mb-3">
              <form onSubmit={handleFreeformSubmit} className="flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#0d1117] border border-white/10 focus-within:border-cyan-400/30 transition-colors">
                  <Search size={14} className="text-white/20 shrink-0" />
                  <input
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    placeholder="Ask anything, or just pick a date..."
                    className="flex-1 bg-transparent text-sm font-body text-white/90 placeholder:text-white/25 outline-none"
                  />
                </div>
              </form>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={handleDateQuery}
                disabled={loading || streaming}
                className="px-5 py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
              >
                {(loading || streaming) ? (
                  <Loader2 size={15} className="text-white animate-spin" />
                ) : (
                  <Calendar size={15} className="text-white" />
                )}
                <span className="font-body text-xs font-semibold text-white">
                  {dateStr}
                </span>
              </button>

              {question.trim() && (
                <button
                  onClick={() => { setHasSearched(true); sendMessage(question.trim()); setQuestion(''); }}
                  disabled={loading || streaming}
                  className="px-5 py-2.5 rounded-lg bg-purple-500/80 hover:bg-purple-400/80 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
                >
                  <Sparkles size={15} className="text-white" />
                  <span className="font-body text-xs font-semibold text-white">Ask Brain</span>
                </button>
              )}

              {hasSearched && (
                <button
                  onClick={handleNewQuery}
                  className="px-3 py-2.5 rounded-lg border border-white/10 hover:bg-white/[0.04] transition-colors inline-flex items-center gap-1.5"
                >
                  <RotateCcw size={13} className="text-white/40" />
                  <span className="font-body text-xs text-white/40">New</span>
                </button>
              )}
            </div>

            {!hasSearched && brainCount && (
              <p className="text-[10px] font-mono text-white/15 mt-4">
                {brainCount.toLocaleString()}+ records across 83 domains · 1950–present
              </p>
            )}
          </div>

          {/* Brain Response — inline, not a modal */}
          <div ref={resultsRef}>
            <ErrorBoundary fallback={<p className="text-xs text-white/40 text-center py-8">Error loading response.</p>}>
              {assistantMessages.map((msg, i) => (
                <BrainResponse
                  key={msg.id}
                  message={msg}
                  isLatest={i === assistantMessages.length - 1}
                  isStreaming={streaming && i === assistantMessages.length - 1}
                />
              ))}

              {loading && !streaming && (
                <div className="flex items-center justify-center gap-2 py-8">
                  <Loader2 size={16} className="text-cyan-400/60 animate-spin" />
                  <span className="text-xs font-mono text-cyan-400/40">Brain is thinking...</span>
                </div>
              )}
            </ErrorBoundary>
          </div>

          {/* Conversation — show user messages for context */}
          {messages.filter(m => m.role === 'user').length > 1 && (
            <div className="border-t border-white/[0.04] mt-6 pt-4 pb-12">
              <p className="text-[9px] font-mono text-white/20 mb-3">CONVERSATION</p>
              {messages.map(msg => (
                <div key={msg.id} className={`mb-2 ${msg.role === 'user' ? 'text-right' : ''}`}>
                  <span className={`inline-block text-xs font-body leading-relaxed rounded-lg px-3 py-2 max-w-[85%] ${
                    msg.role === 'user'
                      ? 'bg-cyan-400/[0.08] text-white/70'
                      : 'bg-white/[0.02] text-white/50'
                  }`}>
                    {msg.role === 'user' ? msg.content : msg.content.slice(0, 200) + (msg.content.length > 200 ? '...' : '')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Bottom padding */}
          <div className="h-12" />
        </div>
      </main>

      <div className="grain-overlay" />
    </div>
  );
}

/** Date spinner component */
function Spinner({ label, value, onUp, onDown, wide }: {
  label: string; value: string; onUp: () => void; onDown: () => void; wide?: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <button onClick={onUp} className="p-1.5 text-white/20 hover:text-white/50 transition-colors">
        <ChevronUp size={16} />
      </button>
      <div className={`${wide ? 'w-28 sm:w-32' : 'w-16 sm:w-20'} h-12 flex items-center justify-center bg-[#0d1117] border border-white/[0.08] rounded-lg`}>
        <span className="text-base sm:text-lg font-bold text-white tracking-wide">{value}</span>
      </div>
      <button onClick={onDown} className="p-1.5 text-white/20 hover:text-white/50 transition-colors">
        <ChevronDown size={16} />
      </button>
      <span className="text-[7px] font-mono text-white/15 tracking-widest mt-0.5">{label}</span>
    </div>
  );
}

/** Renders a brain response with markdown-like formatting */
function BrainResponse({ message, isLatest, isStreaming }: {
  message: { content: string; id: string };
  isLatest: boolean;
  isStreaming: boolean;
}) {
  const content = message.content;
  if (!content) return null;

  // Simple markdown rendering — headers, bold, lists
  const rendered = content.split('\n').map((line, i) => {
    const trimmed = line.trim();

    // Headers
    if (trimmed.startsWith('## ')) {
      return <h3 key={i} className="text-sm font-bold text-white/80 mt-4 mb-1.5">{trimmed.slice(3)}</h3>;
    }
    if (trimmed.startsWith('# ')) {
      return <h2 key={i} className="text-base font-bold text-white/90 mt-4 mb-2">{trimmed.slice(2)}</h2>;
    }

    // Horizontal rules
    if (trimmed === '---') {
      return <hr key={i} className="border-white/[0.06] my-3" />;
    }

    // List items
    if (trimmed.startsWith('- ')) {
      return (
        <div key={i} className="flex gap-2 ml-2 mb-0.5">
          <span className="text-cyan-400/40 text-xs mt-0.5">-</span>
          <span className="text-xs text-white/60 leading-relaxed">{renderBold(trimmed.slice(2))}</span>
        </div>
      );
    }

    // Numbered list
    const numMatch = trimmed.match(/^(\d+)\.\s+/);
    if (numMatch) {
      return (
        <div key={i} className="flex gap-2 ml-2 mb-0.5">
          <span className="text-cyan-400/40 text-xs mt-0.5 font-mono w-3">{numMatch[1]}.</span>
          <span className="text-xs text-white/60 leading-relaxed">{renderBold(trimmed.slice(numMatch[0].length))}</span>
        </div>
      );
    }

    // Table-like rows (pipes)
    if (trimmed.includes('|') && trimmed.split('|').length >= 3) {
      const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.every(c => c.match(/^[-:]+$/))) return null; // skip separator rows
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

    // Empty line
    if (!trimmed) return <div key={i} className="h-2" />;

    // Regular paragraph
    return <p key={i} className="text-xs text-white/60 leading-relaxed mb-1">{renderBold(trimmed)}</p>;
  });

  return (
    <div className={`rounded-xl bg-white/[0.015] border border-white/[0.05] p-4 sm:p-5 mb-4 ${isStreaming ? 'border-cyan-400/10' : ''}`}>
      <div className="flex items-center gap-2 mb-3">
        <Brain size={14} className={`${isStreaming ? 'text-cyan-400 animate-pulse' : 'text-cyan-400/50'}`} />
        <span className="text-[9px] font-mono text-white/30 tracking-wider">
          {isStreaming ? 'THINKING...' : 'BRAIN RESPONSE'}
        </span>
      </div>
      <div>{rendered}</div>
    </div>
  );
}

/** Render **bold** text within a string */
function renderBold(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="text-white/80 font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
