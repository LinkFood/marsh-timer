import { useState, Component, type ReactNode } from 'react';
import { X, Plus, Clock } from 'lucide-react';
import HuntChat from '@/components/HuntChat';
import { useDeck } from '@/contexts/DeckContext';
import { useIsMobile } from '@/hooks/useIsMobile';
import { useChatHistory, type ChatSession } from '@/hooks/useChatHistory';

/** Chat-specific error boundary that shows the actual error */
class ChatErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: Error) { return { error: err.message }; }
  componentDidCatch(err: Error) { console.error('[ChatPanel]', err); }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 p-4">
          <span className="text-[10px] text-red-400">Chat failed to load</span>
          <span className="text-[9px] text-red-400/60 max-w-[280px] text-center break-words">{this.state.error}</span>
          <button onClick={() => this.setState({ error: null })} className="text-[10px] text-cyan-400 hover:text-cyan-300 mt-1">Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function ChatPanel() {
  const { chatOpen, setChatOpen, species, selectedState } = useDeck();
  const isMobile = useIsMobile();
  const [showHistory, setShowHistory] = useState(false);
  const { sessions, loading: historyLoading } = useChatHistory();

  // Callbacks passed down to HuntChat via ref-like pattern
  // We'll use a state-based approach: HuntChat exposes clearMessages/loadSession via useChat
  // ChatPanel needs to call them. We pass callbacks up via props.
  const [chatActions, setChatActions] = useState<{
    clearMessages: () => void;
    loadSession: (sessionId: string) => Promise<void>;
  } | null>(null);

  const handleNewChat = () => {
    chatActions?.clearMessages();
    setShowHistory(false);
  };

  const handleSelectSession = (session: ChatSession) => {
    chatActions?.loadSession(session.sessionId);
    setShowHistory(false);
  };

  return (
    <div
      className={`fixed top-12 bottom-11 right-0 z-40 ${isMobile ? 'left-0' : 'w-[400px]'} glass-panel border-l border-white/[0.06] flex flex-col transition-transform duration-300 ease-out ${
        chatOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* Header */}
      <div className="shrink-0 h-10 px-3 flex items-center justify-between border-b border-white/[0.06]">
        <span className="text-[10px] font-display uppercase tracking-widest text-white/50">Brain Chat</span>
        <div className="flex items-center gap-1">
          <button
            onClick={handleNewChat}
            className="flex items-center gap-1 text-white/40 hover:text-white/80 transition-colors px-1.5 py-1 rounded hover:bg-white/[0.05]"
            title="New Chat"
          >
            <Plus size={12} />
            <span className="text-[9px] font-mono">New</span>
          </button>
          <button
            onClick={() => setShowHistory(prev => !prev)}
            className={`flex items-center gap-1 transition-colors px-1.5 py-1 rounded hover:bg-white/[0.05] ${
              showHistory ? 'text-cyan-400/80' : 'text-white/40 hover:text-white/80'
            }`}
            title="Chat History"
          >
            <Clock size={12} />
          </button>
          <button
            onClick={() => setChatOpen(false)}
            className="text-white/40 hover:text-white/80 transition-colors px-1.5 py-1"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body: history or chat */}
      {showHistory ? (
        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide p-2 space-y-1">
          {historyLoading ? (
            <div className="flex items-center justify-center h-32">
              <span className="text-[11px] font-body text-white/30">Loading history...</span>
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex items-center justify-center h-32">
              <span className="text-[11px] font-body text-white/30">No previous chats</span>
            </div>
          ) : (
            sessions.map((s) => (
              <button
                key={s.sessionId}
                onClick={() => handleSelectSession(s)}
                className="w-full text-left px-3 py-2.5 rounded-lg bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.04] hover:border-white/[0.10] transition-all duration-150"
              >
                <p className="text-[11px] font-body text-white/70 truncate leading-tight">
                  {s.firstMessage}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[9px] font-mono text-white/30">{timeAgo(s.lastMessageAt)}</span>
                  <span className="text-[9px] font-mono text-white/20 bg-white/[0.04] px-1.5 py-0.5 rounded">
                    {s.messageCount} msg{s.messageCount !== 1 ? 's' : ''}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          {chatOpen && (
            <ChatErrorBoundary>
              <HuntChat
                species={species}
                stateAbbr={selectedState}
                isMobile={isMobile}
                onActionsReady={setChatActions}
              />
            </ChatErrorBoundary>
          )}
        </div>
      )}

      {/* Brain indicator */}
      <div className="shrink-0 px-3 py-1.5 border-t border-white/[0.06] flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[9px] font-mono text-white/40">The Brain</span>
        </div>
        <span className="text-[9px] font-mono text-white/30">486K+ entries</span>
      </div>
    </div>
  );
}
