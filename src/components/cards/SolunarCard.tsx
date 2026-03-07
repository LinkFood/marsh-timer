import { Moon } from 'lucide-react';

interface SolunarCardProps {
  data: Record<string, unknown>;
}

export default function SolunarCard({ data }: SolunarCardProps) {
  const moonPhase = data.moon_phase as string | undefined;
  const moonIllumination = data.moon_illumination as number | undefined;
  const majorTimes = data.major_times as string[] | undefined;
  const minorTimes = data.minor_times as string[] | undefined;
  const sunrise = data.sunrise as string | undefined;
  const sunset = data.sunset as string | undefined;
  const rating = data.rating as number | undefined;

  return (
    <div className="rounded-lg bg-purple-950/30 border border-purple-500/20 p-2.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Moon size={12} className="text-purple-400" />
        <span className="text-[10px] font-semibold text-purple-300 uppercase tracking-wider">Solunar</span>
        {rating !== undefined && (
          <span className="text-[9px] font-bold text-purple-300 ml-auto">
            {Array.from({ length: 5 }, (_, i) => i < Math.min(rating, 5) ? '\u2605' : '\u2606').join('')}
          </span>
        )}
      </div>
      {moonPhase && (
        <p className="text-[10px] text-foreground">
          {moonPhase} {moonIllumination !== undefined && `(${moonIllumination}%)`}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 mt-1.5">
        {majorTimes && majorTimes.length > 0 && (
          <div>
            <p className="text-[9px] text-muted-foreground font-semibold">Major</p>
            {majorTimes.map((t, i) => (
              <p key={i} className="text-[10px] text-foreground">{t}</p>
            ))}
          </div>
        )}
        {minorTimes && minorTimes.length > 0 && (
          <div>
            <p className="text-[9px] text-muted-foreground font-semibold">Minor</p>
            {minorTimes.map((t, i) => (
              <p key={i} className="text-[10px] text-foreground">{t}</p>
            ))}
          </div>
        )}
      </div>
      {(sunrise || sunset) && (
        <div className="flex gap-3 mt-1.5 text-[10px] text-muted-foreground">
          {sunrise && <span>Sunrise: {sunrise}</span>}
          {sunset && <span>Sunset: {sunset}</span>}
        </div>
      )}
    </div>
  );
}
