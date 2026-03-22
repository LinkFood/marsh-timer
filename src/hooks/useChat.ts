import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase, SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  cards?: ChatCard[];
  mapAction?: { type: 'flyTo' | 'highlight'; target: string };
  timestamp: Date;
}

export interface ChatCard {
  type: 'weather' | 'season' | 'solunar' | 'alert' | 'convergence' | 'pattern' | 'source' | 'pattern-links' | 'activity';
  data: Record<string, unknown>;
}

export function useChat(
  species: string,
  stateAbbr: string | null,
  onMapAction?: (action: { type: string; target: string }) => void
) {
  const { session } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    try {
      const saved = sessionStorage.getItem('dc-chat-messages');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }));
      }
    } catch {}
    return [];
  });
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const sessionIdRef = useRef<string>('');
  if (!sessionIdRef.current) {
    const saved = sessionStorage.getItem('dc-chat-session-id');
    if (saved) {
      sessionIdRef.current = saved;
    } else {
      const id = crypto.randomUUID();
      sessionStorage.setItem('dc-chat-session-id', id);
      sessionIdRef.current = id;
    }
  }

  // Persist messages to sessionStorage on every change
  useEffect(() => {
    try {
      sessionStorage.setItem('dc-chat-messages', JSON.stringify(messages));
    } catch {}
  }, [messages]);

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || loading || streaming) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setStreaming(false);

    // Create empty assistant message immediately
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      cards: [],
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '',
      };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/hunt-dispatcher`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: content.trim(),
          species,
          stateAbbr,
          sessionId: sessionIdRef.current,
          stream: true,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      // Check if response is SSE stream or JSON fallback
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/event-stream') && res.body) {
        // Streaming path
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamStarted = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Split on double newline (SSE event boundary)
          const events = buffer.split('\n\n');
          buffer = events.pop() || ''; // keep incomplete event

          for (const event of events) {
            for (const line of event.split('\n')) {
              if (!line.startsWith('data: ')) continue;
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'cards') {
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId ? { ...m, cards: data.cards || [] } : m
                  ));
                } else if (data.type === 'text') {
                  if (!streamStarted) {
                    streamStarted = true;
                    setStreaming(true);
                    setLoading(false);
                  }
                  setMessages(prev => prev.map(m =>
                    m.id === assistantId ? { ...m, content: m.content + data.chunk } : m
                  ));
                } else if (data.type === 'done') {
                  if (data.mapAction && onMapAction) {
                    onMapAction(data.mapAction);
                  }
                }
              } catch { /* skip malformed events */ }
            }
          }
        }

        // Infer mode from cards
        setMessages(prev => {
          const msg = prev.find(m => m.id === assistantId);
          if (msg?.cards) {
            const cardTypes = msg.cards.map((c: any) => c.type);
            if (cardTypes.includes('weather')) {
              onMapAction?.({ type: 'setMode', target: 'weather' });
            } else if (cardTypes.includes('pattern') || cardTypes.includes('pattern-links')) {
              onMapAction?.({ type: 'setMode', target: 'intel' });
            }
          }
          return prev;
        });

      } else {
        // Non-streaming fallback (JSON response)
        const data = await res.json();
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? {
            ...m,
            content: data.response || 'No response',
            cards: data.cards || [],
            mapAction: data.mapAction,
          } : m
        ));
        if (data.mapAction && onMapAction) {
          onMapAction(data.mapAction);
        }
        // Infer mode from card types
        const cardTypes = (data.cards || []).map((c: any) => c.type);
        if (cardTypes.includes('weather')) {
          onMapAction?.({ type: 'setMode', target: 'weather' });
        } else if (cardTypes.includes('pattern') || cardTypes.includes('pattern-links')) {
          onMapAction?.({ type: 'setMode', target: 'intel' });
        }
      }
    } catch (err) {
      setMessages(prev => prev.map(m =>
        m.id === assistantId ? {
          ...m,
          content: `Sorry, something went wrong: ${err instanceof Error ? err.message : 'Unknown error'}`,
        } : m
      ));
    } finally {
      setLoading(false);
      setStreaming(false);
    }
  }, [loading, streaming, session, species, stateAbbr, onMapAction]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    sessionIdRef.current = crypto.randomUUID();
    sessionStorage.removeItem('dc-chat-messages');
    sessionStorage.setItem('dc-chat-session-id', sessionIdRef.current);
  }, []);

  const loadSession = useCallback(async (targetSessionId: string) => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from('hunt_conversations')
        .select('role, content, created_at')
        .eq('session_id', targetSessionId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      if (!data) return;

      const loaded: ChatMessage[] = data.map((row: any) => ({
        id: crypto.randomUUID(),
        role: row.role as 'user' | 'assistant',
        content: row.content,
        timestamp: new Date(row.created_at),
      }));

      setMessages(loaded);
      sessionIdRef.current = targetSessionId;
      sessionStorage.setItem('dc-chat-session-id', targetSessionId);
      sessionStorage.setItem('dc-chat-messages', JSON.stringify(loaded));
    } catch (err) {
      console.error('[Chat] Failed to load session:', err);
    }
  }, []);

  return { messages, loading, streaming, sendMessage, clearMessages, loadSession };
}
