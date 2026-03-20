import { useDeck } from '@/contexts/DeckContext';
import { useStateForecast } from '@/hooks/useStateForecast';
import { Wind, Droplets, Sun, Cloud, CloudRain, CloudSnow, CloudLightning, CloudFog } from 'lucide-react';
import type { PanelComponentProps } from './PanelTypes';

function weatherIcon(code: number) {
  if (code <= 1) return Sun;
  if (code <= 3) return Cloud;
  if (code >= 45 && code <= 48) return CloudFog;
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return CloudRain;
  if (code >= 71 && code <= 77) return CloudSnow;
  if (code >= 95 && code <= 99) return CloudLightning;
  return Sun;
}

export default function WeatherForecastPanel({}: PanelComponentProps) {
  const { selectedState } = useDeck();
  const { data, loading } = useStateForecast(selectedState);

  if (!selectedState) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Select a state to view forecast
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading forecast...
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        No forecast data for {selectedState}
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full p-2">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#0a0f1a]/90 backdrop-blur-sm flex items-center gap-2 px-1 py-1.5 mb-0.5 border-b border-white/[0.06]">
        <span className="text-[8px] font-mono text-white/30 w-6">DAY</span>
        <span className="text-[8px] font-mono text-white/30 w-8">DATE</span>
        <span className="text-[8px] font-mono text-white/30 w-4"></span>
        <span className="text-[8px] font-mono text-white/30 w-6 text-right">HI</span>
        <span className="text-[8px] font-mono text-white/30 w-6 text-right">LO</span>
        <span className="text-[8px] font-mono text-white/30 w-10">PRECIP</span>
        <span className="text-[8px] font-mono text-white/30 w-10">WIND</span>
      </div>
      <div className="space-y-0">
        {data.map((day, i) => {
          const d = new Date(day.date + 'T00:00:00');
          const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' }).slice(0, 3);
          const dateLabel = d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
          const Icon = weatherIcon(day.weather_code);
          const isToday = i === 0;
          return (
            <div
              key={i}
              className={`flex items-center gap-2 px-1 py-1 rounded hover:bg-white/[0.04] transition-colors ${isToday ? 'bg-cyan-400/[0.04]' : i % 2 === 1 ? 'bg-white/[0.01]' : ''}`}
            >
              <span className="text-[9px] font-mono text-white/40 w-6">{dayLabel}</span>
              <span className="text-[9px] font-mono text-white/25 w-8">{dateLabel}</span>
              <Icon size={12} className="text-cyan-400/60 shrink-0" />
              <span className="text-[10px] font-mono text-orange-400 w-6 text-right">{Math.round(day.temp_high_f)}</span>
              <span className="text-[10px] font-mono text-orange-400/50 w-6 text-right">{Math.round(day.temp_low_f)}</span>
              <div className="flex items-center gap-0.5 w-10">
                <Droplets size={8} className="text-blue-400/60" />
                <span className="text-[9px] font-mono text-blue-400/60">{day.precipitation_mm > 0 ? `${day.precipitation_mm.toFixed(0)}mm` : '-'}</span>
              </div>
              <div className="flex items-center gap-0.5 w-10">
                <Wind size={8} className="text-cyan-400/40" />
                <span className="text-[9px] font-mono text-cyan-400/40">{Math.round(day.wind_speed_max_mph)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
