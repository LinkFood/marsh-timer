import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface ChatSession {
  sessionId: string;
  firstMessage: string;
  messageCount: number;
  lastMessageAt: string;
}

export function useChatHistory() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSessions = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }

    try {
      const { data, error } = await supabase
        .from('hunt_conversations')
        .select('session_id, role, content, created_at')
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      if (!data || data.length === 0) { setSessions([]); return; }

      // Group by session_id
      const sessionMap = new Map<string, typeof data>();
      for (const row of data) {
        const sid = row.session_id;
        if (!sessionMap.has(sid)) sessionMap.set(sid, []);
        sessionMap.get(sid)!.push(row);
      }

      const result: ChatSession[] = [];
      for (const [sessionId, messages] of sessionMap) {
        // Sort oldest first to get first message
        messages.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        result.push({
          sessionId,
          firstMessage: messages[0].content.slice(0, 100),
          messageCount: messages.length,
          lastMessageAt: messages[messages.length - 1].created_at,
        });
      }

      // Most recent first
      result.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      setSessions(result.slice(0, 20));
    } catch (err) {
      console.error('[ChatHistory] Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  return { sessions, loading, refetch: fetchSessions };
}
