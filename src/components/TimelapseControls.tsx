import { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, X } from 'lucide-react';

interface TimelapseControlsProps {
  dates: string[];
  getAvgForDate: (date: string) => number;
  currentIndex: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

export default function TimelapseControls({
  dates,
  getAvgForDate,
  currentIndex,
  onIndexChange,
  onClose,
}: TimelapseControlsProps) {
  const [playing, setPlaying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexRef = useRef(currentIndex);
  const total = dates.length;

  // Keep ref in sync
  indexRef.current = currentIndex;

  // Auto-advance playback
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!playing || total === 0) return;

    timerRef.current = setInterval(() => {
      const next = indexRef.current + 1;
      if (next >= total) {
        setPlaying(false);
        return;
      }
      onIndexChange(next);
    }, 500);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, total, onIndexChange]);

  const togglePlay = useCallback(() => {
    if (currentIndex >= total - 1) {
      // Reset to start if at end
      onIndexChange(0);
    }
    setPlaying(p => !p);
  }, [currentIndex, total, onIndexChange]);

  if (total === 0) return null;

  const current = dates[currentIndex] || dates[0];
  const avg = getAvgForDate(current);
  const dateLabel = new Date(current + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 glass-panel rounded-lg px-4 py-2 border border-white/[0.06] flex items-center gap-3 backdrop-blur-md bg-black/60 select-none">
      <button
        onClick={togglePlay}
        className="p-1 rounded hover:bg-white/[0.08] transition-colors shrink-0"
      >
        {playing ? (
          <Pause size={14} className="text-white/80" />
        ) : (
          <Play size={14} className="text-white/80 ml-0.5" />
        )}
      </button>

      <input
        type="range"
        min={0}
        max={total - 1}
        value={currentIndex}
        onChange={(e) => {
          setPlaying(false);
          onIndexChange(Number(e.target.value));
        }}
        className="w-40 sm:w-56 h-1 accent-cyan-400 cursor-pointer"
      />

      <span className="text-[10px] font-mono text-white/50 whitespace-nowrap shrink-0">
        {dateLabel} &middot; avg {avg}
      </span>

      <button
        onClick={onClose}
        className="p-1 rounded hover:bg-white/[0.08] transition-colors text-white/20 hover:text-white/50 shrink-0"
      >
        <X size={12} />
      </button>
    </div>
  );
}
