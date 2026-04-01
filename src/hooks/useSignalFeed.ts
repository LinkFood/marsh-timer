import { useState, useEffect, useCallback } from 'react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export interface SignalItem {
  id: string;
  type: 'convergence' | 'weather' | 'nws' | 'migration' | 'brain' | 'compound-risk' | 'disaster-watch' | 'weather-realtime';
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
    if (!SUPABASE_URL || !SUPABASE_KEY) { setLoading(false); return; }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const since48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const headers = { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY };

      const [convRes, weatherRes, nwsRes, riskRes, disasterRes, realtimeRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/hunt_convergence_alerts?select=id,state_abbr,score,previous_score,alert_type,reasoning,created_at&created_at=gte.${since48h}&order=created_at.desc&limit=15`, { headers, signal: controller.signal }),
        fetch(`${SUPABASE_URL}/rest/v1/hunt_weather_events?select=id,event_type,states,severity,title,created_at&created_at=gte.${since48h}&order=created_at.desc&limit=15`, { headers, signal: controller.signal }),
        fetch(`${SUPABASE_URL}/rest/v1/hunt_nws_alerts?select=id,event,headline,states,severity,created_at&created_at=gte.${since24h}&order=created_at.desc&limit=10`, { headers, signal: controller.signal }),
        fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge?select=id,title,content,state_abbr,created_at&content_type=eq.compound-risk-alert&created_at=gte.${since48h}&order=created_at.desc&limit=10`, { headers, signal: controller.signal }),
        fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge?select=id,title,content,state_abbr,effective_date,created_at,metadata&content_type=eq.disaster-watch&created_at=gte.${since48h}&order=created_at.desc&limit=10`, { headers, signal: controller.signal }),
        fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge?select=id,title,content,state_abbr,created_at&content_type=eq.weather-realtime&created_at=gte.${since24h}&order=created_at.desc&limit=15`, { headers, signal: controller.signal }),
      ]);
      clearTimeout(timeout);

      const convData = convRes.ok ? await convRes.json() : [];
      const weatherData = weatherRes.ok ? await weatherRes.json() : [];
      const nwsData = nwsRes.ok ? await nwsRes.json() : [];
      const riskData = riskRes.ok ? await riskRes.json() : [];
      const disasterData = disasterRes.ok ? await disasterRes.json() : [];
      const realtimeData = realtimeRes.ok ? await realtimeRes.json() : [];

      const merged: SignalItem[] = [];

      for (const a of convData) {
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

      for (const w of weatherData) {
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

      for (const n of nwsData) {
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

      for (const item of riskData) {
        merged.push({
          id: `risk-${item.id}`,
          type: 'compound-risk',
          title: item.title || 'Compound Risk Alert',
          body: item.content?.slice(0, 200) || '',
          stateAbbr: item.state_abbr,
          severity: 'high',
          timestamp: item.created_at,
        });
      }

      for (const item of Array.isArray(disasterData) ? disasterData : []) {
        const meta = item.metadata || {};
        const confidence = meta.confidence ?? 0;
        merged.push({
          id: `disaster-${item.id}`,
          type: 'disaster-watch',
          title: item.title || 'Disaster Watch',
          body: item.content?.slice(0, 200) || '',
          stateAbbr: item.state_abbr,
          severity: confidence >= 70 ? 'high' : confidence >= 40 ? 'medium' : 'low',
          timestamp: item.created_at,
        });
      }

      for (const item of Array.isArray(realtimeData) ? realtimeData : []) {
        const content = (item.content || '').toLowerCase();
        let severity: 'high' | 'medium' | 'low' = 'low';
        if (content.includes('front passage') || content.includes('rapid') || content.includes('severe')) {
          severity = 'high';
        } else if (content.includes('significant') || content.includes('wind shift') || content.includes('temperature drop')) {
          severity = 'medium';
        }
        merged.push({
          id: `realtime-${item.id}`,
          type: 'weather-realtime',
          title: item.title || 'Weather Station Update',
          body: item.content?.slice(0, 200) || '',
          stateAbbr: item.state_abbr,
          severity,
          timestamp: item.created_at,
        });
      }

      merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setItems(merged.slice(0, 30));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.warn('[useSignalFeed] Request timed out');
      } else {
        console.error('[SignalFeed] Error:', err);
      }
    } finally {
      clearTimeout(timeout);
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
