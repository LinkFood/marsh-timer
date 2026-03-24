import { useState, useRef, useEffect, useCallback } from 'react';
import { Compass } from 'lucide-react';
import type { Species } from '@/data/types';
import { useChat } from '@/hooks/useChat';
import { useMapAction } from '@/contexts/MapActionContext';
import ChatInput from './ChatInput';
import ChatMessage from './ChatMessage';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return '<1m ago';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`;
  return `${Math.floor(ms / 86400000)}d ago`;
}

interface BrainChatProps {
  species: Species;
  stateAbbr: string | null;
  isMobile: boolean;
  onActionsReady?: (actions: {
    clearMessages: () => void;
    loadSession: (sessionId: string) => Promise<void>;
  }) => void;
}

export default function BrainChat({ species, stateAbbr, isMobile, onActionsReady }: BrainChatProps) {
  const { flyTo, setMapMode } = useMapAction();

  const handleMapAction = useCallback((action: { type: string; target: string }) => {
    if (action.type === 'flyTo') {
      flyTo(action.target);
    } else if (action.type === 'setMode') {
      setMapMode(action.target as any);
    }
  }, [flyTo, setMapMode]);

  const { messages, loading, streaming, sendMessage, clearMessages, loadSession } = useChat(species, stateAbbr, handleMapAction);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([
    "What's the brain detecting right now?",
    "Which states have the strongest signals?",
    "Any significant weather events forming?",
    "Show me the most interesting data from the last 24 hours",
  ]);
  const [brainStats, setBrainStats] = useState<{
    total_entries: number;
    sources: number;
    content_types: number;
    active_crons: number;
    high_signal_count: number;
    alerts_active: number;
    last_update: string | null;
  } | null>(null);

  useEffect(() => {
    if (!SUPABASE_URL) return;
    fetch(`${SUPABASE_URL}/functions/v1/hunt-suggested-prompts`, {
      headers: { 'apikey': SUPABASE_KEY || '' },
    })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.prompts) && data.prompts.length > 0) {
          setSuggestedPrompts(data.prompts);
        }
        if (data.stats) setBrainStats(data.stats);
      })
      .catch(() => { /* keep defaults */ });
  }, []);

  // Expose actions to parent
  useEffect(() => {
    onActionsReady?.({ clearMessages, loadSession });
  }, [onActionsReady, clearMessages, loadSession]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const chatArea = (
    <div className="flex flex-col h-full">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-hide p-3 space-y-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full px-4">
            <div className="w-10 h-10 rounded-full bg-cyan-400/10 flex items-center justify-center mb-3">
              <Compass size={20} className="text-cyan-400/60" />
            </div>
            <p className="text-sm font-heading text-white/70 mb-1">
              The Brain
            </p>
            <p className="text-[11px] font-body text-white/40 text-center mb-1">
              {brainStats
                ? `${brainStats.total_entries.toLocaleString()} entries across ${brainStats.content_types || brainStats.sources} types`
                : '2M+ data points from 25+ sources'}
            </p>
            {brainStats && (
              <p className="text-[9px] font-mono text-cyan-400/50 text-center mb-1">
                {brainStats.active_crons > 0 && `${brainStats.active_crons} crons active · `}
                {brainStats.alerts_active > 0 && `${brainStats.alerts_active} alerts active · `}
                {brainStats.high_signal_count > 0 && `${brainStats.high_signal_count} signals (24h) · `}
                {brainStats.last_update && `Updated ${timeAgo(brainStats.last_update)}`}
              </p>
            )}
            <p className="text-[10px] font-body text-white/30 text-center mb-4">
              Ask me about any environmental pattern across 50 states, from 1950 to today.
            </p>
            <div className="flex flex-col gap-1.5 w-full max-w-[280px]">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-[11px] font-body text-white/60 hover:text-white/90 bg-white/[0.03] hover:bg-white/[0.06] border border-white/[0.06] hover:border-white/[0.10] rounded-xl px-3 py-2 text-left transition-all duration-200"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map(msg => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {loading && !streaming && (
          <div className="flex items-start gap-2 mb-3">
            <div className="w-6 h-6 rounded-full bg-cyan-400/10 flex items-center justify-center mt-0.5">
              <Compass className="w-3.5 h-3.5 text-cyan-400/60 animate-spin" style={{ animationDuration: '3s' }} />
            </div>
            <div className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3.5 py-2.5">
              <p className="text-[11px] text-white/40 font-body">Searching the brain...</p>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput onSend={sendMessage} loading={loading || streaming} stateAbbr={stateAbbr} />
    </div>
  );

  return <div className="h-full">{chatArea}</div>;
}
