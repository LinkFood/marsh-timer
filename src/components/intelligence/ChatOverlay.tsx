import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '@/hooks/useChat';

interface ChatOverlayProps {
  messages: ChatMessage[];
  loading: boolean;
  streaming: boolean;
  onSend: (msg: string) => void;
  onClose: () => void;
}

function renderBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, j) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={j} style={{ color: '#22d3ee' }}>{p.slice(2, -2)}</strong>
      : <span key={j}>{p}</span>
  );
}

const PROMPTS = ['Why is this state #1?', 'Compare top 3 states', 'Next grading window?', 'Explain convergence'];

export default function ChatOverlay({ messages, loading, streaming, onSend, onClose }: ChatOverlayProps) {
  const [input, setInput] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  function handleSend() {
    if (!input.trim() || loading || streaming) return;
    onSend(input.trim());
    setInput('');
  }

  return (
    <div style={{
      position: 'absolute', bottom: 0, right: 280, width: 380,
      height: 'calc(100vh - 50px)',
      backgroundColor: '#0a0f1a', borderLeft: '1px solid #1f2937', borderRight: '1px solid #1f2937',
      display: 'flex', flexDirection: 'column', zIndex: 20,
      boxShadow: '-4px 0 20px rgba(0,0,0,0.5)',
    }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1f2937', display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#22d3ee', fontWeight: 700 }}>ASK THE BRAIN</span>
        <button
          onClick={onClose}
          style={{ border: 'none', background: 'none', color: '#ffffff25', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' }}
        >
          &times;
        </button>
      </div>
      <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((m, i) => (
          <div key={m.id || i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              backgroundColor: m.role === 'user' ? '#22d3ee12' : '#111827',
              border: `1px solid ${m.role === 'user' ? '#22d3ee18' : '#1f2937'}`,
              borderRadius: m.role === 'user' ? '10px 10px 3px 10px' : '10px 10px 10px 3px',
              padding: '7px 10px', maxWidth: '88%',
            }}>
              <div style={{ fontSize: 10, fontFamily: 'monospace', color: m.role === 'user' ? '#22d3ee' : '#ffffff90', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {renderBold(m.content)}
              </div>
            </div>
          </div>
        ))}
        {(loading && !streaming) && (
          <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#ffffff20' }}>Thinking...</div>
        )}
      </div>
      <div style={{ padding: '8px 12px', borderTop: '1px solid #1f2937' }}>
        <div style={{ display: 'flex', gap: 3, marginBottom: 6, flexWrap: 'wrap' }}>
          {PROMPTS.map(p => (
            <button
              key={p}
              onClick={() => onSend(p)}
              style={{
                fontSize: 7, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 8,
                border: '1px solid #22d3ee15', backgroundColor: '#22d3ee06', color: '#22d3ee60', cursor: 'pointer',
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSend(); }}
            placeholder="Ask anything..."
            style={{
              flex: 1, backgroundColor: '#111827', border: '1px solid #1f2937', borderRadius: 4,
              padding: '6px 10px', fontSize: 10, fontFamily: 'monospace', color: '#ffffff90', outline: 'none',
            }}
          />
          <button
            onClick={handleSend}
            style={{
              backgroundColor: '#22d3ee18', border: '1px solid #22d3ee25', borderRadius: 4,
              padding: '6px 10px', fontSize: 8, fontFamily: 'monospace', color: '#22d3ee', fontWeight: 700, cursor: 'pointer',
            }}
          >
            SEND
          </button>
        </div>
      </div>
    </div>
  );
}
