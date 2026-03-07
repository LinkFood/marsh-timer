import { Cloud, Wind, Droplets } from 'lucide-react';

interface WeatherCardProps {
  data: Record<string, unknown>;
}

export default function WeatherCard({ data }: WeatherCardProps) {
  const temp = data.temp as number | undefined;
  const wind = data.wind_speed as number | undefined;
  const precip = data.precipitation as number | undefined;
  const description = data.description as string | undefined;
  const forecast = data.forecast as Array<{ day: string; high: number; low: number; condition: string }> | undefined;

  return (
    <div className="rounded-lg bg-blue-950/30 border border-blue-500/20 p-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Cloud size={12} className="text-blue-400" />
        <span className="text-[10px] font-semibold text-blue-300 uppercase tracking-wider">Weather</span>
      </div>
      {temp !== undefined && (
        <p className="text-sm font-bold text-foreground">{Math.round(temp)}°F</p>
      )}
      {description && (
        <p className="text-[10px] text-muted-foreground">{description}</p>
      )}
      <div className="flex gap-3 mt-1.5">
        {wind !== undefined && (
          <div className="flex items-center gap-1">
            <Wind size={10} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">{Math.round(wind)} mph</span>
          </div>
        )}
        {precip !== undefined && (
          <div className="flex items-center gap-1">
            <Droplets size={10} className="text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">{precip}%</span>
          </div>
        )}
      </div>
      {forecast && forecast.length > 0 && (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          {forecast.slice(0, 3).map((day, i) => (
            <div key={i} className="text-center">
              <p className="text-[9px] text-muted-foreground">{day.day}</p>
              <p className="text-[10px] font-semibold">{day.high}/{day.low}</p>
              <p className="text-[9px] text-muted-foreground">{day.condition}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
