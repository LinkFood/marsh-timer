import type { StateArc } from '@/hooks/useStateArcs';
import type { ConvergenceScore } from '@/hooks/useConvergenceScores';
import StateArcCard from './StateArcCard';
import { Shield } from 'lucide-react';

const STATE_NAMES: Record<string, string> = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',
  CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',
  KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',
  MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',
  NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',
  OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming',
};

interface StateBoardProps {
  arcs: StateArc[];
  scores: Map<string, ConvergenceScore>;
  onSelectState: (abbr: string) => void;
}

interface TierDef {
  label: string;
  dotColor: string;
  textColor: string;
  min: number;
  max: number;
}

const TIERS: TierDef[] = [
  { label: 'Critical', dotColor: 'bg-red-400', textColor: 'text-red-400', min: 75, max: Infinity },
  { label: 'Elevated', dotColor: 'bg-amber-400', textColor: 'text-amber-400', min: 50, max: 75 },
  { label: 'Normal', dotColor: 'bg-cyan-400', textColor: 'text-cyan-400', min: 25, max: 50 },
  { label: 'Quiet', dotColor: 'bg-white/20', textColor: 'text-white/30', min: -Infinity, max: 25 },
];

function scoreTierBorder(score: number): string {
  if (score >= 75) return 'border-red-400/60';
  if (score >= 50) return 'border-amber-400/60';
  if (score >= 25) return 'border-cyan-400/60';
  return 'border-white/10';
}

function scoreTierColor(score: number): string {
  if (score >= 75) return 'text-red-400 bg-red-400/10';
  if (score >= 50) return 'text-amber-400 bg-amber-400/10';
  if (score >= 25) return 'text-cyan-400 bg-cyan-400/10';
  return 'text-white/30 bg-white/[0.03]';
}

export default function StateBoard({ arcs, scores, onSelectState }: StateBoardProps) {
  const arcByState = new Map<string, StateArc>();
  for (const arc of arcs) {
    arcByState.set(arc.state_abbr, arc);
  }

  // Build sorted state list from scores
  const allStates = Array.from(scores.values()).sort((a, b) => b.score - a.score);
  const totalReporting = allStates.length;

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
      <div className="flex items-center gap-2 mb-4">
        <Shield size={14} className="text-cyan-400" />
        <h3 className="text-xs font-mono uppercase tracking-widest text-white/50">50-State Intelligence Board</h3>
        <span className="text-[9px] font-mono text-white/20 ml-auto">
          {totalReporting} states reporting &middot; {arcs.length} active arc{arcs.length !== 1 ? 's' : ''}
        </span>
      </div>

      {allStates.length === 0 ? (
        <div className="flex items-center justify-center h-24 text-white/20 text-[10px] font-mono">
          No convergence data available
        </div>
      ) : (
        <div className="space-y-4">
          {TIERS.map(tier => {
            const tierStates = allStates.filter(
              s => s.score >= tier.min && s.score < tier.max
            );
            if (tierStates.length === 0) return null;

            // For the Quiet tier, render as compressed badges
            if (tier.label === 'Quiet') {
              return (
                <div key={tier.label}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2 h-2 rounded-full ${tier.dotColor}`} />
                    <span className={`text-[10px] font-mono ${tier.textColor} uppercase tracking-wider`}>
                      {tier.label} ({tierStates.length})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tierStates.map(s => (
                      <button
                        key={s.state_abbr}
                        onClick={() => onSelectState(s.state_abbr)}
                        className="px-1.5 py-0.5 rounded text-[8px] font-mono bg-white/[0.03] text-white/30 hover:text-white/50 hover:bg-white/[0.06] transition-colors"
                      >
                        {s.state_abbr}
                        <span className="ml-0.5 text-white/15">{Math.round(s.score)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            }

            return (
              <div key={tier.label}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full ${tier.dotColor}`} />
                  <span className={`text-[10px] font-mono ${tier.textColor} uppercase tracking-wider`}>
                    {tier.label} ({tierStates.length})
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                  {tierStates.map(s => {
                    const arc = arcByState.get(s.state_abbr);
                    if (arc) {
                      return (
                        <StateArcCard
                          key={s.state_abbr}
                          arc={arc}
                          score={s.score}
                          stateName={STATE_NAMES[s.state_abbr] || ''}
                          onClick={() => onSelectState(s.state_abbr)}
                        />
                      );
                    }
                    // Compact card for states without arcs
                    return (
                      <button
                        key={s.state_abbr}
                        onClick={() => onSelectState(s.state_abbr)}
                        className={`bg-gray-900/80 border ${scoreTierBorder(s.score)} rounded-lg p-2.5 flex items-start gap-2.5 hover:brightness-125 transition-all text-left w-full`}
                      >
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm shrink-0 ${scoreTierColor(s.score)}`}>
                          {Math.round(s.score)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className="text-xs font-mono font-bold text-white/90">{s.state_abbr}</span>
                            <span className="text-[8px] font-mono text-white/30 truncate">{STATE_NAMES[s.state_abbr] || ''}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
