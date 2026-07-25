import { CalendarDays } from "lucide-react";
import {
  AbsenceLine,
  Load,
  OpenerLine,
  SeasonModel,
  longDate,
  seasonYearLabel,
  shortDate,
} from "@/lib/season";

/**
 * BLOCK 1 — the season block. The promise the domain name makes.
 *
 * Two rules govern every branch below.
 *
 * ONE DATE PER STATE PER SPECIES (Amendment 1.5 ruling 2). We publish the
 * opener. Zones, splits, closing dates and bag limits belong to the state and
 * this block links to them rather than restating them: being wrong on a bag
 * limit is a citation for the hunter, and we should never be the authority of
 * record on anything with legal consequence when the actual authority
 * publishes the page. So there is no "days left" here — a season that has
 * opened reports the day it opened and says the closing date is the state's.
 *
 * A COUNTDOWN IS EITHER THIS SEASON'S PUBLISHED DATE OR IT DOES NOT EXIST.
 * No "close enough", no last-season fallback, no date from a row the state
 * has not published. A hunter checks this number against his regs booklet in
 * three seconds; being wrong once is unrecoverable, so absence — carrying the
 * state's own reason — is the correct output far more often than a
 * plausible-looking figure.
 *
 * Provisional (Ruling 10.1, reaffirmed in Amendment 1.5 ruling 2) is a
 * DISPLAYED field with three states, not two:
 *   true      → the state published these but the federal frameworks are pending
 *   false     → final; no note at all
 *   null      → we hold NO finality label, and we say that rather than implying
 *               either one.
 * There is no 2026-27 federal frameworks rule this year — USFWS moved to a
 * three-year memorandum due no later than Aug 31 — so a real slice of states
 * are genuinely provisional and say so in their own words.
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

        {load.s === "ok" &&
          (load.v.hero ? (
            <Present stateName={stateName} model={load.v} />
          ) : (
            <Absent stateName={stateName} seasonYear={seasonYear} model={load.v} />
          ))}
      </div>
    </section>
  );
}

/* ─────────────────────────── present data ─────────────────────────── */

function Present({ stateName, model }: { stateName: string; model: SeasonModel }) {
  const hero = model.hero!;
  const rest = model.openers.filter((o) => o.key !== hero.key);

  return (
    <div className="max-w-3xl">
      {hero.status === "upcoming" ? (
        <>
          <h2 className="font-display text-[1.65rem] font-medium leading-[1.25] text-gray-50 sm:text-[2.4rem] sm:leading-[1.2]">
            {hero.speciesLabel} season opens {shortDate(hero.opensOn)}.
          </h2>
          <p className="mt-3 font-display text-[1.9rem] leading-none text-cyan-300 sm:text-[2.6rem]">
            {hero.daysOut} {hero.daysOut === 1 ? "day" : "days"} out.
          </p>
        </>
      ) : (
        <>
          <h2 className="font-display text-[1.65rem] font-medium leading-[1.25] text-gray-50 sm:text-[2.4rem] sm:leading-[1.2]">
            {hero.speciesLabel} season opened {shortDate(hero.opensOn)}.
          </h2>
          <p className="mt-3 font-mono text-[12px] leading-relaxed text-gray-500">
            {hero.daysSince} {hero.daysSince === 1 ? "day" : "days"} ago. We publish openers only
            &mdash; whether it is still open is on {stateName}&rsquo;s own calendar.
          </p>
        </>
      )}

      <WhichOpener stateName={stateName} line={hero} />
      <ProvisionalNote line={hero} />
      <ConfidenceNote line={hero} />

      {rest.length > 0 && (
        <dl className="mt-8 space-y-2.5 font-mono text-[13px]">
          {rest.map((o) => (
            <div
              key={o.key}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/5 pb-2"
            >
              <dt className="text-gray-500">
                {o.speciesLabel} season
                {o.zone && <span className="text-gray-600"> &middot; {o.zone}</span>}
              </dt>
              <dd className="whitespace-nowrap text-gray-300">
                {o.status === "upcoming" ? (
                  <>
                    {shortDate(o.opensOn)}{" "}
                    <span className="text-gray-600">&middot; {o.daysOut} out</span>
                  </>
                ) : (
                  <span className="text-gray-600">opened {shortDate(o.opensOn)}</span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* A species with no date sits alongside the one that has it. */}
      {model.absences.length > 0 && (
        <div className="mt-8 space-y-5">
          {model.absences.map((a) => (
            <AbsenceNote key={a.key} stateName={stateName} line={a} />
          ))}
        </div>
      )}

      <Receipts stateName={stateName} model={model} />
    </div>
  );
}

/**
 * WHICH opener this is. A state with zones has several; we publish the earliest
 * and name the zone or special season it belongs to, so nobody reads a
 * September resident-goose date as a statewide regular-season date.
 */
function WhichOpener({ stateName, line }: { stateName: string; line: OpenerLine }) {
  const many = (line.sourceRecords ?? 1) > 1;
  if (!line.zone && !many) return null;

  return (
    <p className="mt-4 max-w-2xl font-mono text-[11px] leading-relaxed text-gray-500">
      {line.zone ? <span className="text-gray-400">{line.zone}</span> : "Statewide"}
      {many && (
        <>
          {" "}
          &mdash; the earliest of {line.sourceRecords} {line.speciesLabel.toLowerCase()} seasons{" "}
          {stateName} publishes. The others open later or elsewhere in the state.
        </>
      )}
    </p>
  );
}

/** Ruling 10.1 — the state's own label, rendered, with unknown as its own case. */
function ProvisionalNote({ line }: { line: OpenerLine }) {
  if (line.provisional === false) return null;

  const headline =
    line.provisional === true
      ? "State-published, pending federal frameworks (due Aug 31)."
      : "We hold no final-or-provisional label for this date. Read it against the state's own publication before you hunt.";

  return (
    <div className="mt-5 max-w-2xl border-l-2 border-amber-400/30 pl-3 font-mono text-[11px] leading-relaxed text-amber-200/70">
      <p>{headline}</p>
      {/* The state's own wording, not ours. */}
      {line.provisional === true && line.provisionalNote && (
        <p className="mt-1.5 text-amber-200/50">&ldquo;{line.provisionalNote}&rdquo;</p>
      )}
    </div>
  );
}

/**
 * The capture graded its own transcription. Where that grade is not `high`, the
 * card says so — the alternative is a number that looks exactly as certain as
 * the eighty-three that were read cleanly.
 */
function ConfidenceNote({ line }: { line: OpenerLine }) {
  if (!line.confidence || line.confidence === "high") return null;
  return (
    <p className="mt-3 max-w-2xl font-mono text-[11px] leading-relaxed text-gray-500">
      Our transcription of this date is {line.confidence}-confidence. Check it against the
      state&rsquo;s page before you plan around it.
    </p>
  );
}

/* ──────────────────────────── absent data ─────────────────────────── */

const STATUS_PHRASE: Record<string, string> = {
  not_published: "has not published its",
  no_season: "has no",
  closed: "publishes no",
  conflicted: "publishes two disagreeing sets of",
};

function statusPhrase(status: string): string {
  return STATUS_PHRASE[status] ?? "publishes no usable";
}

/** One species with no date, and the state's own reason for it. */
function AbsenceNote({ stateName, line }: { stateName: string; line: AbsenceLine }) {
  const what = line.speciesLabel.toLowerCase();
  return (
    <div className="max-w-2xl border-l-2 border-white/10 pl-3">
      <p className="font-mono text-[12px] text-gray-400">
        No {what} opener &mdash; {stateName} {statusPhrase(line.status)} {what} dates.
      </p>
      {line.reason && (
        <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-gray-600">
          {line.reason}
          {line.reasonTrimmed && <> &hellip;</>}
        </p>
      )}
      <p className="mt-1.5 font-mono text-[10px] text-gray-600">
        {line.recheckAfter && <>re-check after {longDate(line.recheckAfter)} &middot; </>}
        <RegsLink stateName={stateName} url={line.sourceUrl} what={what} />
      </p>
    </div>
  );
}

/**
 * The link-out. `source_url` is the page actually read; the loader already
 * falls back to the standing official link in `hunt_regulation_links`. When
 * neither exists we say so rather than linking nowhere.
 */
function RegsLink({
  stateName,
  url,
  what,
}: {
  stateName: string;
  url: string | null;
  what: string;
}) {
  if (!url) {
    return (
      <span className="text-gray-600">
        we hold no official link for {stateName}&rsquo;s {what} regulations
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-cyan-300/90 underline decoration-cyan-300/30 underline-offset-2 hover:text-cyan-200"
    >
      {stateName}&rsquo;s own dates &rarr;
    </a>
  );
}

function Receipts({ stateName, model }: { stateName: string; model: SeasonModel }) {
  const hero = model.hero;
  const read = model.openers.find((o) => o.fetchedAt)?.fetchedAt ?? null;

  return (
    <div className="mt-6 space-y-1 font-mono text-[10px] leading-relaxed text-gray-600">
      <p>
        openers only &mdash; one date per species. Zones, splits, closing dates and bag limits are{" "}
        {stateName}&rsquo;s to publish, and we do not restate them.
      </p>
      <p>
        {read && <>read from the state&rsquo;s own page {longDate(read.slice(0, 10))} &middot; </>}
        <RegsLink stateName={stateName} url={hero?.sourceUrl ?? model.sourceUrl} what="waterfowl" />
      </p>
    </div>
  );
}

/**
 * The honest absence for the whole state: no current-season row produces a
 * date, for any species. Before the 2026-27 load this is what every state
 * rendered — 482 rows all stamped 2025-2026, nothing to count toward.
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
  return (
    <div className="max-w-2xl">
      <h2 className="font-display text-[1.4rem] leading-snug text-gray-300 sm:text-[1.9rem]">
        We don&rsquo;t hold {stateName}&rsquo;s {seasonYearLabel(seasonYear)} waterfowl openers.
      </h2>

      {model.absences.length > 0 ? (
        // The state itself is the reason, and it said why.
        <div className="mt-5 space-y-5">
          {model.absences.map((a) => (
            <AbsenceNote key={a.key} stateName={stateName} line={a} />
          ))}
        </div>
      ) : (
        <p className="mt-4 font-body text-[15px] leading-relaxed text-gray-400">
          {model.heldYear ? (
            <>
              The newest {stateName} rows in the season table are{" "}
              {seasonYearLabel(model.heldYear)}. Counting down to last season&rsquo;s opener would
              be wrong, so there is no countdown here.
            </>
          ) : (
            <>
              The season table holds no waterfowl rows for {stateName} at all &mdash; not this
              season, not any season. Nothing to count from.
            </>
          )}
        </p>
      )}

      {model.absences.length === 0 && (
        <p className="mt-5 font-mono text-[11px]">
          <RegsLink stateName={stateName} url={model.sourceUrl} what="waterfowl" />
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
