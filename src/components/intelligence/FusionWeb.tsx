const DM: Record<string, { c: string; l: string; i: string; m: number }> = {
  weather: { c: '#f87171', l: 'Weather', i: 'W', m: 25 },
  migration: { c: '#60a5fa', l: 'Migration', i: 'M', m: 25 },
  birdcast: { c: '#34d399', l: 'BirdCast', i: 'B', m: 20 },
  solunar: { c: '#fbbf24', l: 'Solunar', i: 'S', m: 15 },
  water: { c: '#38bdf8', l: 'Water', i: 'H', m: 15 },
  pattern: { c: '#c084fc', l: 'Pattern', i: 'P', m: 15 },
  photo: { c: '#94a3b8', l: 'Photo', i: 'L', m: 10 },
  tide: { c: '#67e8f9', l: 'Tide', i: 'T', m: 10 },
};

export { DM };

interface FusionWebProps {
  domains: Record<string, number>;
}

export default function FusionWeb({ domains }: FusionWebProps) {
  const active = Object.entries(domains).filter(([, v]) => v > 0);
  const cx = 95, cy = 80, r = 58;
  const total = Object.values(domains).reduce((s, v) => s + v, 0);

  return (
    <svg width="190" height="160" style={{ overflow: 'visible' }}>
      <defs>
        <radialGradient id="fusion-glow">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r + 12} fill="url(#fusion-glow)" />
      {active.map(([k, v], i) => {
        const a = (i / active.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        const dm = DM[k];
        if (!dm) return null;
        const pct = v / dm.m;
        return (
          <g key={k}>
            <line
              x1={cx} y1={cy} x2={x} y2={y}
              stroke={dm.c}
              strokeWidth={1 + pct * 2}
              opacity={0.25 + pct * 0.5}
              strokeDasharray={pct > 0.7 ? 'none' : '3 2'}
            >
              <animate
                attributeName="opacity"
                values={`${0.2 + pct * 0.3};${0.5 + pct * 0.5};${0.2 + pct * 0.3}`}
                dur={`${2 + i * 0.3}s`}
                repeatCount="indefinite"
              />
            </line>
            <circle cx={x} cy={y} r={2.5 + pct * 2} fill={dm.c} opacity={0.6 + pct * 0.4} />
            <text
              x={x} y={y + (y > cy ? 12 : -9)}
              textAnchor="middle" fontSize="7" fontFamily="monospace"
              fill={dm.c} opacity="0.65"
            >
              {dm.l}
            </text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={12} fill="#030712" stroke="#22d3ee" strokeWidth="1.5" />
      <text
        x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
        fontSize="10" fontFamily="monospace" fontWeight="bold" fill="#22d3ee"
      >
        {total}
      </text>
    </svg>
  );
}
