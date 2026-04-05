import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Brain, Settings, Loader2, Send, ChevronLeft, MapPin, Zap } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import BrainResponseCard from '@/components/BrainResponseCard';
import UserMenu from '@/components/UserMenu';
import ErrorBoundary from '@/components/ErrorBoundary';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const STATE_NAMES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',
  MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',
  NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',
  ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',
  RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',
  TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',
  WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
};

export default function StatePage() {
  const { stateAbbr } = useParams<{ stateAbbr: string }>();
  const abbr = stateAbbr?.toUpperCase() || '';
  const stateName = STATE_NAMES[abbr] || abbr;
  const [followUp, setFollowUp] = useState('');
  const [brainCount, setBrainCount] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoFiredRef = useRef(false);

  const { messages, loading, streaming, sendMessage } = useChat({
    species: 'all',
    stateAbbr: abbr || null,
    onMapAction: () => {},
  });

  useEffect(() => {
    if (!SUPABASE_URL) return;
    fetch(`${SUPABASE_URL}/functions/v1/hunt-suggested-prompts`, { headers: { apikey: SUPABASE_KEY } })
      .then(r => r.json())
      .then(data => { if (data.stats?.total_entries) setBrainCount(data.stats.total_entries); })
      .catch(() => {});
  }, []);

  // Auto-fire state profile query
  useEffect(() => {
    if (autoFiredRef.current || !abbr) return;
    autoFiredRef.current = true;
    sendMessage(`Give me a complete environmental profile for ${stateName} (${abbr}). Include: current conditions right now (convergence score, any active anomalies), recent activity (last 7 days), historical context (notable events, climate patterns), what domains the brain has data for in this state, and what makes this state environmentally interesting or unusual right now. Be comprehensive.`);
  }, [abbr, stateName, sendMessage]);

  useEffect(() => {
    document.title = `${stateName} — Environmental Profile | Duck Countdown`;
    return () => { document.title = 'Duck Countdown | Environmental Intelligence Platform'; };
  }, [stateName]);

  useEffect(() => {
    if (messages.length > 0 && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streaming]);

  // Embed responses
  const embeddedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return;
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.content && msg.content.length > 50 && !embeddedRef.current.has(msg.id)) {
        if (loading || streaming) continue;
        embeddedRef.current.add(msg.id);
        fetch(`${SUPABASE_URL}/functions/v1/hunt-embed-interaction`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
          body: JSON.stringify({
            content: `State profile query for ${abbr} — Brain responded with ${msg.content.length} chars.`,
            content_type: 'query-signal',
            title: `State Profile: ${abbr}`,
            state_abbr: abbr,
            metadata: { state: abbr, page: 'state-profile', response_length: msg.content.length, timestamp: new Date().toISOString() },
          }),
        }).catch(() => {});
      }
    }
  }, [messages, loading, streaming, abbr]);

  const handleFollowUp = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!followUp.trim() || loading || streaming) return;
    sendMessage(followUp.trim());
    setFollowUp('');
  }, [followUp, loading, streaming, sendMessage]);

  const assistantMessages = messages.filter(m => m.role === 'assistant' && m.content);

  // Quick action buttons for this state
  const quickActions = [
    `What anomalies are happening in ${abbr} right now?`,
    `What's the drought history for ${stateName}?`,
    `Show me the worst storms in ${stateName} in the last 10 years`,
    `How does ${abbr} compare to this time last year?`,
  ];

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#0a0f1a] flex flex-col">
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
          <Link to="/dashboard" className="p-1.5 rounded hover:bg-white/[0.06] transition-colors">
            <Settings size={14} className="text-white/40" />
          </Link>
          <UserMenu />
        </div>
      </header>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-6">
          {/* State header */}
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-2 mb-2">
              <MapPin size={18} className="text-cyan-400/50" />
              <h1 className="font-display text-xl sm:text-2xl text-white/90">{stateName}</h1>
              <span className="text-sm font-mono text-cyan-400/40">{abbr}</span>
            </div>
            <p className="text-xs text-white/30 font-body">Environmental Intelligence Profile</p>

            {/* Quick actions */}
            <div className="flex flex-wrap justify-center gap-1.5 mt-4">
              {quickActions.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  disabled={loading || streaming}
                  className="text-[10px] font-body text-white/30 hover:text-cyan-400/60 bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.05] rounded-lg px-2.5 py-1.5 transition-colors"
                >
                  {q.replace(stateName, abbr).replace(abbr + ' ', '').slice(0, 45)}...
                </button>
              ))}
            </div>
          </div>

          {/* Brain Responses */}
          <ErrorBoundary fallback={<p className="text-xs text-white/40 text-center py-8">Error.</p>}>
            {messages.map((msg, i) => {
              if (msg.role === 'user' && i === 0) return null;
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="mb-3 text-right">
                    <span className="inline-block text-xs font-body text-white/70 bg-cyan-400/[0.08] rounded-lg px-3 py-2 max-w-[85%] text-left">{msg.content}</span>
                  </div>
                );
              }
              if (msg.role === 'assistant' && msg.content) {
                return <BrainResponseCard key={msg.id} message={msg} isStreaming={streaming && i === messages.length - 1} onFollowUp={sendMessage} />;
              }
              return null;
            })}

            {loading && !streaming && (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 size={16} className="text-cyan-400/60 animate-spin" />
                <span className="text-xs font-mono text-cyan-400/40">Loading {stateName} profile...</span>
              </div>
            )}
          </ErrorBoundary>

          {/* Follow-up */}
          {!loading && !streaming && assistantMessages.length > 0 && (
            <form onSubmit={handleFollowUp} className="mt-4 mb-8">
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[#0d1117] border border-white/10 focus-within:border-cyan-400/30 transition-colors">
                <input
                  value={followUp}
                  onChange={e => setFollowUp(e.target.value)}
                  placeholder={`Ask about ${stateName}...`}
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
