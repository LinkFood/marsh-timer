import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Play, Pause, SkipBack, SkipForward, Rewind, FastForward } from 'lucide-react';

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

  const trackRef = useRef<HTMLDivElement>(null);
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setPlaying(false);
    setFrame(Math.round(pct * DAYS_BACK));
  }, []);

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

  // Floating control panel — map is visible behind
  return (
    <div
      className={`fixed z-20 ${
        isMobile
          ? 'left-3 right-3 bottom-14'
          : 'left-[336px] right-4 bottom-4'
      }`}
    >
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
