import { useState, useEffect } from "react";
import { getTimeRemaining } from "@/lib/seasonUtils";

interface CountdownTimerProps {
  target: Date;
}

const CountdownTimer = ({ target }: CountdownTimerProps) => {
  const [time, setTime] = useState(() => getTimeRemaining(target));

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(getTimeRemaining(target));
    }, 1000);
    return () => clearInterval(interval);
  }, [target]);

  const blocks = [
    { value: time.days, label: "DAYS" },
    { value: time.hours, label: "HOURS" },
    { value: time.minutes, label: "MINUTES" },
    { value: time.seconds, label: "SECONDS" },
  ];

  return (
    <div className="grid grid-cols-4 gap-2 md:gap-4 max-w-md mx-auto">
      {blocks.map(b => (
        <div
          key={b.label}
          className="flex flex-col items-center justify-center py-3 md:py-5 rounded-lg bg-secondary border border-primary/20"
        >
          <span className="text-2xl md:text-4xl font-display font-bold text-primary tabular-nums">
            {String(b.value).padStart(2, "0")}
          </span>
          <span className="text-[9px] md:text-xs tracking-wider text-muted-foreground mt-1">
            {b.label}
          </span>
        </div>
      ))}
    </div>
  );
};

export default CountdownTimer;
