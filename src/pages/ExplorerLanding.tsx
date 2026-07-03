import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, Send, Flame, Loader2, RotateCcw, Waves, Scale, CalendarDays } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import { useTodayBriefing } from '@/hooks/useTodayBriefing';
import { useSolunarToday, formatSolunarLine } from '@/hooks/useSolunarToday';
import { useThisDayInHistory } from '@/hooks/useThisDayInHistory';
import { useLatestLayers, type LayerItem } from '@/hooks/useLatestLayers';
import { useClaims, useClaimFires, type ClaimFire } from '@/hooks/useClaims';
import { useBirdActivity, useTodayAnomaly, degreesToCompass, type BirdDay } from '@/hooks/useTodaySignals';
import { useTodayEventMap } from '@/hooks/useTodayEventMap';
import { useUserLocation, US_STATES, getStateName } from '@/hooks/useUserLocation';
import { humanizeEntry, yearLines, layerMeta } from '@/lib/humanize';
import EventMap from '@/components/EventMap';
import BrainResponseCard from '@/components/BrainResponseCard';
import AppHeader from '@/components/AppHeader';
import UserMenu from '@/components/UserMenu';
import ErrorBoundary from '@/components/ErrorBoundary';
import Denominator from '@/components/Denominator';
import PrecedentCard from '@/components/PrecedentCard';
import CascadeRibbon from '@/components/CascadeRibbon';
import CountdownClock from '@/components/salvage/CountdownClock';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * The Today page. Desktop: two columns — narrative left, live rail right
 * (tile map + latest-from-the-layers + latest verdict, sticky). Mobile:
 * single column, rail content flows inline. Everything on load is a direct
 * REST read or an existing non-LLM edge function; the dispatcher only fires
 * when the user asks something. Show don't predict — precedents carry
 * denominators.
 */

function SectionLabel({ children }: { children: string }) {
  return (
    <h2 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-3">{children}</h2>
  );
}

/** Tiny inline SVG sparkline — no chart lib. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 3) return null;
  const w = 72, h = 18;
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / range) * (h - 4)}`)
    .join(' ');
  return (
    <svg width={w} height={h} className="inline-block align-middle opacity-70" aria-hidden>
      <polyline points={pts} fill="none" stroke="rgb(34 211 238 / 0.6)" strokeWidth="1.5" />
    </svg>
  );
}

/** S3 — one unevaluated claim fire, rendered as a watch card with receipts. */
function WatchCard({ fire, claimName }: { fire: ClaimFire; claimName: string }) {
  const detail = (fire.detail && typeof fire.detail === 'object' ? fire.detail : null) as Record<string, unknown> | null;
  const observation = String(detail?.observation || detail?.summary || detail?.text || claimName);
  return (
    <div className="bg-gray-950/60 rounded-lg border border-gray-800 p-4">
      <div className="flex items-start gap-2 mb-2">
        <Flame size={13} className="text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm font-body text-white/80 leading-snug">{observation}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] mb-2">
        <Denominator n={fire.control_n} k={fire.control_hits} label="controls" />
        {fire.window_end && (
          <span className="flex items-center gap-1.5">
            <span className="font-mono text-white/30">window closes</span>
            <CountdownClock deadline={fire.window_end} />
          </span>
        )}
      </div>
      <Link to="/court" className="text-[10px] font-mono text-cyan-400/70 hover:text-cyan-400 transition-colors">
        Filed as claim → Court
      </Link>
    </div>
  );
}

function birdLine(latest: BirdDay, stateName: string): string {
  const n = latest.cumulative_birds;
  const when = new Date(latest.date + 'T12:00:00').toDateString() === new Date().toDateString()
    ? 'today' : 'last night';
  const dir = latest.avg_direction != null ? `, moving ${degreesToCompass(latest.avg_direction)}` : '';
  if (n == null || n === 0) return `Radar shows quiet skies over ${stateName} ${when}.`;
  return `Radar counted ${n.toLocaleString()} birds over ${stateName} ${when}${dir}.`;
}

function relativeDay(dateStr: string): string {
  const then = new Date(dateStr + 'T12:00:00');
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const days = Math.round((now.getTime() - then.getTime()) / 86400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

/** Right-rail feed: the most recent notable entries across the layers. */
function LayersFeed({ items, loading }: { items: LayerItem[]; loading: boolean }) {
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; text: string; state: string | null; when: string; label: string; color: string }[] = [];
    for (const it of items) {
      const text = humanizeEntry(it.title, it.content_type);
      const key = `${text}|${it.state_abbr || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const meta = layerMeta(it.content_type);
      out.push({ key, text, state: it.state_abbr, when: relativeDay(it.effective_date), label: meta.label, color: meta.color });
    }
    return out;
  }, [items]);

  return (
    <section>
      <SectionLabel>Latest from the layers</SectionLabel>
      {loading ? (
        <p className="text-[10px] font-mono text-white/25">Reading the layers...</p>
      ) : rows.length === 0 ? (
        <p className="font-body text-sm text-white/40 italic">The layers are quiet — nothing notable in the last three days.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map(row => (
            <li key={row.key} className="flex items-start gap-2.5">
              <span className="w-1.5 h-1.5 rounded-full mt-[5px] shrink-0" style={{ backgroundColor: row.color }} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-body text-white/65 leading-snug">{row.text}</p>
                <p className="text-[9px] font-mono text-white/30 mt-0.5">
                  {row.state ? `${row.state} · ` : ''}{row.when} · {row.label}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function ExplorerLanding() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { state: locState, setUserState } = useUserLocation();
  // ?state=XX (middleware redirects of /XX and /duck/XX) overrides geolocation
  const [override, setOverride] = useState<string | null>(() => {
    const s = new URLSearchParams(window.location.search).get('state')?.toUpperCase();
    return s && US_STATES.some(st => st.abbr === s) ? s : null;
  });
  const state = override ?? locState;
  const stateName = getStateName(state);
  const [showStates, setShowStates] = useState(false);
  const [question, setQuestion] = useState('');
  const [archiveDate, setArchiveDate] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const autoFiredRef = useRef(false);

  // --- Data on load: cheap REST only, zero LLM ---
  const { data: briefing } = useTodayBriefing(state);            // hunt-today-briefing (table reads)
  const solunarRow = useSolunarToday();                          // hunt_solunar_calendar direct (briefing's cache is stale)
  const { latest: birdLatest, history: birdHistory } = useBirdActivity(state);
  const anomaly = useTodayAnomaly(state);
  const { years: historyYears } = useThisDayInHistory(undefined, state);
  const { claims, status: claimsStatus } = useClaims();
  const { fires, status: firesStatus } = useClaimFires();
  const { byState: eventsByState, activityByState, loading: eventsLoading, quiet: eventsQuiet } = useTodayEventMap();
  const { items: layerItems, loading: layersLoading } = useLatestLayers();

  // --- Chat: fires ONLY on user action (or explicit ?q= deep link) ---
  const { messages, loading, streaming, sendMessage, clearMessages } = useChat({
    species: 'all',
    stateAbbr: state,
    onMapAction: () => {},
  });

  const now = new Date();
  const dateStr = `${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

  const ask = useCallback((q: string) => {
    if (!q.trim() || loading || streaming) return;
    sendMessage(q.trim());
    setQuestion('');
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 150);
  }, [loading, streaming, sendMessage]);

  // Auto-fire deep-linked question (?q=...) — user intent, not a page-load call
  useEffect(() => {
    if (autoFiredRef.current) return;
    const q = searchParams.get('q');
    if (q && q.trim()) {
      autoFiredRef.current = true;
      sendMessage(q.trim());
    }
  }, [searchParams, sendMessage]);

  // Keep the answer in view while streaming
  useEffect(() => {
    if (streaming) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // Embed completed responses back into the brain (query-signal)
  const embeddedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!SUPABASE_URL || !SUPABASE_KEY || loading || streaming) return;
    for (const msg of messages) {
      if (msg.role !== 'assistant' || !msg.content || msg.content.length <= 50 || embeddedRef.current.has(msg.id)) continue;
      embeddedRef.current.add(msg.id);
      const userMsg = messages[messages.indexOf(msg) - 1];
      const queryText = userMsg?.role === 'user' ? userMsg.content : 'unknown query';
      fetch(`${SUPABASE_URL}/functions/v1/hunt-embed-interaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
        body: JSON.stringify({
          content: `User asked: "${queryText}" — Brain responded with ${msg.content.length} chars of cross-domain analysis.`,
          content_type: 'query-signal',
          title: `Query: ${queryText.slice(0, 80)}`,
          metadata: { query: queryText, response_length: msg.content.length, state, timestamp: new Date().toISOString() },
        }),
      }).catch(() => {});
    }
  }, [messages, loading, streaming, state]);

  // S3 — this state's unevaluated fires
  const claimNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of claims) map.set(c.id, c.name || (c.claim_name as string) || 'Registered claim');
    return map;
  }, [claims]);
  const watchFires = firesStatus === 'ready'
    ? fires.filter(f => f.evaluated === false && f.state_abbr === state).slice(0, 2)
    : [];

  // S3.5 — court strip: docket counts + the single latest evaluated verdict
  const awaitingVerdict = firesStatus === 'ready' ? fires.filter(f => f.evaluated === false).length : 0;
  const latestVerdict = firesStatus === 'ready' ? fires.find(f => f.evaluated === true) ?? null : null;
  const courtUnavailable = claimsStatus === 'unavailable' && firesStatus === 'unavailable';

  const mmdd = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const todayISO = `${now.getFullYear()}-${mmdd}`;

  // S5 — four proven-good question shapes, state-substituted
  const chips = [
    `What was happening in ${stateName} on ${MONTHS[now.getMonth()]} ${now.getDate()}, 2012?`,
    `Compare today to this day last year in ${stateName}`,
    'Walk me back through the two weeks before the June heat wave',
    `When has drought in ${stateName} coincided with unusual bird activity?`,
  ];

  const weather = briefing?.current_weather ?? null;
  const birdValues = birdHistory.map(d => d.cumulative_birds ?? 0);
  const docketCount = claimsStatus === 'ready' && claims.length > 0 ? claims.length : 4;

  const archiveDateLabel = archiveDate
    ? new Date(archiveDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  // --- Rail pieces (rendered in the sticky rail on desktop, inline on mobile) ---
  const mapPanel = (
    <section>
      <SectionLabel>Today on the map</SectionLabel>
      <EventMap
        byState={eventsByState}
        activityByState={activityByState}
        loading={eventsLoading}
        quiet={eventsQuiet}
        selectedState={state}
        onSelectState={abbr => { setOverride(null); setUserState(abbr); }}
      />
    </section>
  );

  const layersFeed = <LayersFeed items={layerItems} loading={layersLoading} />;

  const verdictPanel = latestVerdict ? (
    <section>
      <SectionLabel>Latest verdict</SectionLabel>
      <div className="border border-gray-800 rounded-lg bg-gray-900/50 p-4 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className={`font-mono text-xs font-bold ${latestVerdict.hit ? 'text-teal-400' : 'text-red-400'}`}>
            {latestVerdict.hit ? 'HIT' : 'MISS'}
          </span>
          <span className="font-body text-sm text-white/70">
            {claimNameById.get(latestVerdict.claim_id || '') || 'Registered claim'}
          </span>
        </div>
        <Denominator n={latestVerdict.control_n} k={latestVerdict.control_hits} label="controls" className="text-[10px]" />
        <div>
          <Link to="/court" className="text-[10px] font-mono text-cyan-400/70 hover:text-cyan-400 transition-colors">
            Full record →
          </Link>
        </div>
      </div>
    </section>
  ) : null;

  return (
    <div className="min-h-[100dvh] bg-gray-950 flex flex-col">
      <AppHeader>
        <UserMenu />
      </AppHeader>

      <main className="flex-1">
        <div className="max-w-2xl md:max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-10 md:grid md:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_420px] md:gap-10 md:items-start">

          {/* ---------- LEFT COLUMN ---------- */}
          <div className="space-y-10 min-w-0">

          {/* S2 — TODAY, HERE */}
          <section>
            <div className="relative flex flex-wrap items-center gap-2 mb-4">
              <h1 className="font-body text-2xl sm:text-3xl text-white/90 leading-tight">
                {dateStr} — {stateName}
              </h1>
              <button
                onClick={() => setShowStates(!showStates)}
                className="flex items-center gap-1 px-2 py-1 rounded-full border border-white/10 bg-white/[0.03] hover:border-cyan-400/30 transition-colors"
              >
                <span className="text-[10px] font-mono text-cyan-400/80">{state}</span>
                <ChevronDown size={10} className={`text-white/30 transition-transform ${showStates ? 'rotate-180' : ''}`} />
              </button>
              {showStates && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-gray-900 border border-white/10 rounded-lg shadow-xl max-h-64 overflow-y-auto w-56">
                  {US_STATES.map(s => (
                    <button
                      key={s.abbr}
                      onClick={() => { setOverride(null); setUserState(s.abbr); setShowStates(false); }}
                      className={`w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-white/[0.06] transition-colors ${
                        s.abbr === state ? 'text-cyan-400 bg-cyan-400/[0.06]' : 'text-white/50'
                      }`}
                    >
                      <span className="font-bold mr-2">{s.abbr}</span>
                      <span className="text-white/30">{s.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2.5">
              {weather && (
                <p className="font-body text-xl sm:text-2xl text-white/70 leading-snug">
                  {weather.temperature_f != null ? `${weather.temperature_f}°` : '—'} and {weather.conditions.toLowerCase()}
                  {weather.wind_mph != null && weather.wind_mph > 0 ? `, wind ${weather.wind_direction} ${weather.wind_mph} mph` : ''}.
                </p>
              )}
              {birdLatest && (
                <p className="font-body text-sm text-white/55 leading-snug">
                  {birdLine(birdLatest, stateName)}{' '}
                  <Sparkline values={birdValues} />
                </p>
              )}
              {solunarRow && (
                <p className="font-body text-sm text-white/45 leading-snug">
                  {formatSolunarLine(solunarRow)}
                </p>
              )}
              {anomaly && (
                <p className="font-body text-sm text-amber-300/70 leading-snug">
                  {anomaly.checkName} here is {Math.abs(anomaly.zScore).toFixed(1)}σ {anomaly.direction} normal — statistically unusual.
                </p>
              )}
            </div>
          </section>

          {/* S2.5 — map inline on mobile only (lives in the rail on desktop) */}
          <div className="md:hidden">{mapPanel}</div>

          {/* S3 — WHAT'S BUILDING */}
          <section>
            <div className="border border-gray-800 rounded-lg bg-gray-900/50 p-4">
              <SectionLabel>What's building</SectionLabel>
              {watchFires.length > 0 ? (
                <div className="space-y-3">
                  {watchFires.map(fire => (
                    <WatchCard key={fire.id} fire={fire} claimName={claimNameById.get(fire.claim_id || '') || 'Registered claim'} />
                  ))}
                </div>
              ) : (
                <div className="flex items-start gap-2.5">
                  <Waves size={14} className="text-white/20 mt-0.5 shrink-0" />
                  <p className="font-body text-sm text-white/40 leading-relaxed">
                    Nothing building. The layers are within seasonal range.
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* S3.5 — THE COURT */}
          <section id="court">
            <div className="border border-gray-800 rounded-lg bg-gray-900/50 p-4">
              <SectionLabel>The Court</SectionLabel>
              <div className="flex items-start gap-2.5">
                <Scale size={14} className="text-white/20 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  {courtUnavailable ? (
                    <p className="font-body text-sm text-white/40 leading-relaxed">
                      The court convenes — first claims being registered.
                    </p>
                  ) : (
                    <>
                      <p className="font-body text-sm text-white/70">
                        {docketCount} claims on the docket · {awaitingVerdict} awaiting verdict
                      </p>
                      {latestVerdict && (
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                          <span className={`font-mono font-bold ${latestVerdict.hit ? 'text-teal-400' : 'text-red-400'}`}>
                            {latestVerdict.hit ? 'HIT' : 'MISS'}
                          </span>
                          <span className="font-body text-white/55">
                            {claimNameById.get(latestVerdict.claim_id || '') || 'Registered claim'}
                          </span>
                          <Denominator n={latestVerdict.control_n} k={latestVerdict.control_hits} label="controls" className="text-[10px]" />
                        </p>
                      )}
                    </>
                  )}
                  <Link to="/court" className="inline-block text-[11px] font-mono text-cyan-400/70 hover:text-cyan-400 transition-colors">
                    Full record →
                  </Link>
                </div>
              </div>
            </div>
          </section>

          {/* S3.6 — THE CASCADE teaser (quiet, one accent) */}
          <section>
            <Link
              to="/cascade/july-2026-heat"
              className="group block rounded-lg border border-white/[0.06] bg-gray-900/40 hover:border-violet-400/25 transition-colors overflow-hidden"
            >
              <div className="opacity-80">
                <CascadeRibbon mini />
              </div>
              <p className="px-4 py-2.5 text-[11px] font-body text-white/50 leading-snug border-t border-white/[0.05]">
                The birds went silent 11 days before the July heat wave.{' '}
                <span className="font-mono text-violet-300/70 group-hover:text-violet-300 transition-colors">See the cascade →</span>
              </p>
            </Link>
          </section>

          {/* Layers feed inline on mobile only (lives in the rail on desktop) */}
          <div className="md:hidden">{layersFeed}</div>

          {/* S4 — THE ARCHIVE (open any day + this-day preview cards) */}
          <section id="archive">
            <SectionLabel>The Archive</SectionLabel>

            <div className="flex items-center gap-2 mb-4">
              <div className="relative">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-900 border border-white/10 hover:border-cyan-400/30 transition-colors pointer-events-none">
                  <CalendarDays size={13} className="text-cyan-400/70" />
                  {archiveDateLabel ? (
                    <span className="font-display text-sm text-white/90">{archiveDateLabel}</span>
                  ) : (
                    <span className="font-body text-sm text-white/50">Open any day →</span>
                  )}
                </div>
                <input
                  ref={dateInputRef}
                  type="date"
                  min="1950-01-01"
                  max={todayISO}
                  value={archiveDate}
                  onChange={e => setArchiveDate(e.target.value)}
                  onClick={() => { try { dateInputRef.current?.showPicker(); } catch { /* native fallback */ } }}
                  aria-label="Open any day in the archive"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
              {archiveDate && (
                <button
                  onClick={() => navigate(`/date/${archiveDate}?state=${state}`)}
                  className="px-3 py-2 rounded-lg border border-white/10 bg-white/[0.03] hover:border-cyan-400/30 transition-colors text-[11px] font-mono text-cyan-400/80"
                >
                  Open →
                </button>
              )}
              <span className="text-[10px] font-mono text-white/25 hidden sm:inline">any day, 1950 → today</span>
            </div>

            <p className="text-[10px] font-mono text-white/30 mb-2">This day across the years —</p>
            {historyYears.length > 0 ? (
              <div className="space-y-2.5">
                {historyYears.map(({ year, entries }) => (
                  <PrecedentCard
                    key={year}
                    dateHeadline={`${MONTHS[now.getMonth()]} ${now.getDate()}, ${year}`}
                    lines={yearLines(entries)}
                    to={`/date/${year}-${mmdd}?state=${state}`}
                  />
                ))}
              </div>
            ) : (
              <p className="font-body text-sm text-white/30">Opening the archive for this day...</p>
            )}
            <p className="mt-3 text-[10px] font-mono text-white/25">
              Nearest-day matching arrives when the similarity engine clears verification.
            </p>
            <p className="mt-2 text-[10px] font-mono text-white/25">
              <Link to="/cascade" className="hover:text-white/50 transition-colors">
                Strangest days — replays of days the layers moved together →
              </Link>
            </p>
          </section>

          {/* S5 — ASK THE ARCHIVE */}
          <section>
            <SectionLabel>Ask the archive</SectionLabel>

            <form onSubmit={e => { e.preventDefault(); ask(question); }} className="mb-3">
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-900 border border-white/10 focus-within:border-cyan-400/30 transition-colors">
                <input
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  placeholder={messages.length > 0 ? 'Ask a follow-up...' : 'Ask the archive anything...'}
                  className="flex-1 min-w-0 bg-transparent text-sm font-body text-white/90 placeholder:text-white/25 outline-none"
                />
                <button type="submit" disabled={!question.trim() || loading || streaming} className="p-1.5 rounded hover:bg-white/[0.06] transition-colors disabled:opacity-20">
                  {loading && !streaming ? <Loader2 size={14} className="text-cyan-400 animate-spin" /> : <Send size={14} className="text-cyan-400" />}
                </button>
              </div>
            </form>

            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2">
                {chips.map(q => (
                  <button
                    key={q}
                    onClick={() => ask(q)}
                    disabled={loading || streaming}
                    className="px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/10 transition-colors text-[11px] font-body text-white/40 hover:text-white/60 text-left"
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            <ErrorBoundary fallback={<p className="text-xs text-white/40 text-center py-8">Error loading response.</p>}>
              {messages.map((msg, i) => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="mt-4 mb-3 text-right">
                      <span className="inline-block text-xs font-body text-white/70 bg-cyan-400/[0.08] rounded-lg px-3 py-2 max-w-[85%] text-left">
                        {msg.content}
                      </span>
                    </div>
                  );
                }
                if (msg.role === 'assistant' && msg.content) {
                  return (
                    <BrainResponseCard
                      key={msg.id}
                      message={msg}
                      isStreaming={streaming && i === messages.length - 1}
                      onFollowUp={q => ask(q)}
                    />
                  );
                }
                return null;
              })}
              {loading && !streaming && (
                <p className="text-xs font-mono text-cyan-400/40 text-center py-6 animate-pulse">
                  Searching the archive...
                </p>
              )}
            </ErrorBoundary>

            {messages.length > 0 && !loading && !streaming && (
              <button
                onClick={clearMessages}
                className="mt-3 px-3 py-1.5 rounded-lg border border-white/[0.06] hover:bg-white/[0.04] transition-colors inline-flex items-center gap-1.5"
              >
                <RotateCcw size={11} className="text-white/30" />
                <span className="font-body text-[11px] text-white/30">New question</span>
              </button>
            )}
            <div ref={bottomRef} />
          </section>

          {/* S6 — Footer */}
          <footer className="border-t border-white/[0.06] pt-5 space-y-2 text-center">
            <p className="text-[10px] font-mono text-white/30">
              7,600,000+ entries · 25+ data domains · every claim graded against matched controls
            </p>
            <p className="text-[10px] font-mono">
              <Link to="/court" className="text-white/40 hover:text-cyan-400/70 transition-colors">
                {docketCount} claims on the docket — first verdicts land as windows close → Court
              </Link>
            </p>
            <p>
              <Link to="/ops" className="text-[9px] font-mono text-white/20 hover:text-white/40 transition-colors">ops</Link>
            </p>
          </footer>
          </div>

          {/* ---------- RIGHT RAIL (desktop only) ---------- */}
          <aside className="hidden md:block sticky top-6 space-y-8 max-h-[calc(100dvh-3rem)] overflow-y-auto pr-1">
            {mapPanel}
            {layersFeed}
            {verdictPanel}
          </aside>
        </div>
      </main>

      <div className="grain-overlay" />
    </div>
  );
}
