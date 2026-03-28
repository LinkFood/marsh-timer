import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import type { ConvergenceScore } from '@/hooks/useConvergenceScores';
import type { StateArc } from '@/hooks/useStateArcs';
import type { StateBrief } from '@/hooks/useStateBrief';
import ArcTimeline from '@/components/intelligence/ArcTimeline';
import CountdownClock from '@/components/intelligence/CountdownClock';
import SplitVerdict from '@/components/SplitVerdict';
import AutopsyDrawer from '@/components/AutopsyDrawer';

const DOMAINS = [
  { key: 'weather_component' as const, color: '#ef4444', label: 'Weather', max: 25 },
  { key: 'migration_component' as const, color: '#3b82f6', label: 'Migration', max: 25 },
  { key: 'birdcast_component' as const, color: '#22c55e', label: 'BirdCast', max: 20 },
  { key: 'solunar_component' as const, color: '#f59e0b', label: 'Solunar', max: 15 },
  { key: 'water_component' as const, color: '#06b6d4', label: 'Water', max: 15 },
  { key: 'pattern_component' as const, color: '#a855f7', label: 'Pattern', max: 15 },
  { key: 'photoperiod_component' as const, color: '#6b7280', label: 'Photo', max: 10 },
  { key: 'tide_component' as const, color: '#9ca3af', label: 'Tide', max: 10 },
];

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

interface Props {
  state: string;
  score: ConvergenceScore | undefined;
  arc: StateArc | undefined;
  brief: StateBrief | null;
  briefLoading: boolean;
}

export default function StateDetailPanel({ state, score, arc, brief, briefLoading }: Props) {
  const [briefExpanded, setBriefExpanded] = useState(false);

  const tier = score ? (score.score >= 80 ? 'CRITICAL' : score.score >= 50 ? 'ELEVATED' : 'NORMAL') : 'NORMAL';
  const tierColor = tier === 'CRITICAL' ? 'text-red-400' : tier === 'ELEVATED' ? 'text-amber-400' : 'text-white/50';

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-3 space-y-3">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-mono text-white/30">{STATE_NAMES[state] || state}</div>
            <div className="text-xl font-mono font-bold text-white/90">{state}</div>
          </div>
          <div className="text-right">
            <div className={`text-2xl font-mono font-bold ${tierColor}`}>
              {score ? Math.round(score.score) : '—'}
            </div>
            <div className={`text-[8px] font-mono tracking-widest ${tierColor}`}>{tier}</div>
          </div>
        </div>

        {/* Arc Phase */}
        {arc && (
          <div className="flex items-center justify-between">
            <ArcTimeline
              currentAct={arc.current_act}
              openedAt={arc.opened_at}
              actStartedAt={arc.act_started_at}
            />
            {arc.outcome_deadline && arc.current_act === 'outcome' && (
              <CountdownClock deadline={arc.outcome_deadline} />
            )}
          </div>
        )}

        {/* 8-Component Grid */}
        {score && (
          <div>
            <div className="text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1.5">Components</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
              {DOMAINS.map(d => {
                const val = score[d.key] || 0;
                return (
                  <div key={d.key} className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="text-[10px] font-mono text-white/35 w-14 truncate">{d.label}</span>
                    <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, (val / d.max) * 100)}%`,
                          backgroundColor: d.color,
                          opacity: 0.7,
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-white/30 w-6 text-right">
                      {Math.round(val)}/{d.max}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Arc Narrative Snippet */}
        {arc?.narrative && (
          <div>
            <div className="text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1">Arc Narrative</div>
            <p className="text-[11px] font-mono text-white/50 leading-relaxed line-clamp-3">
              {arc.narrative}
            </p>
          </div>
        )}

        {/* AI Brief — only show if no arc narrative (arc is always more current) */}
        {briefLoading && !arc?.narrative && (
          <div className="text-[10px] font-mono text-white/20 animate-pulse">Loading brief...</div>
        )}
        {brief?.content && !arc?.narrative && (
          <div>
            <button
              onClick={() => setBriefExpanded(e => !e)}
              className="flex items-center gap-1 text-[9px] font-mono text-white/25 uppercase tracking-widest mb-1 hover:text-white/40 transition-colors"
            >
              Daily Brief
              {briefExpanded ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
            </button>
            <p className={`text-[11px] font-mono text-white/45 leading-relaxed ${briefExpanded ? '' : 'line-clamp-3'}`}>
              {brief.content}
            </p>
          </div>
        )}

        {/* Conviction / Precedent Accuracy */}
        {arc?.precedent_accuracy != null && (
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono text-white/25 uppercase tracking-widest">Conviction</span>
            <div className="flex-1 h-1.5 bg-white/[0.04] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, arc.precedent_accuracy)}%`,
                  backgroundColor: arc.precedent_accuracy >= 60 ? '#22c55e' : arc.precedent_accuracy >= 30 ? '#f59e0b' : '#ef4444',
                  opacity: 0.7,
                }}
              />
            </div>
            <span className="text-[10px] font-mono text-white/40">
              {Math.round(arc.precedent_accuracy)}%
            </span>
          </div>
        )}

        {/* Split Verdict — outcome phase states */}
        {arc?.current_act === 'outcome' && (
          <SplitVerdict arc={arc} />
        )}

        {/* Autopsy Drawer — graded arcs */}
        {arc?.grade && (
          <AutopsyDrawer arc={arc} />
        )}

        {/* Navigation */}
        <div className="pt-2 border-t border-white/[0.04]">
          <Link
            to={`/intelligence?state=${state}`}
            className="flex items-center gap-1.5 text-[10px] font-mono text-cyan-400/60 hover:text-cyan-400 transition-colors"
          >
            Full analysis
            <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
