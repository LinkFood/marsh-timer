import { useRef, useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import type { Species } from '@/data/types';
import { useChat } from '@/hooks/useChat';
import ChatInput from './ChatInput';
import ChatMessage from './ChatMessage';

interface HuntChatProps {
  species: Species;
  stateAbbr: string | null;
  isMobile: boolean;
}

export default function HuntChat({ species, stateAbbr, isMobile }: HuntChatProps) {
  const { messages, loading, sendMessage } = useChat(species, stateAbbr);
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
            <p className="text-xs font-body text-center">
              Ask about seasons, weather, solunar,<br />or anything hunting-related
            </p>
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
      <ChatInput onSend={sendMessage} loading={loading} />
    </div>
  );

  return <div className="h-full">{chatArea}</div>;
}
