import { useMemo } from 'react';
import { ArrowLeft, Brain, TrendingUp, AlertTriangle, Activity, Link2, Loader2 } from 'lucide-react';
import { useDeck } from '@/contexts/DeckContext';
import { useStateBrief } from '@/hooks/useStateBrief';
import { usePatternLinks } from '@/hooks/usePatternLinks';
import { useConvergenceScores } from '@/hooks/useConvergenceScores';
import { useConvergenceAlerts } from '@/hooks/useConvergenceAlerts';

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

const COMPONENTS = [
  { key: 'weather', label: 'Weather', max: 25, color: 'bg-cyan-400' },
  { key: 'solunar', label: 'Solunar', max: 15, color: 'bg-indigo-400' },
  { key: 'migration', label: 'Migration', max: 25, color: 'bg-emerald-400' },
  { key: 'pattern', label: 'Pattern', max: 15, color: 'bg-amber-400' },
  { key: 'birdcast', label: 'BirdCast', max: 20, color: 'bg-purple-400' },
  { key: 'water', label: 'Water', max: 15, color: 'bg-blue-400' },
  { key: 'photoperiod', label: 'Photoperiod', max: 10, color: 'bg-orange-400' },
  { key: 'tide', label: 'Tide', max: 10, color: 'bg-teal-400' },
] as const;

function scoreColor(score: number): string {
  if (score >= 75) return 'text-green-400 border-green-400/30 bg-green-400/10';
  if (score >= 50) return 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10';
  if (score >= 25) return 'text-amber-400 border-amber-400/30 bg-amber-400/10';
  return 'text-white/40 border-white/10 bg-white/5';
}

function formatContentType(ct: string): string {
  return ct.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function StateIntelView() {
  const { selectedState, setSelectedState } = useDeck();
  const { brief, loading: briefLoading, error: briefError } = useStateBrief(selectedState);
  const { links, loading: linksLoading } = usePatternLinks(selectedState);
  const { scores } = useConvergenceScores();
  const { alerts } = useConvergenceAlerts();

  const convergence = selectedState ? scores.get(selectedState) : null;
  const stateAlerts = useMemo(
    () => alerts.filter(a => a.state_abbr === selectedState),
    [alerts, selectedState]
  );

  if (!selectedState) return null;

  const stateName = STATE_NAMES[selectedState] || selectedState;
  const score = convergence?.score ?? brief?.score ?? null;

  return (
    <div className="h-full flex flex-col bg-[#0a0f1a] overflow-hidden">
      {/* Sticky header */}
      <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-white/[0.06] bg-[#0a0f1a]/95 backdrop-blur-sm">
        <button
          onClick={() => setSelectedState(null)}
          className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          aria-label="Back to panels"
        >
          <ArrowLeft className="w-4 h-4 text-white/60" />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-white tracking-wide truncate font-[Playfair_Display]">
            {stateName}
          </h2>
          <p className="text-[10px] text-cyan-400/60 uppercase tracking-widest">State Intelligence</p>
        </div>
        {score !== null && (
          <div className={`px-2.5 py-1 rounded-md border text-xs font-mono font-bold ${scoreColor(score)}`}>
            {score}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto space-y-4 p-4">
        {/* Brief section */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Brain className="w-3.5 h-3.5 text-cyan-400" />
            <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider">Daily Assessment</h3>
          </div>
          <div className="rounded-lg border border-cyan-400/10 bg-cyan-400/[0.03] p-3">
            {briefLoading ? (
              <div className="flex items-center gap-2 text-white/40 text-xs">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Generating intelligence brief...
              </div>
            ) : briefError ? (
              <p className="text-xs text-red-400/80">{briefError}</p>
            ) : brief?.content ? (
              <p className="text-sm text-white/80 leading-relaxed">{brief.content}</p>
            ) : (
              <p className="text-xs text-white/30">No brief available yet. One will be generated when the convergence engine runs.</p>
            )}
          </div>
        </section>

        {/* Convergence breakdown */}
        {convergence && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
              <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider">Convergence Breakdown</h3>
              {convergence.national_rank && (
                <span className="ml-auto text-[10px] text-white/40">Rank #{convergence.national_rank}</span>
              )}
            </div>
            <div className="space-y-1.5">
              {COMPONENTS.map(comp => {
                const value = convergence[`${comp.key}_component` as keyof typeof convergence] as number;
                const pct = Math.min(100, (value / comp.max) * 100);
                return (
                  <div key={comp.key} className="flex items-center gap-2">
                    <span className="text-[10px] text-white/50 w-20 text-right shrink-0">{comp.label}</span>
                    <div className="flex-1 h-2 bg-white/[0.04] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${comp.color} transition-all`}
                        style={{ width: `${pct}%`, opacity: 0.8 }}
                      />
                    </div>
                    <span className="text-[10px] text-white/40 w-8 shrink-0 font-mono">{value}/{comp.max}</span>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Pattern links */}
        {(links.length > 0 || linksLoading) && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Link2 className="w-3.5 h-3.5 text-cyan-400" />
              <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider">Cross-Domain Patterns</h3>
              <span className="ml-auto text-[10px] text-white/30">72h</span>
            </div>
            {linksLoading ? (
              <div className="flex items-center gap-2 text-white/40 text-xs">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading patterns...
              </div>
            ) : (
              <div className="space-y-1.5">
                {links.slice(0, 8).map(link => (
                  <div
                    key={link.id}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-white/[0.04] bg-white/[0.02]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] text-white/60 truncate">
                        {formatContentType(link.source_content_type)}
                        <span className="text-cyan-400/40 mx-1">&rarr;</span>
                        {formatContentType(link.matched_content_type)}
                      </div>
                    </div>
                    <span className="text-[10px] font-mono text-cyan-400/60 shrink-0">
                      {(link.similarity * 100).toFixed(0)}%
                    </span>
                    <span className="text-[9px] text-white/25 shrink-0">{timeAgo(link.created_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Alerts */}
        {stateAlerts.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider">Recent Alerts</h3>
            </div>
            <div className="space-y-1.5">
              {stateAlerts.slice(0, 5).map((alert, i) => (
                <div
                  key={i}
                  className="px-2.5 py-2 rounded-md border border-amber-400/10 bg-amber-400/[0.03]"
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[10px] font-semibold text-amber-400 uppercase">{alert.alert_type}</span>
                    <span className="text-[10px] text-white/30 ml-auto">{timeAgo(alert.created_at)}</span>
                  </div>
                  <p className="text-xs text-white/60 leading-relaxed">{alert.reasoning}</p>
                  <div className="text-[10px] text-white/30 mt-1 font-mono">
                    Score: {alert.previous_score} &rarr; {alert.score}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Signals from brief data */}
        {brief?.signals && Array.isArray(brief.signals) && brief.signals.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider">Top Signals</h3>
            </div>
            <div className="space-y-1">
              {brief.signals.map((signal: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-white/[0.02] border border-white/[0.04]"
                >
                  <span className="text-[10px] text-cyan-400/50 font-mono shrink-0">
                    {signal.content_type ? formatContentType(signal.content_type) : 'signal'}
                  </span>
                  <span className="text-xs text-white/60 truncate">{signal.title || 'Untitled'}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Pattern links from brief data (if live links are empty) */}
        {links.length === 0 && brief?.pattern_links && Array.isArray(brief.pattern_links) && brief.pattern_links.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-2">
              <Link2 className="w-3.5 h-3.5 text-cyan-400" />
              <h3 className="text-xs font-semibold text-white/80 uppercase tracking-wider">Cross-Domain Patterns</h3>
              <span className="ml-auto text-[10px] text-white/30">from brief</span>
            </div>
            <div className="space-y-1.5">
              {brief.pattern_links.map((pl: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border border-white/[0.04] bg-white/[0.02]"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-white/60 truncate">
                      {formatContentType(pl.source_type || '')}
                      <span className="text-cyan-400/40 mx-1">&rarr;</span>
                      {formatContentType(pl.matched_type || '')}
                    </div>
                    <div className="text-[10px] text-white/30 truncate">
                      {pl.source_title} &harr; {pl.matched_title}
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-400/60 shrink-0">
                    {(pl.similarity * 100).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
