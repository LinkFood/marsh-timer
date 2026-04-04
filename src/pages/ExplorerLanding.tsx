import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Settings, ChevronUp, ChevronDown, Search, Calendar, Loader2, Sparkles, RotateCcw, MapPin, Send, Zap } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import { useDailyDiscovery } from '@/hooks/useDailyDiscovery';
import UserMenu from '@/components/UserMenu';
import ErrorBoundary from '@/components/ErrorBoundary';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_IN_MONTH = [31,29,31,30,31,30,31,31,30,31,30,31];

const STATES: { abbr: string; name: string }[] = [
  {abbr:'AL',name:'Alabama'},{abbr:'AK',name:'Alaska'},{abbr:'AZ',name:'Arizona'},{abbr:'AR',name:'Arkansas'},
  {abbr:'CA',name:'California'},{abbr:'CO',name:'Colorado'},{abbr:'CT',name:'Connecticut'},{abbr:'DE',name:'Delaware'},
  {abbr:'FL',name:'Florida'},{abbr:'GA',name:'Georgia'},{abbr:'HI',name:'Hawaii'},{abbr:'ID',name:'Idaho'},
  {abbr:'IL',name:'Illinois'},{abbr:'IN',name:'Indiana'},{abbr:'IA',name:'Iowa'},{abbr:'KS',name:'Kansas'},
  {abbr:'KY',name:'Kentucky'},{abbr:'LA',name:'Louisiana'},{abbr:'ME',name:'Maine'},{abbr:'MD',name:'Maryland'},
  {abbr:'MA',name:'Massachusetts'},{abbr:'MI',name:'Michigan'},{abbr:'MN',name:'Minnesota'},{abbr:'MS',name:'Mississippi'},
  {abbr:'MO',name:'Missouri'},{abbr:'MT',name:'Montana'},{abbr:'NE',name:'Nebraska'},{abbr:'NV',name:'Nevada'},
  {abbr:'NH',name:'New Hampshire'},{abbr:'NJ',name:'New Jersey'},{abbr:'NM',name:'New Mexico'},{abbr:'NY',name:'New York'},
  {abbr:'NC',name:'North Carolina'},{abbr:'ND',name:'North Dakota'},{abbr:'OH',name:'Ohio'},{abbr:'OK',name:'Oklahoma'},
  {abbr:'OR',name:'Oregon'},{abbr:'PA',name:'Pennsylvania'},{abbr:'RI',name:'Rhode Island'},{abbr:'SC',name:'South Carolina'},
  {abbr:'SD',name:'South Dakota'},{abbr:'TN',name:'Tennessee'},{abbr:'TX',name:'Texas'},{abbr:'UT',name:'Utah'},
  {abbr:'VT',name:'Vermont'},{abbr:'VA',name:'Virginia'},{abbr:'WA',name:'Washington'},{abbr:'WV',name:'West Virginia'},
  {abbr:'WI',name:'Wisconsin'},{abbr:'WY',name:'Wyoming'},
];

export default function ExplorerLanding() {
  const [month, setMonth] = useState(3);
  const [day, setDay] = useState(4);
  const [year, setYear] = useState(2026);
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [brainCount, setBrainCount] = useState<number | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const followUpRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, loading, streaming, sendMessage, clearMessages } = useChat({
    species: 'all',
    stateAbbr: stateFilter,
    onMapAction: () => {},
  });

  const { discovery } = useDailyDiscovery();

  useEffect(() => {
    if (!SUPABASE_URL) return;
    fetch(`${SUPABASE_URL}/functions/v1/hunt-suggested-prompts`, { headers: { apikey: SUPABASE_KEY } })
      .then(r => r.json())
      .then(data => { if (data.stats?.total_entries) setBrainCount(data.stats.total_entries); })
      .catch(() => {});
  }, []);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0 && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streaming]);

  // Embed completed responses back into brain
  const embeddedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.content && msg.content.length > 50 && !embeddedRef.current.has(msg.id)) {
        if (loading || streaming) continue;
        embeddedRef.current.add(msg.id);
        const msgIndex = messages.indexOf(msg);
        const userMsg = msgIndex > 0 ? messages[msgIndex - 1] : null;
        const queryText = userMsg?.role === 'user' ? userMsg.content : 'unknown query';
        fetch(`${SUPABASE_URL}/functions/v1/hunt-embed-interaction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
          body: JSON.stringify({
            content: `User asked: "${queryText}" — Brain responded with ${msg.content.length} chars of cross-domain analysis.`,
            content_type: 'query-signal',
            title: `Query: ${queryText.slice(0, 80)}`,
            metadata: { query: queryText, response_length: msg.content.length, state: stateFilter, timestamp: new Date().toISOString() },
          }),
        }).catch(() => {});
      }
    }
  }, [messages, loading, streaming, stateFilter]);

  const handleDateQuery = useCallback(() => {
    if (loading || streaming) return;
    const dateStr = `${MONTHS[month]} ${day}, ${year}`;
    const stateStr = stateFilter ? ` in ${STATES.find(s => s.abbr === stateFilter)?.name || stateFilter}` : '';
    const msg = question.trim()
      ? `On ${dateStr}${stateStr}: ${question.trim()}`
      : `What was happening on ${dateStr}${stateStr}? Cross-reference every domain you have — weather, climate indices, storms, migration, tides, earthquakes, moon phase, everything. Show me the full picture of that date.`;
    setHasSearched(true);
    sendMessage(msg);
  }, [month, day, year, stateFilter, question, loading, streaming, sendMessage]);

  const handleFreeformSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || loading || streaming) return;
    setHasSearched(true);
    sendMessage(question.trim());
    setQuestion('');
  }, [question, loading, streaming, sendMessage]);

  const handleFollowUp = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!followUp.trim() || loading || streaming) return;
    sendMessage(followUp.trim());
    setFollowUp('');
  }, [followUp, loading, streaming, sendMessage]);

  const handleNewQuery = useCallback(() => {
    clearMessages();
    setHasSearched(false);
    setQuestion('');
    setFollowUp('');
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
              <span className="text-[9px] font-mono text-white/30">{brainCount.toLocaleString()}</span>
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

          {/* Search area */}
          <div className={`text-center transition-all duration-300 ${hasSearched ? 'pt-4 pb-3' : 'pt-8 sm:pt-14 pb-4'}`}>

            {!hasSearched && (
              <>
                <h1 className="font-display text-2xl sm:text-4xl text-white/90 mb-2 leading-tight">
                  Ask the brain anything.
                </h1>
                <p className="text-sm text-white/30 mb-4 font-body max-w-lg mx-auto">
                  Cross-reference {brainCount ? brainCount.toLocaleString() + '+' : 'millions of'} environmental records across 83 domains. Questions Google can't answer.
                </p>

                {/* Daily Discovery */}
                {discovery && (
                  <div className="max-w-2xl mx-auto mb-6">
                    <div className="rounded-xl bg-gradient-to-r from-cyan-400/[0.04] to-purple-400/[0.04] border border-cyan-400/10 px-4 sm:px-5 py-3.5">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap size={13} className="text-cyan-400" />
                        <span className="text-[9px] font-mono text-cyan-400/70 tracking-wider">TODAY'S DISCOVERY</span>
                      </div>
                      <p className="text-sm font-bold text-white/80 mb-1">{discovery.headline}</p>
                      <p className="text-xs text-white/50 leading-relaxed">{discovery.discovery}</p>
                      {discovery.dejaVu && (
                        <p className="text-[10px] text-purple-400/60 mt-2 font-mono">
                          Environmental déjà vu: Today most closely resembles {discovery.dejaVu.date} ({Math.round(discovery.dejaVu.similarity * 100)}% match)
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Primary: Question input — BIG */}
            <div className="max-w-2xl mx-auto mb-4">
              <form onSubmit={handleFreeformSubmit}>
                <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl bg-[#0d1117] border border-white/10 focus-within:border-cyan-400/30 transition-colors">
                  <Search size={18} className="text-white/20 shrink-0" />
                  <input
                    value={question}
                    onChange={e => setQuestion(e.target.value)}
                    placeholder="Ask anything..."
                    className="flex-1 bg-transparent text-base font-body text-white/90 placeholder:text-white/25 outline-none"
                  />
                  {question.trim() && (
                    <button
                      type="submit"
                      disabled={loading || streaming}
                      className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 transition-colors"
                    >
                      <span className="font-body text-xs font-semibold text-white">Ask</span>
                    </button>
                  )}
                </div>
              </form>
            </div>

            {/* Example queries — things Google can't answer */}
            {!hasSearched && (
              <div className="max-w-2xl mx-auto mb-6">
                <div className="flex flex-wrap justify-center gap-2">
                  {[
                    'Every time AO dropped below -2 during La Nina, what storms followed?',
                    'What was happening across all domains on February 10, 2021?',
                    'When has drought in Texas coincided with negative NAO?',
                    'Show me the weirdest environmental day in the last 10 years',
                  ].map(q => (
                    <button
                      key={q}
                      onClick={() => { setHasSearched(true); sendMessage(q); }}
                      disabled={loading || streaming}
                      className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/10 transition-colors text-[11px] font-body text-white/40 hover:text-white/60 text-left"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Secondary: Date picker row */}
            <div className={`flex items-center justify-center gap-2 sm:gap-3 ${hasSearched ? 'mb-2' : 'mb-3'}`}>
              <Spinner label="MONTH" value={MONTHS[month]} onUp={() => spinMonth(1)} onDown={() => spinMonth(-1)} wide />
              <Spinner label="DAY" value={String(day)} onUp={() => spinDay(1)} onDown={() => spinDay(-1)} />
              <Spinner label="YEAR" value={String(year)} onUp={() => spinYear(1)} onDown={() => spinYear(-1)} onEdit={(v) => {
                const n = parseInt(v, 10);
                if (!isNaN(n) && n >= 1950 && n <= 2026) setYear(n);
              }} />
              <div className="flex flex-col items-center">
                <div className="h-[28px]" />
                <select
                  value={stateFilter || ''}
                  onChange={e => setStateFilter(e.target.value || null)}
                  className="h-12 px-2 bg-[#0d1117] border border-white/[0.08] rounded-lg text-sm font-bold text-white appearance-none cursor-pointer outline-none w-20 sm:w-24 text-center"
                >
                  <option value="">US</option>
                  {STATES.map(s => <option key={s.abbr} value={s.abbr}>{s.abbr}</option>)}
                </select>
                <div className="h-[28px]" />
                <span className="text-[7px] font-mono text-white/15 tracking-widest mt-0.5">STATE</span>
              </div>
            </div>

            {/* Date query + Grade + New buttons */}
            <div className="flex items-center justify-center gap-2 flex-wrap">
              <button
                onClick={handleDateQuery}
                disabled={loading || streaming}
                className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
              >
                {(loading || streaming) ? (
                  <Loader2 size={14} className="text-cyan-400 animate-spin" />
                ) : (
                  <Calendar size={14} className="text-white/40" />
                )}
                <span className="font-body text-xs text-white/50">{dateStr}</span>
                {stateFilter && <span className="font-mono text-[10px] text-white/30">· {stateFilter}</span>}
              </button>

              <button
                onClick={() => {
                  if (loading || streaming) return;
                  const d = `${MONTHS[month]} ${day}, ${year}`;
                  const st = stateFilter ? ` in ${STATES.find(s => s.abbr === stateFilter)?.name || stateFilter}` : '';
                  setHasSearched(true);
                  sendMessage(`Grade ${d}${st} as an environmental day. Score it A+ through F based on how unusual or extreme the conditions were across all domains. Show a report card with each domain scored. Make it fun and shareable — like a personality quiz for a date. Include one surprising fact about this date that nobody would expect.`);
                }}
                disabled={loading || streaming}
                className="px-4 py-2 rounded-lg bg-purple-500/10 border border-purple-400/20 hover:bg-purple-500/20 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
              >
                <Sparkles size={14} className="text-purple-400/60" />
                <span className="font-body text-xs text-purple-300/60">Grade this date</span>
              </button>

              {hasSearched && (
                <button
                  onClick={handleNewQuery}
                  className="px-3 py-2 rounded-lg border border-white/[0.06] hover:bg-white/[0.04] transition-colors inline-flex items-center gap-1.5"
                >
                  <RotateCcw size={12} className="text-white/30" />
                  <span className="font-body text-xs text-white/30">New</span>
                </button>
              )}
            </div>
          </div>

          {/* Brain Responses — inline conversation */}
          <div ref={resultsRef}>
            <ErrorBoundary fallback={<p className="text-xs text-white/40 text-center py-8">Error loading response.</p>}>
              {messages.map((msg, i) => {
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
                  return (
                    <BrainResponse
                      key={msg.id}
                      message={msg}
                      isStreaming={streaming && i === messages.length - 1}
                    />
                  );
                }
                return null;
              })}

              {loading && !streaming && (
                <div className="flex items-center justify-center gap-2 py-8">
                  <Loader2 size={16} className="text-cyan-400/60 animate-spin" />
                  <span className="text-xs font-mono text-cyan-400/40">Brain is thinking...</span>
                </div>
              )}
            </ErrorBoundary>
          </div>

          {/* Follow-up input — appears after first response */}
          {hasSearched && !loading && !streaming && assistantMessages.length > 0 && (
            <form onSubmit={handleFollowUp} className="mt-4 mb-8">
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#0d1117] border border-white/10 focus-within:border-cyan-400/30 transition-colors">
                <input
                  ref={followUpRef}
                  value={followUp}
                  onChange={e => setFollowUp(e.target.value)}
                  placeholder="Ask a follow-up question..."
                  className="flex-1 bg-transparent text-sm font-body text-white/90 placeholder:text-white/25 outline-none"
                />
                <button
                  type="submit"
                  disabled={!followUp.trim()}
                  className="p-1.5 rounded hover:bg-white/[0.06] transition-colors disabled:opacity-20"
                >
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

/** Date spinner with click-to-edit on year */
function Spinner({ label, value, onUp, onDown, wide, onEdit }: {
  label: string; value: string; onUp: () => void; onDown: () => void; wide?: boolean; onEdit?: (value: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startHold = useCallback((fn: () => void) => {
    fn();
    timeoutRef.current = setTimeout(() => {
      intervalRef.current = setInterval(fn, 100);
    }, 400);
  }, []);

  const stopHold = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    timeoutRef.current = null;
    intervalRef.current = null;
  }, []);

  useEffect(() => () => stopHold(), [stopHold]);

  if (editing && onEdit) {
    return (
      <div className="flex flex-col items-center">
        <div className="h-[28px]" />
        <input
          autoFocus
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={() => { onEdit(editValue); setEditing(false); }}
          onKeyDown={e => { if (e.key === 'Enter') { onEdit(editValue); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
          className="w-20 sm:w-24 h-12 bg-[#0d1117] border border-cyan-400/30 rounded-lg text-base sm:text-lg font-bold text-white text-center outline-none"
        />
        <div className="h-[28px]" />
        <span className="text-[7px] font-mono text-white/15 tracking-widest mt-0.5">{label}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center">
      <button
        onMouseDown={() => startHold(onUp)}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
        onTouchStart={() => startHold(onUp)}
        onTouchEnd={stopHold}
        className="p-1.5 text-white/20 hover:text-white/50 transition-colors select-none"
      >
        <ChevronUp size={16} />
      </button>
      <div
        className={`${wide ? 'w-28 sm:w-32' : 'w-16 sm:w-20'} h-12 flex items-center justify-center bg-[#0d1117] border border-white/[0.08] rounded-lg ${onEdit ? 'cursor-pointer hover:border-white/20' : ''}`}
        onClick={() => { if (onEdit) { setEditValue(value); setEditing(true); } }}
      >
        <span className="text-base sm:text-lg font-bold text-white tracking-wide">{value}</span>
      </div>
      <button
        onMouseDown={() => startHold(onDown)}
        onMouseUp={stopHold}
        onMouseLeave={stopHold}
        onTouchStart={() => startHold(onDown)}
        onTouchEnd={stopHold}
        className="p-1.5 text-white/20 hover:text-white/50 transition-colors select-none"
      >
        <ChevronDown size={16} />
      </button>
      <span className="text-[7px] font-mono text-white/15 tracking-widest mt-0.5">{label}</span>
    </div>
  );
}

/** Renders a brain response with markdown formatting */
function BrainResponse({ message, isStreaming }: {
  message: { content: string; id: string };
  isStreaming: boolean;
}) {
  const content = message.content;
  if (!content) return null;

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
      <div className="flex items-center gap-2 mb-3">
        <Brain size={14} className={`${isStreaming ? 'text-cyan-400 animate-pulse' : 'text-cyan-400/50'}`} />
        <span className="text-[9px] font-mono text-white/30 tracking-wider">
          {isStreaming ? 'THINKING...' : 'BRAIN'}
        </span>
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
