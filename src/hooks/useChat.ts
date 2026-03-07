import { useState, useCallback, useRef } from 'react';
import { SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';
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
  type: 'weather' | 'season' | 'solunar' | 'alert';
  data: Record<string, unknown>;
}

export function useChat(species: string, stateAbbr: string | null) {
  const { session } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const sessionIdRef = useRef(crypto.randomUUID());

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: content.trim(),
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

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
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();

      const assistantMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.response || 'No response',
        cards: data.cards || [],
        mapAction: data.mapAction,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Sorry, something went wrong: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  }, [loading, session, species, stateAbbr]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    sessionIdRef.current = crypto.randomUUID();
  }, []);

  return { messages, loading, sendMessage, clearMessages };
}
