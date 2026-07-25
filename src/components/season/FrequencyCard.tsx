import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Load, longDate } from "@/lib/season";
import {
  DEFAULT_EPISODE_GAP_DAYS,
  DOY_HALF_WINDOW,
  MIN_MATCHES,
  MIN_DISTINCT_YEARS,
  bandCensus,
  bandPhrase,
  decodeSeriesColumn,
  mmddLabel,
  poolForDoy,
  thresholdPhrase,
  windowPhrase,
  type BandCensus,
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
 * THIS IS THE TEMPERATURE CARD, AND IT SAYS SO. The v1 card in the plan counts a
 * PRESSURE fall off an ERA5 backfill that is still landing. This one counts a
 * temperature tail off 76 complete years of GHCN that are already here.
 * Amendment 1.3 Ruling 3 sanctions exactly that — "the cold-snap card is a
 * separate later card on a separate variable from a separate source, each
 * labeled. Two sources is fine. Two sources silently blended into one number is
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
 *  - FLOORS ARE REFUSALS, NOT TARGETS (Ruling 6). Under 5 matches, or under 10
 *    distinct years, the card says so instead of printing a number.
 *  - THE BAND IS AN INPUT, NOT A CONSTANT. Ruling 1a leaves it deliberately
 *    undecided until it can be set from data. A band hidden inside this component
 *    would be a decision made by taste, so all three candidates are on the face
 *    of the card with what each one yields.
 */

/** Ruling 1a: undecided on purpose. The reader picks, and sees the consequence. */
const BANDS = [0.01, 0.02, 0.05];

interface Props {
  stateName: string;
  /** The anchor day, ISO. "This time of year" means within ±10 days of it. */
  on: string;
  /** `ok` with a null value means the column has not been baked for this state. */
  load: Load<SeriesColumnRow | null>;
}

export default function FrequencyCard({ stateName, on, load }: Props) {
  const [band, setBand] = useState(0.05);
  const mmdd = on.slice(5);
  const w = useMemo(() => windowPhrase(mmdd), [mmdd]);

  const row = load.s === "ok" ? load.v : null;
  const column = useMemo(() => (row ? decodeSeriesColumn(row) : null), [row]);
  const pool = useMemo(() => (column ? poolForDoy(column, mmdd) : null), [column, mmdd]);
  const byBand = useMemo(
    () => (pool ? BANDS.map((b) => bandCensus(pool, b, "low")) : null),
    [pool],
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
        {stateName} &middot; air temperature &middot; counting only &middot; no forward join
      </div>

      <div className="mt-6 max-w-3xl">
        {load.s === "loading" && (
          <p className="font-mono text-xs text-gray-600">reading the archive&hellip;</p>
        )}

        {load.s === "error" && (
          <p className="font-body text-[15px] leading-relaxed text-gray-400">
            The archive did not answer. We can&rsquo;t tell you how often this happens over{" "}
            {stateName}, and we won&rsquo;t estimate it &mdash; reload.
          </p>
        )}

        {load.s === "ok" && !column && <NotBaked stateName={stateName} />}

        {load.s === "ok" && column && byBand && census && (
          <>
            <BandPicker bands={byBand} selected={band} onSelect={setBand} />

            {census.refusal ? (
              <Refusal census={census} stateName={stateName} window={w} since={since} />
            ) : (
              <Answer census={census} stateName={stateName} window={w} since={since} />
            )}

            <Decades census={census} />

            <Receipts
              stateName={stateName}
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

/* ─────────────────────────── the band, on the face ───────────────────────── */

/**
 * Ruling 1a made the band undecided; §6's floors made it consequential. Showing
 * all three with their counts is the only way a reader can see that the number
 * moves with a choice we have not finished making — and which choices refuse.
 */
function BandPicker({
  bands,
  selected,
  onSelect,
}: {
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
              <span className="block">coldest {Math.round(c.band * 1000) / 10}%</span>
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
  stateName,
  window: w,
  since,
}: {
  census: BandCensus;
  stateName: string;
  window: { short: string; span: string };
  since: number | null;
}) {
  return (
    <>
      <h2 className="font-display text-[1.45rem] leading-[1.3] text-gray-50 sm:text-[2rem]">
        {capitalize(thresholdPhrase("avg_high_f", census.side, census.threshold))} over {stateName},{" "}
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
 */
function Refusal({
  census,
  stateName,
  window: w,
  since,
}: {
  census: BandCensus;
  stateName: string;
  window: { short: string; span: string };
  since: number | null;
}) {
  const tooFew = census.count < MIN_MATCHES;
  return (
    <>
      <h2 className="font-display text-[1.45rem] leading-[1.3] text-gray-300 sm:text-[2rem]">
        Not enough history to put a number on that one.
      </h2>
      <p className="mt-3 font-body text-[15px] leading-relaxed text-gray-500">
        {capitalize(bandPhrase(census.band, census.side))} over {stateName} {w.short} has come around{" "}
        {census.count} {census.count === 1 ? "time" : "times"} since {since}, in{" "}
        {census.years.length} separate {census.years.length === 1 ? "year" : "years"}.{" "}
        {tooFew
          ? `Under ${MIN_MATCHES} occasions we don't print a count at all.`
          : `We don't state a frequency on fewer than ${MIN_DISTINCT_YEARS} distinct years.`}{" "}
        Widen the band and the same record will answer.
      </p>
    </>
  );
}

function NotBaked({ stateName }: { stateName: string }) {
  return (
    <>
      <h2 className="font-display text-[1.45rem] leading-[1.3] text-gray-300 sm:text-[2rem]">
        We can&rsquo;t count this yet.
      </h2>
      <p className="mt-3 font-body text-[15px] leading-relaxed text-gray-500">
        The archive holds no temperature column for {stateName}. The record exists &mdash; it just
        has not been transposed into the form this card reads. Rather than count something adjacent
        and call it {stateName}, we say nothing.
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
  census,
  window: w,
  mmdd,
  since,
  through,
  source,
}: {
  stateName: string;
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
        air temperature, not pressure &mdash; this is the cold-snap card, not the front card, and the
        two count different things off different records.
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
        {DEFAULT_EPISODE_GAP_DAYS}-day gap tolerance &middot; the band is not settled &mdash; all
        three candidates are above, with what each one yields &middot; census, so no interval
      </p>
    </div>
  );
}

/* ─────────────────────────────────── utils ───────────────────────────────── */

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
