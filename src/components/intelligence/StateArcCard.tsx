import type { StateArc } from '@/hooks/useStateArcs';
import ArcTimeline from './ArcTimeline';
import CountdownClock from './CountdownClock';

const ACT_COLORS: Record<string, string> = {
  buildup: 'bg-amber-400/20 text-amber-400',
  recognition: 'bg-orange-400/20 text-orange-400',
  outcome: 'bg-red-400/20 text-red-400',
  grade: 'bg-emerald-400/20 text-emerald-400',
};

function scoreTierColor(score: number): string {
  if (score >= 75) return 'text-red-400 bg-red-400/10';
  if (score >= 50) return 'text-amber-400 bg-amber-400/10';
  if (score >= 25) return 'text-cyan-400 bg-cyan-400/10';
  return 'text-white/30 bg-white/[0.03]';
}

function scoreTierBorder(score: number): string {
  if (score >= 75) return 'border-red-400/60';
  if (score >= 50) return 'border-amber-400/60';
  if (score >= 25) return 'border-cyan-400/60';
  return 'border-white/10';
}

interface StateArcCardProps {
  arc: StateArc;
  score: number;
  stateName: string;
  onClick: () => void;
}

export default function StateArcCard({ arc, score, stateName, onClick }: StateArcCardProps) {
  const actColor = ACT_COLORS[arc.current_act] || 'bg-white/10 text-white/50';

  // Extract domain pills from buildup_signals
  const domains: string[] = [];
  if (arc.buildup_signals && typeof arc.buildup_signals === 'object') {
    const bs = arc.buildup_signals as Record<string, unknown>;
    if (bs.converging_domains && Array.isArray(bs.converging_domains)) {
      domains.push(...(bs.converging_domains as string[]).slice(0, 4));
    }
  }

  return (
    <button
      onClick={onClick}
      className={`w-full bg-gray-900/80 border ${scoreTierBorder(score)} rounded-lg p-2.5 hover:brightness-125 transition-all text-left`}
    >
      <div className="flex items-start gap-2.5">
        {/* Score badge */}
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm shrink-0 ${scoreTierColor(score)}`}>
          {Math.round(score)}
        </div>

        <div className="min-w-0 flex-1">
          {/* State name + act badge */}
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-mono font-bold text-white/90">{arc.state_abbr}</span>
            <span className="text-[8px] font-mono text-white/30 truncate">{stateName}</span>
            <span className={`text-[7px] font-mono uppercase px-1.5 py-0.5 rounded ml-auto shrink-0 ${actColor}`}>
              {arc.current_act}
            </span>
          </div>

          {/* Domain pills */}
          {domains.length > 0 && (
            <div className="flex flex-wrap gap-0.5 mb-1">
              {domains.map(d => (
                <span key={d} className="text-[7px] px-1 py-0.5 rounded font-mono bg-cyan-400/10 text-cyan-400/70">
                  {d}
                </span>
              ))}
            </div>
          )}

          {/* Timeline + countdown */}
          <div className="flex items-center gap-2">
            <ArcTimeline
              currentAct={arc.current_act}
              openedAt={arc.opened_at}
              actStartedAt={arc.act_started_at}
            />
            {arc.outcome_deadline && (
              <CountdownClock deadline={arc.outcome_deadline} />
            )}
          </div>

          {/* Narrative snippet */}
          {arc.narrative && (
            <p className="text-[9px] font-mono text-white/40 mt-1 line-clamp-1">{arc.narrative}</p>
          )}
        </div>
      </div>
    </button>
  );
}
