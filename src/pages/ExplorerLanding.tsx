import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { Brain, Settings, ChevronUp, ChevronDown, Search, Calendar, Loader2, Sparkles, RotateCcw, MapPin, Send, Zap, ThumbsUp, ThumbsDown, Clock, X } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import { useDailyDiscovery } from '@/hooks/useDailyDiscovery';
import { useThisDayInHistory } from '@/hooks/useThisDayInHistory';
import { useChatHistory } from '@/hooks/useChatHistory';
import { useBrainPulse, getDomainColor } from '@/hooks/useBrainPulse';
import { useCoincidenceSnapshot } from '@/hooks/useCoincidenceSnapshot';
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
  const navigate = useNavigate();
  const [brainCount, setBrainCount] = useState<number | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [compareMode, setCompareMode] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const { sessions: historySessions } = useChatHistory();
  const pulseEntries = useBrainPulse();
  const [pulseIndex, setPulseIndex] = useState(0);

  // Cycle pulse every 4 seconds
  useEffect(() => {
    if (pulseEntries.length === 0) return;
    const interval = setInterval(() => {
      setPulseIndex(i => (i + 1) % pulseEntries.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [pulseEntries.length]);
  const [month2, setMonth2] = useState(1); // Feb
  const [day2, setDay2] = useState(10);
  const [year2, setYear2] = useState(2021);
  const [searchParams, setSearchParams] = useSearchParams();
  const resultsRef = useRef<HTMLDivElement>(null);
  const followUpRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoFiredRef = useRef(false);

  const { messages, loading, streaming, sendMessage, clearMessages } = useChat({
    species: 'all',
    stateAbbr: stateFilter,
    onMapAction: () => {},
  });

  const { discovery, loading: discoveryLoading } = useDailyDiscovery();

  // Auto-fire query from URL params (?q=...)
  useEffect(() => {
    if (autoFiredRef.current) return;
    const q = searchParams.get('q');
    if (q && q.trim()) {
      autoFiredRef.current = true;
      setHasSearched(true);
      sendMessage(q.trim());
    }
  }, [searchParams, sendMessage]);
  const { entries: historyEntries } = useThisDayInHistory();
  const { data: coincidence } = useCoincidenceSnapshot();

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
    const dateIso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // Navigate to permanent date page
    navigate(`/date/${dateIso}`);
  }, [month, day, year, navigate, loading, streaming]);

  const handleFreeformSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || loading || streaming) return;
    setHasSearched(true);
    setSearchParams({ q: question.trim() }, { replace: true });
    sendMessage(question.trim());
    setQuestion('');
  }, [question, loading, streaming, sendMessage, setSearchParams]);

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
    setSearchParams({}, { replace: true });
    autoFiredRef.current = false;
  }, [clearMessages, setSearchParams]);

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
  const spinMonth2 = (dir: number) => setMonth2(m => (m + dir + 12) % 12);
  const spinDay2 = (dir: number) => setDay2(d => { const max = DAYS_IN_MONTH[month2]; const next = d + dir; if (next < 1) return max; if (next > max) return 1; return next; });
  const spinYear2 = (dir: number) => setYear2(y => Math.max(1950, Math.min(2026, y + dir)));
  const dateStr2 = `${MONTHS[month2]} ${day2}, ${year2}`;

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
              <span className="text-[8px] font-mono text-emerald-400/40">LIVE</span>
            </div>
          )}
          {historySessions.length > 0 && (
            <button onClick={() => setShowHistory(!showHistory)} className="p-1.5 rounded hover:bg-white/[0.06] transition-colors" title="Query History">
              <Clock size={14} className={showHistory ? 'text-cyan-400' : 'text-white/40'} />
            </button>
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

          {/* Brain Pulse — live ingestion ticker */}
          {!hasSearched && pulseEntries.length > 0 && (() => {
            const entry = pulseEntries[pulseIndex];
            if (!entry) return null;
            const age = Date.now() - new Date(entry.created_at).getTime();
            const ageStr = age < 60000 ? 'just now' : age < 3600000 ? `${Math.floor(age / 60000)}m ago` : `${Math.floor(age / 3600000)}h ago`;
            return (
              <div className="flex items-center justify-center gap-2 py-2 transition-opacity duration-500">
                <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${getDomainColor(entry.content_type)}`} />
                <span className="text-[9px] font-mono text-white/30">
                  {entry.content_type}
                </span>
                {entry.state_abbr && <span className="text-[9px] font-mono text-white/20">{entry.state_abbr}</span>}
                <span className="text-[9px] font-mono text-white/15">{ageStr}</span>
              </div>
            );
          })()}

          {/* Search area */}
          <div className={`text-center transition-all duration-300 ${hasSearched ? 'pt-4 pb-3' : 'pt-4 sm:pt-8 pb-4'}`}>

            {!hasSearched && (
              <>
                <h1 className="font-display text-2xl sm:text-4xl text-white/90 mb-2 leading-tight">
                  Ask the brain anything.
                </h1>
                <p className="text-sm text-white/30 mb-4 font-body max-w-lg mx-auto">
                  Cross-reference {brainCount ? brainCount.toLocaleString() + '+' : 'millions of'} environmental records across 83 domains. Questions Google can't answer.
                </p>

                {/* Daily Discovery — skeleton while loading */}
                {discoveryLoading && (
                  <div className="max-w-2xl mx-auto mb-6">
                    <div className="rounded-xl bg-white/[0.02] border border-white/[0.05] px-4 sm:px-5 py-3.5 animate-pulse">
                      <div className="h-3 w-32 bg-white/[0.06] rounded mb-3" />
                      <div className="h-4 w-3/4 bg-white/[0.04] rounded mb-2" />
                      <div className="h-3 w-full bg-white/[0.03] rounded mb-1" />
                      <div className="h-3 w-5/6 bg-white/[0.03] rounded" />
                    </div>
                  </div>
                )}

                {/* Daily Discovery — clickable to dig deeper */}
                {!discoveryLoading && discovery && (
                  <div className="max-w-2xl mx-auto mb-6">
                    <button
                      onClick={() => {
                        setHasSearched(true);
                        sendMessage(`Tell me more about this: ${discovery.headline}. ${discovery.discovery} Dig deeper into the cross-domain connections. What caused this? Has this combination happened before? What might follow?`);
                      }}
                      disabled={loading || streaming}
                      className="w-full text-left rounded-xl bg-gradient-to-r from-cyan-400/[0.04] to-purple-400/[0.04] border border-cyan-400/10 hover:border-cyan-400/25 px-4 sm:px-5 py-3.5 transition-colors group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Zap size={13} className="text-cyan-400" />
                          <span className="text-[9px] font-mono text-cyan-400/70 tracking-wider">TODAY'S DISCOVERY</span>
                        </div>
                        <span className="text-[9px] font-mono text-white/20 group-hover:text-cyan-400/40 transition-colors">click to dig deeper →</span>
                      </div>
                      <p className="text-sm font-bold text-white/80 mb-1">{discovery.headline}</p>
                      <p className="text-xs text-white/50 leading-relaxed">{discovery.discovery}</p>
                      {discovery.dejaVu && (
                        <p className="text-[10px] text-purple-400/60 mt-2 font-mono">
                          Environmental déjà vu: Today most closely resembles {discovery.dejaVu.date} ({Math.round(discovery.dejaVu.similarity * 100)}% match)
                        </p>
                      )}
                    </button>
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

            {/* Coincidence Counter — the hook */}
            {!hasSearched && coincidence && coincidence.activeArcs > 0 && (
              <div className="max-w-2xl mx-auto mb-5 text-center">
                <p className="text-xs font-body text-white/40">
                  Right now, the brain is tracking{' '}
                  <span className="text-cyan-400/70 font-semibold">{coincidence.activeArcs} unusual patterns</span>
                  {' '}across{' '}
                  <span className="text-cyan-400/70 font-semibold">{coincidence.activeStates} states</span>.
                  {coincidence.pendingOutcomes > 0 && (
                    <span className="text-purple-400/50"> {coincidence.pendingOutcomes} investigations waiting for confirmation.</span>
                  )}
                </p>
                {coincidence.hotStates.length > 0 && (
                  <div className="flex items-center justify-center gap-1.5 mt-2">
                    <span className="text-[8px] font-mono text-white/15">HOTTEST:</span>
                    {coincidence.hotStates.map(s => (
                      <button
                        key={s.abbr}
                        onClick={() => {
                          setHasSearched(true);
                          sendMessage(`What's the brain tracking in ${s.abbr} right now? What patterns are unusual?`);
                        }}
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-400/[0.06] text-cyan-400/50 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors"
                      >
                        {s.abbr} {s.score}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Example queries — things Google can't answer */}
            {!hasSearched && (
              <div className="max-w-2xl mx-auto mb-6">
                <div className="flex flex-wrap justify-center gap-2">
                  {[
                    'Every time AO dropped below -2 during La Nina, what storms followed?',
                    'What was happening across all domains on February 10, 2021?',
                    'When has drought in Texas coincided with negative NAO?',
                    'What were the climate indices doing before Hurricane Sandy in 2012?',
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

            {/* This Day in History — compact timeline */}
            {!hasSearched && historyEntries.length > 0 && (
              <div className="max-w-2xl mx-auto mb-6">
                <p className="text-[9px] font-mono text-white/20 tracking-wider mb-2 text-center">
                  THIS DAY IN THE BRAIN
                </p>
                <div className="flex gap-2 overflow-x-auto pb-1 justify-center flex-wrap">
                  {historyEntries.map((entry, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setHasSearched(true);
                        sendMessage(`What was happening on ${MONTHS[new Date().getMonth()]} ${new Date().getDate()}, ${entry.year}? Cross-reference all domains.`);
                      }}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-white/[0.02] border border-white/[0.05] hover:border-white/10 hover:bg-white/[0.04] transition-colors text-left"
                    >
                      <span className="text-[10px] font-mono text-cyan-400/50">{entry.year}</span>
                      <span className="text-[9px] text-white/30 ml-1.5">{entry.state_abbr || ''}</span>
                      <p className="text-[9px] text-white/25 truncate max-w-[140px]">{entry.content_type}</p>
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
                  const dateIso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  navigate(`/date/${dateIso}?grade=true`);
                }}
                disabled={loading || streaming}
                className="px-4 py-2 rounded-lg bg-purple-500/10 border border-purple-400/20 hover:bg-purple-500/20 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
              >
                <Sparkles size={14} className="text-purple-400/60" />
                <span className="font-body text-xs text-purple-300/60">Grade</span>
              </button>

              <button
                onClick={() => setCompareMode(!compareMode)}
                className={`px-4 py-2 rounded-lg border transition-colors inline-flex items-center gap-2 ${
                  compareMode ? 'bg-orange-500/10 border-orange-400/20' : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
                }`}
              >
                <span className="font-body text-xs text-white/40">Compare</span>
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

          {/* Compare mode — second date picker */}
          {compareMode && (
            <div className="text-center mb-4">
              <p className="text-[9px] font-mono text-orange-400/40 tracking-wider mb-2">COMPARE WITH</p>
              <div className="flex items-center justify-center gap-2 sm:gap-3 mb-3">
                <Spinner label="" value={MONTHS[month2]} onUp={() => spinMonth2(1)} onDown={() => spinMonth2(-1)} wide />
                <Spinner label="" value={String(day2)} onUp={() => spinDay2(1)} onDown={() => spinDay2(-1)} />
                <Spinner label="" value={String(year2)} onUp={() => spinYear2(1)} onDown={() => spinYear2(-1)} onEdit={(v) => {
                  const n = parseInt(v, 10);
                  if (!isNaN(n) && n >= 1950 && n <= 2026) setYear2(n);
                }} />
              </div>
              <button
                onClick={() => {
                  if (loading || streaming) return;
                  const dateIso1 = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                  const dateIso2 = `${year2}-${String(month2 + 1).padStart(2, '0')}-${String(day2).padStart(2, '0')}`;
                  navigate(`/date/${dateIso1}?compare=${dateIso2}`);
                }}
                disabled={loading || streaming}
                className="px-5 py-2 rounded-lg bg-orange-500/20 border border-orange-400/20 hover:bg-orange-500/30 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
              >
                <span className="font-body text-xs font-semibold text-orange-300/70">Compare {dateStr} vs {dateStr2}</span>
              </button>
            </div>
          )}

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
                      onFollowUp={(q) => sendMessage(q)}
                    />
                  );
                }
                return null;
              })}

              {loading && !streaming && (
                <ThinkingIndicator />
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

      {/* History sidebar */}
      {showHistory && (
        <div className="fixed top-12 left-0 bottom-0 w-72 bg-[#0b1018] border-r border-white/[0.06] z-40 overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-2.5 border-b border-white/[0.06]">
            <span className="text-[9px] font-mono text-white/30 tracking-wider">QUERY HISTORY</span>
            <button onClick={() => setShowHistory(false)} className="p-1 rounded hover:bg-white/[0.06]">
              <X size={12} className="text-white/30" />
            </button>
          </div>
          {historySessions.map(session => {
            const age = Date.now() - new Date(session.lastMessageAt).getTime();
            const label = age < 3600000 ? 'just now' : age < 86400000 ? 'today' : age < 172800000 ? 'yesterday' : new Date(session.lastMessageAt).toLocaleDateString();
            return (
              <button
                key={session.sessionId}
                onClick={() => {
                  setHasSearched(true);
                  sendMessage(session.firstMessage);
                  setShowHistory(false);
                }}
                className="w-full text-left px-3 py-2.5 border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors"
              >
                <p className="text-[11px] text-white/60 font-body truncate">{session.firstMessage}</p>
                <p className="text-[9px] text-white/20 font-mono mt-0.5">{label} · {session.messageCount} msgs</p>
              </button>
            );
          })}
          {historySessions.length === 0 && (
            <p className="text-[10px] text-white/20 text-center py-8">No history yet</p>
          )}
        </div>
      )}

      <div className="grain-overlay" />
    </div>
  );
}

/** Thinking indicator with elapsed time and timeout messaging */
function ThinkingIndicator() {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center gap-2 py-8">
      <div className="flex items-center gap-2">
        <Loader2 size={16} className="text-cyan-400/60 animate-spin" />
        <span className="text-xs font-mono text-cyan-400/40">
          Brain is thinking...
          {elapsed > 5 && <span className="text-white/20 ml-2">{elapsed}s</span>}
        </span>
      </div>
      {elapsed > 15 && elapsed <= 45 && (
        <span className="text-[10px] text-white/20">Searching across 83 domains — complex queries take longer</span>
      )}
      {elapsed > 45 && elapsed <= 90 && (
        <span className="text-[10px] text-amber-400/40">Taking longer than usual — the brain is searching deep</span>
      )}
      {elapsed > 90 && (
        <span className="text-[10px] text-red-400/40">This query may have timed out. Try a more specific question.</span>
      )}
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
function BrainResponse({ message, isStreaming, onFollowUp }: {
  message: { content: string; id: string };
  isStreaming: boolean;
  onFollowUp?: (query: string) => void;
}) {
  const content = message.content;
  if (!content) return null;

  const [copied, setCopied] = useState(false);
  const handleShare = useCallback(() => {
    // Copy the current URL (which has ?q=... param)
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

  // Extract follow-up questions (lines starting with "**" that look like quoted questions)
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
      {followUps.length > 0 && onFollowUp && (
        <div className="mt-4 pt-3 border-t border-white/[0.04]">
          <p className="text-[9px] font-mono text-white/20 mb-2">DIG DEEPER</p>
          <div className="flex flex-wrap gap-1.5">
            {followUps.map((q, i) => (
              <button
                key={i}
                onClick={() => onFollowUp(q)}
                className="text-[10px] font-body text-cyan-400/50 hover:text-cyan-400 bg-cyan-400/[0.04] hover:bg-cyan-400/[0.08] border border-cyan-400/10 rounded-lg px-2.5 py-1.5 transition-colors text-left"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Feedback — the brain learns */}
      {!isStreaming && <ResponseFeedback messageId={message.id} content={content} />}
    </div>
  );
}

/** Feedback buttons — embeds user rating back into brain */
function ResponseFeedback({ messageId, content }: { messageId: string; content: string }) {
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [surprising, setSurprising] = useState(false);

  const submitFeedback = useCallback((r: 'up' | 'down') => {
    setRating(r);
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
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
      return <strong key={i} className="text-white/80 font-semibold">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
