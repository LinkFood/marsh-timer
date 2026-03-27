import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Brain, Clock, Filter, ChevronDown, ChevronRight } from 'lucide-react';
import { useOpsData } from '@/hooks/useOpsData';
import { useStateArcs, type StateArc } from '@/hooks/useStateArcs';
import { useBrainJournal, FILTER_PRESETS, type JournalEntry } from '@/hooks/useBrainJournal';
import { useConvergenceScores } from '@/hooks/useConvergenceScores';
import CountdownClock from '@/components/intelligence/CountdownClock';

// ── Content type display config ──

const TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  'compound-risk-alert': { label: 'COMPOUND RISK', color: 'text-red-400 border-red-400/40', icon: '🔴' },
  'convergence-score':   { label: 'CONVERGENCE', color: 'text-cyan-400 border-cyan-400/40', icon: '📊' },
  'anomaly-alert':       { label: 'ANOMALY', color: 'text-amber-400 border-amber-400/40', icon: '⚡' },
  'correlation-discovery': { label: 'CORRELATION', color: 'text-purple-400 border-purple-400/40', icon: '🔗' },
  'alert-grade':         { label: 'GRADE', color: 'text-emerald-400 border-emerald-400/40', icon: '✓' },
  'arc-grade-reasoning': { label: 'POST-MORTEM', color: 'text-emerald-300 border-emerald-300/40', icon: '🧠' },
  'arc-fingerprint':     { label: 'ARC CLOSED', color: 'text-white/50 border-white/20', icon: '📁' },
  'state-brief':         { label: 'DAILY BRIEF', color: 'text-cyan-300 border-cyan-300/40', icon: '📋' },
  'disaster-watch':      { label: 'DISASTER WATCH', color: 'text-orange-400 border-orange-400/40', icon: '🌀' },
  'migration-spike-extreme': { label: 'MIGRATION SPIKE', color: 'text-emerald-400 border-emerald-400/40', icon: '🦆' },
  'migration-spike-significant': { label: 'MIGRATION', color: 'text-emerald-300 border-emerald-300/40', icon: '🦆' },
  'nws-alert':           { label: 'NWS ALERT', color: 'text-red-300 border-red-300/40', icon: '⚠️' },
  'weather-event':       { label: 'WEATHER', color: 'text-blue-400 border-blue-400/40', icon: '🌧️' },
  'bio-absence-signal':  { label: 'ABSENCE', color: 'text-gray-400 border-gray-400/40', icon: '👻' },
};

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

const ACT_COLORS: Record<string, string> = {
  buildup: 'bg-amber-400/20 text-amber-400',
  recognition: 'bg-orange-400/20 text-orange-400',
  outcome: 'bg-red-400/20 text-red-400',
  grade: 'bg-emerald-400/20 text-emerald-400',
};

const ACT_BORDER: Record<string, string> = {
  buildup: 'border-l-4 border-l-amber-400',
  recognition: 'border-l-4 border-l-orange-400',
  outcome: 'border-l-4 border-l-red-400',
  grade: 'border-l-4 border-l-emerald-400',
};

const ACT_DOT_COLOR: Record<string, string> = {
  buildup: 'bg-amber-400',
  recognition: 'bg-orange-400',
  outcome: 'bg-red-400',
  grade: 'bg-emerald-400',
};

const JOURNAL_TABS: { key: string; label: string }[] = [
  { key: 'brain', label: 'Brain Activity' },
  { key: 'all', label: 'All' },
  { key: 'weather', label: 'Weather' },
  { key: 'migration', label: 'Migration' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'grades', label: 'Grades' },
];

// ── Helpers ──

function renderNarrative(text: string): JSX.Element {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <span>
      {parts.map((part, i) =>
        i % 2 === 1 ? <strong key={i} className="text-white/90">{part}</strong> : part
      )}
    </span>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const isToday = d.toDateString() === now.toDateString();
  const isYesterday = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();

  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (diffMs < 60000) return 'just now';
  if (isToday) return time;
  if (isYesterday) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function groupByDay(entries: JournalEntry[]): { date: string; label: string; entries: JournalEntry[] }[] {
  const groups = new Map<string, JournalEntry[]>();
  const now = new Date();

  for (const entry of entries) {
    const d = new Date(entry.created_at);
    const key = d.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  return Array.from(groups.entries()).map(([date, entries]) => {
    const d = new Date(date + 'T12:00:00');
    const isToday = d.toDateString() === now.toDateString();
    const isYesterday = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();
    const label = isToday ? 'Today' : isYesterday ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    return { date, label, entries };
  });
}

function getArcTier(arc: StateArc, score: number): 'critical' | 'elevated' | 'active' {
  if (arc.current_act === 'grade') return 'critical';
  if (arc.current_act === 'outcome' && score >= 60) return 'critical';
  if (arc.current_act === 'recognition' || arc.current_act === 'outcome') return 'elevated';
  return 'active';
}

// ── Journal Entry Component ──

function JournalRow({ entry, expanded, onToggle }: { entry: JournalEntry; expanded: boolean; onToggle: () => void }) {
  const cfg = TYPE_CONFIG[entry.content_type] || { label: entry.content_type, color: 'text-white/40 border-white/20', icon: '•' };

  return (
    <div className="group">
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors text-left"
      >
        {/* Timeline dot + line */}
        <div className="flex flex-col items-center shrink-0 pt-0.5">
          <div className={`w-2 h-2 rounded-full border ${cfg.color} shrink-0`} />
          <div className="w-px flex-1 bg-white/[0.06] mt-1" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-mono text-white/30">{formatTime(entry.created_at)}</span>
            <span className={`text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border ${cfg.color}`}>
              {cfg.label}
            </span>
            {entry.state_abbr && (
              <span className="text-[9px] font-mono bg-cyan-400/10 text-cyan-400/80 px-1.5 py-0.5 rounded">
                {entry.state_abbr}
              </span>
            )}
            {entry.signal_weight > 1.2 && (
              <span className="text-[8px] font-mono text-amber-400/60">x{entry.signal_weight.toFixed(1)}</span>
            )}
            <span className="ml-auto shrink-0 text-white/20">
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
          </div>
          <p className={`text-[11px] font-mono text-white/70 ${expanded ? '' : 'line-clamp-2'}`}>
            {renderNarrative(entry.title)}
          </p>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="pl-[28px] pr-4 pb-3">
          <div className="bg-white/[0.02] rounded-lg p-3 border border-white/[0.06] text-[10px] font-mono text-white/60 leading-relaxed whitespace-pre-wrap">
            {renderNarrative(entry.content)}
          </div>
          {entry.metadata && Object.keys(entry.metadata).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(entry.metadata).slice(0, 6).map(([k, v]) => (
                <span key={k} className="text-[8px] font-mono text-white/20 bg-white/[0.03] px-1.5 py-0.5 rounded">
                  {k}: {typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : String(v).slice(0, 40)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Arc Banner — Critical Tier (full card) ──

function ArcBannerFull({ arc, score, selected, onClick }: { arc: StateArc; score: number; selected: boolean; onClick: () => void }) {
  const actColor = ACT_COLORS[arc.current_act] || 'bg-white/10 text-white/50';
  const borderColor = ACT_BORDER[arc.current_act] || '';
  const domains = Array.isArray((arc.buildup_signals as Record<string, unknown>)?.domains)
    ? ((arc.buildup_signals as Record<string, unknown>).domains as string[])
    : [];

  return (
    <button onClick={onClick} className="w-full text-left">
      <div className={`bg-gray-900/80 border border-gray-800 rounded-lg p-4 ${borderColor} ${selected ? 'ring-1 ring-cyan-400/40' : ''}`}>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-lg font-mono font-bold text-cyan-400">{score}</span>
          <span className="text-[8px] text-white/30 font-mono">/ 135</span>
          <span className={`text-[8px] font-mono uppercase px-2 py-1 rounded ${actColor}`}>
            {arc.current_act}
          </span>
          <span className="text-[12px] font-mono font-bold text-white/90 ml-auto">{arc.state_abbr}</span>
          {arc.outcome_deadline && (
            <CountdownClock deadline={arc.outcome_deadline} />
          )}
        </div>
        {domains.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {domains.map(d => (
              <span key={d} className="text-[7px] font-mono px-1.5 py-0.5 rounded bg-cyan-400/10 text-cyan-400/60">
                {d}
              </span>
            ))}
          </div>
        )}
        {arc.narrative && (
          <p className="text-[10px] font-mono text-white/50 line-clamp-2">
            {renderNarrative(arc.narrative)}
          </p>
        )}
      </div>
    </button>
  );
}

// ── Arc Banner — Elevated Tier (medium card) ──

function ArcBannerMedium({ arc, score, selected, onClick }: { arc: StateArc; score: number; selected: boolean; onClick: () => void }) {
  const actColor = ACT_COLORS[arc.current_act] || 'bg-white/10 text-white/50';
  const borderColor = ACT_BORDER[arc.current_act] || '';
  const domains = Array.isArray((arc.buildup_signals as Record<string, unknown>)?.domains)
    ? ((arc.buildup_signals as Record<string, unknown>).domains as string[])
    : [];

  return (
    <button onClick={onClick} className="w-full text-left">
      <div className={`bg-gray-900/80 border border-gray-800 rounded-lg p-3 ${borderColor} ${selected ? 'ring-1 ring-cyan-400/40' : ''}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-mono font-bold text-cyan-400">{score}</span>
          <span className={`text-[8px] font-mono uppercase px-1.5 py-0.5 rounded ${actColor}`}>
            {arc.current_act}
          </span>
          <span className="text-[11px] font-mono font-bold text-white/80 ml-auto">{arc.state_abbr}</span>
        </div>
        {domains.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {domains.slice(0, 4).map(d => (
              <span key={d} className="text-[7px] font-mono px-1 py-0.5 rounded bg-cyan-400/10 text-cyan-400/60">
                {d}
              </span>
            ))}
            {domains.length > 4 && (
              <span className="text-[7px] font-mono text-white/30">+{domains.length - 4}</span>
            )}
          </div>
        )}
        {arc.narrative && (
          <p className="text-[9px] font-mono text-white/40 line-clamp-1">
            {renderNarrative(arc.narrative)}
          </p>
        )}
      </div>
    </button>
  );
}

// ── Arc Pill — Active Tier (compact) ──

function ArcPill({ arc, score, selected, onClick }: { arc: StateArc; score: number; selected: boolean; onClick: () => void }) {
  const dotColor = ACT_DOT_COLOR[arc.current_act] || 'bg-white/30';

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono whitespace-nowrap transition-colors ${
        selected ? 'bg-cyan-400/20 text-cyan-400' : 'bg-gray-900/60 text-white/50 hover:bg-white/[0.04] hover:text-white/70'
      }`}
    >
      <span className="font-bold">{arc.state_abbr}</span>
      <span className="text-white/30">{score}</span>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
    </button>
  );
}

// ── Main Page ──

export default function IntelligencePage() {
  const { data: opsData, loading: opsLoading } = useOpsData();
  const { arcs } = useStateArcs();
  const { scores } = useConvergenceScores();
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [journalTab, setJournalTab] = useState('brain');
  const { entries, loading: journalLoading } = useBrainJournal(stateFilter, journalTab);

  // States with active arcs, sorted by score, grouped into tiers
  const tieredArcs = useMemo(() => {
    const withScore = arcs
      .map(a => ({ arc: a, score: scores.get(a.state_abbr)?.score || 0 }))
      .sort((a, b) => b.score - a.score);

    const critical: typeof withScore = [];
    const elevated: typeof withScore = [];
    const active: typeof withScore = [];

    for (const item of withScore) {
      const tier = getArcTier(item.arc, item.score);
      if (tier === 'critical') critical.push(item);
      else if (tier === 'elevated') elevated.push(item);
      else active.push(item);
    }

    return { critical, elevated, active };
  }, [arcs, scores]);

  // Top states by score (for filter pills)
  const topStates = useMemo(() => {
    return Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(s => s.state_abbr);
  }, [scores]);

  const grouped = useMemo(() => groupByDay(entries), [entries]);

  const totalGraded = opsData.alerts.confirmed + opsData.alerts.partial + opsData.alerts.missed + opsData.alerts.false_alarm;
  const systemHealthy = opsData.crons.error_count === 0;

  const handleArcClick = (stateAbbr: string) => {
    setStateFilter(stateFilter === stateAbbr ? null : stateAbbr);
  };

  if (opsLoading && journalLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-white/30 text-sm font-mono tracking-widest uppercase">Loading journal...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* ── Header ── */}
      <div className="sticky top-0 z-50 bg-gray-900/95 backdrop-blur border-b border-gray-800">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link to="/" className="p-1.5 rounded hover:bg-white/[0.05] transition-colors">
              <ArrowLeft size={16} className="text-white/50" />
            </Link>
            <Brain size={16} className="text-cyan-400" />
            <div className="hidden sm:flex flex-col">
              <span className="text-xs font-display font-bold tracking-widest text-white/90">BRAIN JOURNAL</span>
              <span className="text-[7px] tracking-[0.2em] text-white/40 -mt-0.5">WATCH THE BRAIN THINK</span>
            </div>
            <span className="text-xs font-display font-bold tracking-widest text-white/90 sm:hidden">JOURNAL</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex flex-col items-center px-2">
              <span className="text-sm font-mono font-bold text-cyan-400">{opsData.brain.total.toLocaleString()}</span>
              <span className="text-[8px] font-mono text-white/40">entries</span>
            </div>
            <div className="flex flex-col items-center px-2">
              <span className="text-sm font-mono font-bold text-orange-400">{arcs.length}</span>
              <span className="text-[8px] font-mono text-white/40">arcs</span>
            </div>
            {totalGraded < 10 ? (
              <div className="flex flex-col items-center px-2">
                <span className="text-[9px] font-mono text-white/30 italic">Learning</span>
                <span className="text-[8px] font-mono text-white/40">{totalGraded}/10</span>
              </div>
            ) : (
              <div className="flex flex-col items-center px-2">
                <span className={`text-sm font-mono font-bold ${opsData.alerts.accuracy >= 60 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {opsData.alerts.accuracy}%
                </span>
                <span className="text-[8px] font-mono text-white/40">accuracy</span>
              </div>
            )}
            <span className={`w-2 h-2 rounded-full shrink-0 ${systemHealthy ? 'bg-emerald-400' : 'bg-red-400'}`} />
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">

        {/* ── Critical Arcs ── */}
        {tieredArcs.critical.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              <span className="text-[10px] font-mono text-red-400/80 uppercase tracking-wider font-bold">Critical</span>
              <span className="text-[9px] font-mono text-white/20">({tieredArcs.critical.length})</span>
            </div>
            <div className="grid grid-cols-1 gap-2">
              {tieredArcs.critical.map(({ arc, score }) => (
                <ArcBannerFull
                  key={arc.id}
                  arc={arc}
                  score={score}
                  selected={stateFilter === arc.state_abbr}
                  onClick={() => handleArcClick(arc.state_abbr)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Elevated Arcs ── */}
        {tieredArcs.elevated.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-400" />
              <span className="text-[10px] font-mono text-orange-400/80 uppercase tracking-wider font-bold">Elevated</span>
              <span className="text-[9px] font-mono text-white/20">({tieredArcs.elevated.length})</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {tieredArcs.elevated.map(({ arc, score }) => (
                <ArcBannerMedium
                  key={arc.id}
                  arc={arc}
                  score={score}
                  selected={stateFilter === arc.state_abbr}
                  onClick={() => handleArcClick(arc.state_abbr)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Active Arcs (Buildup) — Compact Pills ── */}
        {tieredArcs.active.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Clock size={12} className="text-amber-400/60" />
              <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">Active</span>
              <span className="text-[9px] font-mono text-white/20">({tieredArcs.active.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tieredArcs.active.map(({ arc, score }) => (
                <ArcPill
                  key={arc.id}
                  arc={arc}
                  score={score}
                  selected={stateFilter === arc.state_abbr}
                  onClick={() => handleArcClick(arc.state_abbr)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── State Filter Pills ── */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
          <Filter size={12} className="text-white/30 shrink-0" />
          <button
            onClick={() => setStateFilter(null)}
            className={`px-2.5 py-1 rounded text-[10px] font-mono whitespace-nowrap transition-colors ${
              !stateFilter ? 'bg-cyan-400/20 text-cyan-400' : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]'
            }`}
          >
            All States
          </button>
          {topStates.map(abbr => (
            <button
              key={abbr}
              onClick={() => setStateFilter(stateFilter === abbr ? null : abbr)}
              className={`px-2.5 py-1 rounded text-[10px] font-mono whitespace-nowrap transition-colors ${
                stateFilter === abbr ? 'bg-cyan-400/20 text-cyan-400' : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04]'
              }`}
            >
              {abbr}
            </button>
          ))}
        </div>

        {/* ── Journal Type Filter Tabs ── */}
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide pb-1">
          {JOURNAL_TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setJournalTab(tab.key)}
              className={`px-3 py-1.5 rounded text-[10px] font-mono whitespace-nowrap transition-colors ${
                journalTab === tab.key
                  ? 'bg-cyan-400/15 text-cyan-400 border border-cyan-400/30'
                  : 'text-white/40 hover:text-white/60 hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ── The Journal ── */}
        {journalLoading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <div className="w-2 h-2 rounded-full bg-white/[0.06] shrink-0 mt-1" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 bg-white/[0.06] rounded animate-pulse w-1/3" />
                  <div className="h-3 bg-white/[0.04] rounded animate-pulse w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Brain size={32} className="text-white/10" />
            <span className="text-[10px] font-mono text-white/20">
              {stateFilter ? `No journal entries for ${STATE_NAMES[stateFilter] || stateFilter}` : 'No journal entries yet'}
            </span>
          </div>
        ) : (
          <div className="bg-gray-900/50 rounded-lg border border-gray-800/50 overflow-hidden">
            {grouped.map(group => (
              <div key={group.date}>
                {/* Day separator */}
                <div className="sticky top-[57px] z-10 bg-gray-900/95 backdrop-blur px-4 py-1.5 border-b border-gray-800/50">
                  <span className="text-[10px] font-mono text-white/30 uppercase tracking-wider">{group.label}</span>
                  <span className="text-[9px] font-mono text-white/15 ml-2">{group.entries.length} entries</span>
                </div>
                {/* Entries */}
                {group.entries.map(entry => (
                  <JournalRow
                    key={entry.id}
                    entry={entry}
                    expanded={expandedId === entry.id}
                    onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
