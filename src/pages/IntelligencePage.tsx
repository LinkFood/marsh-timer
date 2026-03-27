import { useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Brain, TrendingUp, TrendingDown, Minus, Shield, Zap } from 'lucide-react';
import { useOpsData } from '@/hooks/useOpsData';
import { useConvergenceScores, type ConvergenceScore } from '@/hooks/useConvergenceScores';
import { useIntelligenceFeed, type IntelItem } from '@/hooks/useIntelligenceFeed';
import { useAlertCalibration } from '@/hooks/useAlertCalibration';
import { useStateArcs, type StateArc } from '@/hooks/useStateArcs';
import StateArcCard from '@/components/intelligence/StateArcCard';
import ArcDetailView from '@/components/intelligence/ArcDetailView';

// ── Helpers ──────────────────────────────────────────────────────────

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return '<1m';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
  return `${Math.floor(ms / 86400000)}d`;
}

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",
  OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",
  VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
};

const COMPONENT_LABELS: { key: keyof ConvergenceScore; label: string; color: string }[] = [
  { key: 'weather_component', label: 'WX', color: 'bg-blue-400/20 text-blue-300' },
  { key: 'migration_component', label: 'MIG', color: 'bg-emerald-400/20 text-emerald-300' },
  { key: 'birdcast_component', label: 'BIRD', color: 'bg-green-400/20 text-green-300' },
  { key: 'water_component', label: 'H2O', color: 'bg-sky-400/20 text-sky-300' },
  { key: 'solunar_component', label: 'SOL', color: 'bg-yellow-400/20 text-yellow-300' },
  { key: 'pattern_component', label: 'PAT', color: 'bg-purple-400/20 text-purple-300' },
  { key: 'photoperiod_component', label: 'PHO', color: 'bg-orange-400/20 text-orange-300' },
  { key: 'tide_component', label: 'TIDE', color: 'bg-teal-400/20 text-teal-300' },
];

function scoreTier(score: number): { border: string; bg: string; text: string; label: string } {
  if (score >= 75) return { border: 'border-red-400/60', bg: 'bg-red-400/10', text: 'text-red-400', label: 'Critical' };
  if (score >= 50) return { border: 'border-amber-400/60', bg: 'bg-amber-400/10', text: 'text-amber-400', label: 'Elevated' };
  if (score >= 25) return { border: 'border-cyan-400/60', bg: 'bg-cyan-400/10', text: 'text-cyan-400', label: 'Normal' };
  return { border: 'border-white/10', bg: 'bg-white/[0.03]', text: 'text-white/30', label: 'Quiet' };
}

const INTEL_BORDER: Record<string, string> = {
  'correlation-discovery': 'border-l-purple-400',
  'anomaly-alert': 'border-l-amber-400',
  'alert-grade': 'border-l-green-400',
  'compound-risk-alert': 'border-l-red-400',
  'convergence-score': 'border-l-cyan-400',
  'disaster-watch': 'border-l-orange-400',
  'migration-spike-extreme': 'border-l-emerald-400',
  'migration-spike-significant': 'border-l-emerald-400',
};

const FEED_TABS: { label: string; value: string | undefined }[] = [
  { label: 'All', value: undefined },
  { label: 'Compound Risk', value: 'compound-risk-alert' },
  { label: 'Anomalies', value: 'anomaly-alert' },
  { label: 'Correlations', value: 'correlation-discovery' },
  { label: 'Grades', value: 'alert-grade' },
];

// ── Sub-components ───────────────────────────────────────────────────

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-900 rounded-lg border border-gray-800 p-4 ${className}`}>
      {title && <h3 className="text-xs font-mono uppercase tracking-widest text-white/50 mb-3">{title}</h3>}
      {children}
    </div>
  );
}

function StateCard({ score, navigate }: { score: ConvergenceScore; navigate: (path: string) => void }) {
  const tier = scoreTier(score.score);
  const topComponents = COMPONENT_LABELS
    .filter(c => (score[c.key] as number) > 0)
    .sort((a, b) => (score[b.key] as number) - (score[a.key] as number))
    .slice(0, 3);

  return (
    <button
      onClick={() => navigate(`/all/${score.state_abbr}`)}
      className={`${tier.bg} border ${tier.border} rounded-lg p-2.5 flex items-start gap-2.5 hover:brightness-125 transition-all text-left w-full`}
    >
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm shrink-0 ${tier.bg} ${tier.text}`}>
        {Math.round(score.score)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-xs font-mono font-bold text-white/90">{score.state_abbr}</span>
          <span className="text-[8px] font-mono text-white/30 truncate">{STATE_NAMES[score.state_abbr] || ''}</span>
        </div>
        <div className="flex flex-wrap gap-0.5">
          {topComponents.map(c => (
            <span key={c.key} className={`text-[8px] px-1 py-0.5 rounded font-mono ${c.color}`}>
              {c.label}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

function AccuracyBar({ label, accuracy, total }: { label: string; accuracy: number; total: number }) {
  const barColor = accuracy >= 70 ? 'bg-emerald-400' : accuracy >= 50 ? 'bg-amber-400' : 'bg-red-400';
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      <span className="w-28 text-white/50 truncate">{label}</span>
      <div className="flex-1 h-2 bg-white/[0.06] rounded-full overflow-hidden">
        <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${accuracy}%` }} />
      </div>
      <span className="w-10 text-right text-white/70">{accuracy}%</span>
      <span className="w-10 text-right text-white/30">n={total}</span>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────

export default function IntelligencePage() {
  const navigate = useNavigate();
  const { data: opsData, loading: opsLoading } = useOpsData();
  const { scores, loading: scoresLoading } = useConvergenceScores();
  const [selectedArcId, setSelectedArcId] = useState<string | null>(null);
  const [feedFilter, setFeedFilter] = useState<string | undefined>(undefined);
  const { items: intelItems, loading: feedLoading } = useIntelligenceFeed(feedFilter);
  const { bySource, byState, overallAccuracy, calibrations, loading: calLoading } = useAlertCalibration();
  const { arcs, loading: arcsLoading } = useStateArcs();

  // Map arcs by state for quick lookup
  const arcsByState = useMemo(() => {
    const map = new Map<string, StateArc>();
    for (const arc of arcs) {
      if (!map.has(arc.state_abbr)) map.set(arc.state_abbr, arc);
    }
    return map;
  }, [arcs]);

  // Sort all states by score descending
  const sortedStates = useMemo(() => {
    return Array.from(scores.values()).sort((a, b) => b.score - a.score);
  }, [scores]);

  // Group into tiers
  const tiers = useMemo(() => {
    const critical = sortedStates.filter(s => s.score >= 75);
    const elevated = sortedStates.filter(s => s.score >= 50 && s.score < 75);
    const normal = sortedStates.filter(s => s.score >= 25 && s.score < 50);
    const quiet = sortedStates.filter(s => s.score < 25);
    return { critical, elevated, normal, quiet };
  }, [sortedStates]);

  const totalGraded = opsData.alerts.confirmed + opsData.alerts.partial + opsData.alerts.missed + opsData.alerts.false_alarm;
  const lastEmbed = opsData.brain.content_types.length > 0
    ? opsData.brain.content_types.reduce((latest, ct) => (!latest || ct.latest > latest ? ct.latest : latest), '')
    : null;
  const systemHealthy = opsData.crons.error_count === 0;

  if (opsLoading && scoresLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-white/30 text-sm font-mono tracking-widest uppercase">Loading intelligence...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* ── Header Bar ── */}
      <div className="sticky top-0 z-50 bg-gray-900/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link to="/" className="p-1.5 rounded hover:bg-white/[0.05] transition-colors" aria-label="Back to dashboard">
              <ArrowLeft size={16} className="text-white/50" />
            </Link>
            <div className="hidden sm:flex flex-col">
              <span className="text-xs font-display font-bold tracking-widest text-white/90">DUCK COUNTDOWN</span>
              <span className="text-[7px] tracking-[0.2em] text-white/40 -mt-0.5">ENVIRONMENTAL INTELLIGENCE</span>
            </div>
            <span className="text-xs font-display font-bold tracking-widest text-white/90 sm:hidden">INTEL</span>
          </div>
          <div className="flex items-center gap-1 sm:gap-3 overflow-x-auto scrollbar-hide">
            <div className="flex flex-col items-center px-2">
              <span className="text-sm font-mono font-bold text-cyan-400">{opsData.brain.total.toLocaleString()}</span>
              <span className="text-[8px] font-mono text-white/40 uppercase">Brain</span>
            </div>
            <div className="flex flex-col items-center px-2">
              <span className="text-sm font-mono font-bold text-orange-400">{arcs.length}</span>
              <span className="text-[8px] font-mono text-white/40 uppercase">Active Arcs</span>
            </div>
            <div className="flex flex-col items-center px-2">
              <span className="text-sm font-mono font-bold text-white">{totalGraded.toLocaleString()}</span>
              <span className="text-[8px] font-mono text-white/40 uppercase">Graded</span>
            </div>
            <div className="flex flex-col items-center px-2">
              <span className={`text-sm font-mono font-bold ${opsData.alerts.accuracy >= 60 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {opsData.alerts.accuracy}%
              </span>
              <span className="text-[8px] font-mono text-white/40 uppercase">Accuracy</span>
            </div>
            <div className="flex flex-col items-center px-2">
              <span className="text-sm font-mono font-bold text-white/50">{timeAgo(lastEmbed)}</span>
              <span className="text-[8px] font-mono text-white/40 uppercase">Updated</span>
            </div>
            <span className={`w-2 h-2 rounded-full shrink-0 ml-1 ${systemHealthy ? 'bg-emerald-400' : 'bg-red-400'}`} />
          </div>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── 50-State Convergence Board ── */}
        <Card title="">
          <div className="flex items-center gap-2 -mt-3 mb-4">
            <Shield size={14} className="text-cyan-400" />
            <h3 className="text-xs font-mono uppercase tracking-widest text-white/50">50-State Convergence Board</h3>
            <span className="text-[9px] font-mono text-white/20 ml-auto">{sortedStates.length} states reporting</span>
          </div>

          {selectedArcId && (() => {
            const selectedArc = arcs.find(a => a.id === selectedArcId);
            if (!selectedArc) return null;
            return (
              <div className="mb-4">
                <ArcDetailView arc={selectedArc} onClose={() => setSelectedArcId(null)} />
              </div>
            );
          })()}

          {scoresLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="h-16 bg-white/[0.03] rounded-lg animate-pulse" />
              ))}
            </div>
          ) : sortedStates.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-white/20 text-[10px] font-mono">
              No convergence data available
            </div>
          ) : (
            <div className="space-y-4">
              {tiers.critical.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-red-400" />
                    <span className="text-[10px] font-mono text-red-400 uppercase tracking-wider">Critical ({tiers.critical.length})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {tiers.critical.map(s => {
                      const arc = arcsByState.get(s.state_abbr);
                      return arc ? (
                        <StateArcCard key={s.state_abbr} arc={arc} score={s.score} stateName={STATE_NAMES[s.state_abbr] || ''} onClick={() => setSelectedArcId(arc.id)} />
                      ) : (
                        <StateCard key={s.state_abbr} score={s} navigate={navigate} />
                      );
                    })}
                  </div>
                </div>
              )}
              {tiers.elevated.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span className="text-[10px] font-mono text-amber-400 uppercase tracking-wider">Elevated ({tiers.elevated.length})</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                    {tiers.elevated.map(s => {
                      const arc = arcsByState.get(s.state_abbr);
                      return arc ? (
                        <StateArcCard key={s.state_abbr} arc={arc} score={s.score} stateName={STATE_NAMES[s.state_abbr] || ''} onClick={() => setSelectedArcId(arc.id)} />
                      ) : (
                        <StateCard key={s.state_abbr} score={s} navigate={navigate} />
                      );
                    })}
                  </div>
                </div>
              )}
              {tiers.normal.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-wider">Normal ({tiers.normal.length})</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {tiers.normal.map(s => <StateCard key={s.state_abbr} score={s} navigate={navigate} />)}
                  </div>
                </div>
              )}
              {tiers.quiet.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-2 h-2 rounded-full bg-white/20" />
                    <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">Quiet ({tiers.quiet.length})</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {tiers.quiet.map(s => <StateCard key={s.state_abbr} score={s} navigate={navigate} />)}
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* ── Bottom two-column: Feed + Track Record ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Live Intelligence Feed ── */}
          <Card title="">
            <div className="flex items-center gap-2 -mt-3 mb-3">
              <Brain size={14} className="text-cyan-400" />
              <h3 className="text-xs font-mono uppercase tracking-widest text-white/50">Live Intelligence</h3>
            </div>
            <div className="flex items-center gap-1 mb-3 flex-wrap">
              {FEED_TABS.map(tab => (
                <button
                  key={tab.label}
                  onClick={() => setFeedFilter(tab.value)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                    feedFilter === tab.value
                      ? 'bg-cyan-400/20 text-cyan-400'
                      : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="max-h-[500px] overflow-y-auto -mx-4 -mb-4 space-y-0">
              {feedLoading ? (
                <>
                  {[0, 1, 2].map(i => (
                    <div key={i} className="px-4 py-3 border-b border-gray-800/30">
                      <div className="h-3 bg-white/[0.06] rounded animate-pulse w-3/4 mb-2" />
                      <div className="h-2 bg-white/[0.04] rounded animate-pulse w-1/2" />
                    </div>
                  ))}
                </>
              ) : intelItems.length === 0 ? (
                <div className="flex items-center justify-center h-20 text-white/20 text-[10px] font-mono">
                  No intelligence activity in the last 48 hours
                </div>
              ) : (
                intelItems.map((item: IntelItem) => (
                  <div
                    key={item.id}
                    className={`px-4 py-2 border-b border-gray-800/30 border-l-4 ${
                      INTEL_BORDER[item.content_type] || 'border-l-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs text-white/80 font-mono truncate flex-1">{item.title}</span>
                      {item.state_abbr && (
                        <span className="text-[9px] font-mono bg-cyan-400/15 text-cyan-400 px-1.5 py-0.5 rounded shrink-0">
                          {item.state_abbr}
                        </span>
                      )}
                      <span className="text-[10px] font-mono text-white/30 shrink-0">{timeAgo(item.created_at)}</span>
                    </div>
                    {item.content && (
                      <p className="text-[10px] font-mono text-white/50 line-clamp-2">{item.content}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* ── Prediction Track Record ── */}
          <Card title="">
            <div className="flex items-center gap-2 -mt-3 mb-4">
              <TrendingUp size={14} className="text-emerald-400" />
              <h3 className="text-xs font-mono uppercase tracking-widest text-white/50">Prediction Track Record</h3>
            </div>

            {calLoading ? (
              <div className="space-y-3">
                {[0, 1, 2].map(i => (
                  <div key={i} className="h-4 bg-white/[0.04] rounded animate-pulse" />
                ))}
              </div>
            ) : calibrations.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <div className="w-12 h-12 rounded-full bg-white/[0.04] flex items-center justify-center">
                  <Minus size={20} className="text-white/20" />
                </div>
                <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">Learning...</span>
                <p className="text-[10px] font-mono text-white/20 text-center max-w-xs leading-relaxed">
                  The grading system is building its track record. Results will appear as alerts cross their outcome deadlines.
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Overall accuracy */}
                <div className="flex items-center gap-4">
                  <div className="text-center">
                    <div className={`text-4xl font-mono font-bold ${overallAccuracy >= 60 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {overallAccuracy}%
                    </div>
                    <div className="text-[9px] font-mono text-white/40 uppercase">Overall Accuracy</div>
                  </div>
                  <div className="flex-1 text-[10px] font-mono text-white/30 leading-relaxed">
                    Weighted average across {bySource.reduce((s, r) => s + r.total_alerts, 0).toLocaleString()} graded alerts
                    from {bySource.length} source{bySource.length !== 1 ? 's' : ''} and {byState.length} state{byState.length !== 1 ? 's' : ''}.
                  </div>
                </div>

                {/* Per-source accuracy */}
                <div>
                  <h4 className="text-[10px] font-mono text-white/40 uppercase tracking-wider mb-2">By Source</h4>
                  <div className="space-y-1.5">
                    {bySource.map(s => (
                      <AccuracyBar key={s.source} label={s.source} accuracy={s.accuracy} total={s.total_alerts} />
                    ))}
                  </div>
                </div>

                {/* Per-state accuracy */}
                {byState.length > 0 && (
                  <div>
                    <h4 className="text-[10px] font-mono text-white/40 uppercase tracking-wider mb-2">Top States (by volume)</h4>
                    <div className="space-y-1.5">
                      {byState.map(s => (
                        <AccuracyBar key={s.state_abbr} label={s.state_abbr} accuracy={s.accuracy} total={s.total_alerts} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
