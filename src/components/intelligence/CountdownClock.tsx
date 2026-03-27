import { useState, useEffect, useRef } from 'react';

interface CountdownClockProps {
  deadline: string;
}

function formatRemaining(deadline: string): { text: string; color: string } {
  const ms = new Date(deadline).getTime() - Date.now();
  if (ms <= 0) return { text: 'EXPIRED', color: 'text-red-400' };

  const hours = ms / (1000 * 60 * 60);
  const days = Math.floor(hours / 24);
  const remainHours = Math.floor(hours % 24);

  const text = days > 0 ? `${days}d ${remainHours}h` : `${remainHours}h`;
  const color = hours > 48 ? 'text-emerald-400' : hours > 24 ? 'text-amber-400' : 'text-red-400';
  return { text, color };
}

export default function CountdownClock({ deadline }: CountdownClockProps) {
  const [state, setState] = useState(() => formatRemaining(deadline));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setState(formatRemaining(deadline));
    intervalRef.current = setInterval(() => {
      setState(formatRemaining(deadline));
    }, 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [deadline]);

  return (
    <span className={`text-[10px] font-mono font-bold ${state.color}`}>
      {state.text}
    </span>
  );
}
