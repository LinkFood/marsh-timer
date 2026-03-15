import { Fragment, useMemo, useState } from 'react';
import { Zap, Cloud, AlertTriangle, TrendingUp, Bird } from 'lucide-react';
import type { ConvergenceAlert } from '@/hooks/useConvergenceAlerts';
import type { HuntAlert } from '@/hooks/useHuntAlerts';
import type { FeatureCollection } from 'geojson';

interface MurmurationData {
  index: number;
  change_pct: number;
  direction: 'up' | 'down' | 'flat';
  top_states: string[];
  spike_count: number;
  active_states: number;
}

interface LiveTickerProps {
  convergenceAlerts: ConvergenceAlert[];
  weatherEventsGeoJSON: FeatureCollection | null;
  nwsAlertsGeoJSON: FeatureCollection | null;
  huntAlerts: HuntAlert[];
  murmurationIndex: MurmurationData | null;
}

interface TickerItem {
  id: string;
  icon: 'zap' | 'cloud' | 'alert-triangle' | 'trending-up' | 'bird';
  text: string;
  severity: 'high' | 'medium' | 'info';
  timestamp: Date;
}

const ICONS = {
  zap: Zap,
  cloud: Cloud,
  'alert-triangle': AlertTriangle,
  'trending-up': TrendingUp,
  bird: Bird,
};

const SEVERITY_COLORS: Record<TickerItem['severity'], string> = {
  high: 'text-red-400',
  medium: 'text-amber-400',
  info: 'text-cyan-400',
};

function timeAgo(d: Date): string {
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const LiveTicker = ({
  convergenceAlerts,
  weatherEventsGeoJSON,
  nwsAlertsGeoJSON,
  huntAlerts,
  murmurationIndex,
}: LiveTickerProps) => {
  const [isHovered, setIsHovered] = useState(false);

  const items = useMemo(() => {
    const all: TickerItem[] = [];

    // 1. Convergence alerts
    for (const alert of convergenceAlerts) {
      const delta = alert.score_after - alert.score_before;
      all.push({
        id: `conv-${alert.state_abbr}`,
        icon: 'zap',
        text: `${alert.state_abbr} surged +${delta} to ${alert.score_after}`,
        severity: delta >= 15 ? 'high' : delta >= 8 ? 'medium' : 'info',
        timestamp: new Date(alert.created_at),
      });
    }

    // 2. Weather events
    if (weatherEventsGeoJSON?.features) {
      for (const feature of weatherEventsGeoJSON.features) {
        const p = feature.properties;
        if (!p) continue;
        all.push({
          id: `wx-${p.station}-${p.type}`,
          icon: 'cloud',
          text: `${p.station}: ${p.details}`,
          severity: p.severity === 'high' ? 'high' : p.severity === 'medium' ? 'medium' : 'info',
          timestamp: p.timestamp ? new Date(p.timestamp) : new Date(),
        });
      }
    }

    // 3. NWS alerts
    if (nwsAlertsGeoJSON?.features) {
      for (let i = 0; i < nwsAlertsGeoJSON.features.length; i++) {
        const p = nwsAlertsGeoJSON.features[i].properties;
        if (!p) continue;
        all.push({
          id: `nws-${i}`,
          icon: 'alert-triangle',
          text: `${p.event}: ${p.headline?.slice(0, 60) ?? ''}`,
          severity: p.severity === 'Extreme' || p.severity === 'Severe' ? 'high' : 'medium',
          timestamp: new Date(),
        });
      }
    }

    // 4. Hunt alerts
    for (const alert of huntAlerts) {
      all.push({
        id: `hunt-${alert.stateAbbr}`,
        icon: 'bird',
        text: `${alert.stateName}: ${alert.forecastSummary.slice(0, 60)}`,
        severity: alert.severity,
        timestamp: new Date(),
      });
    }

    // 5. Murmuration index
    if (murmurationIndex) {
      const arrow = murmurationIndex.direction === 'up' ? '▲' : murmurationIndex.direction === 'down' ? '▼' : '—';
      all.push({
        id: 'murm',
        icon: 'trending-up',
        text: `Migration Index: ${murmurationIndex.index} ${arrow} ${murmurationIndex.change_pct}%`,
        severity: 'info',
        timestamp: new Date(),
      });
    }

    // Sort by recency, dedup by id, cap at 20
    all.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    const seen = new Set<string>();
    const deduped: TickerItem[] = [];
    for (const item of all) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      deduped.push(item);
      if (deduped.length >= 20) break;
    }

    return deduped;
  }, [convergenceAlerts, weatherEventsGeoJSON, nwsAlertsGeoJSON, huntAlerts, murmurationIndex]);

  // Scale animation: ~2s per item, min 15s, max 60s
  const duration = Math.min(60, Math.max(15, items.length * 2));

  return (
    <div className="h-7 glass-panel border-b border-white/[0.06] overflow-hidden relative flex items-center">
      <style>{`@keyframes ticker-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }`}</style>

      {/* LIVE indicator */}
      <div className="flex items-center gap-1.5 px-3 shrink-0 z-10 border-r border-white/[0.06]">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
        <span className="text-[9px] font-mono text-white/40 tracking-wider">LIVE</span>
      </div>

      {items.length === 0 ? (
        <span className="text-[10px] font-body text-white/20 tracking-widest uppercase ml-4">
          Scanning data feeds...
        </span>
      ) : (
        <div className="overflow-hidden flex-1">
          <div
            className="flex items-center h-full whitespace-nowrap"
            style={{
              animation: `ticker-scroll ${duration}s linear infinite`,
              animationPlayState: isHovered ? 'paused' : 'running',
            }}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
          >
            {[...items, ...items].map((item, i) => {
              const Icon = ICONS[item.icon];
              const colorClass = SEVERITY_COLORS[item.severity];
              return (
                <Fragment key={`${item.id}-${i}`}>
                  {i > 0 && <span className="text-white/20 mx-3">·</span>}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Icon size={12} className={colorClass} />
                    <span className={`text-[10px] font-body ${colorClass}`}>{item.text}</span>
                    <span className="text-[10px] text-white/30">{timeAgo(item.timestamp)}</span>
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveTicker;
