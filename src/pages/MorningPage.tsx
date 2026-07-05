import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { SUPABASE_FUNCTIONS_URL } from "@/lib/supabase";

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

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

function shortLabel(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

export default function MorningPage() {
  const { date } = useParams<{ date?: string }>();
  const [line, setLine] = useState<MorningLine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  const anomaly = line?.parts?.anomaly ?? null;
  const tideStation = line?.parts?.lineup?.tide_station ?? null;

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
      <header>
        <div className="font-mono text-[11px] tracking-[0.28em] text-cyan-300/90">THE MORNING LINE</div>
        <div className="mt-1.5 font-mono text-[11px] text-gray-500">
          {line ? line.date_label : date ? shortLabel(date) : "today"} &middot; one true sentence about
          American ground &middot; recorded fact, never a forecast
        </div>
      </header>

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

      <footer className="flex items-center justify-between font-mono text-[11px] text-gray-500">
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
      </footer>
    </div>
  );
}
