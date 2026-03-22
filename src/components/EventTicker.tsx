import { useEffect, useMemo, useState } from 'react';
import type { FeatureCollection } from 'geojson';

interface TickerItem {
  text: string;
  colorClass: string;
  timestamp: string;
}

interface EventTickerProps {
  convergenceAlerts: Array<{ state_abbr: string; score: number; previous_score: number; alert_type: string; created_at: string }>;
  weatherEventsGeoJSON: FeatureCollection | null;
  nwsAlertsGeoJSON: FeatureCollection | null;
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function EventTicker({ convergenceAlerts, weatherEventsGeoJSON, nwsAlertsGeoJSON }: EventTickerProps) {
  const [hovered, setHovered] = useState(false);
  const [compoundAlerts, setCompoundAlerts] = useState<any[]>([]);

  useEffect(() => {
    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!SUPABASE_URL) return;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge?select=title,state_abbr,created_at&content_type=eq.compound-risk-alert&created_at=gte.${since}&order=created_at.desc&limit=5`, {
      headers: { 'Authorization': `Bearer ${SUPABASE_KEY}`, 'apikey': SUPABASE_KEY },
    })
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setCompoundAlerts(data); })
      .catch(() => {});
  }, []);

  const items = useMemo<TickerItem[]>(() => {
    const all: TickerItem[] = [];

    for (const a of convergenceAlerts) {
      all.push({
        text: `${a.state_abbr} convergence ${a.alert_type}: ${a.previous_score}\u2192${a.score}`,
        colorClass: 'bg-cyan-400',
        timestamp: a.created_at,
      });
    }

    if (weatherEventsGeoJSON?.features) {
      for (const f of weatherEventsGeoJSON.features) {
        const props = f.properties || {};
        const title = props.title || props.eventType || props.event_type || 'Weather event';
        all.push({
          text: String(title),
          colorClass: 'bg-amber-400',
          timestamp: props.created_at || props.timestamp || props.time || new Date().toISOString(),
        });
      }
    }

    if (nwsAlertsGeoJSON?.features) {
      for (const f of nwsAlertsGeoJSON.features) {
        const props = f.properties || {};
        const headline = props.headline || props.event || 'NWS Alert';
        all.push({
          text: String(headline),
          colorClass: 'bg-red-400',
          timestamp: props.onset || props.effective || props.created_at || new Date().toISOString(),
        });
      }
    }

    for (const alert of compoundAlerts) {
      all.push({
        text: `COMPOUND RISK: ${alert.title}`,
        colorClass: 'bg-red-500',
        timestamp: alert.created_at,
      });
    }

    all.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return all.slice(0, 15);
  }, [convergenceAlerts, weatherEventsGeoJSON, nwsAlertsGeoJSON, compoundAlerts]);

  if (items.length === 0) {
    return (
      <div className="h-8 overflow-hidden bg-black/30 border-b border-white/[0.06] flex items-center px-4">
        <span className="text-[10px] font-mono text-white/20">No recent events</span>
      </div>
    );
  }

  return (
    <div
      className="h-8 overflow-hidden bg-black/30 border-b border-white/[0.06] flex items-center"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <style>{`
        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
      <div
        className="flex items-center gap-6 whitespace-nowrap px-4"
        style={{
          animation: 'ticker-scroll 60s linear infinite',
          animationPlayState: hovered ? 'paused' : 'running',
        }}
      >
        {/* Render twice for seamless loop */}
        {[...items, ...items].map((item, i) => (
          <span key={i} className="text-[10px] font-mono flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${item.colorClass}`} />
            <span className="text-white/60">{item.text}</span>
            <span className="text-white/20">{timeAgo(item.timestamp)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
