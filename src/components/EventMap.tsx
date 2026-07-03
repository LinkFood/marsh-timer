import { useMemo } from 'react';
import { STATE_COORDS } from './InlineStateMap';
import { getStateName } from '@/hooks/useUserLocation';
import type { EventCategory, StateEvents } from '@/hooks/useTodayEventMap';

/**
 * EventMap — tappable dependency-free SVG US map, colored by TODAY'S REAL
 * EVENTS only. Amber = statistical anomalies, teal = radar bird spikes,
 * red = NWS alerts / storm events. Intensity scales with event count.
 * Never renders convergence scores. Tap a state to make it the page context.
 */

const CATEGORY_COLOR: Record<EventCategory, string> = {
  anomaly: '#fbbf24', // amber-400
  birds: '#2dd4bf',   // teal-400
  weather: '#f87171', // red-400
};

function dominant(ev: StateEvents): EventCategory {
  if (ev.weather >= ev.anomaly && ev.weather >= ev.birds) return 'weather';
  if (ev.anomaly >= ev.birds) return 'anomaly';
  return 'birds';
}

interface EventMapProps {
  byState: Record<string, StateEvents>;
  loading: boolean;
  quiet: boolean;
  selectedState: string;
  onSelectState: (abbr: string) => void;
}

export default function EventMap({ byState, loading, quiet, selectedState, onSelectState }: EventMapProps) {
  // Legend: live counts of states per category
  const legend = useMemo(() => {
    let anomaly = 0, birds = 0, weather = 0;
    for (const ev of Object.values(byState)) {
      if (ev.anomaly > 0) anomaly++;
      if (ev.birds > 0) birds++;
      if (ev.weather > 0) weather++;
    }
    const parts: { color: string; text: string }[] = [];
    if (anomaly > 0) parts.push({ color: CATEGORY_COLOR.anomaly, text: `${anomaly} state${anomaly === 1 ? '' : 's'} with anomalies` });
    if (birds > 0) parts.push({ color: CATEGORY_COLOR.birds, text: `${birds} state${birds === 1 ? '' : 's'} with bird spikes` });
    if (weather > 0) parts.push({ color: CATEGORY_COLOR.weather, text: `${weather} under NWS or storm alerts` });
    return parts;
  }, [byState]);

  return (
    <div>
      <svg viewBox="0 0 100 80" className="w-full h-auto" role="group" aria-label="US map of today's events">
        {Object.entries(STATE_COORDS).map(([abbr, [x, y]]) => {
          const ev = byState[abbr];
          const isSelected = abbr === selectedState;
          const intensity = ev ? Math.min(ev.total, 6) : 0;
          const color = ev ? CATEGORY_COLOR[dominant(ev)] : '#1f2937'; // gray-800 baseline
          const title = ev
            ? `${getStateName(abbr)} — ${ev.anomaly ? `${ev.anomaly} anomaly, ` : ''}${ev.birds ? `${ev.birds} bird spike, ` : ''}${ev.weather ? `${ev.weather} weather event, ` : ''}`.replace(/, $/, '')
            : getStateName(abbr);
          return (
            <g
              key={abbr}
              onClick={() => onSelectState(abbr)}
              className="cursor-pointer"
              role="button"
              aria-label={title}
            >
              <title>{title}</title>
              {/* invisible tap target */}
              <circle cx={x} cy={y} r={4.5} fill="transparent" />
              {isSelected && <circle cx={x} cy={y} r={4} fill="none" stroke="#22d3ee" strokeWidth={0.5} opacity={0.8} />}
              {ev && <circle cx={x} cy={y} r={3 + intensity * 0.6} fill={color} opacity={0.1 + intensity * 0.03} />}
              <circle
                cx={x}
                cy={y}
                r={ev ? 1.8 + intensity * 0.3 : 1.4}
                fill={color}
                opacity={ev ? 0.55 + intensity * 0.07 : 0.35}
              />
              {ev && (
                <text x={x} y={y - (3.2 + intensity * 0.4)} textAnchor="middle" fontSize="3" fill={color} opacity={0.85} fontFamily="monospace">
                  {abbr}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {loading ? (
        <p className="mt-2 text-[10px] font-mono text-white/25 text-center">Reading today's layers...</p>
      ) : quiet ? (
        <p className="mt-2 text-[11px] font-body text-white/40 text-center italic">A quiet day across the layers.</p>
      ) : (
        <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
          {legend.map(item => (
            <span key={item.text} className="flex items-center gap-1.5 text-[10px] font-mono text-white/45">
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: item.color }} />
              {item.text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
