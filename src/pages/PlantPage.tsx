import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { InnerHeader, InnerFooter } from "@/components/InnerNav";
import { stateFullName } from "@/lib/board/frameStore";
import { useYourGround } from "@/hooks/useYourGround";

/**
 * THE PLANTING TABLE (/plant) — the almanac's most-used table, done our way.
 *
 * James's ask: "When am I going to know when to plant my tomatoes?" The
 * Almanac answers with a single made-up "frost date"; the house answers with
 * the DISTRIBUTION (house law: distributions, never a single date; never a
 * forecast; every number traceable). Per state, 76 recorded years of ghcn-daily
 * state-day minima (NOAA ACIS, 1950-2025) computed one-time into
 * planting_climatology by scripts/frost-climatology.ts — last spring freeze,
 * first fall freeze, growing season, each with median / p10 / p90 and the
 * earliest/latest years named (the cruelest year gets its name printed).
 *
 * HONESTY (rendered, not implied): state-level minima mean "somewhere in the
 * state froze" — a Baltimore backyard thaws weeks before Garrett County does.
 * The this-year line reads the live lane (hunt_weather_history), which is one
 * representative point per state — also disclosed.
 */

const CURRENT_YEAR = new Date().getFullYear();

/** The 50 states the climatology table covers (script order, alphabetized by name). */
const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

interface FreezeDist {
  n_freeze_years: number;
  no_freeze_years: number;
  median_doy: number; median_date: string;
  p10_doy: number; p10_date: string;
  p90_doy: number; p90_date: string;
  earliest_doy: number; earliest_date: string; earliest_year: number;
  latest_doy: number; latest_date: string; latest_year: number;
  /** count of freeze-years whose event had happened by the p90 date */
  pct_passed_by_p90: number;
}

interface SeasonDist {
  n_years: number;
  median_days: number; p10_days: number; p90_days: number;
  shortest_days: number; shortest_year: number;
  longest_days: number; longest_year: number;
}

interface ClimatologyRow {
  state_abbr: string;
  n_years: number;
  spring: FreezeDist;
  fall: FreezeDist;
  season: SeasonDist;
  source: string;
  computed_at: string;
  receipts: {
    spread_dropped_days: number;
    stuck_dropped_days: number;
    singleton_dropped_days?: number;
    excluded_years: number[];
  } | null;
}

interface ThisYear {
  lastFreeze: { date: string; low: number } | null;
  currentThrough: string | null;
}

interface CropReceipt {
  commodity: string;
  measure: string;
  percent: number;
  weekEnding: string;
}

const MONTHS = ["January","February","March","April","May","June","July",
  "August","September","October","November","December"];

function longDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

function days(n: number): string {
  return `${n} day${n === 1 ? "" : "s"}`;
}

/** "PCT PLANTED" -> "planted" */
function measureLabel(m: string): string {
  return m.replace(/^PCT\s+/i, "").toLowerCase();
}

export default function PlantPage() {
  const [params, setParams] = useSearchParams();
  // The shared ground choice — ?state=XX overrides and persists; with no
  // param the page opens on your ground (blueprint §2e: the private select
  // became the shared picker).
  const { ground, setGround } = useYourGround(params.get("state"));
  const stateParam = (params.get("state") || "").toUpperCase();
  const st = STATES.includes(stateParam) ? stateParam : STATES.includes(ground) ? ground : "MD";
  const stateName = stateFullName(st);

  const [row, setRow] = useState<ClimatologyRow | null>(null);
  const [rowMissing, setRowMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [thisYear, setThisYear] = useState<ThisYear | null>(null);
  const [crops, setCrops] = useState<CropReceipt[] | null>(null);

  useEffect(() => {
    document.title = `When to plant — ${stateName} — Duck Countdown`;
  }, [stateName]);

  // The climatology row — the one-time computed distributions (anon read).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setLoading(true);
    setRow(null);
    setRowMissing(false);
    supabase
      .from("planting_climatology")
      .select("*")
      .eq("state_abbr", st)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoading(false);
        if (error || !data) {
          setRowMissing(true);
          return;
        }
        setRow(data as ClimatologyRow);
      });
    return () => {
      cancelled = true;
    };
  }, [st]);

  // This spring's status — the live lane (one representative point per state,
  // current through yesterday): the last date this half-year that dipped <=32F.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setThisYear(null);
    Promise.all([
      supabase
        .from("hunt_weather_history")
        .select("date,temp_low_f")
        .eq("state_abbr", st)
        .gte("date", `${CURRENT_YEAR}-01-01`)
        .lte("date", `${CURRENT_YEAR}-06-30`)
        .lte("temp_low_f", 32)
        .order("date", { ascending: false })
        .limit(1),
      supabase
        .from("hunt_weather_history")
        .select("date")
        .eq("state_abbr", st)
        .order("date", { ascending: false })
        .limit(1),
    ]).then(([freeze, latest]) => {
      if (cancelled) return;
      const f = freeze.data?.[0] as { date: string; temp_low_f: number } | undefined;
      const l = latest.data?.[0] as { date: string } | undefined;
      setThisYear({
        lastFreeze: f ? { date: f.date, low: f.temp_low_f } : null,
        currentThrough: l?.date ?? null,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [st]);

  // Field receipts — USDA NASS weekly crop progress, where the lane holds it
  // (major row-crop states; many states, MD included, have no NASS weekly
  // rows — that absence renders honestly, never invented).
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    setCrops(null);
    supabase
      .from("hunt_knowledge")
      .select("effective_date,metadata")
      .eq("content_type", "crop-progress-weekly")
      .eq("state_abbr", st)
      .order("effective_date", { ascending: false })
      .limit(40)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setCrops([]);
          return;
        }
        const seen = new Set<string>();
        const receipts: CropReceipt[] = [];
        for (const r of data as {
          effective_date: string;
          metadata: {
            commodity?: string;
            progress_measure?: string;
            percent_value?: number;
            week_ending?: string;
          } | null;
        }[]) {
          const m = r.metadata;
          if (!m?.commodity || !m?.progress_measure || typeof m.percent_value !== "number") continue;
          const key = `${m.commodity}|${m.progress_measure}`;
          if (seen.has(key)) continue; // newest-first: keep the latest per commodity+measure
          seen.add(key);
          receipts.push({
            commodity: m.commodity.toLowerCase(),
            measure: measureLabel(m.progress_measure),
            percent: m.percent_value,
            weekEnding: m.week_ending ?? r.effective_date,
          });
        }
        // planting receipts first — this is the planting page
        receipts.sort((a, b) =>
          (a.measure === "planted" ? 0 : 1) - (b.measure === "planted" ? 0 : 1) ||
          a.commodity.localeCompare(b.commodity),
        );
        setCrops(receipts.slice(0, 5));
      });
    return () => {
      cancelled = true;
    };
  }, [st]);

  const spring = row?.spring ?? null;
  // Hero count: years whose last freeze had passed by the p90 date, plus the
  // covered years that never froze at all that spring (trivially passed).
  const heroN = spring ? spring.pct_passed_by_p90 + spring.no_freeze_years : 0;

  const guardsLine = useMemo(() => {
    const r = row?.receipts;
    if (!r) return null;
    const dropped =
      (r.spread_dropped_days ?? 0) + (r.stuck_dropped_days ?? 0) + (r.singleton_dropped_days ?? 0);
    const parts: string[] = [];
    if (dropped > 0) parts.push(`${dropped} broken-instrument day${dropped === 1 ? "" : "s"} dropped`);
    if (r.excluded_years?.length)
      parts.push(`year${r.excluded_years.length === 1 ? "" : "s"} ${r.excluded_years.join(", ")} excluded (untrustworthy record)`);
    return parts.length ? parts.join(" · ") : null;
  }, [row]);

  return (
    <div className="flex min-h-screen w-full flex-col bg-gray-950 px-5 py-7 text-gray-100 sm:px-10 sm:py-9">
      <InnerHeader
        title="THE PLANTING TABLE"
        subtitle={
          <>
            when to plant, from the record &middot; distributions, never a single date &middot;
            never a forecast
          </>
        }
      />

      {/* the ground picker */}
      <div className="mt-8 flex items-center gap-3 font-mono text-[11px] text-gray-500">
        <label htmlFor="plant-state">your ground</label>
        <select
          id="plant-state"
          value={st}
          onChange={(e) => {
            setGround(e.target.value);
            setParams({ state: e.target.value }, { replace: true });
          }}
          className="rounded border border-white/10 bg-gray-900 px-2 py-1.5 font-mono text-[12px] text-gray-200 outline-none focus:border-cyan-300/40"
        >
          {[...STATES]
            .sort((a, b) => stateFullName(a).localeCompare(stateFullName(b)))
            .map((s) => (
              <option key={s} value={s}>
                {stateFullName(s)}
              </option>
            ))}
        </select>
      </div>

      <main className="flex-1 py-10">
        {loading && <p className="font-mono text-xs text-gray-600">reading the record&hellip;</p>}

        {!loading && rowMissing && (
          <div className="max-w-2xl">
            <p className="font-display text-2xl leading-snug text-gray-300 sm:text-3xl">
              The table holds no frost record for {stateName}.
            </p>
            <p className="mt-3 font-mono text-xs leading-relaxed text-gray-500">
              The state&rsquo;s station record was too thin to publish a distribution honestly.
            </p>
          </div>
        )}

        {!loading && row && spring && (
          <article className="max-w-3xl">
            {/* THE TOMATO LEDE */}
            <p className="font-display text-lg italic text-gray-400 sm:text-xl">
              &ldquo;When do I plant my tomatoes?&rdquo;
            </p>
            <h1 className="mt-4 font-display text-[1.65rem] font-medium leading-[1.25] text-gray-50 sm:text-[2.4rem] sm:leading-[1.2]">
              In {heroN} of {row.n_years} recorded years, {stateName}&rsquo;s last freeze had
              passed by {spring.p90_date}.
            </h1>
            <p className="mt-5 max-w-2xl font-body text-[15px] leading-relaxed text-gray-400">
              The median year&rsquo;s last freeze fell on {spring.median_date}. The record is not
              a promise: in {spring.latest_year} the last freeze waited until{" "}
              {spring.latest_date} &mdash; the cruelest spring on file.
            </p>

            {/* honesty disclosure — house law, always rendered */}
            <p className="mt-6 max-w-2xl border-l-2 border-amber-400/30 pl-3 font-mono text-[11px] leading-relaxed text-amber-200/70">
              State-level: a freeze in this table means somewhere in {stateName} froze &mdash;
              your backyard varies. County-level is coming.
            </p>

            {/* THE SPRING TABLE */}
            <section className="mt-12">
              <div className="font-mono text-[11px] tracking-[0.28em] text-cyan-300/90">
                LAST SPRING FREEZE
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-gray-500">
                the last day at or below 32&deg;F before July 1, each recorded year
              </div>
              <dl className="mt-5 space-y-2.5 font-mono text-[13px]">
                <Row label="in the earliest tenth of years, passed by" value={spring.p10_date} />
                <Row label="median year" value={spring.median_date} strong />
                <Row label="in 9 of 10 freeze-years, passed by" value={spring.p90_date} strong />
                <Row
                  label="earliest ever"
                  value={`${spring.earliest_date} (${spring.earliest_year})`}
                />
                <Row
                  label="latest ever"
                  value={`${spring.latest_date} (${spring.latest_year})`}
                  accent
                />
                {spring.no_freeze_years > 0 && (
                  <Row
                    label="years with no spring freeze at all"
                    value={String(spring.no_freeze_years)}
                  />
                )}
              </dl>
            </section>

            {/* THIS YEAR */}
            {thisYear && (
              <section className="mt-10 border-l-2 border-white/10 pl-3">
                <p className="font-body text-[15px] leading-relaxed text-gray-300">
                  {thisYear.lastFreeze ? (
                    <>
                      This spring&rsquo;s last freeze-cold reading in the live lane:{" "}
                      <span className="text-gray-100">{longDate(thisYear.lastFreeze.date)}</span>{" "}
                      ({thisYear.lastFreeze.low}&deg;F).
                    </>
                  ) : (
                    <>No freeze-cold reading this spring in the live lane.</>
                  )}
                </p>
                <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-gray-600">
                  live lane reads one representative point per state
                  {thisYear.currentThrough && <> &middot; current through {longDate(thisYear.currentThrough)}</>}
                </p>
              </section>
            )}

            {/* THE FALL TABLE */}
            <section className="mt-12">
              <div className="font-mono text-[11px] tracking-[0.28em] text-cyan-300/90">
                FIRST FALL FREEZE
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-gray-500">
                the first day at or below 32&deg;F from July 1 on &mdash; the other end of the season
              </div>
              <dl className="mt-5 space-y-2.5 font-mono text-[13px]">
                <Row label="median year" value={row.fall.median_date} strong />
                <Row
                  label="earliest ever"
                  value={`${row.fall.earliest_date} (${row.fall.earliest_year})`}
                  accent
                />
                <Row
                  label="latest ever"
                  value={`${row.fall.latest_date} (${row.fall.latest_year})`}
                />
              </dl>
            </section>

            {/* THE SEASON */}
            <section className="mt-12">
              <div className="font-mono text-[11px] tracking-[0.28em] text-cyan-300/90">
                THE GROWING SEASON
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-gray-500">
                days between the last spring freeze and the first fall freeze, statewide minima
              </div>
              <dl className="mt-5 space-y-2.5 font-mono text-[13px]">
                <Row label="median year" value={days(row.season.median_days)} strong />
                <Row
                  label="shortest on file"
                  value={`${days(row.season.shortest_days)} (${row.season.shortest_year})`}
                  accent
                />
                <Row
                  label="longest on file"
                  value={`${days(row.season.longest_days)} (${row.season.longest_year})`}
                />
              </dl>
            </section>

            {/* FIELD RECEIPTS — USDA NASS, where the lane holds them */}
            <section className="mt-12">
              <div className="font-mono text-[11px] tracking-[0.28em] text-cyan-300/90">
                FIELD RECEIPTS
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-gray-500">
                what {stateName}&rsquo;s farmers actually did &mdash; USDA NASS weekly crop progress
              </div>
              {crops === null ? (
                <p className="mt-4 font-mono text-xs text-gray-600">reading the lane&hellip;</p>
              ) : crops.length > 0 ? (
                <ul className="mt-5 space-y-2 font-mono text-[13px]">
                  {crops.map((c) => (
                    <li key={`${c.commodity}-${c.measure}`} className="text-gray-300">
                      {c.commodity} &mdash; {c.percent}% {c.measure} by week ending{" "}
                      {longDate(c.weekEnding)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 max-w-2xl font-body text-sm leading-relaxed text-gray-500">
                  USDA&rsquo;s weekly crop-progress lane holds no {stateName} rows &mdash; NASS
                  publishes weekly progress for major row-crop states only. Receipts render where
                  the record exists, never invented.
                </p>
              )}
            </section>

            {/* provenance */}
            <div className="mt-12 flex max-w-2xl flex-wrap gap-1.5">
              {[
                "ghcn-daily (NOAA ACIS)",
                "state-level minima",
                `${row.n_years} yrs (1950–2025)`,
                ...(crops && crops.length > 0 ? ["usda-nass weekly"] : []),
                "live lane: open-meteo point",
              ].map((c) => (
                <span
                  key={c}
                  className="rounded-full bg-gray-900/80 px-2.5 py-1 font-mono text-[10px] text-gray-400 ring-1 ring-white/10"
                >
                  {c}
                </span>
              ))}
            </div>
            {guardsLine && (
              <p className="mt-3 font-mono text-[10px] leading-relaxed text-gray-600">
                data-quality receipts: {guardsLine} &middot; every number traceable to state-day rows
              </p>
            )}
          </article>
        )}
      </main>

      <InnerFooter current="plant" />
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 pb-2">
      <dt className="text-gray-500">{label}</dt>
      <dd
        className={
          accent
            ? "whitespace-nowrap text-amber-200/90"
            : strong
              ? "whitespace-nowrap text-gray-100"
              : "whitespace-nowrap text-gray-300"
        }
      >
        {value}
      </dd>
    </div>
  );
}
