import { useState, useMemo } from 'react';
import { CloudRain, Wind, Thermometer, Gauge, Zap, CloudLightning } from 'lucide-react';
import { useWeatherEvents } from '@/hooks/useWeatherEvents';
import { useMapAction } from '@/contexts/MapActionContext';
import { useDeck } from '@/contexts/DeckContext';
import PanelTabs from '@/components/PanelTabs';
import type { PanelComponentProps } from './PanelTypes';

const STATION_STATE: Record<string, string> = {
  KLIT: 'AR', KMEM: 'TN', KJAN: 'MS', KSHV: 'LA', KMSY: 'LA',
  KIAH: 'TX', KDFW: 'TX', KOKC: 'OK', KSTL: 'MO', KDSM: 'IA',
  KMSP: 'MN', KORD: 'IL', KDTW: 'MI', KCLT: 'NC', KATL: 'GA',
  KJAX: 'FL', KBNA: 'TN', KIND: 'IN', KCVG: 'OH', KMCI: 'MO',
  KDEN: 'CO', KSLC: 'UT', KBOI: 'ID', KPDX: 'OR', KSEA: 'WA',
  KPHX: 'AZ', KABQ: 'NM',
};

const EVENT_ICONS: Record<string, typeof Wind> = {
  'front-passage': CloudLightning,
  'temp-drop': Thermometer,
  'wind-shift': Wind,
  'pressure-change': Gauge,
  'weather-event': CloudRain,
};

const SEVERITY_COLORS: Record<string, string> = {
  high: 'bg-red-500/20 text-red-400',
  medium: 'bg-orange-500/20 text-orange-400',
  low: 'bg-yellow-500/20 text-yellow-400',
};

const EVENT_LABELS: Record<string, string> = {
  'front-passage': 'Front Passage',
  'temp-drop': 'Temp Drop',
  'wind-shift': 'Wind Shift',
  'pressure-change': 'Pressure Change',
  'weather-event': 'Weather Event',
};

function formatTitle(title: string, eventType: string): string {
  // Extract station and make human-readable: "METAR Alert: KDFW - Temperature Drop" → "Dallas TX — Temp Drop"
  const stationMatch = title.match(/([A-Z]{4})/);
  const label = EVENT_LABELS[eventType] || eventType.replace(/-/g, ' ');
  if (stationMatch) {
    return `${stationMatch[1]} — ${label}`;
  }
  return label;
}

function formatContent(content: string): string {
  // Clean up raw METAR content for display
  if (!content) return '';
  // If it's the raw pipe-delimited format, extract the useful part
  if (content.includes('|')) {
    const parts = content.split('|').map(s => s.trim());
    // Find parts that look like data (not source names)
    const useful = parts.filter(p =>
      p.includes('change') || p.includes('drop') || p.includes('shift') ||
      p.includes('front') || p.includes('temp') || p.includes('wind') ||
      p.includes('mb') || p.includes('°') || p.includes('mph')
    );
    if (useful.length > 0) return useful.join(' · ');
  }
  return content.slice(0, 120);
}

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function WeatherEventsPanel({}: PanelComponentProps) {
  const { eventsGeoJSON } = useWeatherEvents();
  const { flyToCoords } = useMapAction();
  const { selectedState } = useDeck();
  const [activeTab, setActiveTab] = useState('all');

  const allEvents = useMemo(() => {
    if (!eventsGeoJSON?.features) return [];
    return eventsGeoJSON.features.map(f => ({
      station: f.properties?.station as string,
      eventType: f.properties?.eventType as string,
      severity: f.properties?.severity as string,
      title: f.properties?.title as string,
      content: f.properties?.content as string,
      timestamp: f.properties?.timestamp as string,
      lng: (f.geometry as any)?.coordinates?.[0] as number,
      lat: (f.geometry as any)?.coordinates?.[1] as number,
    }));
  }, [eventsGeoJSON]);

  const events = useMemo(() => {
    if (!selectedState) return allEvents;
    return allEvents.filter(e => STATION_STATE[e.station] === selectedState);
  }, [allEvents, selectedState]);

  const eventTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const evt of events) {
      counts.set(evt.eventType, (counts.get(evt.eventType) || 0) + 1);
    }
    return counts;
  }, [events]);

  const tabs = useMemo(() => {
    const t: { id: string; label: string; count: number }[] = [
      { id: 'all', label: 'ALL', count: events.length },
    ];
    for (const [type, count] of eventTypes) {
      t.push({ id: type, label: (EVENT_LABELS[type] || type.replace(/-/g, ' ')).toUpperCase(), count });
    }
    return t;
  }, [events, eventTypes]);

  const filtered = useMemo(() => {
    if (activeTab === 'all') return events;
    return events.filter(e => e.eventType === activeTab);
  }, [events, activeTab]);

  if (!eventsGeoJSON) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading weather events...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        {selectedState ? `No weather events for ${selectedState}` : 'No active weather events'}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <PanelTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col gap-0.5 p-2">
          {filtered.map((evt, i) => {
            const Icon = EVENT_ICONS[evt.eventType] || Zap;
            const sevClass = SEVERITY_COLORS[evt.severity] || SEVERITY_COLORS.low;
            return (
              <button
                key={`${evt.station}-${i}`}
                onClick={() => flyToCoords(evt.lng, evt.lat, 8)}
                className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-white/[0.06] transition-colors text-left w-full"
              >
                <Icon size={14} className="text-cyan-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-body text-white/80">{formatTitle(evt.title, evt.eventType)}</span>
                    <span className={`text-[8px] font-mono px-1 py-0.5 rounded shrink-0 ${sevClass}`}>
                      {evt.severity.toUpperCase()}
                    </span>
                  </div>
                  <p className="text-[10px] text-white/40 mt-0.5 truncate">{formatContent(evt.content)}</p>
                </div>
                <span className="text-[9px] font-mono text-white/20 shrink-0">{timeAgo(evt.timestamp)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
