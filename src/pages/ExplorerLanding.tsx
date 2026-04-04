import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Settings, MessageSquare, X, ChevronLeft, ChevronRight, Search, Calendar, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { CONTENT_TYPE_GROUPS, typeColor } from '@/data/contentTypeGroups';
import { useChat } from '@/hooks/useChat';
import UserMenu from '@/components/UserMenu';
import ErrorBoundary from '@/components/ErrorBoundary';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_IN_MONTH = [31,29,31,30,31,30,31,31,30,31,30,31];

interface TimeMachineResult {
  domain: string;
  domainColor: string;
  entries: Array<{
    title: string;
    content: string;
    content_type: string;
    state_abbr: string | null;
    effective_date: string | null;
  }>;
}

export default function ExplorerLanding() {
  // Date picker state
  const [month, setMonth] = useState(3); // April (0-indexed)
  const [day, setDay] = useState(4);
  const [year, setYear] = useState(2026);
  const [question, setQuestion] = useState('');

  // Results
  const [results, setResults] = useState<TimeMachineResult[] | null>(null);
  const [totalEntries, setTotalEntries] = useState(0);
  const [loading, setLoading] = useState(false);
  const [brainCount, setBrainCount] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

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

  // Query the brain for a specific date
  const handleTimeMachine = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    setResults(null);

    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // Query ±3 days to catch nearby data
    const from = new Date(year, month, day - 3);
    const to = new Date(year, month, day + 3);
    const fromStr = from.toISOString().split('T')[0];
    const toStr = to.toISOString().split('T')[0];

    try {
      const { data, error } = await supabase
        .from('hunt_knowledge')
        .select('title,content,content_type,state_abbr,effective_date')
        .gte('effective_date', fromStr)
        .lte('effective_date', toStr)
        .order('content_type')
        .limit(500);

      if (error || !data) {
        setResults([]);
        setTotalEntries(0);
        setLoading(false);
        return;
      }

      // Group by domain
      const grouped = new Map<string, TimeMachineResult>();
      for (const entry of data) {
        const ct = entry.content_type || 'unknown';
        const group = CONTENT_TYPE_GROUPS.find(g => g.types.includes(ct));
        const domainKey = group?.key || 'other';
        const domainLabel = group?.label || 'Other';
        const domainColor = group?.color || 'text-white/50 bg-white/[0.06]';

        if (!grouped.has(domainKey)) {
          grouped.set(domainKey, { domain: domainLabel, domainColor, entries: [] });
        }
        grouped.get(domainKey)!.entries.push({
          title: entry.title || '',
          content: entry.content || '',
          content_type: ct,
          state_abbr: entry.state_abbr || null,
          effective_date: entry.effective_date || null,
        });
      }

      // Sort by entry count descending
      const sorted = [...grouped.values()].sort((a, b) => b.entries.length - a.entries.length);
      setResults(sorted);
      setTotalEntries(data.length);

      // Embed this query back into the brain (fire and forget)
      if (SUPABASE_URL && SUPABASE_KEY) {
        const queryContent = `time-machine query | ${dateStr} | ${question || 'browsing'} | domains: ${sorted.map(s => s.domain).join(', ')} | results: ${data.length}`;
        fetch(`${SUPABASE_URL}/functions/v1/hunt-embed-interaction`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${SUPABASE_KEY}`,
            apikey: SUPABASE_KEY,
          },
          body: JSON.stringify({
            content: queryContent,
            content_type: 'query-signal',
            title: `Time Machine: ${dateStr}`,
            metadata: { date: dateStr, question, result_count: data.length },
          }),
        }).catch(() => {}); // fire and forget
      }
    } catch {
      setResults([]);
      setTotalEntries(0);
    } finally {
      setLoading(false);
    }
  }, [month, day, year, question]);

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

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#0a0f1a] flex flex-col">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between px-4 h-12 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="text-sm font-bold text-white tracking-wider">DUCK COUNTDOWN</span>
          </Link>
          <span className="text-[9px] font-mono text-cyan-400/60 tracking-widest hidden sm:inline">
            TIME MACHINE
          </span>
        </div>
        <div className="flex items-center gap-2">
          {brainCount && (
            <span className="text-[9px] font-mono text-white/30 hidden sm:inline">
              BRAIN: {brainCount.toLocaleString()}
            </span>
          )}
          <Link to="/dashboard" className="p-1.5 rounded hover:bg-white/[0.06] transition-colors" title="Dashboard">
            <Settings size={14} className="text-white/40" />
          </Link>
          <button onClick={() => setChatOpen(true)} className="p-1.5 rounded hover:bg-white/[0.06] transition-colors" title="Ask Brain">
            <MessageSquare size={14} className="text-white/40" />
          </button>
          <UserMenu />
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 py-8">
          {/* Date Spinner */}
          <div className="text-center mb-8">
            <h1 className="font-display text-xl sm:text-2xl text-white/90 mb-6">
              Pick a date. See everything.
            </h1>

            <div className="flex items-center justify-center gap-1 sm:gap-3 mb-4">
              {/* Month spinner */}
              <div className="flex flex-col items-center">
                <button onClick={() => spinMonth(1)} className="p-1 text-white/30 hover:text-white/60"><ChevronLeft size={16} className="rotate-90" /></button>
                <div className="w-28 sm:w-36 h-14 flex items-center justify-center bg-[#0d1117] border border-white/10 rounded-lg">
                  <span className="text-lg sm:text-xl font-bold text-white">{MONTHS[month]}</span>
                </div>
                <button onClick={() => spinMonth(-1)} className="p-1 text-white/30 hover:text-white/60"><ChevronRight size={16} className="rotate-90" /></button>
                <span className="text-[8px] font-mono text-white/20 mt-1">MONTH</span>
              </div>

              {/* Day spinner */}
              <div className="flex flex-col items-center">
                <button onClick={() => spinDay(1)} className="p-1 text-white/30 hover:text-white/60"><ChevronLeft size={16} className="rotate-90" /></button>
                <div className="w-16 sm:w-20 h-14 flex items-center justify-center bg-[#0d1117] border border-white/10 rounded-lg">
                  <span className="text-lg sm:text-xl font-bold text-white">{day}</span>
                </div>
                <button onClick={() => spinDay(-1)} className="p-1 text-white/30 hover:text-white/60"><ChevronRight size={16} className="rotate-90" /></button>
                <span className="text-[8px] font-mono text-white/20 mt-1">DAY</span>
              </div>

              {/* Year spinner */}
              <div className="flex flex-col items-center">
                <button onClick={() => spinYear(1)} className="p-1 text-white/30 hover:text-white/60"><ChevronLeft size={16} className="rotate-90" /></button>
                <div className="w-20 sm:w-24 h-14 flex items-center justify-center bg-[#0d1117] border border-white/10 rounded-lg">
                  <span className="text-lg sm:text-xl font-bold text-white">{year}</span>
                </div>
                <button onClick={() => spinYear(-1)} className="p-1 text-white/30 hover:text-white/60"><ChevronRight size={16} className="rotate-90" /></button>
                <span className="text-[8px] font-mono text-white/20 mt-1">YEAR</span>
              </div>
            </div>

            {/* Optional question */}
            <div className="max-w-md mx-auto mb-4">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0d1117] border border-white/10">
                <Search size={14} className="text-white/30 shrink-0" />
                <input
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleTimeMachine()}
                  placeholder="Optional: what are you looking for?"
                  className="flex-1 bg-transparent text-sm font-body text-white/90 placeholder:text-white/30 outline-none"
                />
              </div>
            </div>

            {/* Go button */}
            <button
              onClick={handleTimeMachine}
              disabled={loading}
              className="px-8 py-3 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 transition-colors inline-flex items-center gap-2"
            >
              {loading ? (
                <Loader2 size={18} className="text-white animate-spin" />
              ) : (
                <Calendar size={18} className="text-white" />
              )}
              <span className="font-body text-sm font-bold text-white">
                {loading ? 'Searching...' : `What happened on ${dateStr}?`}
              </span>
            </button>

            {brainCount && (
              <p className="text-[10px] font-mono text-white/20 mt-3">
                {brainCount.toLocaleString()}+ records · 83 domains · 1950–present
              </p>
            )}
          </div>

          {/* Results */}
          <ErrorBoundary fallback={<p className="text-xs text-white/40 text-center">Error loading results.</p>}>
            {results && results.length > 0 && (
              <div>
                <div className="text-center mb-6">
                  <h2 className="text-lg font-bold text-white/90 mb-1">{dateStr}</h2>
                  <p className="text-xs font-mono text-white/40">
                    {totalEntries} entries across {results.length} domains
                  </p>
                </div>

                <div className="space-y-4">
                  {results.map(domain => (
                    <DomainSection key={domain.domain} domain={domain} />
                  ))}
                </div>
              </div>
            )}

            {results && results.length === 0 && (
              <div className="text-center py-12">
                <p className="text-sm text-white/40">No data found for {dateStr}.</p>
                <p className="text-xs text-white/20 mt-1">The brain has data from 1950–present, but coverage varies by domain.</p>
              </div>
            )}
          </ErrorBoundary>
        </div>
      </main>

      {/* Chat overlay */}
      {chatOpen && <ChatOverlay onClose={() => setChatOpen(false)} />}

      <div className="grain-overlay" />
    </div>
  );
}

function DomainSection({ domain }: { domain: TimeMachineResult }) {
  const [expanded, setExpanded] = useState(false);
  const preview = domain.entries.slice(0, 5);
  const rest = domain.entries.slice(5);

  return (
    <div className="bg-white/[0.02] border border-white/[0.06] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${domain.domainColor}`}>
            {domain.domain}
          </span>
          <span className="text-xs font-mono text-white/30">{domain.entries.length} entries</span>
        </div>
        <ChevronRight size={14} className={`text-white/30 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      <div className="px-4 pb-3 space-y-1.5">
        {preview.map((entry, i) => (
          <EntryRow key={i} entry={entry} />
        ))}
        {expanded && rest.map((entry, i) => (
          <EntryRow key={`rest-${i}`} entry={entry} />
        ))}
        {!expanded && rest.length > 0 && (
          <button
            onClick={() => setExpanded(true)}
            className="text-[10px] font-mono text-cyan-400/60 hover:text-cyan-400 transition-colors"
          >
            + {rest.length} more entries
          </button>
        )}
      </div>
    </div>
  );
}

function EntryRow({ entry }: { entry: TimeMachineResult['entries'][0] }) {
  const [showFull, setShowFull] = useState(false);
  const content = entry.content || '';
  const short = content.slice(0, 150);
  const isLong = content.length > 150;

  return (
    <div className="py-1 border-t border-white/[0.03] first:border-0">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${typeColor(entry.content_type)}`}>
          {entry.content_type}
        </span>
        {entry.state_abbr && (
          <span className="text-[9px] font-mono text-white/40">{entry.state_abbr}</span>
        )}
        {entry.effective_date && (
          <span className="text-[9px] font-mono text-white/20">{entry.effective_date}</span>
        )}
      </div>
      <p className="text-[10px] text-white/50 leading-relaxed">
        {showFull ? content : short}{isLong && !showFull && '...'}
        {isLong && (
          <button
            onClick={() => setShowFull(!showFull)}
            className="ml-1 text-cyan-400/50 hover:text-cyan-400"
          >
            {showFull ? 'less' : 'more'}
          </button>
        )}
      </p>
    </div>
  );
}

function ChatOverlay({ onClose }: { onClose: () => void }) {
  const { messages, loading: chatLoading, streaming, sendMessage } = useChat({
    species: 'all',
    stateAbbr: null,
    onMapAction: () => {},
  });
  const [input, setInput] = useState('');

  const handleSend = useCallback(() => {
    if (!input.trim()) return;
    sendMessage(input.trim());
    setInput('');
  }, [input, sendMessage]);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl h-[70vh] bg-[#0d1117] border border-white/10 rounded-xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <span className="text-xs font-bold text-white tracking-wider">ASK THE BRAIN</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/[0.06]">
            <X size={14} className="text-white/50" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-white/20 text-xs mt-8">
              <Brain size={24} className="mx-auto mb-2 text-white/10" />
              <p>Ask anything about any date, any pattern, any connection.</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`text-xs font-body leading-relaxed ${
              msg.role === 'user'
                ? 'text-white/80 bg-cyan-400/[0.08] rounded-lg px-3 py-2 ml-12'
                : 'text-white/60 bg-white/[0.02] rounded-lg px-3 py-2 mr-12'
            }`}>
              {msg.content}
            </div>
          ))}
          {(chatLoading || streaming) && (
            <div className="text-xs text-cyan-400/40 animate-pulse">Thinking...</div>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-white/[0.06]">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder="Ask the brain..."
            className="flex-1 bg-transparent text-xs font-body text-white/80 placeholder:text-white/20 outline-none"
            autoFocus
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || chatLoading}
            className="px-3 py-1.5 bg-cyan-400/10 text-cyan-400 text-[10px] font-mono rounded hover:bg-cyan-400/20 transition-colors disabled:opacity-30"
          >
            SEND
          </button>
        </div>
      </div>
    </div>
  );
}
