const ACTS = ['buildup', 'recognition', 'outcome', 'grade'] as const;

const ACT_LABELS: Record<string, string> = {
  buildup: 'BUILDUP',
  recognition: 'RECOGNITION',
  outcome: 'OUTCOME',
  grade: 'GRADE',
};

interface ArcTimelineProps {
  currentAct: string;
  openedAt: string;
  actStartedAt: string;
}

export default function ArcTimeline({ currentAct }: ArcTimelineProps) {
  const currentIdx = ACTS.indexOf(currentAct as typeof ACTS[number]);

  return (
    <div className="flex items-center gap-1">
      {ACTS.map((act, i) => {
        const isComplete = i < currentIdx;
        const isCurrent = i === currentIdx;
        const isFuture = i > currentIdx;

        return (
          <div key={act} className="flex items-center gap-1">
            {i > 0 && <span className="text-white/10 text-[8px]">&rarr;</span>}
            <div className="flex items-center gap-0.5">
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ${
                  isComplete
                    ? 'bg-emerald-400'
                    : isCurrent
                    ? 'bg-cyan-400 animate-pulse'
                    : 'bg-white/10'
                }`}
              />
              <span
                className={`text-[7px] font-mono uppercase tracking-wider ${
                  isComplete
                    ? 'text-emerald-400/70'
                    : isCurrent
                    ? 'text-cyan-400'
                    : 'text-white/15'
                }`}
              >
                {ACT_LABELS[act]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
