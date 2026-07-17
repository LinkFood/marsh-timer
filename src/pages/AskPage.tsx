import { useState, useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, Send, Loader2, RotateCcw } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import { useUserLocation, US_STATES, getStateName } from '@/hooks/useUserLocation';
import BrainResponseCard from '@/components/BrainResponseCard';
import { InnerHeader, InnerFooter } from '@/components/InnerNav';
import UserMenu from '@/components/UserMenu';
import ErrorBoundary from '@/components/ErrorBoundary';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * /ask — the query door over the whole archive.
 *
 * The /explore chat pipeline reborn in the one nav idiom: one input over the
 * 9-intent dispatcher (Haiku routing → deterministic handlers → Sonnet
 * narration → typed cards → thumbs feedback embedded back into the brain).
 * Nothing here forecasts — the chat narrates rows the handlers fetched.
 * Suggestion chips are seeded from the visitor's state; the four canned
 * state-profile prompts live here now that /state is gone.
 */
export default function AskPage() {
  const [searchParams] = useSearchParams();
  const { state: locState, setUserState } = useUserLocation();
  // ?state=XX overrides geolocation (share links stay faithful)
  const [override, setOverride] = useState<string | null>(() => {
    const s = new URLSearchParams(window.location.search).get('state')?.toUpperCase();
    return s && US_STATES.some(st => st.abbr === s) ? s : null;
  });
  const state = override ?? locState;
  const stateName = getStateName(state);
  const [showStates, setShowStates] = useState(false);
  const [question, setQuestion] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const autoFiredRef = useRef(false);

  const { messages, loading, streaming, sendMessage, clearMessages } = useChat({
    species: 'all',
    stateAbbr: state,
    onMapAction: () => {},
  });

  useEffect(() => {
    document.title = 'Ask the archive — Duck Countdown';
    return () => { document.title = 'Duck Countdown | Environmental Intelligence Platform'; };
  }, []);

  const ask = useCallback((q: string) => {
    if (!q.trim() || loading || streaming) return;
    sendMessage(q.trim());
    setQuestion('');
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 150);
  }, [loading, streaming, sendMessage]);

  // Auto-fire deep-linked question (?q=...) — user intent, not a page-load call
  useEffect(() => {
    if (autoFiredRef.current) return;
    const q = searchParams.get('q');
    if (q && q.trim()) {
      autoFiredRef.current = true;
      sendMessage(q.trim());
    }
  }, [searchParams, sendMessage]);

  // Keep the answer in view while streaming
  useEffect(() => {
    if (streaming) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // Embed completed responses back into the brain (query-signal)
  const embeddedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_KEY || loading || streaming) return;
    for (const msg of messages) {
      if (msg.role !== 'assistant' || !msg.content || msg.content.length <= 50 || embeddedRef.current.has(msg.id)) continue;
      embeddedRef.current.add(msg.id);
      const userMsg = messages[messages.indexOf(msg) - 1];
      const queryText = userMsg?.role === 'user' ? userMsg.content : 'unknown query';
      fetch(`${SUPABASE_URL}/functions/v1/hunt-embed-interaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
        body: JSON.stringify({
          content: `User asked: "${queryText}" — Brain responded with ${msg.content.length} chars.`,
          content_type: 'query-signal',
          title: `Query: ${queryText.slice(0, 80)}`,
          metadata: { query: queryText, response_length: msg.content.length, state, timestamp: new Date().toISOString() },
        }),
      }).catch(() => {});
    }
  }, [messages, loading, streaming, state]);

  const now = new Date();

  // Suggestion chips: proven question shapes + the four canned state-profile
  // prompts (moved here from the killed /state page), state-substituted.
  const chips = [
    `What anomalies are happening in ${stateName} right now?`,
    `What's the drought history for ${stateName}?`,
    `Show me the worst storms in ${stateName} in the last 10 years`,
    `How does ${stateName} compare to this time last year?`,
    `What was happening in ${stateName} on ${MONTHS[now.getMonth()]} ${now.getDate()}, 2012?`,
    `When has drought in ${stateName} coincided with unusual bird activity?`,
  ];

  return (
    <div className="min-h-[100dvh] bg-gray-950 flex flex-col">
      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 pb-10">
          <InnerHeader
            title="ASK"
            subtitle="the query door over the whole archive"
            right={<UserMenu />}
          />

          {/* The invitation + the visitor's state */}
          <div className="mt-8 relative flex flex-wrap items-baseline gap-2">
            <h1 className="font-display text-2xl sm:text-3xl text-white/95 leading-tight">
              Ask the archive anything.
            </h1>
            <button
              onClick={() => setShowStates(!showStates)}
              className="flex items-center gap-1 px-2 py-1 rounded-full border border-white/10 bg-white/[0.03] hover:border-cyan-400/30 transition-colors"
            >
              <span className="text-[10px] font-mono text-cyan-400/80">{state}</span>
              <ChevronDown size={10} className={`text-white/30 transition-transform ${showStates ? 'rotate-180' : ''}`} />
            </button>
            {showStates && (
              <div className="absolute top-full left-0 mt-1 z-50 bg-gray-900 border border-white/10 rounded-lg shadow-xl max-h-64 overflow-y-auto w-56">
                {US_STATES.map(s => (
                  <button
                    key={s.abbr}
                    onClick={() => { setOverride(null); setUserState(s.abbr); setShowStates(false); }}
                    className={`w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-white/[0.06] transition-colors ${
                      s.abbr === state ? 'text-cyan-400 bg-cyan-400/[0.06]' : 'text-white/50'
                    }`}
                  >
                    <span className="font-bold mr-2">{s.abbr}</span>
                    <span className="text-white/30">{s.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="mt-2 font-mono text-[10px] text-gray-600">
            7.6M+ readings · 25+ domains · it narrates the record — never a forecast
          </p>

          {/* The input */}
          <form onSubmit={e => { e.preventDefault(); ask(question); }} className="mt-5 mb-3">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-900 border border-white/10 focus-within:border-cyan-400/30 transition-colors">
              <input
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder={messages.length > 0 ? 'Ask a follow-up...' : 'Ask the archive anything...'}
                className="flex-1 min-w-0 bg-transparent text-sm font-body text-white/90 placeholder:text-white/25 outline-none"
              />
              <button type="submit" disabled={!question.trim() || loading || streaming} className="p-1.5 rounded hover:bg-white/[0.06] transition-colors disabled:opacity-20">
                {loading && !streaming ? <Loader2 size={14} className="text-cyan-400 animate-spin" /> : <Send size={14} className="text-cyan-400" />}
              </button>
            </div>
          </form>

          {/* Suggestion chips — only before the first question */}
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {chips.map(q => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  disabled={loading || streaming}
                  className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/10 transition-colors text-[11px] font-body text-white/40 hover:text-white/60 text-left"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* The conversation */}
          <ErrorBoundary fallback={<p className="text-xs text-white/40 text-center py-8">Error loading response.</p>}>
            {messages.map((msg, i) => {
              if (msg.role === 'user') {
                return (
                  <div key={msg.id} className="mt-4 mb-3 text-right">
                    <span className="inline-block text-xs font-body text-white/70 bg-cyan-400/[0.08] rounded-lg px-3 py-2 max-w-[85%] text-left">
                      {msg.content}
                    </span>
                  </div>
                );
              }
              if (msg.role === 'assistant' && msg.content) {
                return (
                  <BrainResponseCard
                    key={msg.id}
                    message={msg}
                    isStreaming={streaming && i === messages.length - 1}
                    onFollowUp={q => ask(q)}
                  />
                );
              }
              return null;
            })}
            {loading && !streaming && (
              <p className="text-xs font-mono text-cyan-400/40 text-center py-6 animate-pulse">
                Searching the archive...
              </p>
            )}
          </ErrorBoundary>

          {messages.length > 0 && !loading && !streaming && (
            <button
              onClick={clearMessages}
              className="mt-3 px-3 py-1.5 rounded-lg border border-white/[0.06] hover:bg-white/[0.04] transition-colors inline-flex items-center gap-1.5"
            >
              <RotateCcw size={11} className="text-white/30" />
              <span className="font-body text-[11px] text-white/30">New question</span>
            </button>
          )}
          <div ref={bottomRef} />

          <InnerFooter current="ask" />
        </div>
      </main>

      <div className="grain-overlay" />
    </div>
  );
}
