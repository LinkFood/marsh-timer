import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SUPABASE_FUNCTIONS_URL, supabase } from "@/lib/supabase";
import { trackDateLookup } from "@/lib/analytics";
import { InnerHeader, InnerFooter } from "@/components/InnerNav";
import { fetchFormingWatches, stateFullName, type FormationWatch } from "@/lib/board/frameStore";
import { useYourGround } from "@/hooks/useYourGround";

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

/** Provenance + registered lead time per formation lead — lead times exactly
 *  as registered (docs/VALIDATED-LEADS-2026-07-17.md), never restated. */
const LEAD_PROVENANCE: Record<string, string> = {
  "flood-forming": "live NWS watch, lead time 1–3 days",
  "smoke-forming": "open-meteo CAMS model, lead time days",
  "aqi-ramp-forming": "open-meteo CAMS model, lead time 1–2 days",
  "drought-fire-forming": "USDM weekly drought lane, lead time weeks",
  "precip-flood-forming": "station precipitation lane, lead time 1–2 days",
};

interface MorningLine {
  date: string;
  date_label: string;
  month_day_label: string;
  state: string;
  state_name: string;
  headline: string;
  lede: string;
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
  } | null;
  line?: null;
  reason?: string;
  nav: { yesterday: string | null; tomorrow: string | null } | null;
}

/** One world event the record holds for this calendar day (Wikipedia on-this-day). */
interface WorldEvent {
  year: number;
  text: string;
  /** the row's own receipt (metadata.url — a Wikipedia page); null = no receipt on file */
  url: string | null;
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

/**
 * One onthisday row → { year, text, url }. The ingest hard-cut the title
 * column at ~86 chars (mid-word); the FULL sentence lives in content as
 * "<full text> | pages: <wiki page list>" — prefer it, fall back to the title.
 * The receipt is metadata.url (these rows never got a provenance_url key).
 */
function parseWorldEvent(
  title: string,
  effectiveDate: string,
  content?: string | null,
  metadata?: { url?: string; provenance_url?: string } | null,
): WorldEvent | null {
  const full = (content || "").split(/\s*\|\s*pages:/)[0].trim();
  const clean = full || (title || "").trim();
  if (!clean) return null;
  const url = metadata?.provenance_url ?? metadata?.url ?? null;
  const m = /^(\d{1,4}):\s*(.+)$/.exec(clean);
  if (m) return { year: Number(m[1]), text: m[2].trim(), url };
  const tm = /^(\d{1,4}):/.exec((title || "").trim());
  if (tm) return { year: Number(tm[1]), text: clean, url };
  const yr = Number(effectiveDate.slice(0, 4));
  return Number.isFinite(yr) ? { year: yr, text: clean, url } : null;
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
  // The shared ground choice — read-only here: the line goes where the record
  // ran deepest, but a chosen ground gets its own quiet line when they differ.
  const { ground, groundName, chosen } = useYourGround();
  const [line, setLine] = useState<MorningLine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [world, setWorld] = useState<WorldEvent[]>([]);
  const [forming, setForming] = useState<FormationWatch[]>([]);
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

  // Gate-3 §0: completed lookup = the line actually rendered (headline came
  // back from the archive), not the route mounting. Once per day per load.
  const lookupFiredRef = useRef(new Set<string>());
  useEffect(() => {
    if (loading || error || !line?.headline || !line.date) return;
    if (lookupFiredRef.current.has(line.date)) return;
    lookupFiredRef.current.add(line.date);
    trackDateLookup("morning");
  }, [loading, error, line]);

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
      .select("title,effective_date,content,metadata")
      .eq("content_type", "onthisday-event")
      .eq("metadata->>mmdd", mmdd)
      .order("effective_date", { ascending: false })
      .limit(7)
      .then(({ data, error: qErr }) => {
        if (cancelled || qErr || !data) return;
        const events = (data as {
          title: string;
          effective_date: string;
          content: string | null;
          metadata: { url?: string; provenance_url?: string } | null;
        }[])
          .map((r) => parseWorldEvent(r.title, r.effective_date, r.content, r.metadata))
          .filter((e): e is WorldEvent => e !== null);
        setWorld(events);
      });
    return () => {
      cancelled = true;
    };
  }, [line?.date]);

  // The FORMING lane — open formation watches speak of NOW, so they render
  // only on today's page; a dated past page never wears them. Empty result =
  // no panel, never a placeholder.
  useEffect(() => {
    if (date) {
      setForming([]);
      return;
    }
    let cancelled = false;
    fetchFormingWatches().then((rows) => {
      if (!cancelled) setForming(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

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
            {/* THE RETIREMENT LINE — where the lineup sentence used to sit.
                This line IS the product: the almanac that kills its own magic
                in public, and says so. One quiet line, the trial linked. */}
            <p className="mt-7 max-w-2xl font-mono text-[11px] leading-relaxed text-gray-500">
              The moon-and-tide lineup was retired July 17, 2026 &mdash; tested against
              1.35 million recorded days, it carried no information. The record of the
              trial is in{" "}
              <Link
                to="/court"
                className="text-gray-400 underline decoration-white/20 underline-offset-2 hover:text-gray-200"
              >
                the court
              </Link>
              .
            </p>
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
              to={`/atlas?state=${line.state}`}
              className="mt-11 inline-block font-mono text-sm text-cyan-300 hover:text-cyan-200"
            >
              fall into {line.state_name} &rarr;
            </Link>
            {/* YOUR GROUND — the §2e your-state line, only when it differs from
                the line's state and only on today's page (forming speaks of NOW). */}
            {!date && chosen && line.state !== ground && (
              <p className="mt-4 max-w-2xl font-mono text-[11px] leading-relaxed text-gray-600">
                Your ground, {groundName}:{" "}
                {forming.some((w) => w.states.includes(ground)) ? (
                  <>
                    {forming.filter((w) => w.states.includes(ground)).length === 1
                      ? "a formation watch is standing"
                      : `${forming.filter((w) => w.states.includes(ground)).length} formation watches are standing`}{" "}
                    over it &mdash; see FORMING below.
                  </>
                ) : (
                  <>no watch standing &mdash; the line goes where the record ran deepest.</>
                )}{" "}
                <Link to={`/atlas?state=${ground}`} className="text-gray-500 hover:text-cyan-300">
                  read {groundName} &rarr;
                </Link>
              </p>
            )}
          </article>
        )}
      </main>

      {/* THE FORMING LANE — the formation layer's daily face here: what live
          instruments say is taking shape, each watch with its receipts and
          provenance. Fact-only, lead-time honest, never "will". Renders only
          on today's page and only when watches actually stand. */}
      {!date && forming.length > 0 && (
        <section className="mx-auto mt-4 w-full max-w-3xl border-t border-white/10 py-8">
          <div className="font-mono text-[11px] tracking-[0.28em] text-slate-300/90">FORMING</div>
          <div className="mt-1.5 font-mono text-[11px] text-gray-500">
            fired by live data &middot; the archive supplies the record &middot; the history book
            recognizes, it never predicts
          </div>
          <ul className="mt-5 space-y-5">
            {forming.map((w) => (
              <li key={w.id} className="border-l-2 border-slate-400/20 pl-3">
                <p className="font-body text-[15px] leading-relaxed text-gray-200">{w.copy}</p>
                <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-gray-600">
                  {w.lead_id} &middot; {w.states.map(stateFullName).join(", ")} &middot; opened{" "}
                  {shortLabel(w.opened_at)} &middot;{" "}
                  {LEAD_PROVENANCE[w.lead_id] ?? "live lane, lead time as registered"}
                  {w.claim_fire_id && (
                    <>
                      {" "}
                      &middot; <span className="text-emerald-400/80">court fire on the docket</span>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-5 font-mono text-[10px] leading-relaxed text-gray-600">
            formation watches &middot; every newly opened watch is embedded and on the record
            &middot; never a forecast
          </p>
        </section>
      )}

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
                  {ev.text}{" "}
                  {ev.url ? (
                    <a
                      href={ev.url}
                      target="_blank"
                      rel="noreferrer"
                      className="whitespace-nowrap font-mono text-[10px] text-gray-600 underline decoration-white/20 underline-offset-2 hover:text-gray-400"
                    >
                      source
                    </a>
                  ) : (
                    <span className="whitespace-nowrap font-mono text-[10px] text-gray-600">
                      no receipt on file
                    </span>
                  )}
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
