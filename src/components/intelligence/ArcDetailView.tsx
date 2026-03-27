import type { StateArc } from '@/hooks/useStateArcs';
import ArcTimeline from './ArcTimeline';
import CountdownClock from './CountdownClock';
import FingerprintMatches from './FingerprintMatches';
import { X, Clock, BookOpen, Target, CheckCircle, AlertTriangle, XCircle, HelpCircle, Fingerprint, Layers } from 'lucide-react';

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

const ACT_COLORS: Record<string, string> = {
  buildup: 'bg-amber-400/20 text-amber-400',
  recognition: 'bg-orange-400/20 text-orange-400',
  outcome: 'bg-red-400/20 text-red-400',
  grade: 'bg-emerald-400/20 text-emerald-400',
};

function scoreTierColor(score: number | null): string {
  if (!score) return 'text-white/30 bg-white/[0.03]';
  if (score >= 75) return 'text-red-400 bg-red-400/10';
  if (score >= 50) return 'text-amber-400 bg-amber-400/10';
  if (score >= 25) return 'text-cyan-400 bg-cyan-400/10';
  return 'text-white/30 bg-white/[0.03]';
}

const GRADE_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle }> = {
  confirmed: { bg: 'bg-emerald-400/20', text: 'text-emerald-400', icon: CheckCircle },
  partially_confirmed: { bg: 'bg-amber-400/20', text: 'text-amber-400', icon: AlertTriangle },
  missed: { bg: 'bg-red-400/20', text: 'text-red-400', icon: XCircle },
  false_alarm: { bg: 'bg-gray-500/20', text: 'text-gray-400', icon: HelpCircle },
};

interface ArcDetailViewProps {
  arc: StateArc;
  onClose: () => void;
}

function renderNarrative(text: string) {
  // Respect line breaks and bold (**text**)
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={i} className={`text-sm font-mono text-white/80 leading-relaxed ${i > 0 ? 'mt-2' : ''}`}>
        {parts.map((part, j) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={j} className="text-white font-bold">{part.slice(2, -2)}</strong>;
          }
          return <span key={j}>{part}</span>;
        })}
      </p>
    );
  });
}

export default function ArcDetailView({ arc, onClose }: ArcDetailViewProps) {
  const actColor = ACT_COLORS[arc.current_act] || 'bg-white/10 text-white/50';
  const stateName = STATE_NAMES[arc.state_abbr] || arc.state_abbr;
  const showOutcomeSplit = arc.current_act === 'outcome' || arc.current_act === 'grade';

  // Extract claim data
  const claim = arc.recognition_claim || {};
  const claimText = (claim as Record<string, unknown>).claim_text as string || (claim as Record<string, unknown>).text as string || '';
  const expectedSignals = Array.isArray((claim as Record<string, unknown>).expected_signals) ? (claim as Record<string, unknown>).expected_signals as string[] : [];
  const patternType = (claim as Record<string, unknown>).pattern_type as string || '';

  // Extract buildup data
  const buildup = arc.buildup_signals || {};
  const domains = Array.isArray((buildup as Record<string, unknown>).converging_domains)
    ? (buildup as Record<string, unknown>).converging_domains as string[]
    : [];
  const convergenceScore = (buildup as Record<string, unknown>).convergence_score as number | undefined;
  const triggerText = (buildup as Record<string, unknown>).trigger as string || (buildup as Record<string, unknown>).trigger_text as string || '';

  // Outcome signals
  const outcomeSignals = Array.isArray(arc.outcome_signals) ? arc.outcome_signals as Record<string, unknown>[] : [];

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
      {/* ── 1. Header Bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900/95">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-mono font-bold text-white">{arc.state_abbr}</span>
          <span className="text-xs font-mono text-white/40 truncate">{stateName}</span>
          {arc.precedent_accuracy != null && (
            <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${scoreTierColor(arc.precedent_accuracy)}`}>
              {Math.round(arc.precedent_accuracy)}
            </span>
          )}
          <span className={`text-[8px] font-mono uppercase px-2 py-0.5 rounded shrink-0 ${actColor}`}>
            {arc.current_act}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded hover:bg-white/[0.08] transition-colors shrink-0"
          aria-label="Close detail view"
        >
          <X size={16} className="text-white/50" />
        </button>
      </div>

      <div className="p-4 space-y-5 max-h-[70vh] overflow-y-auto">
        {/* ── 2. Arc Timeline ── */}
        <div>
          <ArcTimeline
            currentAct={arc.current_act}
            openedAt={arc.opened_at}
            actStartedAt={arc.act_started_at}
          />
        </div>

        {/* ── 3. Narrative ── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <BookOpen size={12} className="text-cyan-400" />
            <h4 className="text-[10px] font-mono uppercase tracking-widest text-white/50">Narrative</h4>
          </div>
          {arc.narrative ? (
            <div className="bg-gray-950/50 rounded-lg p-4 border border-gray-800/50">
              {renderNarrative(arc.narrative)}
            </div>
          ) : (
            <div className="bg-gray-950/50 rounded-lg p-4 border border-gray-800/50">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                <span className="text-xs font-mono text-white/30">Narrator pending...</span>
              </div>
              <div className="mt-2 space-y-1.5">
                <div className="h-3 bg-white/[0.04] rounded animate-pulse w-full" />
                <div className="h-3 bg-white/[0.04] rounded animate-pulse w-4/5" />
                <div className="h-3 bg-white/[0.04] rounded animate-pulse w-3/5" />
              </div>
            </div>
          )}
        </div>

        {/* ── 4. Claim vs Reality (Act 3/4 only) ── */}
        {showOutcomeSplit && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: THE CLAIM */}
            <div className="bg-gray-950/50 rounded-lg p-4 border border-orange-400/20">
              <div className="flex items-center gap-2 mb-3">
                <Target size={12} className="text-orange-400" />
                <h4 className="text-[10px] font-mono uppercase tracking-widest text-orange-400">The Claim</h4>
              </div>
              {claimText ? (
                <p className="text-xs font-mono text-white/70 leading-relaxed mb-3">{claimText}</p>
              ) : (
                <p className="text-xs font-mono text-white/20 mb-3">No claim recorded</p>
              )}
              {expectedSignals.length > 0 && (
                <div className="mb-3">
                  <span className="text-[9px] font-mono text-white/40 uppercase">Expected signals</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {expectedSignals.map((sig, i) => (
                      <span key={i} className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-orange-400/10 text-orange-400/80">
                        {sig}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {patternType && (
                <div className="mb-3">
                  <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-purple-400/15 text-purple-400 uppercase">
                    {patternType}
                  </span>
                </div>
              )}
              {arc.outcome_deadline && (
                <div className="flex items-center gap-2">
                  <Clock size={10} className="text-white/30" />
                  <span className="text-[9px] font-mono text-white/40">Deadline:</span>
                  <CountdownClock deadline={arc.outcome_deadline} />
                </div>
              )}
            </div>

            {/* Right: REALITY */}
            <div className="bg-gray-950/50 rounded-lg p-4 border border-cyan-400/20">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle size={12} className="text-cyan-400" />
                <h4 className="text-[10px] font-mono uppercase tracking-widest text-cyan-400">Reality</h4>
              </div>
              {outcomeSignals.length > 0 ? (
                <div className="space-y-2">
                  {outcomeSignals.map((sig, i) => (
                    <div key={i} className="bg-gray-900/50 rounded p-2 border border-gray-800/50">
                      <p className="text-[10px] font-mono text-white/70">
                        {(sig.signal_text as string) || (sig.text as string) || JSON.stringify(sig)}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        {sig.source && (
                          <span className="text-[8px] font-mono text-white/30">{sig.source as string}</span>
                        )}
                        {sig.match_type && (
                          <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-cyan-400/10 text-cyan-400/70">
                            {sig.match_type as string}
                          </span>
                        )}
                        {sig.timestamp && (
                          <span className="text-[8px] font-mono text-white/20 ml-auto">
                            {new Date(sig.timestamp as string).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2 py-4">
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
                  <span className="text-xs font-mono text-white/30">Watching for confirmation signals...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 5. Grade Reasoning (Act 4 only) ── */}
        {arc.grade && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle size={12} className="text-emerald-400" />
              <h4 className="text-[10px] font-mono uppercase tracking-widest text-white/50">Grade</h4>
            </div>
            <div className="bg-gray-950/50 rounded-lg p-4 border border-gray-800/50">
              {(() => {
                const style = GRADE_STYLES[arc.grade] || GRADE_STYLES.false_alarm;
                const Icon = style.icon;
                return (
                  <div className="flex items-start gap-3">
                    <div className={`w-14 h-14 rounded-lg flex items-center justify-center shrink-0 ${style.bg}`}>
                      <Icon size={24} className={style.text} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className={`text-sm font-mono font-bold uppercase ${style.text}`}>
                        {arc.grade.replace('_', ' ')}
                      </span>
                      {arc.grade_reasoning && (
                        <p className="text-xs font-mono text-white/60 leading-relaxed mt-2">
                          {arc.grade_reasoning}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ── 6. Fingerprint Matches ── */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Fingerprint size={12} className="text-purple-400" />
            <h4 className="text-[10px] font-mono uppercase tracking-widest text-white/50">Historical Fingerprints</h4>
          </div>
          <FingerprintMatches stateAbbr={arc.state_abbr} />
        </div>

        {/* ── 7. Buildup Signals ── */}
        {(domains.length > 0 || triggerText || convergenceScore != null) && (
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Layers size={12} className="text-amber-400" />
              <h4 className="text-[10px] font-mono uppercase tracking-widest text-white/50">Buildup Signals</h4>
            </div>
            <div className="bg-gray-950/50 rounded-lg p-4 border border-gray-800/50">
              {domains.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {domains.map(d => (
                    <span key={d} className="text-[8px] font-mono px-2 py-1 rounded bg-cyan-400/10 text-cyan-400/80">
                      {d}
                    </span>
                  ))}
                </div>
              )}
              {convergenceScore != null && (
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[9px] font-mono text-white/40 uppercase">Convergence</span>
                  <span className="text-xs font-mono font-bold text-cyan-400">{convergenceScore}</span>
                </div>
              )}
              {triggerText && (
                <p className="text-xs font-mono text-white/60 leading-relaxed">{triggerText}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
