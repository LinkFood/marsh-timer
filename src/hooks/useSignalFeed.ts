import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface SignalItem {
  id: string;
  type: 'convergence' | 'weather' | 'nws' | 'migration' | 'brain';
  title: string;
  body: string;
  stateAbbr: string | null;
  severity: 'high' | 'medium' | 'low';
  timestamp: string;
}

export function useSignalFeed() {
  const [items, setItems] = useState<SignalItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFeed = useCallback(async () => {
    if (!supabase) { setLoading(false); return; }

    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const [convRes, weatherRes, nwsRes] = await Promise.all([
        supabase.from('hunt_convergence_alerts')
          .select('id, state_abbr, score, previous_score, alert_type, reasoning, created_at')
          .gt('created_at', since)
          .order('created_at', { ascending: false })
          .limit(15),
        supabase.from('hunt_weather_events')
          .select('id, event_type, states, severity, title, created_at')
          .gt('created_at', since)
          .order('created_at', { ascending: false })
          .limit(15),
        supabase.from('hunt_nws_alerts')
          .select('id, event, headline, states, severity, created_at')
          .gt('created_at', since)
          .order('created_at', { ascending: false })
          .limit(10),
      ]);

      const merged: SignalItem[] = [];

      for (const a of (convRes.data || [])) {
        const delta = a.score - a.previous_score;
        merged.push({
          id: `conv-${a.id}`,
          type: 'convergence',
          title: `${a.state_abbr} convergence ${a.alert_type}: ${a.previous_score}\u2192${a.score}`,
          body: a.reasoning || `Score changed by ${delta > 0 ? '+' : ''}${delta}`,
          stateAbbr: a.state_abbr,
          severity: Math.abs(delta) >= 15 ? 'high' : Math.abs(delta) >= 8 ? 'medium' : 'low',
          timestamp: a.created_at,
        });
      }

      for (const w of (weatherRes.data || [])) {
        const states = Array.isArray(w.states) ? w.states.join(', ') : w.states || '';
        merged.push({
          id: `wx-${w.id}`,
          type: 'weather',
          title: w.title || `${w.event_type} detected`,
          body: `${w.event_type} — ${states}`,
          stateAbbr: Array.isArray(w.states) ? w.states[0] : w.states,
          severity: w.severity === 'high' || w.severity === 'severe' ? 'high' : w.severity === 'moderate' ? 'medium' : 'low',
          timestamp: w.created_at,
        });
      }

      for (const n of (nwsRes.data || [])) {
        const states = Array.isArray(n.states) ? n.states.join(', ') : n.states || '';
        merged.push({
          id: `nws-${n.id}`,
          type: 'nws',
          title: n.headline || n.event || 'NWS Alert',
          body: `${n.event} — ${states}`,
          stateAbbr: Array.isArray(n.states) ? n.states[0] : n.states,
          severity: n.severity === 'Extreme' || n.severity === 'Severe' ? 'high' : n.severity === 'Moderate' ? 'medium' : 'low',
          timestamp: n.created_at,
        });
      }

      merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setItems(merged.slice(0, 30));
    } catch (err) {
      console.error('[SignalFeed] Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFeed();
    const interval = setInterval(fetchFeed, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchFeed]);

  return { items, loading, refetch: fetchFeed };
}
