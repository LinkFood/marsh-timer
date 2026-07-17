import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, ChevronDown, Sparkles, Loader2 } from 'lucide-react';
import BrainResponseCard from '@/components/BrainResponseCard';
import { InnerHeader, InnerFooter } from '@/components/InnerNav';
import ErrorBoundary from '@/components/ErrorBoundary';
import PrecedentCard from '@/components/PrecedentCard';
import CiteBlock, { retrievedToday } from '@/components/CiteBlock';
import { useChat } from '@/hooks/useChat';
import { useDayArchive, useArchaeologyTimeline, shiftDate, PROBE_COLORS, PROBE_LABELS, type ArchiveEntry } from '@/hooks/useDayArchive';
import { useThisDayInHistory } from '@/hooks/useThisDayInHistory';
import { US_STATES, getStateName } from '@/hooks/useUserLocation';
import { humanizeEntry, yearLines } from '@/lib/humanize';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const MIN_DATE = '1950-01-01';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}, ${y}`;
}

function isValidDateStr(s: string | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T12:00:00').getTime());
}

function SectionLabel({ children }: { children: string }) {
  return (
    <h2 className="text-[10px] font-mono uppercase tracking-widest text-white/40 mb-3">{children}</h2>
  );
}

/**
 * One entry as a one-liner: human headline + state tag. Titles route through
 * humanizeEntry — machine row keys (the fire lane's "fire-{UUID}-…" identity
 * strings) are rebuilt as sentences from the content column, never shown raw.
 */
function EntryLine({ entry }: { entry: ArchiveEntry }) {
  const text = humanizeEntry(entry.title || entry.content?.slice(0, 120), entry.content_type, entry.content);
  return (
    <li className="flex items-start justify-between gap-2 py-1">
      <span className="text-xs font-body text-white/60 leading-snug line-clamp-2">{text}</span>
      {entry.state_abbr && (
        <span className="text-[9px] font-mono text-white/30 px-1.5 py-0.5 rounded border border-white/10 shrink-0 mt-0.5">
          {entry.state_abbr}
        </span>
      )}
    </li>
  );
}

export default function DatePage() {
  const { dateStr: rawDateStr } = useParams<{ dateStr: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const today = todayStr();

  // URL is the source of truth
  const dateStr = isValidDateStr(rawDateStr) ? rawDateStr : today;
  const stateParam = searchParams.get('state')?.toUpperCase() || null;
  const state = stateParam && US_STATES.some(s => s.abbr === stateParam) ? stateParam : null;
  const [showStates, setShowStates] = useState(false);

  const goTo = useCallback((d: string, s: string | null = state) => {
    if (d < MIN_DATE || d > today) return;
    navigate(`/date/${d}${s ? `?state=${s}` : ''}`);
  }, [navigate, state, today]);

  // --- Data on load: direct REST reads only, zero LLM ---
  const { groups, total, loading: archiveLoading } = useDayArchive(dateStr, state);
  const { days: timelineDays } = useArchaeologyTimeline(dateStr, state);
  const { years: historyYears } = useThisDayInHistory(dateStr, state);

  // --- Synthesis: LLM fires ONLY on button press ---
  const { messages, loading, streaming, sendMessage } = useChat({
    species: 'all',
    stateAbbr: state,
    onMapAction: () => {},
  });

  const formatted = formatDateStr(dateStr);
  const prompt = useMemo(
    () => `What was happening across all domains on ${formatted}${state ? ` in ${getStateName(state)}` : ''}? Lead with the most unusual thing.`,
    [formatted, state]
  );
  const cacheKey = `daystory:${dateStr}:${state || 'ALL'}`;
  const [cached, setCached] = useState<string | null>(null);
  useEffect(() => {
    try { setCached(localStorage.getItem(cacheKey)); } catch { setCached(null); }
  }, [cacheKey]);

  // The live story = the assistant message answering exactly this date's prompt
  const liveStory = useMemo(() => {
    for (let i = messages.length - 1; i > 0; i--) {
      if (messages[i].role === 'assistant' && messages[i - 1]?.role === 'user' && messages[i - 1].content === prompt) {
        return messages[i];
      }
    }
    return null;
  }, [messages, prompt]);

  // Cache the finished story + embed it back into the brain (once)
  const embeddedRef = useRef(new Set<string>());
  useEffect(() => {
    if (loading || streaming || !liveStory || liveStory.content.length <= 50) return;
    try { localStorage.setItem(cacheKey, liveStory.content); } catch {}
    setCached(liveStory.content);
    if (SUPABASE_URL && SUPABASE_KEY && !embeddedRef.current.has(liveStory.id)) {
      embeddedRef.current.add(liveStory.id);
      fetch(`${SUPABASE_URL}/functions/v1/hunt-embed-interaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
        body: JSON.stringify({
          content: `User synthesized the story of ${dateStr}${state ? ` in ${state}` : ''} — Brain responded with ${liveStory.content.length} chars.`,
          content_type: 'query-signal',
          title: `Date Page: ${dateStr}`,
          metadata: { date: dateStr, state, response_length: liveStory.content.length, timestamp: new Date().toISOString() },
        }),
      }).catch(() => {});
    }
  }, [loading, streaming, liveStory, cacheKey, dateStr, state]);

  const synthesize = useCallback(() => {
    if (loading || streaming) return;
    sendMessage(prompt);
  }, [loading, streaming, sendMessage, prompt]);

  const regenerate = useCallback(() => {
    if (loading || streaming) return;
    try { localStorage.removeItem(cacheKey); } catch {}
    setCached(null);
    sendMessage(prompt);
  }, [loading, streaming, cacheKey, sendMessage, prompt]);

  // Center the timeline strip on the selected date
  const stripRef = useRef<HTMLDivElement>(null);
  const selectedDotRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const strip = stripRef.current, dot = selectedDotRef.current;
    if (strip && dot) {
      strip.scrollLeft = dot.offsetLeft - strip.clientWidth / 2 + dot.clientWidth / 2;
    }
  }, [dateStr, timelineDays.length]);

  // SEO title
  useEffect(() => {
    document.title = `${formatted}${state ? ` — ${getStateName(state)}` : ''} | Duck Countdown Archive`;
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', `Everything the archive holds for ${formatted}: weather, storms, water, drought, migration, sky, climate, quakes, air, fire.`);
    return () => { document.title = 'Duck Countdown | Environmental Intelligence Platform'; };
  }, [formatted, state]);

  const isStoryStreaming = !!liveStory && streaming && messages[messages.length - 1]?.id === liveStory.id;
  const showLive = !!liveStory && (liveStory.content.length > 0 || loading || streaming);
  const timelineCats = useMemo(() => {
    const s = new Set<string>();
    for (const d of timelineDays) d.cats.forEach(c => s.add(c));
    return [...s];
  }, [timelineDays]);
  const precedents = historyYears;
  const mmdd = dateStr.slice(5);

  return (
    <div className="min-h-[100dvh] bg-gray-950 flex flex-col">
      <main className="flex-1">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-10 pb-10">
          <InnerHeader
            title="THE MUSEUM"
            subtitle="any day since 1950, receipts on the table"
          />

          {/* Date navigation — URL is the source of truth */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <button
                onClick={() => goTo(shiftDate(dateStr, -1))}
                disabled={dateStr <= MIN_DATE}
                aria-label="Previous day"
                className="p-2 rounded-lg border border-white/10 hover:border-cyan-400/30 hover:bg-white/[0.03] transition-colors disabled:opacity-20"
              >
                <ChevronLeft size={16} className="text-white/50" />
              </button>
              <input
                type="date"
                value={dateStr}
                min={MIN_DATE}
                max={today}
                onChange={e => { if (isValidDateStr(e.target.value)) goTo(e.target.value); }}
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-gray-900 border border-white/10 text-sm font-mono text-white/80 outline-none focus:border-cyan-400/30 transition-colors [color-scheme:dark]"
              />
              <button
                onClick={() => goTo(shiftDate(dateStr, 1))}
                disabled={dateStr >= today}
                aria-label="Next day"
                className="p-2 rounded-lg border border-white/10 hover:border-cyan-400/30 hover:bg-white/[0.03] transition-colors disabled:opacity-20"
              >
                <ChevronRight size={16} className="text-white/50" />
              </button>
            </div>

            <div className="relative flex flex-wrap items-baseline gap-2">
              <h1 className="font-display text-2xl sm:text-3xl text-white/90 leading-tight">{formatted}</h1>
              <button
                onClick={() => setShowStates(!showStates)}
                className="flex items-center gap-1 px-2 py-1 rounded-full border border-white/10 bg-white/[0.03] hover:border-cyan-400/30 transition-colors"
              >
                <span className="text-[10px] font-mono text-cyan-400/80">{state || 'All states'}</span>
                <ChevronDown size={10} className={`text-white/30 transition-transform ${showStates ? 'rotate-180' : ''}`} />
              </button>
              {showStates && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-gray-900 border border-white/10 rounded-lg shadow-xl max-h-64 overflow-y-auto w-56">
                  <button
                    onClick={() => { setShowStates(false); goTo(dateStr, null); }}
                    className={`w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-white/[0.06] transition-colors ${
                      !state ? 'text-cyan-400 bg-cyan-400/[0.06]' : 'text-white/50'
                    }`}
                  >
                    All states
                  </button>
                  {US_STATES.map(s => (
                    <button
                      key={s.abbr}
                      onClick={() => { setShowStates(false); goTo(dateStr, s.abbr); }}
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
            {total != null && (
              <p className="mt-2 text-[10px] font-mono text-white/30">
                ~{total.toLocaleString()} entries in the archive for this day{state ? ` in ${getStateName(state)}` : ''}
              </p>
            )}
          </section>

          {/* Archaeology timeline — ±14 days of rare-event presence */}
          {timelineDays.length > 0 && (
            <section>
              <SectionLabel>Two weeks either side</SectionLabel>
              <div ref={stripRef} className="overflow-x-auto -mx-4 px-4 pb-2 [scrollbar-width:thin]">
                <div className="flex gap-1 w-max">
                  {timelineDays.map(day => {
                    const selected = day.date === dateStr;
                    const dayNum = parseInt(day.date.slice(8), 10);
                    return (
                      <button
                        key={day.date}
                        ref={selected ? selectedDotRef : undefined}
                        onClick={() => goTo(day.date)}
                        title={formatDateStr(day.date)}
                        className={`flex flex-col items-center gap-1 px-1.5 py-1.5 rounded-lg transition-colors ${
                          selected ? 'bg-cyan-400/[0.08] border border-cyan-400/40' : 'border border-transparent hover:bg-white/[0.04]'
                        }`}
                      >
                        <span className={`text-[9px] font-mono ${selected ? 'text-cyan-400' : dayNum === 1 ? 'text-white/60' : 'text-white/35'}`}>
                          {dayNum === 1 ? day.date.slice(5, 7) + '/1' : dayNum}
                        </span>
                        <span className="flex gap-0.5 h-1.5 items-center">
                          {day.cats.length > 0 ? (
                            day.cats.map(cat => (
                              <span key={cat} className={`w-1.5 h-1.5 rounded-full ${PROBE_COLORS[cat]}`} />
                            ))
                          ) : (
                            <span className="w-1 h-1 rounded-full bg-white/10" />
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {timelineCats.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                  {timelineCats.map(cat => (
                    <span key={cat} className="flex items-center gap-1 text-[9px] font-mono text-white/30">
                      <span className={`w-1.5 h-1.5 rounded-full ${PROBE_COLORS[cat]}`} />
                      {PROBE_LABELS[cat]}
                    </span>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Domain cards — the core */}
          <section>
            <SectionLabel>The record</SectionLabel>
            {archiveLoading ? (
              <p className="text-xs font-mono text-cyan-400/40 py-4 animate-pulse">Opening the archive...</p>
            ) : groups.length === 0 ? (
              <p className="font-body text-sm text-white/40 leading-relaxed">The archive is quiet for this day.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {groups.map(group => (
                  <div key={group.key} className="bg-gray-900 rounded-lg border border-gray-800 p-4">
                    <h3 className="font-display text-sm text-white/85 mb-2">{group.label}</h3>
                    <ul className="divide-y divide-white/[0.04]">
                      {group.entries.map((entry, i) => (
                        <EntryLine key={i} entry={entry} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4">
              <CiteBlock
                label="Cite this day"
                citation={`Duck Countdown Environmental Archive, entry for ${formatted}${state ? `, ${getStateName(state)}` : ''}. 7.6M+ records across 25+ domains, 1950–present. duckcountdown.com/date/${dateStr}${state ? `?state=${state}` : ''}. Retrieved ${retrievedToday()}.`}
              />
            </div>
          </section>

          {/* Synthesize — the only LLM call, and only on press */}
          <section>
            <SectionLabel>The story</SectionLabel>
            <ErrorBoundary fallback={<p className="text-xs text-white/40 py-4">Error loading the story.</p>}>
              {showLive ? (
                <>
                  {liveStory!.content ? (
                    <BrainResponseCard message={liveStory!} isStreaming={isStoryStreaming} />
                  ) : (
                    <p className="text-xs font-mono text-cyan-400/40 py-4 animate-pulse">Reading the day across every domain...</p>
                  )}
                  {!loading && !streaming && (
                    <button onClick={regenerate} className="mt-2 text-[10px] font-mono text-white/30 hover:text-cyan-400/70 transition-colors">
                      regenerate
                    </button>
                  )}
                </>
              ) : cached ? (
                <>
                  <BrainResponseCard message={{ id: `cached-${cacheKey}`, content: cached }} isStreaming={false} />
                  <button onClick={regenerate} className="mt-2 text-[10px] font-mono text-white/30 hover:text-cyan-400/70 transition-colors">
                    regenerate
                  </button>
                </>
              ) : (
                <button
                  onClick={synthesize}
                  disabled={loading || streaming}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-cyan-400/[0.08] border border-cyan-400/30 hover:bg-cyan-400/[0.14] transition-colors disabled:opacity-40"
                >
                  {loading || streaming ? (
                    <Loader2 size={14} className="text-cyan-400 animate-spin" />
                  ) : (
                    <Sparkles size={14} className="text-cyan-400" />
                  )}
                  <span className="text-sm font-body text-cyan-400/90">Tell the story of this day</span>
                </button>
              )}
            </ErrorBoundary>
          </section>

          {/* This day in other years */}
          {precedents.length > 0 && (
            <section>
              <SectionLabel>This day in other years</SectionLabel>
              <div className="space-y-2.5">
                {precedents.map(({ year, entries }) => (
                  <PrecedentCard
                    key={year}
                    dateHeadline={formatDateStr(`${year}-${mmdd}`)}
                    lines={yearLines(entries)}
                    to={`/date/${year}-${mmdd}${state ? `?state=${state}` : ''}`}
                  />
                ))}
              </div>
            </section>
          )}

          <InnerFooter current="date" />
        </div>
      </main>

      <div className="grain-overlay" />
    </div>
  );
}
