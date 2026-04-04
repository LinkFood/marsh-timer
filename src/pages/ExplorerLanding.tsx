import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Brain, Settings, MessageSquare, X } from 'lucide-react';
import SearchHero from '@/components/search/SearchHero';
import ResultsView from '@/components/search/ResultsView';
import { useFusionSearch } from '@/hooks/useFusionSearch';
import { useChat } from '@/hooks/useChat';
import UserMenu from '@/components/UserMenu';
import ErrorBoundary from '@/components/ErrorBoundary';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export default function ExplorerLanding() {
  const { stateAbbr: routeState } = useParams<{ stateAbbr?: string }>();
  const navigate = useNavigate();
  const { search, results, loading, clear } = useFusionSearch();
  const [chatOpen, setChatOpen] = useState(false);
  const [brainCount, setBrainCount] = useState<number | null>(null);

  // Fetch brain count on mount
  useEffect(() => {
    if (!SUPABASE_URL) return;
    fetch(`${SUPABASE_URL}/functions/v1/hunt-suggested-prompts`, {
      headers: { apikey: SUPABASE_KEY },
    })
      .then(r => r.json())
      .then(data => {
        if (data.stats?.total_entries) setBrainCount(data.stats.total_entries);
      })
      .catch(() => {});
  }, []);

  const handleSearch = useCallback((params: {
    query?: string;
    contentTypeGroup: string | null;
    stateAbbr: string | null;
    dateFrom: string | null;
    dateTo: string | null;
  }) => {
    search({
      query: params.query,
      contentTypeGroup: params.contentTypeGroup,
      stateAbbr: params.stateAbbr,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
    });
  }, [search]);

  const handleStateClick = useCallback((abbr: string) => {
    navigate(`/${abbr}`, { replace: true });
  }, [navigate]);

  const handleChatOpen = useCallback(() => {
    setChatOpen(true);
  }, []);

  return (
    <div className="h-[100dvh] w-screen overflow-hidden bg-[#0a0f1a] flex flex-col">
      {/* Minimal header */}
      <header className="shrink-0 flex items-center justify-between px-4 h-12 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <Link to="/" onClick={() => clear()} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <span className="text-sm font-bold text-white tracking-wider">DUCK COUNTDOWN</span>
          </Link>
          <span className="text-[9px] font-mono text-cyan-400/60 tracking-widest hidden sm:inline">
            ENVIRONMENTAL INTELLIGENCE
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
          <Link to="/ops" className="p-1.5 rounded hover:bg-white/[0.06] transition-colors" title="Operations">
            <Brain size={14} className="text-white/40" />
          </Link>
          <button
            onClick={handleChatOpen}
            className="p-1.5 rounded hover:bg-white/[0.06] transition-colors"
            title="Ask Brain"
          >
            <MessageSquare size={14} className="text-white/40" />
          </button>
          <UserMenu />
        </div>
      </header>

      {/* Main content — scrollable */}
      <main className="flex-1 overflow-y-auto">
        <ErrorBoundary fallback={
          <div className="flex items-center justify-center h-64">
            <p className="text-xs font-body text-white/40">Something went wrong. Refresh to try again.</p>
          </div>
        }>
          {/* Search hero */}
          <SearchHero
            onSearch={handleSearch}
            onChatOpen={handleChatOpen}
            loading={loading}
            brainCount={brainCount}
            initialState={routeState || null}
          />

          {/* Results */}
          {results && (
            <div className="max-w-6xl mx-auto px-4 pb-12">
              <ResultsView
                primary={results.primary}
                fusion={results.fusion}
                stats={results.stats}
                loading={loading}
                onStateClick={handleStateClick}
              />
            </div>
          )}

          {/* Empty state — when no search yet */}
          {!results && !loading && (
            <div className="max-w-3xl mx-auto px-4 pt-8">
              <div className="text-center text-white/20 text-xs font-body">
                <p className="mb-2">76 years of climate data · 35 years of storm events · 25+ live data feeds</p>
                <p>Pick your filters and explore cross-domain patterns nobody else can see.</p>
              </div>
            </div>
          )}
        </ErrorBoundary>
      </main>

      {/* Chat overlay */}
      {chatOpen && (
        <ChatOverlay onClose={() => setChatOpen(false)} />
      )}

      {/* Grain overlay */}
      <div className="grain-overlay" />
    </div>
  );
}

/** Minimal chat overlay — reuses existing useChat hook */
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
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
          <span className="text-xs font-bold text-white tracking-wider">ASK THE BRAIN</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-white/[0.06]">
            <X size={14} className="text-white/50" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="text-center text-white/20 text-xs mt-8">
              <Brain size={24} className="mx-auto mb-2 text-white/10" />
              <p>Ask anything about environmental patterns.</p>
              <p className="mt-1 text-white/10">"When was the last drought in Maryland?"</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`text-xs font-body leading-relaxed ${
                msg.role === 'user'
                  ? 'text-white/80 bg-cyan-400/[0.08] rounded-lg px-3 py-2 ml-12'
                  : 'text-white/60 bg-white/[0.02] rounded-lg px-3 py-2 mr-12'
              }`}
            >
              {msg.content}
            </div>
          ))}
          {(chatLoading || streaming) && (
            <div className="text-xs text-cyan-400/40 animate-pulse">Thinking...</div>
          )}
        </div>

        {/* Input */}
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
