import { useMemo } from 'react';
import { getStateName } from '@/hooks/useUserLocation';
import type { EventCategory, StateEvents } from '@/hooks/useTodayEventMap';

/**
 * EventMap — tile-grid US map. Each state is a rounded square in the classic
 * geographic grid arrangement, so the whole thing reads as AMERICA at a glance.
 *
 * Baseline fill: subtle gray→slate ramp by how many entries the archive
 * ingested TODAY for that state. Event overlays keep the category colors:
 * amber = statistical anomalies, teal = radar bird spikes, red = NWS alerts /
 * storm events. Count badge on tiles with >1 event. Never renders convergence
 * scores. Tap a state to make it the page context.
 */

const CATEGORY_COLOR: Record<EventCategory, string> = {
  anomaly: '#fbbf24', // amber-400
  birds: '#2dd4bf',   // teal-400
  weather: '#f87171', // red-400
};

// Classic tile-grid layout — [col, row]. ME top right, FL bottom right,
// AK/HI bottom left. 11 columns × 8 rows. Exported for static mini-map reuse.
export const TILE_GRID: Record<string, [number, number]> = {
  ME: [10, 0],
  VT: [9, 1], NH: [10, 1],
  WA: [0, 2], ID: [1, 2], MT: [2, 2], ND: [3, 2], MN: [4, 2], WI: [5, 2], MI: [7, 2], NY: [8, 2], MA: [9, 2], RI: [10, 2],
  OR: [0, 3], NV: [1, 3], WY: [2, 3], SD: [3, 3], IA: [4, 3], IL: [5, 3], IN: [6, 3], OH: [7, 3], PA: [8, 3], NJ: [9, 3], CT: [10, 3],
  CA: [0, 4], UT: [1, 4], CO: [2, 4], NE: [3, 4], MO: [4, 4], KY: [5, 4], WV: [6, 4], VA: [7, 4], MD: [8, 4], DE: [9, 4],
  AZ: [1, 5], NM: [2, 5], KS: [3, 5], AR: [4, 5], TN: [5, 5], NC: [6, 5], SC: [7, 5],
  OK: [3, 6], LA: [4, 6], MS: [5, 6], AL: [6, 6], GA: [7, 6],
  AK: [0, 7], HI: [1, 7], TX: [3, 7], FL: [8, 7],
};

export const CELL = 10;
export const PITCH = 11.2;
export const VIEW_W = 10 * PITCH + CELL;      // 11 columns
export const VIEW_H = 7 * PITCH + CELL;       // 8 rows

// Activity ramp: gray-800 → slate-600
const RAMP_LO: [number, number, number] = [31, 41, 55];
const RAMP_HI: [number, number, number] = [71, 85, 105];

function rampColor(ratio: number): string {
  const [r, g, b] = RAMP_LO.map((lo, i) => Math.round(lo + (RAMP_HI[i] - lo) * ratio));
  return `rgb(${r} ${g} ${b})`;
}

function dominant(ev: StateEvents): EventCategory {
  if (ev.weather >= ev.anomaly && ev.weather >= ev.birds) return 'weather';
  if (ev.anomaly >= ev.birds) return 'anomaly';
  return 'birds';
}

interface EventMapProps {
  byState: Record<string, StateEvents>;
  activityByState: Record<string, number>;
  loading: boolean;
  quiet: boolean;
  selectedState: string;
  onSelectState: (abbr: string) => void;
}

export default function EventMap({ byState, activityByState, loading, quiet, selectedState, onSelectState }: EventMapProps) {
  const maxActivity = useMemo(() => {
    let max = 0;
    for (const abbr of Object.keys(TILE_GRID)) max = Math.max(max, activityByState[abbr] ?? 0);
    return max;
  }, [activityByState]);

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
      <svg viewBox={`-0.5 -0.5 ${VIEW_W + 1} ${VIEW_H + 1}`} className="w-full h-auto" role="group" aria-label="US tile map of today's archive activity and events">
        {Object.entries(TILE_GRID).map(([abbr, [col, row]]) => {
          const x = col * PITCH;
          const y = row * PITCH;
          const ev = byState[abbr];
          const isSelected = abbr === selectedState;
          const activity = activityByState[abbr] ?? 0;
          const ratio = maxActivity > 0 ? Math.sqrt(activity / maxActivity) : 0;
          const baseFill = rampColor(ratio);
          const evColor = ev ? CATEGORY_COLOR[dominant(ev)] : null;
          const title = ev
            ? `${getStateName(abbr)} — ${ev.anomaly ? `${ev.anomaly} anomaly, ` : ''}${ev.birds ? `${ev.birds} bird spike, ` : ''}${ev.weather ? `${ev.weather} weather event, ` : ''}`.replace(/, $/, '')
            : `${getStateName(abbr)}${activity > 0 ? ` — ${activity} entr${activity === 1 ? 'y' : 'ies'} ingested today` : ''}`;
          return (
            <g
              key={abbr}
              onClick={() => onSelectState(abbr)}
              className="cursor-pointer"
              role="button"
              aria-label={title}
            >
              <title>{title}</title>
              <rect x={x} y={y} width={CELL} height={CELL} rx={1.8} fill={baseFill} />
              {evColor && (
                <rect x={x} y={y} width={CELL} height={CELL} rx={1.8} fill={evColor} opacity={0.22} stroke={evColor} strokeWidth={0.6} strokeOpacity={0.9} />
              )}
              {isSelected && (
                <rect x={x - 0.6} y={y - 0.6} width={CELL + 1.2} height={CELL + 1.2} rx={2.4} fill="none" stroke="#22d3ee" strokeWidth={0.8} />
              )}
              <text
                x={x + CELL / 2}
                y={y + CELL / 2}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="3.7"
                fontFamily="ui-monospace, monospace"
                fill={isSelected ? '#22d3ee' : evColor ? '#f3f4f6' : '#9ca3af'}
                opacity={isSelected || evColor ? 0.95 : 0.7}
              >
                {abbr}
              </text>
              {ev && ev.total > 1 && (
                <g>
                  <circle cx={x + CELL} cy={y} r={2.3} fill={evColor!} />
                  <text x={x + CELL} y={y + 0.1} textAnchor="middle" dominantBaseline="central" fontSize="2.8" fontWeight="bold" fontFamily="ui-monospace, monospace" fill="#0a0f1a">
                    {Math.min(ev.total, 9)}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {loading ? (
        <p className="mt-2 text-[10px] font-mono text-white/25 text-center">Reading today's layers...</p>
      ) : (
        <div className="mt-2.5 space-y-1.5">
          {quiet ? (
            <p className="text-[11px] font-body text-white/40 text-center italic">A quiet day across the layers.</p>
          ) : (
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
              {legend.map(item => (
                <span key={item.text} className="flex items-center gap-1.5 text-[10px] font-mono text-white/45">
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: item.color }} />
                  {item.text}
                </span>
              ))}
            </div>
          )}
          <p className="text-[9px] font-mono text-white/25 text-center">
            shading = entries ingested today · colors = events
          </p>
        </div>
      )}
    </div>
  );
}
