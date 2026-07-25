/**
 * season.ts — the pure model behind /season (v1a, the hunter's state page).
 *
 * Everything here is a total function over rows the page already read: no
 * fetching, no clock reads except the one `today` string the caller passes in.
 * That keeps the honesty branches testable and keeps the page thin.
 *
 * Three house laws are enforced here rather than in the markup, because markup
 * is where honesty rules go to get edited away:
 *
 *  1. A countdown is only ever built from rows stamped with the CURRENT season
 *     year (`currentSeasonYear`). Before the 2026-27 load, `hunt_seasons` held
 *     482 rows all stamped 2025-2026; every one of those dates is last season.
 *     A countdown off them would be confidently wrong three seconds after a
 *     hunter checked it against his regs booklet, so `buildSeasonModel` returns
 *     no openers at all and the page renders the absence.
 *
 *  2. ONE DATE PER STATE PER SPECIES (Amendment 1.5 ruling 2). We publish the
 *     opener and link out for zones, splits, closing dates and bag limits —
 *     being wrong on a bag limit is a citation for the hunter, and the state
 *     publishes all of it at a URL we already hold. So there is no "days left"
 *     here and no bag limit: a season that has opened reports the date it
 *     opened and says the closing date is the state's to publish.
 *     A row whose `status` is not `ok` NEVER becomes a countdown. It becomes an
 *     absence carrying the state's own reason.
 *
 *  3. `hunt_weather_events` is a DETECTION lane sitting on top of a forecast,
 *     and it carries a known artifact: past the forecast horizon the upstream
 *     row reports `new_pressure: 0`, which the detector reads as a ~1015 mb
 *     pressure fall and stamps `severity: high`. 993 of 4,847 pressure_drop
 *     rows are that sentinel. Rendering one would put a physically impossible
 *     number on the one page a hunter is supposed to trust. `isLaneArtifact`
 *     drops them and the page counts what it dropped out loud.
 */

/** Tri-state for a bounded read: loading is not the same as absent. */
export type Load<T> = { s: "loading" } | { s: "error" } | { s: "ok"; v: T };

/** The "is something coming" horizon — spec §5.2's "next five days". */
export const COMING_WINDOW_DAYS = 5;
/** Older than this and we refuse to call the board quiet; we call the lane dark. */
export const LANE_STALE_DAYS = 2;
/** World record 24h surface fall is ~60 mb; over CONUS, >40 is the sentinel. */
export const MAX_PLAUSIBLE_PRESSURE_DROP_MB = 40;
/** Every read is bounded. No forever-hang path (the AtlasPage defect). */
export const READ_TIMEOUT_MS = 8000;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ────────────────────────────── dates ────────────────────────────── */

/** Local calendar date as ISO — the hunter's today, not UTC's. */
export function todayIso(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Anchor at noon UTC so DST can never move a day count by one. */
function noonUtc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1, 12);
}

export function addDays(iso: string, n: number): string {
  const t = new Date(noonUtc(iso) + n * 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** Whole calendar days from a to b. Negative when b is behind a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((noonUtc(b) - noonUtc(a)) / 86400000);
}

/** "October 10" */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

/** "October 10, 2026" */
export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function weekday(iso: string): string {
  return WEEKDAYS[new Date(noonUtc(iso)).getUTCDay()];
}

/**
 * The season year a given day belongs to. Waterfowl seasons open in autumn and
 * close in winter, so the license year turns over on July 1: 2026-07-24 belongs
 * to "2026-2027", 2027-02-01 still belongs to "2026-2027".
 */
export function currentSeasonYear(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return (m || 1) >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/** "2026-2027" → "2026-27" */
export function seasonYearLabel(sy: string): string {
  const [a, b] = sy.split("-");
  return b && b.length === 4 ? `${a}-${b.slice(2)}` : sy;
}

/* ───────────────────────────── seasons ───────────────────────────── */

/**
 * A window as `hunt_seasons.dates` carries it. Under the openers-only scope the
 * 2026-27 rows carry exactly one window with an `open` and NO `close` — the
 * closing date is the state's to publish. `close` stays optional rather than
 * being deleted because the superseded 2025-26 rows still carry it.
 */
export interface SeasonWindow {
  open: string;
  close?: string | null;
}

/**
 * A `hunt_seasons` row. The page selects `*`; the fields the 2026-27 load adds
 * are optional here so the model is total over rows from either era.
 *
 * `status` is the load-bearing one: only `ok` may produce a countdown. A row
 * with no `status` at all is a pre-load row, and it is read as `ok` — those
 * rows are all stamped with a past season year and are refused a line anyway.
 */
export interface SeasonRow {
  id: string;
  species_id: string;
  state_abbr: string;
  season_type: string | null;
  zone: string | null;
  dates: SeasonWindow[] | null;
  notes: string | null;
  source_url: string | null;
  season_year: string;
  status?: string | null;
  provisional?: boolean | null;
  provisional_note?: string | null;
  fetched_at?: string | null;
  confidence?: string | null;
  recheck_after?: string | null;
  source_records?: number | null;
}

/** Upcoming, or already opened. There is no "closed": we hold no close date. */
export type OpenerStatus = "upcoming" | "opened";

/** One state-species opener — the countdown itself. */
export interface OpenerLine {
  key: string;
  species: string;
  /** "Duck" */
  speciesLabel: string;
  /** The zone or special-season label THIS date belongs to. Never inferred. */
  zone: string | null;
  opensOn: string;
  status: OpenerStatus;
  /** Days until it opens (upcoming only). */
  daysOut: number | null;
  /** Days since it opened (opened only). */
  daysSince: number | null;
  /** The state's own finality label. null = we hold no label. */
  provisional: boolean | null;
  /** The state's own wording for that label. */
  provisionalNote: string | null;
  /** The capture's own read of the transcription: high / medium / low. */
  confidence: string | null;
  /** When the state's page was read. */
  fetchedAt: string | null;
  sourceUrl: string | null;
  /** How many published season rows this one date was collapsed from. */
  sourceRecords: number | null;
}

/** One state-species pair with no date, and the state's reason for it. */
export interface AbsenceLine {
  key: string;
  species: string;
  speciesLabel: string;
  /** not_published | no_season | closed | conflicted */
  status: string;
  /** The state's own reason, as captured. Trimmed to leading sentences. */
  reason: string | null;
  /** True when `reason` is a trim of a longer note. */
  reasonTrimmed: boolean;
  recheckAfter: string | null;
  sourceUrl: string | null;
  fetchedAt: string | null;
}

export interface SeasonModel {
  /** One line per species, current season year only. Empty = no countdown. */
  openers: OpenerLine[];
  /** The one number the domain name promises. */
  hero: OpenerLine | null;
  /** Species we hold no date for, each carrying the state's own reason. */
  absences: AbsenceLine[];
  /** What we DO hold when we hold nothing current — named, not hidden. */
  heldYear: string | null;
  heldCount: number;
  /** A regs link from whatever rows we hold, so the absence is still useful. */
  sourceUrl: string | null;
}

const SPECIES_LABEL: Record<string, string> = {
  duck: "Duck",
  goose: "Goose",
};

/** Duck first. It is Duck Countdown. */
const SPECIES_ORDER: Record<string, number> = { duck: 0, goose: 1 };

export function speciesLabel(id: string): string {
  return SPECIES_LABEL[id] ?? humanize(id);
}

function humanize(s: string): string {
  const t = s.replace(/[-_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The earliest well-formed `open` on a row, or null. */
function earliestOpen(row: SeasonRow): string | null {
  if (!Array.isArray(row.dates)) return null;
  const opens = row.dates
    .map((w) => w?.open)
    .filter((o): o is string => typeof o === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o))
    .sort();
  return opens[0] ?? null;
}

/**
 * The state's reasons run 700–3,900 characters — they are audit notes, not card
 * copy. Take whole leading sentences up to `max` so the card never renders half
 * a clause and never paraphrases the state. The trim is flagged, not hidden.
 */
export function leadSentences(text: string | null | undefined, max = 320): {
  text: string | null;
  trimmed: boolean;
} {
  if (!text) return { text: null, trimmed: false };
  const clean = text.trim();
  if (clean.length <= max) return { text: clean, trimmed: false };

  let out = "";
  for (const p of clean.split(/(?<=[.!?])\s+/)) {
    const next = out ? `${out} ${p}` : p;
    if (next.length > max) break;
    out = next;
  }
  // A first sentence longer than `max`: cut at the last space rather than
  // mid-word.
  if (!out) {
    const cut = clean.lastIndexOf(" ", max);
    out = clean.slice(0, cut > 0 ? cut : max);
  }
  return { text: out, trimmed: out.length < clean.length };
}

/**
 * Build the season block. Rows whose `season_year` is not `seasonYear` never
 * become a line — they are counted so the absence can name itself.
 *
 * One line per species: if a state ever holds more than one current row for a
 * species (the openers load writes exactly one, but a future full load would
 * not), the EARLIEST dated row wins, which is the same rule the loader applies.
 */
export function buildSeasonModel(rows: SeasonRow[], today: string, seasonYear: string): SeasonModel {
  const current = rows.filter((r) => r.season_year === seasonYear);
  const other = rows.filter((r) => r.season_year !== seasonYear);

  const bySpecies = new Map<string, SeasonRow[]>();
  for (const r of current) {
    const held = bySpecies.get(r.species_id);
    if (held) held.push(r);
    else bySpecies.set(r.species_id, [r]);
  }

  const openers: OpenerLine[] = [];
  const absences: AbsenceLine[] = [];

  const species = [...bySpecies.keys()].sort(
    (a, b) => (SPECIES_ORDER[a] ?? 9) - (SPECIES_ORDER[b] ?? 9) || a.localeCompare(b),
  );

  for (const sp of species) {
    const group = bySpecies.get(sp)!;
    const dated = group
      .map((row) => ({ row, open: earliestOpen(row) }))
      .filter((d): d is { row: SeasonRow; open: string } => {
        const status = d.row.status ?? "ok";
        return status === "ok" && d.open !== null;
      })
      .sort((a, b) => a.open.localeCompare(b.open));

    if (dated.length) {
      const { row, open } = dated[0];
      const opened = open <= today;
      openers.push({
        key: row.id,
        species: sp,
        speciesLabel: speciesLabel(sp),
        zone: row.zone && !/^(statewide|opener)$/i.test(row.zone) ? row.zone : null,
        opensOn: open,
        status: opened ? "opened" : "upcoming",
        daysOut: opened ? null : daysBetween(today, open),
        daysSince: opened ? daysBetween(open, today) : null,
        provisional: row.provisional ?? null,
        provisionalNote: row.provisional_note ?? null,
        confidence: row.confidence ?? null,
        fetchedAt: row.fetched_at ?? null,
        sourceUrl: row.source_url,
        sourceRecords: row.source_records ?? null,
      });
      continue;
    }

    // No date for this species. Say why, in the state's own words. Prefer the
    // row that actually carries a reason; a row with no reason at all is still
    // an absence, just a quieter one.
    const carrier = group.find((r) => r.notes) ?? group[0];
    if (!carrier) continue;
    const lead = leadSentences(carrier.notes);
    absences.push({
      key: carrier.id,
      species: sp,
      speciesLabel: speciesLabel(sp),
      status: carrier.status ?? "not_published",
      reason: lead.text,
      reasonTrimmed: lead.trimmed,
      recheckAfter: carrier.recheck_after ?? null,
      sourceUrl: carrier.source_url,
      fetchedAt: carrier.fetched_at ?? null,
    });
  }

  // Hero: the next opener still ahead, soonest first, duck breaking the tie —
  // the countdown is the product. When everything has already opened the hero
  // is the most recent opener, so the page still says something true rather
  // than nothing. There is no "days left" branch: we hold no closing date.
  const duckFirst = (a: OpenerLine, b: OpenerLine) =>
    (SPECIES_ORDER[a.species] ?? 9) - (SPECIES_ORDER[b.species] ?? 9);
  const upcoming = openers
    .filter((o) => o.status === "upcoming")
    .sort((a, b) => a.opensOn.localeCompare(b.opensOn) || duckFirst(a, b));
  const opened = openers
    .filter((o) => o.status === "opened")
    .sort((a, b) => b.opensOn.localeCompare(a.opensOn) || duckFirst(a, b));
  const hero = upcoming[0] ?? opened[0] ?? null;

  // Newest season year we actually hold — the honest "here's what we've got".
  const heldYear = other.length
    ? other.map((r) => r.season_year).sort().reverse()[0]
    : null;

  return {
    openers,
    hero,
    absences,
    heldYear,
    heldCount: heldYear ? other.filter((r) => r.season_year === heldYear).length : 0,
    sourceUrl:
      current.find((r) => r.source_url)?.source_url ?? other.find((r) => r.source_url)?.source_url ?? null,
  };
}


/* ────────────────────────── weather events ────────────────────────── */

export interface EventDetails {
  description?: string;
  pressure_drop_mb?: number;
  new_pressure?: number;
  prev_pressure?: number;
  temp_drop_f?: number;
  prev_high?: number;
  new_high?: number;
  wind_mph?: number;
  low_f?: number;
  precip_mm?: number;
}

export interface EventRow {
  event_date: string;
  event_type: string;
  severity: string | null;
  details: EventDetails | null;
  created_at: string;
}

export interface ComingEvent {
  key: string;
  date: string;
  type: string;
  severity: string | null;
  /** "a 6.1 mb pressure fall" — lowercase, sentence-embeddable. */
  phrase: string;
}

export interface ComingModel {
  events: ComingEvent[];
  /** Sentinel rows removed. Rendered as a receipt, never silently swallowed. */
  dropped: number;
}

/**
 * The end-of-horizon sentinel: upstream reports 0 mb, the detector subtracts,
 * and the row claims a ~1015 mb fall at severity `high`. Never render one.
 */
export function isLaneArtifact(e: EventRow): boolean {
  if (e.event_type !== "pressure_drop") return false;
  const d = e.details ?? {};
  if (typeof d.new_pressure === "number" && d.new_pressure <= 0) return true;
  if (typeof d.pressure_drop_mb === "number" && d.pressure_drop_mb > MAX_PLAUSIBLE_PRESSURE_DROP_MB) return true;
  return false;
}

export function eventPhrase(e: EventRow): string {
  const d = e.details ?? {};
  switch (e.event_type) {
    case "pressure_drop":
      return typeof d.pressure_drop_mb === "number"
        ? `a ${d.pressure_drop_mb.toFixed(1)} mb pressure fall`
        : "a pressure fall";
    case "cold_front":
      return typeof d.temp_drop_f === "number"
        ? `a cold front — the high drops ${Math.round(d.temp_drop_f)}°F`
        : "a cold front";
    case "high_wind":
      return typeof d.wind_mph === "number" ? `wind to ${Math.round(d.wind_mph)} mph` : "high wind";
    case "first_freeze":
      return typeof d.low_f === "number" ? `the first freeze — low ${Math.round(d.low_f)}°F` : "the first freeze";
    case "heavy_precip":
      return typeof d.precip_mm === "number" ? `${d.precip_mm.toFixed(1)} mm of rain` : "heavy rain";
    default:
      return humanize(e.event_type).toLowerCase();
  }
}

/**
 * Rows arrive newest-`created_at`-first. The watchdog re-detects the same
 * forward day on every run, so a single (date, type) carries one row per run
 * going back a week or more — the freshest run is the only one that is still a
 * forecast. Dedupe FIRST (newest wins), then drop artifacts.
 *
 * Order matters. If the newest run says "past my horizon" (the 0 mb sentinel),
 * the honest result is nothing for that day — not a two-week-old forecast
 * resurrected because it happened to be well-formed. And `dropped` then counts
 * only the sentinels that would actually have reached the page.
 */
export function buildComingModel(rows: EventRow[]): ComingModel {
  const freshest = new Map<string, EventRow>();
  for (const r of rows) {
    const key = `${r.event_date}|${r.event_type}`;
    const held = freshest.get(key);
    if (!held || r.created_at > held.created_at) freshest.set(key, r);
  }

  let dropped = 0;
  const events: ComingEvent[] = [];
  for (const [key, r] of freshest) {
    if (isLaneArtifact(r)) {
      dropped += 1;
      continue;
    }
    events.push({
      key,
      date: r.event_date,
      type: r.event_type,
      severity: r.severity,
      phrase: eventPhrase(r),
    });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
  return { events, dropped };
}

/* ──────────────────────── the national next opener ──────────────────────── */

/**
 * THE FRONT DOOR'S HEADLINE (2026-07-25).
 *
 * The front door used to lead with a percentile — "California is running hotter
 * than 99% of its July record" — computed from a byte whose day and whose
 * record are two different measurements (`src/lib/board/tailDepthGate.ts`). It
 * had to stop. This is what replaced it, and the argument for it is that it is
 * the opposite kind of statement in every way that mattered:
 *
 *  - it is a TRANSCRIPTION, not a construction. The number is a date a state
 *    wildlife agency published, and every row carries the `source_url` a reader
 *    can open in one tap. There is no pool, no denominator and no rank, so
 *    there is nothing that can be mismatched against anything.
 *  - it is the question the domain name asks. On a July morning the one thing a
 *    waterfowler wants off a front door is how long until he can hunt.
 *  - it is falsifiable in three seconds against a regs booklet, which is the
 *    strongest honesty guarantee any line on this site has.
 *  - it carries its own decay: `provisional` is the state's own label, and a
 *    row that says so says so on the page (PLAN §10.1).
 *
 * THE RULE: the earliest `open` at or after `today`, over rows stamped with the
 * current season year at `status = 'ok'`. Ties break to the state abbreviation
 * then the species, so the sentence is stable between renders. `null` when we
 * hold nothing — the caller renders the absence, never a countdown to last
 * season, which is the same law `buildSeasonModel` enforces one level down.
 *
 * Like everything else in this module it is a total function over rows plus one
 * `today` string. No clock, no network.
 */
export interface NextOpener {
  stateAbbr: string;
  species: string;
  speciesLabel: string;
  /** The winning row's own zone or special-season label. Displayed, never inferred. */
  zone: string | null;
  opensOn: string;
  daysOut: number;
  provisional: boolean | null;
  provisionalNote: string | null;
  sourceUrl: string | null;
  /** How many OTHER state-species openers fall on that same first day. */
  sameDay: number;
  /** How many openers in the whole country are still ahead of today. */
  aheadCount: number;
}

export function nextOpenerNationally(
  rows: SeasonRow[],
  today: string,
  seasonYear: string,
): NextOpener | null {
  const ahead: { row: SeasonRow; opensOn: string }[] = [];
  for (const row of rows) {
    if (row.season_year !== seasonYear) continue;
    if ((row.status ?? "ok") !== "ok") continue;
    const opensOn = earliestOpen(row);
    if (!opensOn || daysBetween(today, opensOn) < 0) continue;
    ahead.push({ row, opensOn });
  }
  if (!ahead.length) return null;

  ahead.sort(
    (a, b) =>
      a.opensOn.localeCompare(b.opensOn) ||
      a.row.state_abbr.localeCompare(b.row.state_abbr) ||
      a.row.species_id.localeCompare(b.row.species_id),
  );

  const first = ahead[0];
  return {
    stateAbbr: first.row.state_abbr,
    species: first.row.species_id,
    speciesLabel: speciesLabel(first.row.species_id),
    zone: first.row.zone,
    opensOn: first.opensOn,
    daysOut: daysBetween(today, first.opensOn),
    provisional: first.row.provisional ?? null,
    provisionalNote: first.row.provisional_note ?? null,
    sourceUrl: first.row.source_url,
    sameDay: ahead.filter((a) => a.opensOn === first.opensOn).length - 1,
    aheadCount: ahead.length,
  };
}
