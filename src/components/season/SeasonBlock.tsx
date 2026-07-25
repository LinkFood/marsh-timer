import { CalendarDays } from "lucide-react";
import {
  Load,
  SeasonLine,
  SeasonModel,
  longDate,
  seasonYearLabel,
  shortDate,
} from "@/lib/season";

/**
 * BLOCK 1 — the season block. The promise the domain name makes.
 *
 * The one rule that governs every branch below: a countdown is either built
 * from THIS season's published dates or it does not exist. There is no third
 * option, no "close enough", no last-season fallback. A hunter checks this
 * number against his regs booklet in three seconds; being wrong once is
 * unrecoverable, so absence is the correct output far more often than a
 * plausible-looking figure.
 *
 * Provisional (Ruling 10.1) is a DISPLAYED field with three states, not two:
 *   true      → the state published these but the federal frameworks are pending
 *   false     → final; no note at all
 *   null      → we hold NO finality label, and we say that rather than implying
 *               either one. `hunt_seasons` has no `provisional` column today,
 *               so null is what every row reports right now.
 */

interface Props {
  stateName: string;
  /** The season year the page is counting toward, e.g. "2026-2027". */
  seasonYear: string;
  load: Load<SeasonModel>;
}

export default function SeasonBlock({ stateName, seasonYear, load }: Props) {
  return (
    <section>
      <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.28em] text-cyan-300/90">
        <CalendarDays className="h-3.5 w-3.5" aria-hidden />
        THE SEASON
      </div>
      <div className="mt-1.5 font-mono text-[11px] text-gray-500">
        {stateName} &middot; {seasonYearLabel(seasonYear)} waterfowl
      </div>

      <div className="mt-6">
        {load.s === "loading" && (
          <p className="font-mono text-xs text-gray-600">reading the season table&hellip;</p>
        )}

        {/* The read itself failed — distinct from "we hold no dates". */}
        {load.s === "error" && (
          <p className="max-w-2xl font-body text-[15px] leading-relaxed text-gray-400">
            The season table did not answer. That is a fault on our side, not a
            statement about {stateName}&rsquo;s dates &mdash; reload before you
            conclude anything from it.
          </p>
        )}

        {load.s === "ok" && (load.v.hero ? <Present model={load.v} /> : <Absent stateName={stateName} seasonYear={seasonYear} model={load.v} />)}
      </div>
    </section>
  );
}

/* ─────────────────────────── present data ─────────────────────────── */

function Present({ model }: { model: SeasonModel }) {
  const hero = model.hero!;
  return (
    <div className="max-w-3xl">
      {hero.status === "upcoming" ? (
        <>
          <h2 className="font-display text-[1.65rem] font-medium leading-[1.25] text-gray-50 sm:text-[2.4rem] sm:leading-[1.2]">
            {hero.label} opens {shortDate(hero.opens!)}.
          </h2>
          <p className="mt-3 font-display text-[1.9rem] leading-none text-cyan-300 sm:text-[2.6rem]">
            {hero.daysOut} {hero.daysOut === 1 ? "day" : "days"} out.
          </p>
        </>
      ) : (
        <>
          <h2 className="font-display text-[1.65rem] font-medium leading-[1.25] text-gray-50 sm:text-[2.4rem] sm:leading-[1.2]">
            {hero.label} is open.
          </h2>
          <p className="mt-3 font-display text-[1.9rem] leading-none text-cyan-300 sm:text-[2.6rem]">
            {hero.daysLeft} {hero.daysLeft === 1 ? "day" : "days"} left.
          </p>
          {hero.closes && (
            <p className="mt-2 font-mono text-[11px] text-gray-500">closes {longDate(hero.closes)}</p>
          )}
        </>
      )}

      <ProvisionalNote line={hero} />

      {/* Every season we hold for this state and year — zones included. */}
      {model.lines.length > 1 && (
        <dl className="mt-8 space-y-2.5 font-mono text-[13px]">
          {model.lines.map((l) => (
            <div
              key={l.key}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/5 pb-2"
            >
              <dt className="text-gray-500">{l.label}</dt>
              <dd className="whitespace-nowrap text-gray-300">
                {l.status === "closed" ? (
                  <span className="text-gray-600">closed {shortDate(l.closes!)}</span>
                ) : l.status === "open" ? (
                  <span className="text-cyan-300/90">open &middot; {l.daysLeft} left</span>
                ) : (
                  <>
                    {shortDate(l.opens!)} <span className="text-gray-600">&middot; {l.daysOut} out</span>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <Receipts model={model} />
    </div>
  );
}

/** Ruling 10.1 — the state's own label, rendered, with unknown as its own case. */
function ProvisionalNote({ line }: { line: SeasonLine }) {
  if (line.provisional === false) return null;

  const text =
    line.provisional === true
      ? "State-published, pending federal frameworks (due Aug 31)."
      : "We hold no final-or-provisional label for these dates. Read them against the state's own publication before you hunt.";

  return (
    <p className="mt-5 max-w-2xl border-l-2 border-amber-400/30 pl-3 font-mono text-[11px] leading-relaxed text-amber-200/70">
      {text}
      {line.sourceUrl && (
        <>
          {" "}
          <a
            href={line.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-amber-200/90 underline decoration-amber-200/30 underline-offset-2 hover:text-amber-100"
          >
            the state&rsquo;s regulations &rarr;
          </a>
        </>
      )}
    </p>
  );
}

function Receipts({ model }: { model: SeasonModel }) {
  const unverified = model.lines.filter((l) => l.verified === false).length;
  return (
    <p className="mt-6 font-mono text-[10px] leading-relaxed text-gray-600">
      {model.lines.length} season {model.lines.length === 1 ? "row" : "rows"} held &middot; statewide
      and zone rows as the state publishes them
      {unverified > 0 && (
        <>
          {" "}
          &middot; {unverified} not yet double-checked against the state&rsquo;s publication
        </>
      )}
    </p>
  );
}

/* ──────────────────────────── absent data ─────────────────────────── */

/**
 * The honest absence. This is what renders today, for all 50 states: every one
 * of the 482 rows in `hunt_seasons` is stamped 2025-2026, so there is nothing
 * to count toward. We name what we hold rather than showing a stale number.
 */
function Absent({
  stateName,
  seasonYear,
  model,
}: {
  stateName: string;
  seasonYear: string;
  model: SeasonModel;
}) {
  const allClosed = model.lines.length > 0;

  return (
    <div className="max-w-2xl">
      <h2 className="font-display text-[1.4rem] leading-snug text-gray-300 sm:text-[1.9rem]">
        {allClosed ? (
          <>
            Every {seasonYearLabel(seasonYear)} waterfowl season we hold for {stateName} has closed.
          </>
        ) : (
          <>
            We don&rsquo;t hold {stateName}&rsquo;s {seasonYearLabel(seasonYear)} waterfowl dates
            yet.
          </>
        )}
      </h2>

      {!allClosed && (
        <p className="mt-4 font-body text-[15px] leading-relaxed text-gray-400">
          {model.heldYear ? (
            <>
              The newest {stateName} rows in the season table are{" "}
              {seasonYearLabel(model.heldYear)}. Counting down to last season&rsquo;s opener would
              be wrong, so there is no countdown here. The {seasonYearLabel(seasonYear)} dates are
              being transcribed from the state&rsquo;s own publication.
            </>
          ) : (
            <>
              The season table holds no waterfowl rows for {stateName} at all &mdash; not this
              season, not any season. Nothing to count from.
            </>
          )}
        </p>
      )}

      {model.sourceUrl && (
        <p className="mt-4 font-mono text-[11px]">
          <a
            href={model.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-300/90 underline decoration-cyan-300/30 underline-offset-2 hover:text-cyan-200"
          >
            {stateName}&rsquo;s regulations &rarr;
          </a>
        </p>
      )}

      {model.heldYear && (
        <p className="mt-5 font-mono text-[10px] leading-relaxed text-gray-600">
          held: {model.heldCount} {stateName} duck/goose{" "}
          {model.heldCount === 1 ? "row" : "rows"}, all stamped{" "}
          {seasonYearLabel(model.heldYear)}
        </p>
      )}
    </div>
  );
}
