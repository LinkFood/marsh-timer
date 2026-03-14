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
          <div className="flex flex-col items-center justify-center h-full text-white/40">
            <MessageSquare size={24} className="mb-2 opacity-40" />
            <p className="text-xs font-body text-center mb-3">
              Ask me about hunting conditions in any state
            </p>
            <div className="flex flex-col gap-1.5 w-full max-w-[240px]">
              {(stateAbbr
                ? [
                    `${stateAbbr} conditions today`,
                    `Hunt score breakdown for ${stateAbbr}`,
                    `${stateAbbr} season dates`,
                  ]
                : [
                    "Best states for mallards this week",
                    "Texas conditions today",
                    "Migration activity in Mississippi Flyway",
                  ]
              ).map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-[11px] font-body text-cyan-400/70 hover:text-cyan-400 bg-cyan-400/5 hover:bg-cyan-400/10 border border-cyan-400/10 rounded-lg px-3 py-1.5 text-left transition-colors"
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
          <div className="flex justify-start mb-2">
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
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
