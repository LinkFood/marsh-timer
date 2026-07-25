import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Load, longDate } from "@/lib/season";
import {
  CARD_METRICS,
  CARD_METRIC_BY_ID,
  DEFAULT_EPISODE_GAP_DAYS,
  DOY_HALF_WINDOW,
  MIN_MATCHES,
  MIN_DISTINCT_YEARS,
  bandCensus,
  bandLabel,
  bandPhrase,
  decodeSeriesColumn,
  mmddLabel,
  poolForDoy,
  subjectPhrase,
  windowPhrase,
  type BandCensus,
  type CardMetric,
  type DecadeBar,
  type SeriesColumnRow,
} from "@/lib/board/frequency";

/**
 * BLOCK 3 — the frequency card.
 *
 * One sentence a hunter can check against his own memory:
 *
 *   A daytime high of 58.2 °F or colder over Maryland, within 10 days of
 *   October 10, has happened 46 times since 1950.
 *   Most recently October 19, 2022.
 *   [decade bars, per-year normalized]
 *   Maryland statewide. Not your marsh.
 *
 * …and now the same sentence about the two other things a duck hunter actually
 * asks — the water and the freeze (measured, Maryland, ±10 days of October 10,
 * wettest/coldest 5%):
 *
 *   0.65 in of rain or more, averaged across Maryland, within 10 days of
 *   October 10, has happened 66 times since 1950. Most recently October 1, 2022.
 *
 *   An overnight low of 35.2 °F or colder over Maryland, within 10 days of
 *   October 10, has happened 54 times since 1950. Most recently October 18, 2015.
 *
 * All seven metrics come off `ghcn-daily` rows that were already in the archive.
 * No new ingest, no new content type, and — because `board_series_columns` has no
 * `layout_version` — no board layout change and no re-bake of the 27,964 frames.
 *
 * THIS IS THE GHCN CARD, AND IT SAYS SO. The v1 card in the plan counts a PRESSURE
 * fall off an ERA5 backfill that is still landing. This one counts the state
 * weather record that is already here. Amendment 1.3 Ruling 3 sanctions exactly
 * that — "two sources is fine. Two sources silently blended into one number is
 * not." Nothing on this card may imply it is the pressure card.
 *
 * WHAT IS FIXED HERE, and must survive whoever edits it next:
 *
 *  - NO FORWARD JOIN (Ruling 4). Count, recency, decade distribution. No "what
 *    followed", no rate, no Wilson interval — a census is a complete enumeration
 *    of the archive, not a sample, and takes no confidence interval (Ruling 4b).
 *  - EPISODES, NOT DAYS (Ruling 2). A four-day cold snap is one time. The merge
 *    lives in scripts/board/episodes.ts and there is exactly one of it.
 *  - Decade bars PER-YEAR NORMALIZED, 1980s forward (Ruling 10.4). 1979 and
 *    earlier count toward the headline and the denominator, never a bar; the
 *    2020s bar is marked partial.
 *  - FLOORS ARE REFUSALS, NOT TARGETS (Ruling 6). Under 5 matches, under 10
 *    distinct years, or a band whose edge is a mass of identical readings, the
 *    card says so instead of printing a number.
 *  - THE BAND IS AN INPUT, NOT A CONSTANT. Ruling 1a leaves it deliberately
 *    undecided until it can be set from data, so all three candidates are on the
 *    face of the card with what each one yields.
 *  - THE DIRECTION IS PER METRIC AND IT IS NOT A DEFAULT. A hunter asks the cold
 *    question of temperature and the wet question of rain. `CARD_METRICS` names
 *    the tail each metric counts and the receipts say which one was used.
 */

/** Ruling 1a: undecided on purpose. The reader picks, and sees the consequence. */
const BANDS = [0.01, 0.02, 0.05];

/** What `board_series_columns` says this state holds, without pulling any blob. */
export interface MetricAvailability {
  metric: string;
  n_present: number;
  first_year: number;
  last_year: number;
}

interface Props {
  stateName: string;
  /** The anchor day, ISO. "This time of year" means within ±10 days of it. */
  on: string;
  /** Which metrics the archive holds for this state. One tiny read, no `readings`. */
  menu: Load<MetricAvailability[]>;
  /** The metric on display, owned by the page so the read can follow it. */
  metric: string;
  onMetric: (metric: string) => void;
  /** `ok` with a null value means this metric's column has not been baked here. */
  load: Load<SeriesColumnRow | null>;
}

export default function FrequencyCard({ stateName, on, menu, metric, onMetric, load }: Props) {
  const [band, setBand] = useState(0.05);
  const mmdd = on.slice(5);
  const w = useMemo(() => windowPhrase(mmdd), [mmdd]);

  const cm = CARD_METRIC_BY_ID[metric] ?? CARD_METRICS[0];
  const row = load.s === "ok" ? load.v : null;
  // Only decode the blob when it is the metric being asked for. A stale row from
  // the previous metric would render a rain threshold under a temperature label.
  const column = useMemo(
    () => (row && row.metric === metric ? decodeSeriesColumn(row) : null),
    [row, metric],
  );
  const pool = useMemo(() => (column ? poolForDoy(column, mmdd) : null), [column, mmdd]);
  const byBand = useMemo(
    () => (pool ? BANDS.map((b) => bandCensus(pool, b, cm.side)) : null),
    [pool, cm.side],
  );

  const census = byBand?.find((c) => c.band === band) ?? null;
  const since = pool?.length ? Math.min(...pool.map((p) => p.year)) : null;
  const through = column?.lastYear ?? null;

  return (
    <section>
      <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.28em] text-cyan-300/90">
        <BarChart3 className="h-3.5 w-3.5" aria-hidden />
        HOW OFTEN THIS HAPPENS HERE
      </div>
      <div className="mt-1.5 font-mono text-[11px] text-gray-500">
        {stateName} &middot; {cm.label} &middot; counting only &middot; no forward join
      </div>

      <div className="mt-6 max-w-3xl">
        <MetricPicker menu={menu} selected={metric} onSelect={onMetric} />

        {load.s === "loading" && (
          <p className="font-mono text-xs text-gray-600">reading the archive&hellip;</p>
        )}

        {load.s === "error" && (
          <p className="font-body text-[15px] leading-relaxed text-gray-400">
            The archive did not answer. We can&rsquo;t tell you how often this happens over{" "}
            {stateName}, and we won&rsquo;t estimate it &mdash; reload.
          </p>
        )}

        {load.s === "ok" && !column && <NotBaked stateName={stateName} metric={cm} />}

        {load.s === "ok" && column && byBand && census && (
          <>
            <BandPicker metric={metric} bands={byBand} selected={band} onSelect={setBand} />

            {census.refusal ? (
              <Refusal census={census} metric={cm} stateName={stateName} window={w} since={since} />
            ) : (
              <Answer census={census} metric={cm} stateName={stateName} window={w} since={since} />
            )}

            {!census.refusal && <Decades census={census} />}

            <Receipts
              stateName={stateName}
              metric={cm}
              census={census}
              window={w}
              mmdd={mmdd}
              since={since}
              through={through}
              source={column.source}
            />
          </>
        )}
      </div>
    </section>
  );
}

/* ────────────────────── which question, on the face ──────────────────────── */

/**
 * The archive has carried these seven fields for every state since 1950 and the
 * card counted one of them. Water and the freeze are a duck hunter's other two
 * real questions, so they belong on the face in the same idiom as the band: the
 * choice is visible, and a metric the archive does not hold for this state is
 * named as absent rather than quietly missing.
 */
function MetricPicker({
  menu,
  selected,
  onSelect,
}: {
  menu: Load<MetricAvailability[]>;
  selected: string;
  onSelect: (m: string) => void;
}) {
  const held = new Map((menu.s === "ok" ? menu.v : []).map((m) => [m.metric, m]));
  return (
    <div className="mb-7">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-600">
        which question
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {CARD_METRICS.map((m) => {
          const have = menu.s !== "ok" || held.has(m.metric);
          const active = m.metric === selected;
          return (
            <button
              key={m.metric}
              type="button"
              disabled={!have}
              onClick={() => onSelect(m.metric)}
              aria-pressed={active}
              className={`rounded border px-3 py-1.5 text-left font-mono text-[11px] leading-tight transition-colors ${
                !have
                  ? "cursor-not-allowed border-white/5 bg-gray-900/40 text-gray-700"
                  : active
                    ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-100"
                    : "border-white/10 bg-gray-900/60 text-gray-400 hover:border-white/25 hover:text-gray-200"
              }`}
            >
              <span className="block">{m.label}</span>
              <span className="block text-[10px] text-gray-600">
                {have ? `${m.side === "low" ? "cold" : "high"} end · ${m.unit}` : "not held here"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─────────────────────────── the band, on the face ───────────────────────── */

/**
 * Ruling 1a made the band undecided; §6's floors made it consequential. Showing
 * all three with their counts is the only way a reader can see that the number
 * moves with a choice we have not finished making — and which choices refuse.
 */
function BandPicker({
  metric,
  bands,
  selected,
  onSelect,
}: {
  metric: string;
  bands: BandCensus[];
  selected: number;
  onSelect: (b: number) => void;
}) {
  return (
    <div className="mb-7">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-600">
        how close a match has to count
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {bands.map((c) => {
          const active = c.band === selected;
          return (
            <button
              key={c.band}
              type="button"
              onClick={() => onSelect(c.band)}
              aria-pressed={active}
              className={`rounded border px-3 py-1.5 text-left font-mono text-[11px] leading-tight transition-colors ${
                active
                  ? "border-cyan-300/50 bg-cyan-300/10 text-cyan-100"
                  : "border-white/10 bg-gray-900/60 text-gray-400 hover:border-white/25 hover:text-gray-200"
              }`}
            >
              <span className="block">{bandLabel(metric, c.band, c.side)}</span>
              <span className={`block text-[10px] ${c.refusal ? "text-gray-600" : "text-gray-500"}`}>
                {c.refusal ? "refuses" : `${c.count} times`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ───────────────────────────────── the answer ────────────────────────────── */

function Answer({
  census,
  metric,
  stateName,
  window: w,
  since,
}: {
  census: BandCensus;
  metric: CardMetric;
  stateName: string;
  window: { short: string; span: string };
  since: number | null;
}) {
  return (
    <>
      <h2 className="font-display text-[1.45rem] leading-[1.3] text-gray-50 sm:text-[2rem]">
        {capitalize(subjectPhrase(metric.metric, census.side, census.threshold, stateName))},{" "}
        {w.short}, has happened {census.count} times since {since}.
      </h2>
      {census.lastOccurrence && (
        <p className="mt-3 font-body text-[15px] leading-relaxed text-gray-400">
          Most recently {longDate(census.lastOccurrence)}.
        </p>
      )}
    </>
  );
}

/**
 * The refusal, written as content. A count under the floors says more about
 * chance than about the ground, and a number chosen anyway would be a guess
 * wearing a count's clothes.
 *
 * Two different refusals, because they have two different remedies. Too little
 * history is answered by widening the band. A band whose edge is a MASS of
 * identical readings is not: widening it only swallows more of the same value,
 * and the honest thing to say is that this state's record does not carry the
 * question — which is what a snowfall card in Louisiana is.
 */
function Refusal({
  census,
  metric,
  stateName,
  window: w,
  since,
}: {
  census: BandCensus;
  metric: CardMetric;
  stateName: string;
  window: { short: string; span: string };
  since: number | null;
}) {
  const tieRefusal = /share the band's edge value/.test(census.refusal ?? "");
  const tooFew = census.count < MIN_MATCHES;

  if (tieRefusal) {
    const pct = Math.round((100 * census.edge.ties) / Math.max(census.poolN, 1));
    return (
      <>
        <h2 className="font-display text-[1.45rem] leading-[1.3] text-gray-300 sm:text-[2rem]">
          {stateName}&rsquo;s record can&rsquo;t answer this one.
        </h2>
        <p className="mt-3 font-body text-[15px] leading-relaxed text-gray-500">
          {capitalize(census.edge.ties.toLocaleString())} of the {census.poolN.toLocaleString()} days
          in this window &mdash; {pct}% of them &mdash; read exactly the same value, so a
          &ldquo;{bandLabel(metric.metric, census.band, census.side)}&rdquo; band is a rank drawn
          through a pile of identical readings. Which days landed inside it would be decided by the
          sort order, not by the weather. Widening the band makes that worse, not better, so we
          don&rsquo;t print a count.
        </p>
      </>
    );
  }

  return (
    <>
      <h2 className="font-display text-[1.45rem] leading-[1.3] text-gray-300 sm:text-[2rem]">
        Not enough history to put a number on that one.
      </h2>
      <p className="mt-3 font-body text-[15px] leading-relaxed text-gray-500">
        {capitalize(bandPhrase(metric.metric, census.band, census.side))} over {stateName} {w.short}{" "}
        has come around {census.count} {census.count === 1 ? "time" : "times"} since {since}, in{" "}
        {census.years.length} separate {census.years.length === 1 ? "year" : "years"}.{" "}
        {tooFew
          ? `Under ${MIN_MATCHES} occasions we don't print a count at all.`
          : `We don't state a frequency on fewer than ${MIN_DISTINCT_YEARS} distinct years.`}{" "}
        Widen the band and the same record will answer.
      </p>
    </>
  );
}

function NotBaked({ stateName, metric }: { stateName: string; metric: CardMetric }) {
  return (
    <>
      <h2 className="font-display text-[1.45rem] leading-[1.3] text-gray-300 sm:text-[2rem]">
        We can&rsquo;t count this yet.
      </h2>
      <p className="mt-3 font-body text-[15px] leading-relaxed text-gray-500">
        The archive holds no {metric.label} column for {stateName}. The record may exist &mdash; it
        just has not been transposed into the form this card reads. Rather than count something
        adjacent and call it {stateName}, we say nothing.
      </p>
    </>
  );
}

/* ───────────────────────────── the decade bars ───────────────────────────── */

/**
 * Ruling 10.4 — per-year normalized, 1980s forward, 2020s marked partial.
 *
 * One series, so no legend: the axis line names it. Every bar carries its own
 * count and its own denominator in text, so nothing here is encoded in colour
 * alone, and the partial decade is marked by a hatched fill AND the word.
 */
function Decades({ census }: { census: BandCensus }) {
  const bars = census.dist.bars;
  if (!bars.length) return null;
  const peak = Math.max(...bars.map((b) => b.perYear), 0.0001);

  return (
    <figure className="mt-8">
      <figcaption className="font-mono text-[10px] uppercase tracking-[0.2em] text-gray-600">
        occasions per year of record
      </figcaption>

      <div className="mt-3 flex items-end gap-[2px]" style={{ height: 84 }}>
        {bars.map((b) => (
          <Bar key={b.decade} bar={b} peak={peak} />
        ))}
      </div>

      <div className="flex gap-[2px] border-t border-white/10 pt-1.5">
        {bars.map((b) => (
          <div key={b.decade} className="flex-1 text-center font-mono text-[10px] leading-tight">
            <div className="text-gray-400">{b.decade}s</div>
            <div className="text-gray-600">
              {b.count}/{b.yearsOfRecord}y
            </div>
            {b.partial && <div className="text-amber-200/70">partial</div>}
          </div>
        ))}
      </div>

      {(census.dist.preBarCount > 0 || census.dist.preBarYears > 0) && (
        <p className="mt-3 font-mono text-[10px] leading-relaxed text-gray-600">
          {census.dist.preBarCount} of the {census.dist.total} fell before {bars[0].decade}, across{" "}
          {census.dist.preBarYears} years of record. Counted in the headline and in the denominator,
          not drawn &mdash; a stub decade normalized per year swings on n=0-to-3 and reads as a
          spike at the left edge, where it anchors the eye.
        </p>
      )}
    </figure>
  );
}

function Bar({ bar, peak }: { bar: DecadeBar; peak: number }) {
  const pct = Math.max(bar.perYear / peak, bar.count > 0 ? 0.03 : 0);
  return (
    <div className="flex flex-1 flex-col justify-end" style={{ height: "100%" }}>
      <div
        role="img"
        aria-label={`${bar.decade}s: ${bar.count} in ${bar.yearsOfRecord} years of record, ${bar.perYear.toFixed(2)} per year${bar.partial ? ", partial decade" : ""}`}
        title={`${bar.perYear.toFixed(2)}/yr`}
        className="rounded-t-[4px]"
        style={{
          height: `${pct * 100}%`,
          minHeight: bar.count > 0 ? 2 : 0,
          // Longhand, not the `background` shorthand: a gradient inside the
          // shorthand is silently dropped by some CSS parsers, and a partial
          // decade that renders as an empty column is the one bar on this figure
          // that MUST be visible. The hatch is a second encoding, never the only
          // one — the word "partial" sits under it either way.
          backgroundColor: "rgba(103,232,249,0.75)",
          backgroundImage: bar.partial
            ? "repeating-linear-gradient(135deg, rgba(3,7,18,0) 0 3px, rgba(3,7,18,0.55) 3px 6px)"
            : undefined,
        }}
      />
    </div>
  );
}

/* ─────────────────────────────── the receipts ────────────────────────────── */

function Receipts({
  stateName,
  metric,
  census,
  window: w,
  mmdd,
  since,
  through,
  source,
}: {
  stateName: string;
  metric: CardMetric;
  census: BandCensus;
  window: { short: string; span: string };
  mmdd: string;
  since: number | null;
  through: number | null;
  source: string;
}) {
  return (
    <div className="mt-7 space-y-2">
      <p className="font-body text-[14px] italic leading-relaxed text-gray-500">
        {stateName} statewide. Not your marsh.
      </p>
      <p className="font-mono text-[10px] leading-relaxed text-gray-600">
        {metric.label} &mdash; {metric.note}. This is not the pressure card: that one counts a
        different variable off a different record, and the two are never blended.
      </p>
      <p className="font-mono text-[10px] leading-relaxed text-gray-600">
        counted at the {census.side === "low" ? "low" : "high"} end &mdash; {metric.sideWhy}
        {metric.zeroInflated
          ? " · most days here read 0, so only the high end is a tail at all; the other end is the mass, and a rank inside it would be the sort order"
          : ""}
      </p>
      <p className="font-mono text-[10px] leading-relaxed text-gray-600">
        {source} &middot; daily state means, {since}&ndash;{through} &middot; a state mean is an
        average over a station network that grew from 6,121 to 7,771 stations across this record, so
        a small part of any long-run drift is the network changing, not the weather.
      </p>
      <p className="font-mono text-[10px] leading-relaxed text-gray-600">
        window: {w.short} ({w.span}), every year on record &mdash; {census.poolN} days from{" "}
        {census.poolYears.length} years is the denominator &middot; anchored on {mmddLabel(mmdd)}{" "}
        &middot; &plusmn;{DOY_HALF_WINDOW} days by calendar day-of-year, February 29 counted with
        March 1
      </p>
      <p className="font-mono text-[10px] leading-relaxed text-gray-600">
        &ldquo;times&rdquo; means occasions, not days: {census.matchedDays} matched days merge into{" "}
        {census.count} {census.count === 1 ? "occasion" : "occasions"} at a{" "}
        {DEFAULT_EPISODE_GAP_DAYS}-day gap tolerance &middot; {census.edge.ties} of the window share
        the band&rsquo;s edge value, {census.edge.tiesInBand} of them inside it &middot; the band is
        not settled &mdash; all three candidates are above, with what each one yields &middot;
        census, so no interval
      </p>
    </div>
  );
}

/* ─────────────────────────────────── utils ───────────────────────────────── */

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
