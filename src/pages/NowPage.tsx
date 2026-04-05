import { useState, useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Brain, Settings, Loader2, Send, ChevronLeft, Zap } from 'lucide-react';
import BrainResponseCard from '@/components/BrainResponseCard';
import { useChat } from '@/hooks/useChat';
import { useCoincidenceSnapshot } from '@/hooks/useCoincidenceSnapshot';
import { useDailyDiscovery } from '@/hooks/useDailyDiscovery';
import UserMenu from '@/components/UserMenu';
import ErrorBoundary from '@/components/ErrorBoundary';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export default function NowPage() {
  const [followUp, setFollowUp] = useState('');
  const [brainCount, setBrainCount] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoFiredRef = useRef(false);

  const { messages, loading, streaming, sendMessage } = useChat({
    species: 'all',
    stateAbbr: null,
    onMapAction: () => {},
  });

  const { data: coincidence } = useCoincidenceSnapshot();
  const { discovery } = useDailyDiscovery();

  useEffect(() => {
    if (!SUPABASE_URL) return;
    fetch(`${SUPABASE_URL}/functions/v1/hunt-suggested-prompts`, { headers: { apikey: SUPABASE_KEY } })
      .then(r => r.json())
      .then(data => { if (data.stats?.total_entries) setBrainCount(data.stats.total_entries); })
      .catch(() => {});
  }, []);

  // Auto-fire "what's weird right now" on mount
  useEffect(() => {
    if (autoFiredRef.current) return;
    autoFiredRef.current = true;
    sendMessage("What's the most unusual thing happening across all 50 states right now? Show me the top 3-5 anomalies — the things that are most statistically unusual compared to historical baselines. For each one, tell me what state, what domain, and why it's weird. Lead with the most striking finding.");
  }, [sendMessage]);

  useEffect(() => {
    document.title = 'What\'s Weird Right Now | Duck Countdown';
    return () => { document.title = 'Duck Countdown | Environmental Intelligence Platform'; };
  }, []);

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
            content: `"What's weird right now" query — Brain found ${msg.content.length} chars of anomalies.`,
            content_type: 'query-signal',
            title: 'Now Page Query',
            metadata: { page: 'now', response_length: msg.content.length, timestamp: new Date().toISOString() },
          }),
        }).catch(() => {});
      }
    }
  }, [messages, loading, streaming]);

  const handleFollowUp = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!followUp.trim() || loading || streaming) return;
    sendMessage(followUp.trim());
    setFollowUp('');
  }, [followUp, loading, streaming, sendMessage]);

  const assistantMessages = messages.filter(m => m.role === 'assistant' && m.content);

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
          {/* Header */}
          <div className="text-center mb-6">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Zap size={18} className="text-cyan-400" />
              <h1 className="font-display text-xl sm:text-2xl text-white/90">What's Weird Right Now</h1>
            </div>
            <p className="text-xs text-white/30 font-body mb-3">
              Real-time anomalies across all 50 states — things the brain thinks are unusual compared to historical baselines.
            </p>

            {/* Live stats */}
            {coincidence && coincidence.activeArcs > 0 && (
              <div className="mb-4">
                <p className="text-xs font-body text-white/40">
                  Tracking <span className="text-cyan-400/70 font-semibold">{coincidence.activeArcs} patterns</span> across{' '}
                  <span className="text-cyan-400/70 font-semibold">{coincidence.activeStates} states</span>
                </p>
                {coincidence.hotStates.length > 0 && (
                  <div className="flex items-center justify-center gap-1.5 mt-2">
                    {coincidence.hotStates.map(s => (
                      <button
                        key={s.abbr}
                        onClick={() => sendMessage(`What's unusual in ${s.abbr} right now?`)}
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-cyan-400/[0.06] text-cyan-400/50 hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors"
                      >
                        {s.abbr} {s.score}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Today's discovery */}
            {discovery && (
              <div className="max-w-xl mx-auto mb-4 rounded-lg bg-gradient-to-r from-cyan-400/[0.03] to-purple-400/[0.03] border border-cyan-400/10 px-3 py-2.5 text-left">
                <p className="text-[9px] font-mono text-cyan-400/50 mb-1">TODAY'S DISCOVERY</p>
                <p className="text-xs text-white/60">{discovery.headline}</p>
              </div>
            )}
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
                <span className="text-xs font-mono text-cyan-400/40">Scanning all 50 states...</span>
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
                  placeholder="Dig deeper into any anomaly..."
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

