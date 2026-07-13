import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SUPABASE_FUNCTIONS_URL, supabase } from "@/lib/supabase";
import { InnerHeader, InnerFooter } from "@/components/InnerNav";

/**
 * THE MORNING LINE — the product's front door and daily heartbeat
 * (docs/THE-WEEK.md acceptance test 3; Double Fall plan item 6).
 *
 * Every day: one dated Playfair lede sentence about American ground, built
 * from recorded fact by hunt-morning-line (template, never an LLM, never a
 * forecast), at a permanent URL. /morning is today; /morning/:date is any
 * past day, recomputed identically from the append-only archive. The
 * anti-feed: yesterday's line is never deleted — the day just moves on.
 *
 * Newspaper front page, Apple restraint: one sentence huge, the control line
 * small beneath it, provenance chips, ONE link down into the atlas.
 */

const APIKEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

interface MorningLine {
  date: string;
  date_label: string;
  month_day_label: string;
  state: string;
  state_name: string;
  headline: string;
  lede: string;
  lineup_sentence: string | null;
  control_line: string | null;
  parts: {
    anomaly: {
      value: number | null;
      z: number | null;
      as_of_year: number | null;
      n_years: number;
      resolution: string;
      source: string;
    } | null;
    alerts_on_file: Array<{ type: string; title: string; count: number }>;
    lineup: { mode: string; tide_station: string | null } | null;
  } | null;
  line?: null;
  reason?: string;
  nav: { yesterday: string | null; tomorrow: string | null } | null;
}

/** One world event the record holds for this calendar day (Wikipedia on-this-day). */
interface WorldEvent {
  year: number;
  text: string;
}

/**
 * THE GRADE — the published record of this day's line (morning_lines, anon
 * read) and the verdict hunt-morning-grader ruled at +7 days. Product law:
 * the product shows itself being graded, win or lose.
 */
interface LineRecord {
  day: string;
  basis: string;
  grade: {
    verdict: "CONFIRMED" | "MISSED" | "NO_CLAIM" | "UNGRADEABLE";
    summary: string;
    graded_at: string;
  } | null;
}

const VERDICT_STYLE: Record<string, string> = {
  CONFIRMED: "bg-emerald-400/10 text-emerald-400 border-emerald-400/20",
  MISSED: "bg-red-400/10 text-red-400 border-red-400/20",
  NO_CLAIM: "bg-white/[0.04] text-white/40 border-white/10",
  UNGRADEABLE: "bg-white/[0.04] text-white/40 border-white/10",
};

/** "1962: Pope John XXIII excommunicates Fidel Castro." → { year, text } */
function parseWorldEvent(title: string, effectiveDate: string): WorldEvent | null {
  const clean = (title || "").trim();
  if (!clean) return null;
  const m = /^(\d{1,4}):\s*(.+)$/.exec(clean);
  if (m) return { year: Number(m[1]), text: m[2].trim() };
  const yr = Number(effectiveDate.slice(0, 4));
  return Number.isFinite(yr) ? { year: yr, text: clean } : null;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

function shortLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

function isoPlusDays(iso: string, days: number): string {
  const dt = new Date(iso + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** The Morning Line publishes-and-persists since this day; earlier days have no record to grade. */
const PUBLISH_ERA_START = "2026-07-05";

/** Timestamp → the American day it happened on (product law: US Eastern, not UTC). */
function etDayLabel(iso: string): string {
  return shortLabel(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(iso)),
  );
}

export default function MorningPage() {
  const { date } = useParams<{ date?: string }>();
  const [line, setLine] = useState<MorningLine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [world, setWorld] = useState<WorldEvent[]>([]);
  const [record, setRecord] = useState<LineRecord | null>(null);
  const [recent, setRecent] = useState<{ confirmed: number; missed: number; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setLine(null);
    const url = `${SUPABASE_FUNCTIONS_URL}/hunt-morning-line${date ? `?date=${date}` : ""}`;
    fetch(url, { headers: { apikey: APIKEY, Authorization: `Bearer ${APIKEY}` } })
      .then(async (res) => {
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || json?.error) {
          setError(typeof json?.error === "string" ? json.error : `Couldn't read the line (${res.status}).`);
        } else {
          setLine(json as MorningLine);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't reach the archive right now.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    document.title = line
      ? `The Morning Line — ${line.date_label}`
      : "The Morning Line — Duck Countdown";
  }, [line]);

  // The world lane — what the record holds for this calendar day, anywhere on
  // earth (Wikipedia on-this-day rows, keyed by month-day). A quiet companion to
  // the ground reading, never the lede. onthisday-event effective_dates carry the
  // real historical year, so we match on metadata.mmdd (the date-page pattern
  // reads exact effective_dates; this reads the month-day across all years).
  useEffect(() => {
    const mmdd = line?.date ? line.date.slice(5) : null; // "MM-DD"
    if (!supabase || !mmdd) {
      setWorld([]);
      return;
    }
    let cancelled = false;
    supabase
      .from("hunt_knowledge")
      .select("title,effective_date")
      .eq("content_type", "onthisday-event")
      .eq("metadata->>mmdd", mmdd)
      .order("effective_date", { ascending: false })
      .limit(7)
      .then(({ data, error: qErr }) => {
        if (cancelled || qErr || !data) return;
        const events = (data as { title: string; effective_date: string }[])
          .map((r) => parseWorldEvent(r.title, r.effective_date))
          .filter((e): e is WorldEvent => e !== null);
        setWorld(events);
      });
    return () => {
      cancelled = true;
    };
  }, [line?.date]);

  // The grade lane — this day's published record + its verdict (anon read of
  // morning_lines), and the last 30 graded lines for the quiet track-record
  // line. The court's law on the flagship voice: graded win or lose.
  useEffect(() => {
    setRecord(null);
    if (!supabase || !line?.date || line.date < PUBLISH_ERA_START) return;
    let cancelled = false;
    supabase
      .from("morning_lines")
      .select("day, basis, grade")
      .eq("day", line.date)
      .maybeSingle()
      .then(({ data, error: qErr }) => {
        if (cancelled || qErr || !data) return;
        setRecord({ ...(data as LineRecord), day: String((data as LineRecord).day).slice(0, 10) });
      });
    return () => {
      cancelled = true;
    };
  }, [line?.date]);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from("morning_lines")
      .select("grade")
      .not("grade", "is", null)
      .order("day", { ascending: false })
      .limit(30)
      .then(({ data, error: qErr }) => {
        if (cancelled || qErr || !data || data.length === 0) return;
        const grades = (data as { grade: { verdict: string } }[]).map((r) => r.grade?.verdict);
        setRecent({
          confirmed: grades.filter((v) => v === "CONFIRMED").length,
          missed: grades.filter((v) => v === "MISSED").length,
          total: grades.length,
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const anomaly = line?.parts?.anomaly ?? null;
  const tideStation = line?.parts?.lineup?.tide_station ?? null;

  const grade = record?.grade ?? null;
  // An ungraded line in the publish era gets its court date named — the +7-day
  // grading is a standing appointment, shown before the verdict exists.
  const gradeDue =
    line?.date && line.date >= PUBLISH_ERA_START && !grade
      ? shortLabel(isoPlusDays(line.date, 7))
      : null;

  const chips: string[] = [];
  if (anomaly) {
    chips.push(anomaly.source ?? "ghcn-daily");
    chips.push(`${anomaly.resolution ?? "state"}-level`);
    chips.push(`${anomaly.n_years} yrs of ${line!.month_day_label}s`);
    if (anomaly.as_of_year) chips.push(`as of ${anomaly.as_of_year}`);
  }
  if (tideStation) chips.push(`tide: ${tideStation}`);
  if (line?.lineup_sentence) chips.push("moon: computed");

  return (
    <div className="flex min-h-screen w-full flex-col bg-gray-950 px-5 py-7 text-gray-100 sm:px-10 sm:py-9">
      <InnerHeader
        title="THE MORNING LINE"
        subtitle={
          <>
            {line ? line.date_label : date ? shortLabel(date) : "today"} &middot; one true sentence about
            American ground &middot; recorded fact, never a forecast
          </>
        }
      />

      <main className="flex flex-1 flex-col justify-center py-12">
        {loading && (
          <p className="font-mono text-xs text-gray-600">reading the ground&hellip;</p>
        )}

        {!loading && error && (
          <div className="max-w-2xl">
            <p className="font-display text-2xl leading-snug text-gray-300 sm:text-3xl">
              No line for this day.
            </p>
            <p className="mt-3 font-mono text-xs leading-relaxed text-gray-500">{error}</p>
          </div>
        )}

        {!loading && !error && line && !line.headline && (
          <div className="max-w-2xl">
            <p className="font-display text-2xl leading-snug text-gray-300 sm:text-3xl">
              The archive holds no scoreable reading for this day.
            </p>
            {line.reason && (
              <p className="mt-3 font-mono text-xs leading-relaxed text-gray-500">{line.reason}</p>
            )}
          </div>
        )}

        {!loading && !error && line && line.headline && (
          <article>
            <h1 className="max-w-4xl font-display text-[1.7rem] font-medium leading-[1.25] text-gray-50 sm:text-[2.6rem] sm:leading-[1.2] lg:text-5xl lg:leading-[1.18]">
              {line.lede}
            </h1>
            {line.lineup_sentence && (
              <p className="mt-7 max-w-3xl font-display text-lg leading-relaxed text-gray-300 sm:text-2xl sm:leading-normal">
                {line.lineup_sentence}
              </p>
            )}
            {line.control_line && (
              <p className="mt-9 max-w-2xl font-mono text-[11px] leading-relaxed text-gray-500">
                {line.control_line}
              </p>
            )}
            {/* THE GRADE — the product grading its own published line, win or
                lose (court idiom, kept quiet). Verdict when ruled; the court
                date when not; the running record beneath. */}
            {(grade || gradeDue) && (
              <div className="mt-5 max-w-2xl border-l-2 border-white/10 pl-3">
                {grade ? (
                  <p className="font-mono text-[11px] leading-relaxed text-gray-500">
                    This line was graded{" "}
                    <span
                      className={`inline-block rounded-full border px-2 py-px text-[9px] font-bold uppercase tracking-wider align-[1px] ${
                        VERDICT_STYLE[grade.verdict] ?? VERDICT_STYLE.NO_CLAIM
                      }`}
                    >
                      {grade.verdict.replace(/_/g, " ")}
                    </span>{" "}
                    on {etDayLabel(grade.graded_at)}
                    {grade.summary ? <> &mdash; {grade.summary}</> : "."}
                    {record?.basis === "recomputed" && (
                      <span className="text-gray-600"> (line recomputed by the current engine)</span>
                    )}
                  </p>
                ) : (
                  <p className="font-mono text-[11px] leading-relaxed text-gray-500">
                    This line will be graded against what actually happens &mdash; {gradeDue}.
                  </p>
                )}
                {recent && recent.total > 0 && (
                  <p className="mt-1.5 font-mono text-[10px] text-gray-600">
                    recent grades: {recent.confirmed} confirmed &middot; {recent.missed} missed of{" "}
                    {recent.total} graded
                  </p>
                )}
              </div>
            )}
            {chips.length > 0 && (
              <div className="mt-5 flex max-w-2xl flex-wrap gap-1.5">
                {chips.map((c) => (
                  <span
                    key={c}
                    className="rounded-full bg-gray-900/80 px-2.5 py-1 font-mono text-[10px] text-gray-400 ring-1 ring-white/10"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
            <Link
              to="/atlas"
              className="mt-11 inline-block font-mono text-sm text-cyan-300 hover:text-cyan-200"
            >
              fall into {line.state_name} &rarr;
            </Link>
          </article>
        )}
      </main>

      {/* THE WORLD LANE — a quiet panel below the fold. The lede owns the first
          viewport; this sits beneath it, small: what the record holds for this
          calendar day anywhere on earth, newest first. Only renders when the
          record actually holds something — never an empty box or a spinner. */}
      {line?.headline && world.length > 0 && (
        <section className="mx-auto mt-4 w-full max-w-3xl border-t border-white/10 py-8">
          <div className="font-mono text-[11px] tracking-[0.28em] text-cyan-300/90">
            ON THIS DAY
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-gray-500">
            elsewhere in the world, on {line.month_day_label} &middot; newest first
          </div>
          <ul className="mt-5 space-y-3">
            {world.map((ev, i) => (
              <li key={`${ev.year}-${i}`} className="flex gap-3">
                <span className="w-12 shrink-0 pt-0.5 text-right font-mono text-[12px] tabular-nums text-cyan-300/70">
                  {ev.year}
                </span>
                <span className="font-body text-sm leading-relaxed text-gray-300">
                  {ev.text}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-5 font-mono text-[10px] leading-relaxed text-gray-600">
            from Wikipedia&rsquo;s on-this-day record &middot; the world&rsquo;s events, not this ground
          </p>
        </section>
      )}

      <nav className="flex items-center justify-between font-mono text-[11px] text-gray-500">
        {line?.nav?.yesterday ? (
          <Link to={`/morning/${line.nav.yesterday}`} className="hover:text-gray-200">
            &larr; {shortLabel(line.nav.yesterday)}
          </Link>
        ) : (
          <span />
        )}
        {line?.nav?.tomorrow ? (
          <Link to={`/morning/${line.nav.tomorrow}`} className="hover:text-gray-200">
            {shortLabel(line.nav.tomorrow)} &rarr;
          </Link>
        ) : (
          <span className="text-gray-700">tomorrow&rsquo;s line publishes when the day does</span>
        )}
      </nav>

      <InnerFooter current="morning" />
    </div>
  );
}
