/**
 * season.ts — the pure model behind /season (v1a, the hunter's state page).
 *
 * Everything here is a total function over rows the page already read: no
 * fetching, no clock reads except the one `today` string the caller passes in.
 * That keeps the honesty branches testable and keeps the page thin.
 *
 * Two house laws are enforced here rather than in the markup, because markup
 * is where honesty rules go to get edited away:
 *
 *  1. A countdown is only ever built from rows stamped with the CURRENT season
 *     year (`currentSeasonYear`). `hunt_seasons` today holds 482 rows all
 *     stamped 2025-2026; every one of those dates is last season. A countdown
 *     off them would be confidently wrong three seconds after a hunter checked
 *     it against his regs booklet, so `buildSeasonModel` returns no lines at
 *     all and the page renders the absence.
 *
 *  2. `hunt_weather_events` is a DETECTION lane sitting on top of a forecast,
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

export interface SeasonWindow {
  open: string;
  close: string;
}

/**
 * A `hunt_seasons` row. `provisional` and `fetched_at` are optional because the
 * columns do not exist yet — Ruling 10.1 makes provisional a DISPLAYED field,
 * and the 2026-27 transcription is what lands it. The page selects `*`, so the
 * day the column appears the label renders with no code change. Until then the
 * value is `undefined`, which the UI reads as "unknown", never as "final".
 */
export interface SeasonRow {
  id: string;
  species_id: string;
  state_abbr: string;
  season_type: string | null;
  zone: string | null;
  dates: SeasonWindow[] | null;
  bag_limit: number | null;
  notes: string | null;
  verified: boolean | null;
  source_url: string | null;
  season_year: string;
  provisional?: boolean | null;
  fetched_at?: string | null;
}

export type SeasonStatus = "open" | "upcoming" | "closed";

export interface SeasonLine {
  key: string;
  /** "Duck season — Eastern Zone" */
  label: string;
  /** Raw `species_id` — the hero tie-breaks toward duck. It is Duck Countdown. */
  species: string;
  status: SeasonStatus;
  /** The window that matters: the one we're inside, else the next one. */
  opens: string | null;
  closes: string | null;
  /** Days until it opens (upcoming only). */
  daysOut: number | null;
  /** Days until it closes, today inclusive (open only). */
  daysLeft: number | null;
  /** The state's own finality label. null = we hold no label. */
  provisional: boolean | null;
  /** False means nobody has checked this row against the state's publication. */
  verified: boolean | null;
  sourceUrl: string | null;
}

export interface SeasonModel {
  /** Rows for the CURRENT season year only. Empty means no countdown, ever. */
  lines: SeasonLine[];
  /** The one number the domain name promises: soonest opener, else what's open. */
  hero: SeasonLine | null;
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

function humanize(s: string): string {
  const t = s.replace(/[-_]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function lineLabel(row: SeasonRow): string {
  let label = `${SPECIES_LABEL[row.species_id] ?? humanize(row.species_id)} season`;
  const qual: string[] = [];
  if (row.season_type && row.season_type !== "regular") qual.push(humanize(row.season_type));
  if (row.zone && !/^statewide$/i.test(row.zone)) qual.push(row.zone);
  if (qual.length) label += ` — ${qual.join(", ")}`;
  return label;
}

function windowsOf(row: SeasonRow): SeasonWindow[] {
  if (!Array.isArray(row.dates)) return [];
  return row.dates
    .filter((w): w is SeasonWindow => !!w && typeof w.open === "string" && typeof w.close === "string")
    .sort((a, b) => a.open.localeCompare(b.open));
}

const STATUS_RANK: Record<SeasonStatus, number> = { open: 0, upcoming: 1, closed: 2 };

/**
 * Build the season block. Rows whose `season_year` is not `seasonYear` never
 * become a line — they are counted so the absence can name itself.
 */
export function buildSeasonModel(rows: SeasonRow[], today: string, seasonYear: string): SeasonModel {
  const current = rows.filter((r) => r.season_year === seasonYear);
  const other = rows.filter((r) => r.season_year !== seasonYear);

  const lines: SeasonLine[] = [];
  for (const row of current) {
    const windows = windowsOf(row);
    if (!windows.length) continue;

    const openNow = windows.find((w) => w.open <= today && today <= w.close);
    const next = windows.find((w) => w.open > today);

    let status: SeasonStatus;
    let opens: string | null;
    let closes: string | null;
    if (openNow) {
      status = "open";
      opens = openNow.open;
      closes = openNow.close;
    } else if (next) {
      status = "upcoming";
      opens = next.open;
      closes = next.close;
    } else {
      status = "closed";
      const last = windows[windows.length - 1];
      opens = last.open;
      closes = last.close;
    }

    lines.push({
      key: row.id,
      label: lineLabel(row),
      species: row.species_id,
      status,
      opens,
      closes,
      daysOut: status === "upcoming" && opens ? daysBetween(today, opens) : null,
      daysLeft: status === "open" && closes ? daysBetween(today, closes) + 1 : null,
      provisional: row.provisional ?? null,
      verified: row.verified,
      sourceUrl: row.source_url,
    });
  }

  lines.sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (a.opens ?? "").localeCompare(b.opens ?? "") ||
      a.label.localeCompare(b.label),
  );

  // Hero: what is open today outranks what opens later — a hunter standing in
  // October needs "your season is open, 4 days left" ahead of a goose opener
  // three weeks out. Within a status, duck wins the tie; it is Duck Countdown.
  const duckFirst = (a: SeasonLine, b: SeasonLine) =>
    (a.species === "duck" ? 0 : 1) - (b.species === "duck" ? 0 : 1);
  const open = lines
    .filter((l) => l.status === "open")
    .sort((a, b) => duckFirst(a, b) || (a.closes ?? "").localeCompare(b.closes ?? ""));
  const upcoming = lines
    .filter((l) => l.status === "upcoming")
    .sort((a, b) => (a.opens ?? "").localeCompare(b.opens ?? "") || duckFirst(a, b));
  const hero = open[0] ?? upcoming[0] ?? null;

  // Newest season year we actually hold — the honest "here's what we've got".
  const heldYear = other.length
    ? other.map((r) => r.season_year).sort().reverse()[0]
    : null;

  return {
    lines,
    hero,
    heldYear,
    heldCount: heldYear ? other.filter((r) => r.season_year === heldYear).length : 0,
    sourceUrl: current.find((r) => r.source_url)?.source_url ?? other.find((r) => r.source_url)?.source_url ?? null,
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
