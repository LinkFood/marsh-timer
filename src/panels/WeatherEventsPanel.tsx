import { useMemo } from 'react';
import { CloudRain, Wind, Thermometer, Gauge, Zap, CloudLightning } from 'lucide-react';
import { useWeatherEvents } from '@/hooks/useWeatherEvents';
import { useMapAction } from '@/contexts/MapActionContext';
import type { PanelComponentProps } from './PanelTypes';

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

  const events = useMemo(() => {
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
        No active weather events
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto h-full p-2">
      {events.map((evt, i) => {
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
                <span className="text-[10px] font-mono text-white/60">{evt.station}</span>
                <span className={`text-[8px] font-mono px-1 py-0.5 rounded ${sevClass}`}>
                  {evt.severity.toUpperCase()}
                </span>
              </div>
              <p className="text-[10px] text-white/40 mt-0.5 truncate">{evt.content}</p>
            </div>
            <span className="text-[9px] font-mono text-white/20 shrink-0">{timeAgo(evt.timestamp)}</span>
          </button>
        );
      })}
    </div>
  );
}
