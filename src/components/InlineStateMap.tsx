/**
 * Lightweight inline SVG map that highlights mentioned US states.
 * No Mapbox dependency. Pure SVG with approximate state positions.
 */

// Approximate centroids for 50 states (normalized 0-100 x/y)
const STATE_COORDS: Record<string, [number, number]> = {
  AK:[12,8], HI:[22,78], WA:[14,18], OR:[12,28], CA:[10,45],
  NV:[15,42], ID:[18,28], MT:[25,18], WY:[27,30], UT:[20,40],
  CO:[30,42], AZ:[22,55], NM:[28,55], ND:[38,18], SD:[38,25],
  NE:[40,32], KS:[42,40], OK:[45,48], TX:[42,58], MN:[45,18],
  IA:[48,28], MO:[50,38], AR:[50,48], LA:[50,58], MS:[55,52],
  WI:[50,18], IL:[55,30], IN:[58,32], MI:[58,20], OH:[62,30],
  KY:[60,38], TN:[58,42], AL:[58,50], GA:[62,50], FL:[65,60],
  SC:[65,46], NC:[66,40], VA:[68,36], WV:[64,35], PA:[70,28],
  NJ:[74,30], DE:[73,34], MD:[72,35], NY:[72,22], CT:[78,24],
  RI:[80,24], MA:[78,20], VT:[75,16], NH:[77,16], ME:[80,12],
};

const ALL_STATES = Object.keys(STATE_COORDS);

interface InlineStateMapProps {
  highlightedStates: string[];
  height?: number;
}

export default function InlineStateMap({ highlightedStates, height = 100 }: InlineStateMapProps) {
  const highlighted = new Set(highlightedStates.map(s => s.toUpperCase()));
  if (highlighted.size === 0) return null;

  const width = height * 1.6;

  return (
    <div className="flex justify-center my-3">
      <svg width={width} height={height} viewBox="0 0 100 80" className="opacity-60">
        {/* Background dots for all states */}
        {ALL_STATES.map(abbr => {
          const [x, y] = STATE_COORDS[abbr];
          const isHighlighted = highlighted.has(abbr);
          return (
            <g key={abbr}>
              <circle
                cx={x}
                cy={y}
                r={isHighlighted ? 3.5 : 1.5}
                fill={isHighlighted ? '#22d3ee' : '#ffffff'}
                opacity={isHighlighted ? 0.8 : 0.08}
              />
              {isHighlighted && (
                <>
                  <circle cx={x} cy={y} r={6} fill="#22d3ee" opacity={0.1} />
                  <text x={x} y={y - 5} textAnchor="middle" fontSize="3.5" fill="#22d3ee" opacity={0.7} fontFamily="monospace">
                    {abbr}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Extract state abbreviations mentioned in text */
export function extractStates(text: string): string[] {
  const found = new Set<string>();
  // Match 2-letter state abbreviations
  for (const abbr of ALL_STATES) {
    // Look for the abbreviation as a standalone word or in common patterns
    const patterns = [
      new RegExp(`\\b${abbr}\\b`),  // standalone
      new RegExp(`\\b${abbr}[,\\s]`), // followed by comma or space
    ];
    for (const p of patterns) {
      if (p.test(text)) {
        found.add(abbr);
        break;
      }
    }
  }
  return [...found];
}
