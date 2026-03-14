import { useRef, useEffect, useCallback } from 'react';
import { Compass } from 'lucide-react';
import type { Species } from '@/data/types';
import { useChat } from '@/hooks/useChat';
import { useMapAction } from '@/contexts/MapActionContext';
import ChatInput from './ChatInput';
import ChatMessage from './ChatMessage';

interface HuntChatProps {
  species: Species;
  stateAbbr: string | null;
  isMobile: boolean;
}

export default function HuntChat({ species, stateAbbr, isMobile }: HuntChatProps) {
  const { flyTo, setMapMode } = useMapAction();

  const handleMapAction = useCallback((action: { type: string; target: string }) => {
    if (action.type === 'flyTo') {
      flyTo(action.target);
    } else if (action.type === 'setMode') {
      setMapMode(action.target as any);
    }
  }, [flyTo, setMapMode]);

  const { messages, loading, sendMessage } = useChat(species, stateAbbr, handleMapAction);
  const scrollRef = useRef<HTMLDivElement>(null);

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
              Duck Countdown Brain
            </p>
            <p className="text-[11px] font-body text-white/40 text-center mb-4">
              {stateAbbr
                ? `Ask me anything about hunting in ${stateAbbr}`
                : 'Ask me about conditions, seasons, or patterns in any state'
              }
            </p>
            <div className="flex flex-col gap-1.5 w-full max-w-[280px]">
              {(stateAbbr
                ? [
                    `Weather conditions in ${stateAbbr}`,
                    `Best duck species for ${stateAbbr} right now`,
                    `${stateAbbr} season dates and bag limits`,
                    `What patterns is the brain seeing in ${stateAbbr}?`,
                  ]
                : [
                    "Where should I hunt this weekend?",
                    "What's the migration index showing?",
                    "Tell me about canvasback behavior",
                    "Which states have the best conditions?",
                  ]
              ).map((prompt) => (
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
        {loading && (
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
      <ChatInput onSend={sendMessage} loading={loading} stateAbbr={stateAbbr} />
    </div>
  );

  return <div className="h-full">{chatArea}</div>;
}
