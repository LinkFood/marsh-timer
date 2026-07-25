import { BarChart3 } from "lucide-react";

/**
 * BLOCK 3 — the frequency card. ██ PLACEHOLDER — DATA DOES NOT EXIST YET ██
 *
 * This file is deliberately incomplete and must stay that way until week two.
 * It holds the final props shape and the honest empty state. It holds NO
 * numbers, no sample data, no mock, no shape-of-the-answer illustration.
 *
 * WHY IT IS NOT BUILT (do not "finish" this without reading these):
 *
 *  1. The series it counts against is still landing. The ERA5 surface-pressure
 *     backfill (1979-forward, 5 sample points per state, `sampling_version`
 *     frozen per Ruling 10.3) is running in parallel. There is nothing to
 *     count today.
 *
 *  2. The BAND — how close a match has to be to count as "a pressure fall this
 *     size" — is deliberately undecided. Ruling 2 makes it a moving window
 *     around the live event's percentile, and plan §2.5–2.7 sets it from
 *     episode-gap sensitivity and the pressure-delta independence check, both
 *     of which need the backfilled data first. Picking a band by taste now
 *     would put a guess behind a count, which is exactly the failure this card
 *     exists to avoid.
 *
 * WHAT IS ALREADY FIXED, and must survive whoever finishes it:
 *
 *  - NO FORWARD JOIN (Ruling 4). Count, recency, decade distribution. No
 *    "what followed", no rate, no Wilson interval, because there is no rate.
 *    v1a is counting, and counting has never failed.
 *  - Decade bars are PER-YEAR NORMALIZED and start at the 1980s (Ruling 10.4).
 *    1979 counts toward `count` and toward the denominator but never gets its
 *    own bar; the 2020s bar is marked partial.
 *  - Statistical floor (spec §6.4): under MIN_MATCHES, refuse. A refusal is a
 *    better product than a fabricated number.
 *  - The honesty line renders on every card, every time: state-level. The
 *    5-point sampling detail belongs in the methods note, not the card face
 *    (Ruling 10.3).
 */

/** Spec §6.4 — below this we render the refusal, never a number. */
export const MIN_MATCHES = 5;

export interface DecadeBar {
  /** 1980, 1990, … */
  decade: number;
  count: number;
  /** Years of record contributing to this bar — the denominator. */
  years: number;
  /** count / years. What actually gets drawn (Ruling 10.4). */
  perYear: number;
  /** True for a decade the record only partly covers (the 2020s). */
  partial: boolean;
}

export interface FrequencyCardData {
  /** "A pressure fall this size" — the band, phrased. */
  eventPhrase: string;
  /** "the second week of October" — the doy window, phrased. */
  windowPhrase: string;
  /** Matches over the full record. */
  count: number;
  /** First year of the record the count runs over (1979). */
  sinceYear: number;
  /** ISO date of the most recent match, null if none. */
  lastOccurrence: string | null;
  /** 1980s forward, per-year normalized. */
  decades: DecadeBar[];
  /** How the band was defined, for the methods note. Never "roughly". */
  bandNote: string;
}

interface Props {
  stateName: string;
  /** null until the backfill lands and the band is set. */
  data: FrequencyCardData | null;
}

export default function FrequencyCard({ stateName, data }: Props) {
  return (
    <section>
      <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.28em] text-cyan-300/90">
        <BarChart3 className="h-3.5 w-3.5" aria-hidden />
        HOW OFTEN THIS HAPPENS HERE
      </div>
      <div className="mt-1.5 font-mono text-[11px] text-gray-500">
        {stateName} &middot; counting only &middot; no forward join
      </div>

      <div className="mt-6 max-w-3xl">
        {data === null || data.count < MIN_MATCHES ? (
          <Absent stateName={stateName} data={data} />
        ) : (
          /* ██ NOT BUILT ██ — see the header comment. The present-data render
             is week-two work and must not be authored before the band is set
             from the backfilled data. Rendering the refusal is the correct
             behaviour until then, not a stopgap. */
          <Absent stateName={stateName} data={null} />
        )}
      </div>
    </section>
  );
}

function Absent({ stateName, data }: { stateName: string; data: FrequencyCardData | null }) {
  // Two different absences, and they are not the same statement.
  const refusal = data !== null;

  return (
    <>
      <h2 className="font-display text-[1.45rem] leading-[1.3] text-gray-300 sm:text-[2rem]">
        {refusal
          ? "Not enough history at this time of year."
          : "We can’t count this yet."}
      </h2>
      <p className="mt-3 font-body text-[15px] leading-relaxed text-gray-500">
        {refusal ? (
          <>
            Fewer than {MIN_MATCHES} matched days in {stateName}&rsquo;s record. Below that a count
            says more about chance than about the ground, so we don&rsquo;t print one.
          </>
        ) : (
          <>
            The pressure record this card counts against is still landing &mdash; an ERA5 backfill,
            1979 forward. And the band, meaning how close a match has to be to count, is
            deliberately undecided until that data is in. A number chosen before then would be a
            guess wearing a count&rsquo;s clothes.
          </>
        )}
      </p>
      <p className="mt-6 font-mono text-[10px] leading-relaxed text-gray-600">
        when it lands: count, most-recent, decade distribution &middot; per-year normalized, 1980s
        forward &middot; {stateName} statewide. Not your marsh.
      </p>
    </>
  );
}
