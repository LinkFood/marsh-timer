import { useDeck } from '@/contexts/DeckContext';
import { useSolunar } from '@/hooks/useSolunar';
import { Moon, Sunrise, Sunset, Star } from 'lucide-react';
import type { PanelComponentProps } from './PanelTypes';

// State centroids for solunar lookup
const STATE_COORDS: Record<string, [number, number]> = {
  AL:[32.8,-86.8],AK:[64.2,-153.5],AZ:[34.3,-111.7],AR:[34.8,-92.2],CA:[37.2,-119.5],
  CO:[39.0,-105.5],CT:[41.6,-72.7],DE:[39.0,-75.5],FL:[28.6,-82.4],GA:[32.7,-83.5],
  HI:[20.5,-157.4],ID:[44.4,-114.6],IL:[40.0,-89.2],IN:[39.9,-86.3],IA:[42.0,-93.5],
  KS:[38.5,-98.3],KY:[37.8,-85.7],LA:[31.1,-92.0],ME:[45.4,-69.2],MD:[39.0,-76.8],
  MA:[42.2,-71.8],MI:[43.3,-84.5],MN:[46.3,-94.3],MS:[32.7,-89.7],MO:[38.4,-92.5],
  MT:[47.0,-109.6],NE:[41.5,-99.8],NV:[39.5,-116.9],NH:[43.7,-71.6],NJ:[40.1,-74.7],
  NM:[34.5,-106.0],NY:[42.9,-75.5],NC:[35.6,-79.8],ND:[47.4,-100.5],OH:[40.4,-82.8],
  OK:[35.6,-97.5],OR:[44.0,-120.5],PA:[40.9,-77.8],RI:[41.7,-71.5],SC:[33.9,-80.9],
  SD:[44.4,-100.2],TN:[35.9,-86.4],TX:[31.5,-99.3],UT:[39.3,-111.7],VT:[44.1,-72.6],
  VA:[37.5,-78.9],WA:[47.4,-120.7],WV:[38.6,-80.6],WI:[44.6,-89.8],WY:[43.0,-107.6],
};

function formatTime(str: string | undefined): string {
  if (!str) return '--';
  // Handle ISO or HH:MM format
  if (str.includes('T')) {
    return new Date(str).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return str;
}

export default function SolunarPanel({}: PanelComponentProps) {
  const { selectedState } = useDeck();
  const coords = selectedState ? STATE_COORDS[selectedState] : null;
  const { data, isLoading } = useSolunar(coords?.[0] ?? null, coords?.[1] ?? null);

  if (!selectedState) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Select a state to view solunar data
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading solunar...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        No solunar data for {selectedState}
      </div>
    );
  }

  const solunar = data.solunar as Record<string, any>;
  const sunrise = data.sunrise as Record<string, any>;

  const moonPhase = solunar?.moonPhase ?? solunar?.moon_phase ?? 'Unknown';
  const moonIllum = solunar?.moonIllumination ?? solunar?.moon_illumination ?? 0;
  const rating = solunar?.rating ?? solunar?.overallRating ?? 0;
  const majorStart = solunar?.majorStart ?? solunar?.major_start ?? '';
  const majorEnd = solunar?.majorEnd ?? solunar?.major_end ?? '';
  const minorStart = solunar?.minorStart ?? solunar?.minor_start ?? '';
  const minorEnd = solunar?.minorEnd ?? solunar?.minor_end ?? '';
  const sunriseTime = sunrise?.sunrise ?? '';
  const sunsetTime = sunrise?.sunset ?? '';

  return (
    <div className="flex flex-col gap-3 p-3 h-full overflow-y-auto">
      <div className="text-[10px] font-mono text-white/30">
        {selectedState} - SOLUNAR
      </div>

      {/* Moon Phase */}
      <div className="flex items-center gap-3">
        <Moon size={20} className="text-yellow-300" />
        <div>
          <div className="text-xs font-mono text-white/90">{String(moonPhase)}</div>
          <div className="text-[10px] font-mono text-white/40">{Math.round(Number(moonIllum))}% illumination</div>
        </div>
      </div>

      {/* Sun times */}
      <div className="flex gap-4">
        <div className="flex items-center gap-1.5">
          <Sunrise size={12} className="text-orange-400" />
          <span className="text-[10px] font-mono text-white/70">{formatTime(sunriseTime)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Sunset size={12} className="text-orange-400/60" />
          <span className="text-[10px] font-mono text-white/70">{formatTime(sunsetTime)}</span>
        </div>
      </div>

      {/* Feeding Periods */}
      <div className="space-y-1.5">
        <div className="text-[10px] font-display tracking-widest text-white/30 uppercase">Feeding Periods</div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          <span className="text-[10px] font-mono text-white/50 w-10">Major</span>
          <span className="text-[10px] font-mono text-white/70">
            {formatTime(majorStart)} - {formatTime(majorEnd)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-cyan-400/50" />
          <span className="text-[10px] font-mono text-white/50 w-10">Minor</span>
          <span className="text-[10px] font-mono text-white/70">
            {formatTime(minorStart)} - {formatTime(minorEnd)}
          </span>
        </div>
      </div>

      {/* Rating */}
      {rating > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-white/40">Rating</span>
          <div className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map(n => (
              <Star
                key={n}
                size={10}
                className={n <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-white/10'}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
