interface StackedAreaProps {
  data: Array<{
    label: string;
    values: Record<string, number>;
  }>;
  keys: string[];
  colors: Record<string, string>;
  width?: number;
  height?: number;
  className?: string;
}

export default function StackedArea({
  data,
  keys,
  colors,
  width = 400,
  height = 160,
  className = '',
}: StackedAreaProps) {
  if (data.length < 2) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ width, height }}>
        <span className="text-[10px] text-white/20">Accumulating data...</span>
      </div>
    );
  }

  const padL = 28;
  const padR = 8;
  const padT = 8;
  const padB = 20;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  // Compute stacked totals
  const stacked = data.map(d => {
    let cum = 0;
    const layers: Record<string, { y0: number; y1: number }> = {};
    for (const key of keys) {
      const val = d.values[key] ?? 0;
      layers[key] = { y0: cum, y1: cum + val };
      cum += val;
    }
    return { label: d.label, layers, total: cum };
  });

  const maxTotal = Math.max(...stacked.map(s => s.total), 1);

  function xPos(i: number): number {
    return padL + (i / (data.length - 1)) * chartW;
  }

  function yPos(val: number): number {
    return padT + (1 - val / maxTotal) * chartH;
  }

  // Build paths for each layer (bottom to top)
  const paths = keys.map(key => {
    const topPoints = stacked.map((s, i) => `${xPos(i)},${yPos(s.layers[key].y1)}`);
    const bottomPoints = [...stacked].reverse().map((s, i) => `${xPos(data.length - 1 - i)},${yPos(s.layers[key].y0)}`);
    return `M ${topPoints.join(' L ')} L ${bottomPoints.join(' L ')} Z`;
  });

  // Y-axis labels
  const yTicks = [0, Math.round(maxTotal / 2), maxTotal];

  // X-axis labels (show first, middle, last)
  const xLabels: Array<{ i: number; label: string }> = [];
  if (data.length > 0) {
    xLabels.push({ i: 0, label: data[0].label });
    if (data.length > 2) {
      const mid = Math.floor(data.length / 2);
      xLabels.push({ i: mid, label: data[mid].label });
    }
    xLabels.push({ i: data.length - 1, label: data[data.length - 1].label });
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
    >
      {/* Grid lines */}
      {yTicks.map(tick => (
        <line
          key={tick}
          x1={padL}
          x2={width - padR}
          y1={yPos(tick)}
          y2={yPos(tick)}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={0.5}
        />
      ))}

      {/* Stacked areas */}
      {paths.map((d, i) => (
        <path
          key={keys[i]}
          d={d}
          fill={colors[keys[i]] || '#22d3ee'}
          opacity={0.6}
          stroke={colors[keys[i]] || '#22d3ee'}
          strokeWidth={0.5}
        />
      ))}

      {/* Y-axis labels */}
      {yTicks.map(tick => (
        <text
          key={tick}
          x={padL - 4}
          y={yPos(tick) + 3}
          textAnchor="end"
          fill="rgba(255,255,255,0.3)"
          fontSize={9}
          fontFamily="monospace"
        >
          {tick}
        </text>
      ))}

      {/* X-axis labels */}
      {xLabels.map(({ i, label }) => (
        <text
          key={i}
          x={xPos(i)}
          y={height - 4}
          textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
          fill="rgba(255,255,255,0.3)"
          fontSize={9}
          fontFamily="monospace"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}
