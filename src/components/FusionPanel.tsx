const DOMAINS = [
  { key: 'weather_component', color: '#ef4444', label: 'Wx', max: 25 },
  { key: 'migration_component', color: '#3b82f6', label: 'Mig', max: 25 },
  { key: 'birdcast_component', color: '#22c55e', label: 'BC', max: 20 },
  { key: 'solunar_component', color: '#f59e0b', label: 'Sol', max: 15 },
  { key: 'water_component', color: '#06b6d4', label: 'Wtr', max: 15 },
  { key: 'pattern_component', color: '#a855f7', label: 'Pat', max: 15 },
  { key: 'photoperiod_component', color: '#6b7280', label: 'Pho', max: 10 },
  { key: 'tide_component', color: '#9ca3af', label: 'Tid', max: 10 },
] as const;

interface HistoryEntry {
  date: string;
  score: number;
  weather_component: number;
  solunar_component: number;
  migration_component: number;
  pattern_component: number;
  birdcast_component: number;
  water_component: number;
  photoperiod_component: number;
  tide_component: number;
}

interface Props {
  history: HistoryEntry[];
  state: string;
}

export default function FusionPanel({ history, state }: Props) {
  if (history.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-[10px] font-mono text-white/20 animate-pulse">Loading fusion data...</span>
      </div>
    );
  }

  // Use last 3 entries (most recent days)
  const days = history.slice(-3);
  const colCount = days.length;

  // Detect collision days (3+ domains at >=50% of their max)
  const collisions = days.map(day => {
    let active = 0;
    for (const d of DOMAINS) {
      const val = (day as Record<string, number>)[d.key] || 0;
      if (val >= d.max * 0.5) active++;
    }
    return active >= 3;
  });

  // Format date labels
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = Math.round((today.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return `${diff}d ago`;
  };

  const ROW_H = 16;
  const GAP = 1;
  const LABEL_W = 32;
  const HEADER_H = 16;
  const totalH = HEADER_H + DOMAINS.length * (ROW_H + GAP);

  return (
    <div className="h-full flex flex-col bg-[#0a0f1a] border-t border-white/[0.06] overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-3 py-1 flex items-center justify-between border-b border-white/[0.04]">
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-white/30 uppercase tracking-widest">Fusion Timeline</span>
          <span className="text-[9px] font-mono text-white/15">{state}</span>
        </div>
        <div className="flex items-center gap-3">
          {days.map((day, i) => (
            <div key={day.date} className="flex items-center gap-1">
              {collisions[i] && (
                <div className="w-1 h-1 rounded-full bg-red-400 animate-pulse" />
              )}
              <span className={`text-[8px] font-mono ${collisions[i] ? 'text-red-400/70' : 'text-white/20'}`}>
                {formatDate(day.date)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Timeline grid */}
      <div className="flex-1 px-3 py-1 overflow-hidden">
        <div className="h-full flex flex-col justify-center gap-[1px]">
          {DOMAINS.map(domain => {
            return (
              <div key={domain.key} className="flex items-center gap-1" style={{ height: ROW_H }}>
                {/* Domain label */}
                <span
                  className="text-[8px] font-mono shrink-0 text-right"
                  style={{ width: LABEL_W, color: domain.color, opacity: 0.6 }}
                >
                  {domain.label}
                </span>

                {/* Day bars */}
                <div className="flex-1 flex gap-[2px] h-full">
                  {days.map((day, dayIdx) => {
                    const val = (day as Record<string, number>)[domain.key] || 0;
                    const pct = Math.min(100, (val / domain.max) * 100);
                    const isActive = val >= domain.max * 0.5;

                    return (
                      <div
                        key={day.date}
                        className="flex-1 relative rounded-[2px] overflow-hidden"
                        style={{ backgroundColor: '#ffffff04' }}
                      >
                        {/* Fill bar */}
                        <div
                          className="absolute left-0 top-0 bottom-0 rounded-[2px] transition-all duration-700"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: domain.color,
                            opacity: isActive ? 0.7 : 0.3,
                          }}
                        />
                        {/* Value label on hover */}
                        <div
                          className="absolute inset-0 flex items-center justify-center"
                          title={`${domain.label}: ${val.toFixed(1)}/${domain.max} on ${day.date}`}
                        >
                          {val > 0 && (
                            <span className="text-[7px] font-mono text-white/30 relative z-10">
                              {Math.round(val)}
                            </span>
                          )}
                        </div>
                        {/* Collision marker */}
                        {collisions[dayIdx] && isActive && (
                          <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-red-400/40" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
