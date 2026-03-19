import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward, Rewind, FastForward } from 'lucide-react';
import Sparkline from './charts/Sparkline';
import { useConvergenceTimeline } from '@/hooks/useConvergenceTimeline';
import { useHistoryEvents } from '@/hooks/useHistoryEvents';
import type { HistoryEvent } from '@/hooks/useHistoryEvents';

interface HistoryCanvasProps {
  onDateChange: (date: Date | null) => void;
  isMobile: boolean;
  convergenceScores: Map<string, number>;
  isLoading: boolean;
}

const SPEEDS = [0.5, 1, 2, 4] as const;
const FRAME_MS_BASE = 800;
const DAYS_BACK = 30;

function getDateForOffset(offset: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (DAYS_BACK - offset));
  return d;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatDateShort(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function toDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

// --- National Convergence Timeline Chart ---
function NationalTimeline({
  dailyAverages,
  currentFrame,
  onFrameClick,
}: {
  dailyAverages: Array<{ date: string; avg: number }>;
  currentFrame: number;
  onFrameClick: (frame: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  if (dailyAverages.length < 2) {
    return (
      <div className="flex items-center justify-center h-[100px]">
        <span className="text-[10px] font-mono text-white/20">Accumulating data...</span>
      </div>
    );
  }

  const width = 600;
  const height = 100;
  const padL = 32;
  const padR = 8;
  const padT = 12;
  const padB = 20;
  const chartW = width - padL - padR;
  const chartH = height - padT - padB;

  const maxAvg = Math.max(...dailyAverages.map(d => d.avg), 1);
  const minAvg = Math.min(...dailyAverages.map(d => d.avg), 0);
  const range = maxAvg - minAvg || 1;

  function xPos(i: number): number {
    return padL + (i / (dailyAverages.length - 1)) * chartW;
  }

  function yPos(val: number): number {
    return padT + (1 - (val - minAvg) / range) * chartH;
  }

  // Build line path
  const linePath = dailyAverages
    .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xPos(i)},${yPos(d.avg)}`)
    .join(' ');

  // Fill area
  const fillPath = `${linePath} L ${xPos(dailyAverages.length - 1)},${padT + chartH} L ${xPos(0)},${padT + chartH} Z`;

  // Scrub line position — map frame to closest data point
  const scrubDate = toDateStr(getDateForOffset(currentFrame));
  const scrubIdx = dailyAverages.findIndex(d => d.date >= scrubDate);
  const scrubX = scrubIdx >= 0 ? xPos(scrubIdx) : xPos(dailyAverages.length - 1);

  // Y-axis ticks
  const yTicks = [minAvg, Math.round((minAvg + maxAvg) / 2), maxAvg];

  // X-axis labels
  const xLabels: Array<{ i: number; label: string }> = [];
  if (dailyAverages.length > 0) {
    xLabels.push({ i: 0, label: dailyAverages[0].date.slice(5) });
    if (dailyAverages.length > 2) {
      const mid = Math.floor(dailyAverages.length / 2);
      xLabels.push({ i: mid, label: dailyAverages[mid].date.slice(5) });
    }
    xLabels.push({ i: dailyAverages.length - 1, label: dailyAverages[dailyAverages.length - 1].date.slice(5) });
  }

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgWidth = rect.width;
    const clickX = e.clientX - rect.left;
    // Map click position to chart area
    const pctOfChart = (clickX / svgWidth * width - padL) / chartW;
    const clampedPct = Math.max(0, Math.min(1, pctOfChart));
    const newFrame = Math.round(clampedPct * DAYS_BACK);
    onFrameClick(newFrame);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      className="w-full cursor-pointer"
      style={{ height: '100px' }}
      onClick={handleClick}
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

      {/* Fill */}
      <path d={fillPath} fill="#22d3ee" opacity={0.08} />

      {/* Line */}
      <path d={linePath} fill="none" stroke="#22d3ee" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />

      {/* Current value dot */}
      {scrubIdx >= 0 && (
        <circle
          cx={xPos(scrubIdx)}
          cy={yPos(dailyAverages[scrubIdx].avg)}
          r={3}
          fill="#22d3ee"
        />
      )}

      {/* Scrub line */}
      <line
        x1={scrubX}
        x2={scrubX}
        y1={padT}
        y2={padT + chartH}
        stroke="#22d3ee"
        strokeWidth={1}
        strokeDasharray="3 2"
        opacity={0.7}
      />

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
          {Math.round(tick)}
        </text>
      ))}

      {/* X-axis labels */}
      {xLabels.map(({ i, label }) => (
        <text
          key={i}
          x={xPos(i)}
          y={height - 4}
          textAnchor={i === 0 ? 'start' : i === dailyAverages.length - 1 ? 'end' : 'middle'}
          fill="rgba(255,255,255,0.3)"
          fontSize={9}
          fontFamily="monospace"
        >
          {label}
        </text>
      ))}

      {/* Score label at scrub */}
      {scrubIdx >= 0 && (
        <text
          x={scrubX + 4}
          y={padT + 10}
          fill="#22d3ee"
          fontSize={10}
          fontFamily="monospace"
          opacity={0.9}
        >
          {dailyAverages[scrubIdx].avg}
        </text>
      )}
    </svg>
  );
}

// --- Top Movers Panel ---
function TopMovers({
  movers,
}: {
  movers: Array<{ state: string; change: number; sparkline: number[] }>;
}) {
  if (movers.length === 0) {
    return (
      <div className="flex items-center justify-center py-2">
        <span className="text-[10px] font-mono text-white/20">No mover data</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 overflow-x-auto py-1 px-1">
      {movers.map(m => {
        const isUp = m.change >= 0;
        return (
          <div
            key={m.state}
            className="flex items-center gap-1.5 flex-shrink-0 px-2 py-1 rounded bg-white/[0.03] border border-white/[0.06]"
          >
            <span className="text-[11px] font-mono font-bold text-white/80">{m.state}</span>
            <span
              className={`text-[10px] font-mono font-bold ${
                isUp ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {isUp ? '\u25B2' : '\u25BC'}{Math.abs(m.change)}
            </span>
            <Sparkline
              data={m.sparkline}
              width={48}
              height={16}
              color={isUp ? '#4ade80' : '#f87171'}
              strokeWidth={1}
            />
          </div>
        );
      })}
    </div>
  );
}

// --- Event Timeline Strip ---
function EventTimeline({
  events,
  dailyAverages,
  currentFrame,
}: {
  events: HistoryEvent[];
  dailyAverages: Array<{ date: string; avg: number }>;
  currentFrame: number;
}) {
  const [hoveredEvent, setHoveredEvent] = useState<HistoryEvent | null>(null);
  const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });
  const stripRef = useRef<HTMLDivElement>(null);

  if (dailyAverages.length < 2 || events.length === 0) {
    return null;
  }

  const startDate = dailyAverages[0].date;
  const endDate = dailyAverages[dailyAverages.length - 1].date;

  // Deduplicate: max 3 events per day to avoid clutter
  const byDate = new Map<string, HistoryEvent[]>();
  for (const ev of events) {
    if (ev.date < startDate || ev.date > endDate) continue;
    const arr = byDate.get(ev.date) || [];
    if (arr.length < 3) arr.push(ev);
    byDate.set(ev.date, arr);
  }

  const startMs = new Date(startDate).getTime();
  const endMs = new Date(endDate).getTime();
  const rangeMs = endMs - startMs || 1;

  const severityColor = {
    high: '#f87171',
    medium: '#fbbf24',
    low: '#22d3ee',
  };

  const handleMouseEnter = (ev: HistoryEvent, e: React.MouseEvent) => {
    setHoveredEvent(ev);
    if (stripRef.current) {
      const rect = stripRef.current.getBoundingClientRect();
      setHoverPos({ x: e.clientX - rect.left, y: -4 });
    }
  };

  const handleMouseLeave = () => {
    setHoveredEvent(null);
  };

  return (
    <div ref={stripRef} className="relative h-4 mt-1">
      {/* Background track */}
      <div className="absolute inset-0 rounded-full bg-white/[0.03]" />

      {/* Event dots */}
      {Array.from(byDate.entries()).map(([date, evts]) => {
        const dateMs = new Date(date).getTime();
        const pct = ((dateMs - startMs) / rangeMs) * 100;

        return evts.map((ev, i) => (
          <div
            key={`${date}-${i}`}
            className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full cursor-pointer transition-transform hover:scale-150"
            style={{
              left: `${pct}%`,
              backgroundColor: severityColor[ev.severity],
              opacity: ev.severity === 'high' ? 0.9 : ev.severity === 'medium' ? 0.7 : 0.5,
              marginTop: `${(i - 1) * 3}px`,
            }}
            onMouseEnter={(e) => handleMouseEnter(ev, e)}
            onMouseLeave={handleMouseLeave}
          />
        ));
      })}

      {/* Scrub position indicator */}
      {(() => {
        const scrubDate = toDateStr(getDateForOffset(currentFrame));
        const scrubMs = new Date(scrubDate).getTime();
        const scrubPct = Math.max(0, Math.min(100, ((scrubMs - startMs) / rangeMs) * 100));
        return (
          <div
            className="absolute top-0 bottom-0 w-px bg-cyan-400/50"
            style={{ left: `${scrubPct}%` }}
          />
        );
      })()}

      {/* Hover tooltip */}
      {hoveredEvent && (
        <div
          className="absolute bottom-full mb-2 z-30 glass-panel rounded-lg px-2 py-1.5 border border-white/[0.08] max-w-[200px] pointer-events-none"
          style={{ left: `${Math.min(hoverPos.x, 160)}px` }}
        >
          <p className="text-[9px] font-mono text-white/80 leading-tight truncate">
            {hoveredEvent.title}
          </p>
          <p className="text-[8px] font-mono text-white/40 leading-tight mt-0.5 line-clamp-2">
            {hoveredEvent.content}
          </p>
        </div>
      )}
    </div>
  );
}

// --- Main Component ---
export default function HistoryCanvas({
  onDateChange,
  isMobile,
  convergenceScores,
  isLoading,
}: HistoryCanvasProps) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const speed = SPEEDS[speedIdx];

  const { dailyAverages, getTopMovers, loading: timelineLoading } = useConvergenceTimeline(DAYS_BACK);
  const { events } = useHistoryEvents(DAYS_BACK);

  const currentDate = useMemo(() => getDateForOffset(frame), [frame]);
  const isToday = frame === DAYS_BACK;

  // Emit date changes
  useEffect(() => {
    onDateChange(isToday ? null : currentDate);
  }, [currentDate, isToday, onDateChange]);

  // Playback loop
  useEffect(() => {
    if (!playing) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const interval = FRAME_MS_BASE / speed;
    timerRef.current = setTimeout(() => {
      setFrame(f => {
        if (f >= DAYS_BACK) {
          setPlaying(false);
          return DAYS_BACK;
        }
        return f + 1;
      });
    }, interval);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [playing, frame, speed]);

  // Cleanup — reset to live on unmount
  useEffect(() => {
    return () => onDateChange(null);
  }, [onDateChange]);

  const handlePlay = useCallback(() => {
    if (frame >= DAYS_BACK) setFrame(0);
    setPlaying(true);
  }, [frame]);

  const handlePause = useCallback(() => setPlaying(false), []);

  const handleSkipBack = useCallback(() => {
    setPlaying(false);
    setFrame(0);
  }, []);

  const handleSkipForward = useCallback(() => {
    setPlaying(false);
    setFrame(DAYS_BACK);
  }, []);

  const handleStepBack = useCallback(() => {
    setPlaying(false);
    setFrame(f => Math.max(0, f - 1));
  }, []);

  const handleStepForward = useCallback(() => {
    setPlaying(false);
    setFrame(f => Math.min(DAYS_BACK, f + 1));
  }, []);

  const cycleSpeed = useCallback(() => {
    setSpeedIdx(i => (i + 1) % SPEEDS.length);
  }, []);

  const handleChartClick = useCallback((newFrame: number) => {
    setPlaying(false);
    setFrame(Math.max(0, Math.min(DAYS_BACK, newFrame)));
  }, []);

  const trackRef = useRef<HTMLDivElement>(null);
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setPlaying(false);
    setFrame(Math.round(pct * DAYS_BACK));
  }, []);

  // Top movers: compare day 0 to current scrub date
  const topMovers = useMemo(() => {
    if (dailyAverages.length < 2) return [];
    const fromDate = dailyAverages[0].date;
    const scrubDate = toDateStr(getDateForOffset(frame));
    // Find closest available date
    let toDate = dailyAverages[dailyAverages.length - 1].date;
    for (const da of dailyAverages) {
      if (da.date >= scrubDate) {
        toDate = da.date;
        break;
      }
    }
    return getTopMovers(fromDate, toDate);
  }, [dailyAverages, frame, getTopMovers]);

  const scoreCount = convergenceScores.size;
  const avgScore = useMemo(() => {
    if (scoreCount === 0) return 0;
    let total = 0;
    convergenceScores.forEach(s => { total += s; });
    return Math.round(total / scoreCount);
  }, [convergenceScores, scoreCount]);

  const ticks = useMemo(() => {
    const t: Array<{ offset: number; label: string }> = [];
    for (let i = 0; i <= DAYS_BACK; i += 7) {
      t.push({ offset: i, label: formatDateShort(getDateForOffset(i)) });
    }
    return t;
  }, []);

  return (
    <div
      className={`fixed z-20 ${
        isMobile
          ? 'left-3 right-3 bottom-14'
          : 'left-[336px] right-4 bottom-4'
      }`}
    >
      {/* National Convergence Timeline */}
      <div className="glass-panel rounded-xl border border-white/[0.06] px-3 py-2 mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
            National Convergence
          </span>
          {timelineLoading && (
            <span className="text-[9px] font-mono text-cyan-400/50 animate-pulse">loading...</span>
          )}
        </div>
        <NationalTimeline
          dailyAverages={dailyAverages}
          currentFrame={frame}
          onFrameClick={handleChartClick}
        />

        {/* Event Timeline Strip */}
        <div className="mt-1">
          <EventTimeline
            events={events}
            dailyAverages={dailyAverages}
            currentFrame={frame}
          />
        </div>
      </div>

      {/* Top Movers */}
      <div className="glass-panel rounded-xl border border-white/[0.06] px-3 py-2 mb-2">
        <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
          Top Movers
        </span>
        <TopMovers movers={topMovers} />
      </div>

      {/* Date + stats banner */}
      <div className="flex items-center justify-between mb-2">
        <div className="glass-panel rounded-lg px-3 py-1.5 border border-white/[0.06]">
          <span className="text-lg font-mono text-white/90">
            {formatDate(currentDate)}
          </span>
          {isLoading && (
            <span className="text-[10px] text-cyan-400/60 animate-pulse ml-2">loading...</span>
          )}
        </div>
        <div className="glass-panel rounded-lg px-3 py-1.5 border border-white/[0.06] flex items-center gap-3">
          <span className="text-[10px] font-mono text-white/40">{scoreCount} states</span>
          <span className="text-[10px] font-mono text-white/50">avg {avgScore}</span>
          {!isToday && (
            <span className="text-[10px] font-mono text-cyan-400/70">{DAYS_BACK - frame}d ago</span>
          )}
          {isToday && (
            <span className="text-[10px] font-mono text-green-400/70">LIVE</span>
          )}
        </div>
      </div>

      {/* Main control bar */}
      <div className="glass-panel rounded-xl border border-white/[0.06] px-4 py-3">
        {/* Controls row */}
        <div className="flex items-center justify-center gap-2 mb-3">
          <button onClick={handleSkipBack} className="p-1.5 text-white/30 hover:text-white/60 transition-colors">
            <SkipBack size={14} />
          </button>
          <button onClick={handleStepBack} className="p-1.5 text-white/30 hover:text-white/60 transition-colors">
            <Rewind size={14} />
          </button>
          <button
            onClick={playing ? handlePause : handlePlay}
            className="p-2.5 rounded-full bg-cyan-400/20 text-cyan-400 hover:bg-cyan-400/30 transition-colors"
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button onClick={handleStepForward} className="p-1.5 text-white/30 hover:text-white/60 transition-colors">
            <FastForward size={14} />
          </button>
          <button onClick={handleSkipForward} className="p-1.5 text-white/30 hover:text-white/60 transition-colors">
            <SkipForward size={14} />
          </button>
          <button
            onClick={cycleSpeed}
            className="ml-2 px-2 py-0.5 rounded bg-white/[0.05] border border-white/[0.08] text-[10px] font-mono text-white/50 hover:text-white/70 transition-colors"
          >
            {speed}x
          </button>
        </div>

        {/* Timeline track */}
        <div className="relative">
          {/* Tick labels */}
          <div className="relative h-3 mb-1">
            {ticks.map(t => (
              <span
                key={t.offset}
                className="absolute text-[8px] font-mono text-white/20 -translate-x-1/2"
                style={{ left: `${(t.offset / DAYS_BACK) * 100}%` }}
              >
                {t.label}
              </span>
            ))}
          </div>

          {/* Track bar */}
          <div
            ref={trackRef}
            className="relative h-1.5 rounded-full bg-white/[0.06] cursor-pointer"
            onClick={handleTrackClick}
          >
            <div
              className="absolute top-0 left-0 h-full rounded-full bg-cyan-400/40 transition-[width] duration-100"
              style={{ width: `${(frame / DAYS_BACK) * 100}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-cyan-400 shadow-lg shadow-cyan-400/30 transition-[left] duration-100"
              style={{ left: `calc(${(frame / DAYS_BACK) * 100}% - 6px)` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
