import { useState, useCallback, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { useConvergenceTimeline } from '@/hooks/useConvergenceTimeline';
import { useDeck } from '@/contexts/DeckContext';
import Sparkline from '@/components/charts/Sparkline';
import type { PanelComponentProps } from './PanelTypes';

const SPEEDS = [0.5, 1, 2, 4];

export default function HistoryReplayPanel({}: PanelComponentProps) {
  const { dailyAverages, loading } = useConvergenceTimeline();
  const { setHistoryDate } = useDeck();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIndex, setSpeedIndex] = useState(1); // default 1x
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalDays = dailyAverages.length;
  const speed = SPEEDS[speedIndex];

  // Playback timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!playing || totalDays === 0) return;

    timerRef.current = setInterval(() => {
      setCurrentIndex(prev => {
        if (prev >= totalDays - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1000 / speed);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, speed, totalDays]);

  // Push current date to DeckContext for map convergence heatmap
  useEffect(() => {
    if (totalDays === 0) return;
    const dateStr = dailyAverages[currentIndex]?.date ?? null;
    setHistoryDate(dateStr);
    return () => setHistoryDate(null); // clear on unmount
  }, [currentIndex, totalDays, dailyAverages, setHistoryDate]);

  const togglePlay = useCallback(() => setPlaying(p => !p), []);
  const skipBack = useCallback(() => {
    setCurrentIndex(prev => Math.max(0, prev - 1));
  }, []);
  const skipForward = useCallback(() => {
    setCurrentIndex(prev => Math.min(totalDays - 1, prev + 1));
  }, [totalDays]);
  const cycleSpeed = useCallback(() => {
    setSpeedIndex(prev => (prev + 1) % SPEEDS.length);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        Loading timeline...
      </div>
    );
  }

  if (totalDays === 0) {
    return (
      <div className="flex items-center justify-center h-full text-white/40 text-xs">
        No history data
      </div>
    );
  }

  const current = dailyAverages[currentIndex];
  const sparkData = dailyAverages.map(d => d.avg);
  const progress = totalDays > 1 ? (currentIndex / (totalDays - 1)) * 100 : 0;

  return (
    <div className="flex flex-col gap-3 p-3 h-full">
      {/* Date + Score */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-display tracking-widest text-white/30 uppercase">30-DAY REPLAY</div>
          <div className="text-sm font-mono text-white/90">
            {new Date(current.date + 'T00:00:00').toLocaleDateString('en-US', {
              weekday: 'short', month: 'short', day: 'numeric',
            })}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-mono text-cyan-400">{current.avg}</div>
          <div className="text-[9px] font-mono text-white/30">NAT AVG</div>
        </div>
      </div>

      {/* Sparkline */}
      <div className="relative">
        <Sparkline data={sparkData} width={300} height={40} color="#22d3ee" fillColor="#22d3ee" className="w-full" />
        {/* Playhead indicator */}
        <div
          className="absolute top-0 bottom-0 w-px bg-white/60"
          style={{ left: `${progress}%` }}
        />
      </div>

      {/* Timeline bar */}
      <div
        className="h-1.5 bg-white/[0.06] rounded-full cursor-pointer relative"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = (e.clientX - rect.left) / rect.width;
          setCurrentIndex(Math.round(pct * (totalDays - 1)));
        }}
      >
        <div
          className="h-full bg-cyan-400/60 rounded-full transition-all"
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-cyan-400 border border-white/20"
          style={{ left: `${progress}%`, marginLeft: '-5px' }}
        />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={skipBack}
          className="p-1.5 rounded hover:bg-white/[0.06] transition-colors"
        >
          <SkipBack size={14} className="text-white/60" />
        </button>
        <button
          onClick={togglePlay}
          className="p-2 rounded-full bg-white/[0.08] hover:bg-white/[0.12] transition-colors"
        >
          {playing ? (
            <Pause size={16} className="text-white/90" />
          ) : (
            <Play size={16} className="text-white/90 ml-0.5" />
          )}
        </button>
        <button
          onClick={skipForward}
          className="p-1.5 rounded hover:bg-white/[0.06] transition-colors"
        >
          <SkipForward size={14} className="text-white/60" />
        </button>
        <button
          onClick={cycleSpeed}
          className="text-[10px] font-mono text-cyan-400 px-2 py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
        >
          {speed}x
        </button>
      </div>

      {/* Day counter */}
      <div className="text-center text-[9px] font-mono text-white/20">
        Day {currentIndex + 1} of {totalDays}
      </div>
    </div>
  );
}
