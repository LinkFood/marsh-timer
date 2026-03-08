import { useState, useRef, useCallback, useEffect } from 'react';

interface TimelineScrubberProps {
  onDateChange: (date: Date) => void;
  className?: string;
  sidebarOffset?: number;
}

const DAYS_BACK = 30;
const DAYS_FORWARD = 7;
const TOTAL_DAYS = DAYS_BACK + 1 + DAYS_FORWARD; // 38 positions (30 back + today + 7 forward)

function getDateForIndex(index: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + (index - DAYS_BACK));
  return d;
}

function formatDateLabel(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (diff === 0) return monthDay;
  if (diff < 0) return `${monthDay} (${diff}d)`;
  return `${monthDay} (+${diff}d)`;
}

function isWeekBoundary(date: Date): boolean {
  return date.getDay() === 0; // Sunday
}

export default function TimelineScrubber({ onDateChange, className, sidebarOffset = 0 }: TimelineScrubberProps) {
  const [index, setIndex] = useState(DAYS_BACK); // Start at today (center)
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const animatingRef = useRef(false);

  const indexToPercent = (i: number) => (i / (TOTAL_DAYS - 1)) * 100;

  const percentToIndex = useCallback((percent: number) => {
    const raw = (percent / 100) * (TOTAL_DAYS - 1);
    return Math.round(Math.max(0, Math.min(TOTAL_DAYS - 1, raw)));
  }, []);

  const getPercentFromEvent = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) return 50;
    const rect = track.getBoundingClientRect();
    const x = clientX - rect.left;
    return Math.max(0, Math.min(100, (x / rect.width) * 100));
  }, []);

  const emitDate = useCallback((idx: number) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onDateChange(getDateForIndex(idx));
    }, 300);
  }, [onDateChange]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    const pct = getPercentFromEvent(e.clientX);
    const newIdx = percentToIndex(pct);
    setIndex(newIdx);
    emitDate(newIdx);
  }, [getPercentFromEvent, percentToIndex, emitDate]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging) return;
    const pct = getPercentFromEvent(e.clientX);
    const newIdx = percentToIndex(pct);
    setIndex(newIdx);
    emitDate(newIdx);
  }, [dragging, getPercentFromEvent, percentToIndex, emitDate]);

  const handlePointerUp = useCallback(() => {
    setDragging(false);
    // Snap to today if within 1 day
    const diff = Math.abs(index - DAYS_BACK);
    if (diff <= 1 && index !== DAYS_BACK) {
      animatingRef.current = true;
      setIndex(DAYS_BACK);
      emitDate(DAYS_BACK);
      setTimeout(() => { animatingRef.current = false; }, 300);
    }
  }, [index, emitDate]);

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const currentDate = getDateForIndex(index);
  const handlePercent = indexToPercent(index);
  const todayPercent = indexToPercent(DAYS_BACK);
  const isToday = index === DAYS_BACK;

  // Build tick marks
  const ticks = [];
  for (let i = 0; i < TOTAL_DAYS; i++) {
    const d = getDateForIndex(i);
    const pct = indexToPercent(i);
    const isBoundary = isWeekBoundary(d);
    ticks.push(
      <div
        key={i}
        className="absolute top-0"
        style={{
          left: `${pct}%`,
          width: '1px',
          height: isBoundary ? '8px' : '4px',
          backgroundColor: i === DAYS_BACK ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.12)',
          transform: 'translateX(-0.5px)',
        }}
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        position: 'fixed',
        bottom: 0,
        left: sidebarOffset,
        right: 0,
        height: '40px',
        background: 'rgba(10, 15, 30, 0.85)',
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        zIndex: 20,
        userSelect: 'none',
        touchAction: 'none',
      }}
    >
      {/* Track area */}
      <div
        ref={trackRef}
        style={{
          position: 'absolute',
          left: '24px',
          right: '24px',
          top: '50%',
          height: '20px',
          transform: 'translateY(-50%)',
          cursor: 'pointer',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Track line */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '50%',
            height: '2px',
            backgroundColor: 'rgba(255,255,255,0.1)',
            transform: 'translateY(-50%)',
            borderRadius: '1px',
          }}
        />

        {/* Tick marks */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 'calc(50% - 1px)' }}>
          {ticks}
        </div>

        {/* Today marker */}
        <div
          style={{
            position: 'absolute',
            left: `${todayPercent}%`,
            top: 'calc(50% - 6px)',
            width: '2px',
            height: '12px',
            backgroundColor: 'rgba(255,255,255,0.3)',
            transform: 'translateX(-1px)',
            borderRadius: '1px',
          }}
        />

        {/* Date label - floats above handle */}
        <div
          style={{
            position: 'absolute',
            left: `${handlePercent}%`,
            bottom: '100%',
            transform: 'translateX(-50%)',
            marginBottom: '4px',
            fontSize: '11px',
            fontFamily: 'Lora, serif',
            color: isToday ? 'rgba(255,255,255,0.7)' : '#22d3ee',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            transition: animatingRef.current ? 'left 0.3s ease-out' : 'none',
          }}
        >
          {formatDateLabel(currentDate)}
        </div>

        {/* Draggable handle */}
        <div
          style={{
            position: 'absolute',
            left: `${handlePercent}%`,
            top: '50%',
            width: '16px',
            height: '16px',
            borderRadius: '50%',
            backgroundColor: '#22d3ee',
            boxShadow: '0 0 8px rgba(34, 211, 238, 0.5), 0 0 16px rgba(34, 211, 238, 0.2)',
            transform: 'translate(-50%, -50%)',
            cursor: 'grab',
            transition: animatingRef.current ? 'left 0.3s ease-out' : 'none',
          }}
        />
      </div>

      {/* Edge labels */}
      <div
        style={{
          position: 'absolute',
          left: '4px',
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: '9px',
          color: 'rgba(255,255,255,0.25)',
          fontFamily: 'Lora, serif',
        }}
      >
        -30d
      </div>
      <div
        style={{
          position: 'absolute',
          right: '4px',
          top: '50%',
          transform: 'translateY(-50%)',
          fontSize: '9px',
          color: 'rgba(255,255,255,0.25)',
          fontFamily: 'Lora, serif',
        }}
      >
        +7d
      </div>
    </div>
  );
}
