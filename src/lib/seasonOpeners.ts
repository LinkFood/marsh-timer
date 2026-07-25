/**
 * seasonOpeners.ts — the openers-only derivation (Amendment 1.5 ruling 2).
 *
 * THE RULING: the countdown needs ONE date per state per species. The 2026-27
 * capture holds 357 records with zone structures, splits and per-segment bag
 * limits; nearly all the cost and nearly all the error risk lives in structure
 * the countdown never reads, and every failure found in verification was
 * structural. So we transcribe openers and link out for everything else. Being
 * wrong on a bag limit is a citation for the hunter — we are not the authority
 * of record on anything with legal consequence when the actual authority
 * publishes a URL we already hold.
 *
 * THE SELECTION RULE, stated once and enforced here rather than in the loader:
 *
 *   For each (state, species), the opener is the EARLIEST `open` date across
 *   every capture record for that pair whose `status` is "ok". Nothing else is
 *   eligible — `not_published`, `no_season`, `closed` and `conflicted` never
 *   produce a date, they produce an absence carrying the state's own reason.
 *
 * Three consequences, all deliberate, all made visible on the card:
 *
 *  1. ZONES. A state whose zones open on different days has one opener: the
 *     earliest. The winning record's own zone label rides along in `zone`, so
 *     the card says WHICH zone that date belongs to and reports how many other
 *     openers sit behind it (`laterOpeners`). We never imply a statewide date.
 *
 *  2. EARLY AND SPECIAL SEASONS. September resident Canada goose, September
 *     teal, the August goose management take — these ARE the opener when they
 *     are the earliest legal day, and the zone label names them as such
 *     ("Early Resident Canada Goose - Eastern Zone"). The alternative rule —
 *     "the regular season is the real opener" — is not derivable from this
 *     capture: there is no season_type field, the zone strings mix zone and
 *     season name in free text, and classifying them would be exactly the kind
 *     of structural inference that produced every verification failure. The
 *     earliest-open rule answers a question with one unambiguous answer: the
 *     first day this state lets you hunt this bird somewhere.
 *
 *  3. TIES. When two records share the earliest date, the label is taken from
 *     the alphabetically-first zone and `sameDayOpeners` counts the rest, so
 *     the choice is deterministic and reproducible from the file alone.
 *
 * Nothing here reads a clock, a network or a database. It is a total function
 * over the capture file, which is what makes the honesty branches testable.
 */

export type CaptureStatus = "ok" | "not_published" | "no_season" | "closed" | "conflicted";

export interface CaptureWindow {
  open: string;
  close: string;
}

/** One row of `data/seasons/2026-27.json`, as captured and verified. */
export interface CaptureRecord {
  state_abbr: string;
  species: string;
  season_year: string;
  zone: string;
  dates: CaptureWindow[] | null;
  status: string;
  bag_limit: number | null;
  provisional: boolean;
  provisional_note: string | null;
  source_url: string | null;
  fetched_at: string;
  confidence: string;
  notes: string | null;
  recheck_after?: string | null;
}

/** One state-species pair that produces a real countdown. */
export interface DerivedOpener {
  stateAbbr: string;
  species: string;
  seasonYear: string;
  /** The one date. ISO, the earliest `open` across the pair's `ok` records. */
  opensOn: string;
  /** The winning record's own zone/season label — displayed, never inferred. */
  zone: string;
  provisional: boolean;
  provisionalNote: string | null;
  sourceUrl: string | null;
  fetchedAt: string;
  confidence: string;
  /** How many other `ok` records open on the same day. */
  sameDayOpeners: number;
  /** How many other `ok` records open LATER — the "more zones behind this" count. */
  laterOpeners: number;
  /** How many `ok` records this one date was collapsed from. */
  sourceRecords: number;
}

/** One state-species pair that produces an honest absence, with its reason. */
export interface DerivedAbsence {
  stateAbbr: string;
  species: string;
  seasonYear: string;
  /** The state's own situation: not_published | no_season | closed | conflicted. */
  status: string;
  /** The capture's verbatim reason for the winning record. Long on purpose. */
  reason: string | null;
  recheckAfter: string | null;
  sourceUrl: string | null;
  fetchedAt: string;
  /** How many capture records this absence collapsed. */
  sourceRecords: number;
}

export interface Derivation {
  openers: DerivedOpener[];
  absences: DerivedAbsence[];
  /** Contradictions in the capture. Reported, never smoothed. */
  warnings: string[];
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function firstOpen(r: CaptureRecord): string | null {
  if (!Array.isArray(r.dates)) return null;
  const opens = r.dates
    .map((w) => w?.open)
    .filter((o): o is string => typeof o === "string" && ISO_DAY.test(o))
    .sort();
  return opens[0] ?? null;
}

function pairKey(r: CaptureRecord): string {
  return `${r.state_abbr}|${r.species}`;
}

/**
 * The season year runs July 1 → June 30. A capture date outside that window is
 * either a typo or a season from another year filed in this one; either way it
 * is a contradiction we name rather than silently count down to.
 */
function outsideSeasonYear(iso: string, seasonYear: string): boolean {
  const [a, b] = seasonYear.split("-");
  if (!a || !b) return false;
  return iso < `${a}-07-01` || iso > `${b}-06-30`;
}

export function deriveOpeners(records: CaptureRecord[]): Derivation {
  const pairs = new Map<string, CaptureRecord[]>();
  for (const r of records) {
    const k = pairKey(r);
    const held = pairs.get(k);
    if (held) held.push(r);
    else pairs.set(k, [r]);
  }

  const openers: DerivedOpener[] = [];
  const absences: DerivedAbsence[] = [];
  const warnings: string[] = [];

  for (const key of [...pairs.keys()].sort()) {
    const group = pairs.get(key)!;
    const [stateAbbr, species] = key.split("|");
    const seasonYear = group[0].season_year;
    if (group.some((r) => r.season_year !== seasonYear)) {
      warnings.push(`${key}: records disagree on season_year — using ${seasonYear}`);
    }

    // Eligible = status ok AND at least one well-formed open date.
    const eligible: { rec: CaptureRecord; open: string }[] = [];
    for (const r of group) {
      const open = firstOpen(r);
      if (r.status !== "ok") {
        if (open) {
          warnings.push(
            `${key}: record "${r.zone}" carries dates (opens ${open}) but is status=${r.status} — excluded from the opener`,
          );
        }
        continue;
      }
      if (!open) {
        warnings.push(`${key}: record "${r.zone}" is status=ok but holds no usable open date — excluded`);
        continue;
      }
      if (outsideSeasonYear(open, seasonYear)) {
        warnings.push(`${key}: record "${r.zone}" opens ${open}, outside season year ${seasonYear} — excluded`);
        continue;
      }
      eligible.push({ rec: r, open });
    }

    if (eligible.length === 0) {
      // The honest absence. Take the status the pair's records agree on; when
      // they disagree, the most common one, and say so.
      const counts = new Map<string, number>();
      for (const r of group) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const status = ranked[0]?.[0] ?? "not_published";
      if (ranked.length > 1) {
        warnings.push(`${key}: no opener and mixed statuses (${ranked.map(([s, n]) => `${s}×${n}`).join(", ")}) — filed as ${status}`);
      }
      // Prefer a Statewide record's reason when one exists; otherwise the first
      // record in file order. Deterministic, and it never merges two reasons.
      const carriers = group.filter((r) => r.status === status);
      const carrier = carriers.find((r) => /^statewide$/i.test(r.zone)) ?? carriers[0];
      absences.push({
        stateAbbr,
        species,
        seasonYear,
        status,
        reason: carrier.notes,
        recheckAfter: carrier.recheck_after ?? null,
        sourceUrl: carrier.source_url,
        fetchedAt: carrier.fetched_at,
        sourceRecords: group.length,
      });
      continue;
    }

    eligible.sort((a, b) => a.open.localeCompare(b.open) || a.rec.zone.localeCompare(b.rec.zone));
    const win = eligible[0];
    const sameDay = eligible.filter((e) => e.open === win.open).length - 1;

    openers.push({
      stateAbbr,
      species,
      seasonYear,
      opensOn: win.open,
      zone: win.rec.zone,
      // The winning record's OWN finality label. Not an OR across the pair: we
      // publish one date, and only that date's label describes it.
      provisional: win.rec.provisional === true,
      provisionalNote: win.rec.provisional_note,
      sourceUrl: win.rec.source_url,
      fetchedAt: win.rec.fetched_at,
      confidence: win.rec.confidence,
      sameDayOpeners: sameDay,
      laterOpeners: eligible.length - 1 - sameDay,
      sourceRecords: eligible.length,
    });
  }

  return { openers, absences, warnings };
}
