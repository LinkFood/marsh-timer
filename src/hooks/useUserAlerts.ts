import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export interface UserAlert {
  id: string;
  name: string;
  trigger_type: 'score_spike' | 'weather_event' | 'threshold' | 'new_data';
  config: Record<string, any>;
  states: string[] | null;
  species: string;
  enabled: boolean;
  check_interval: string;
  last_fired_at: string | null;
  created_at: string;
}

export interface AlertHistoryItem {
  id: string;
  alert_id: string;
  title: string;
  body: string | null;
  data: Record<string, any>;
  read: boolean;
  created_at: string;
}

export function useUserAlerts() {
  const [alerts, setAlerts] = useState<UserAlert[]>([]);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchAlerts = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('hunt_user_alerts')
      .select('*')
      .order('created_at', { ascending: false });
    setAlerts((data || []) as UserAlert[]);
  }, []);

  const fetchHistory = useCallback(async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('hunt_user_alert_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    setHistory((data || []) as AlertHistoryItem[]);
    setUnreadCount((data || []).filter((h: any) => !h.read).length);
  }, []);

  const fetchedRef = useRef(false);
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    Promise.all([fetchAlerts(), fetchHistory()]).finally(() => setLoading(false));
    const interval = setInterval(fetchHistory, 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchAlerts, fetchHistory]);

  const createAlert = useCallback(async (alert: Omit<UserAlert, 'id' | 'created_at' | 'last_fired_at'>) => {
    if (!supabase) return null;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
      .from('hunt_user_alerts')
      .insert({ ...alert, user_id: user.id })
      .select()
      .single();
    if (error) { console.error('[UserAlerts] Create failed:', error); return null; }
    await fetchAlerts();
    return data;
  }, [fetchAlerts]);

  const deleteAlert = useCallback(async (id: string) => {
    if (!supabase) return;
    await supabase.from('hunt_user_alerts').delete().eq('id', id);
    await fetchAlerts();
  }, [fetchAlerts]);

  const toggleAlert = useCallback(async (id: string, enabled: boolean) => {
    if (!supabase) return;
    await supabase.from('hunt_user_alerts').update({ enabled }).eq('id', id);
    await fetchAlerts();
  }, [fetchAlerts]);

  const markRead = useCallback(async (historyId: string) => {
    if (!supabase) return;
    await supabase.from('hunt_user_alert_history').update({ read: true }).eq('id', historyId);
    await fetchHistory();
  }, [fetchHistory]);

  const markAllRead = useCallback(async () => {
    if (!supabase) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('hunt_user_alert_history').update({ read: true }).eq('user_id', user.id).eq('read', false);
    await fetchHistory();
  }, [fetchHistory]);

  return { alerts, history, unreadCount, loading, createAlert, deleteAlert, toggleAlert, markRead, markAllRead };
}
