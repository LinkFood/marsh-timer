/**
 * SpotDossier — the HERO surface of ATLAS (docs/THE-VISION-AND-ROADMAP.md).
 *
 * "What do I need to know at THIS spot" at a glance, depth on demand. Renders a
 * spot's NOW (weather, front signal, shooting light, moon, tide, solunar feed
 * windows) + PAST ("days like today here" — the rhyme, with the denominator
 * ALWAYS shown). Built for the hunter; the kid gets the wonder for free.
 *
 * Design: Apple-clean (real typographic hierarchy, generous space, restrained) ×
 * Palantir-operational (dense but legible, state encoded in FORM — a front chip,
 * a solunar rating meter, a quiet anomaly z-badge). Dark theme, teal/cyan accents.
 *
 * PURE PRESENTATION. It renders entirely from the `data` prop — no fetching, no
 * DB, no side effects. The shape below matches the (read-only) hunt-atlas-spot +
 * hunt-atlas-solunar response contract. Every field is optional/nullable because
 * the data staircase is jagged (staircase-honest): the card degrades gracefully
 * and LABELS its granularity rather than faking precision.
 *
 * Optional callbacks (onRhymeClick / onFrontClick) let a parent wire map.flyTo()
 * — passing them is additive; the card is fully functional without them.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * PROP CONTRACT — the exact shape SpotDossier expects.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Geographic granularity of the reading — the card says what it actually knows. */
export type SpotResolution = "nation" | "state" | "county" | "station" | "spot";

export interface MoonNow {
  /** e.g. "Waxing Gibbous" */
  phase: string;
  /** fraction illuminated, 0..1 */
  illumination: number;
  /** days since the last new moon (0..29.5) */
  age_days?: number | null;
  /** local clock string "HH:MM" or ISO; null if it does not rise/set today */
  rise?: string | null;
  set?: string | null;
}

export interface SunNow {
  /** local "HH:MM" */
  sunrise: string;
  sunset: string;
  /** waterfowl legal light = ~30 min before sunrise / after sunset; null if not computed */
  shooting_light_start?: string | null;
  shooting_light_end?: string | null;
  /** minutes of daylight */
  day_length_min?: number | null;
}

export interface SolunarWindow {
  kind: "major" | "minor";
  /** local "HH:MM" */
  start: string;
  end: string;
  peak?: string | null;
}

export interface SolunarNow {
  /** feed-quality score for the day, 0..4 (0 poor → 4 excellent) */
  day_rating: number;
  /** optional label mirroring the rating ("Excellent" | "Good" | "Average" | "Poor") */
  rating_label?: string | null;
  windows: SolunarWindow[];
  /** the single best window to surface, if the fn picks one */
  best_window?: SolunarWindow | null;
}

export interface WeatherNow {
  temp_f: number;
  feels_like_f?: number | null;
  /** short sky/condition phrase, e.g. "Overcast", "Light rain" */
  sky?: string | null;
  wind_mph: number;
  /** compass label, e.g. "NW" */
  wind_dir?: string | null;
  /** wind bearing in degrees (0=N, 90=E) — drives the wind arrow if present */
  wind_dir_deg?: number | null;
  wind_gust_mph?: number | null;
  humidity_pct?: number | null;
  pressure_mb?: number | null;
  pressure_trend?: "rising" | "falling" | "steady" | null;
}

/** Is a front moving? Ducks move on fronts — this is the operational hero signal. */
export interface FrontSignal {
  moving: boolean;
  kind?: "cold" | "warm" | "stationary" | null;
  /** pressure change over the trailing window (mb; negative = falling) */
  pressure_delta_mb?: number | null;
  /** human phrase, e.g. "Pressure falling 6 mb / 6h — cold front" */
  detail?: string | null;
  /**
   * "YYYY-MM-DD" the front read is BASED ON. Shown small so the basis is
   * always visible: current dates read from the live station feed (today or
   * yesterday); dated visits read from the GHCN archive (~a year behind).
   */
  as_of?: string | null;
  /** basis of the run-up: "live" | "live-yesterday" (station feed) | "archive" (GHCN) */
  day0_source?: string | null;
}

/**
 * A recorded alert ON FILE for the actual today — a row the pipes already
 * wrote (nws-alert / weather-event / compound-risk-alert), never a forecast.
 */
export interface LiveAlert {
  /** content type, e.g. "nws-alert" */
  type: string;
  /** cleaned title, e.g. "Flood Watch" */
  title: string;
  /** identical titles collapse into one chip with a count */
  count: number;
}

export interface TideNow {
  station?: string | null;
  /** current tidal state */
  state: "rising" | "falling" | "high" | "low" | string;
  height_ft?: number | null;
  /** the next turn */
  next_event?: {
    type: "high" | "low";
    /** local "HH:MM" */
    time: string;
    height_ft?: number | null;
  } | null;
}

/** Today is weird FOR HERE — z-score vs this place's own history, denominator attached. */
export interface AnomalyNow {
  z: number | null;
  /** the observed value that produced z */
  value?: number | null;
  baseline_mean?: number | null;
  /** the DENOMINATOR — years of history z was measured against */
  n_years?: number | null;
  /** what was measured, e.g. "avg high °F" */
  metric?: string | null;
}

/** A provenance chip — something the archive holds for a named date. */
export interface OnFileChip {
  /** content type, e.g. "storm-event" */
  type: string;
  /** one-line title, e.g. "Thunderstorm Wind — Accomack" */
  line: string;
  /** "here" (state-scoped) or "in the world" (global, e.g. onthisday-event) */
  scope?: string | null;
}

/** One historical day this spot's NOW rhymes with. Every one is a place you can fly to. */
export interface RhymeDay {
  /** "YYYY-MM-DD" */
  date: string;
  /** 0..1 match strength */
  similarity?: number | null;
  /** why it rhymes, e.g. "Same moon phase, tide within 0.3 ft, high within 2°F" */
  summary?: string | null;
  /** what followed (honest, recorded) */
  outcome?: string | null;
  /** provenance chips — what else the archive holds for this exact date */
  on_file?: OnFileChip[] | null;
  /** true coords for map.flyTo(); null when the layer only knows a region */
  lat?: number | null;
  lng?: number | null;
}

export interface RhymeResult {
  matches: RhymeDay[];
  /** DENOMINATOR: total comparable days searched */
  n_candidates?: number | null;
  /** honest base-rate line, e.g. "4 of 6 dry springs vs 1-in-10 random" */
  base_rate?: string | null;
}

/**
 * SEMANTIC RHYME — "days that READ like today, here." The structured rhyme
 * above matches on one number (avg-high); this layer matches on MEANING —
 * cosine over each day's embedded daily narrative. `novel: true` is the
 * honest no-precedent state: today reads like nothing on record here. That
 * sentence renders at full weight — it's a hero line, not an error.
 */
export interface SemanticRhyme {
  matches: RhymeDay[];
  /** true = no recorded day reads like today (the finding, not a failure) */
  novel?: boolean;
  /** the no-precedent sentence, verbatim from the archive */
  note?: string | null;
  /** DENOMINATOR — recorded days searched (estimated) */
  n_searched?: number | null;
  /** how the match was made, e.g. "voyage-512 cosine over this state's own daily records" */
  method?: string | null;
}

/*
 * THE LINEUP HERO IS RETIRED (gate 1, retrodiction 2026-07-17 — no lift,
 * Δ −0.19pp over 1.35M paired days; the trial record is at /court). The
 * fused "last time the moon, the tide, and the cold lined up" lead no longer
 * renders anywhere; the dossier leads with the recorded blocks below. The
 * control line stays — honest base-rate copy, spared by the registration.
 */

/**
 * THE CONTROL LINE — the all-years base rate for the counted outcome.
 * "Cooling ≥5° within a week happened 31 of 74 times — the 17 lineup-matched
 * days ran 12 of 17." Honest counts, never a forecast.
 */
export interface ControlLine {
  /** the recorded outcome being counted, e.g. "avg high cooled ≥5°F within the next 7 recorded days" */
  outcome?: string | null;
  matched_n: number;
  matched_outcome_n: number;
  all_n: number;
  all_outcome_n: number;
}

/**
 * WHAT THIS DAY WAS — the recorded truth of the target date itself, above the
 * rhyme. Weather as a composed lede, severity-ranked events with full recorded
 * narrative, tide residuals per gauge, and quiet world context. Every field is
 * optional; the block only renders when the archive actually holds something.
 */
export interface ThatDayWeather {
  avg_high_f?: number | null;
  avg_low_f?: number | null;
  precip_in?: number | null;
  /** number of reporting stations the day was averaged across */
  stations?: number | null;
  max_f?: number | null;
  min_f?: number | null;
  /** the archive's own prose for the day; the card composes its own lede */
  narrative?: string | null;
}

export interface ThatDayEvent {
  title: string;
  /** FULL recorded narrative — rendered in body text, never truncated by the type */
  narrative?: string | null;
  deaths?: number | null;
  injuries?: number | null;
  damage_usd?: number | null;
  county?: string | null;
  began?: string | null;
  /** e.g. "began 1 day earlier" — when the event's span predates the target date */
  span_note?: string | null;
  provenance_url?: string | null;
}

export interface ThatDayTide {
  station_name?: string | null;
  /** peak departure from predicted tide (ft; signed) */
  residual_max_ft?: number | null;
  /** ISO-8601 UTC (or "HH:MM") of the residual peak */
  residual_max_time_utc?: string | null;
  /** observed water level at peak (ft) */
  daily_max_ft?: number | null;
  /** v1-era rows recorded daily MEANS, not maxima — rendered on their own terms */
  residual_mean_ft?: number | null;
  daily_mean_ft?: number | null;
  /** 'daily-max' (v2 contract) | 'daily-mean' (v1 record) */
  basis?: string | null;
  provenance_url?: string | null;
}

export interface ThatDayQuake {
  magnitude?: number | null;
  place?: string | null;
  event_time_utc?: string | null;
  depth_km?: number | null;
  felt?: number | null;
  provenance_url?: string | null;
}

/** World context for the date — NOT ground truth of this state; rendered quiet. */
export interface ThatDayWorld {
  title: string;
  content?: string | null;
  /** the row's own receipt (a Wikipedia page); null = no receipt on file */
  provenance_url?: string | null;
}

export interface ThatDayReport {
  /** "YYYY-MM-DD" */
  date: string;
  weather?: ThatDayWeather | null;
  /** severity-ranked (highest first) by the backend */
  events?: ThatDayEvent[] | null;
  tide?: ThatDayTide[] | null;
  quakes?: ThatDayQuake[] | null;
  world?: ThatDayWorld[] | null;
  era_note?: string | null;
  honest_note?: string | null;
}

/** The full dossier payload — the merged hunt-atlas-spot + hunt-atlas-solunar shape. */
export interface SpotData {
  resolution: SpotResolution;
  /** ISO timestamp the NOW reading is as-of */
  as_of?: string | null;
  coords?: { lat: number; lng: number } | null;
  /** WHAT THIS DAY WAS — the recorded truth of the target date (renders first). */
  thatDay?: ThatDayReport | null;
  weather?: WeatherNow | null;
  front?: FrontSignal | null;
  /** Recorded alerts on file for the ACTUAL today (never a forecast). */
  live?: LiveAlert[] | null;
  /** "YYYY-MM-DD" the live layer was read for (the actual today). */
  live_as_of?: string | null;
  moon?: MoonNow | null;
  sun?: SunNow | null;
  tide?: TideNow | null;
  solunar?: SolunarNow | null;
  anomaly?: AnomalyNow | null;
  rhyme?: RhymeResult | null;
  /** "days that READ like today" — matched by meaning, not by one number */
  semantic?: SemanticRhyme | null;
  control?: ControlLine | null;
}

export interface SpotDossierProps {
  /** Human label for the place, e.g. "Back River — Poquoson, VA" */
  placeLabel: string;
  data: SpotData;
  /** Optional: parent wires map.flyTo() to a rhyming day's true coords. */
  onRhymeClick?: (day: RhymeDay) => void;
  /** Optional: parent reacts to the front chip (e.g. open the pressure layer). */
  onFrontClick?: () => void;
  /**
   * A dated visit (?date= — a birthday, a historical day) vs the live current-
   * day dossier. On a dated visit WHAT THIS DAY WAS leads and today's-conditions
   * chips (live alerts + front) are suppressed so a year-old NOW anchor can't
   * read as if it belongs to the requested date. Defaults to the live dossier.
   */
  datedVisit?: boolean;
  className?: string;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Formatting helpers
 * ──────────────────────────────────────────────────────────────────────────── */

const DASH = "—"; // em dash for "unknown / not recorded"

const num = (n: number | null | undefined, dp = 0): string =>
  n === null || n === undefined || !Number.isFinite(n)
    ? DASH
    : n.toFixed(dp);

const signed = (n: number | null | undefined, dp = 1): string =>
  n === null || n === undefined || !Number.isFinite(n)
    ? DASH
    : `${n > 0 ? "+" : ""}${n.toFixed(dp)}`;

const RES_LABEL: Record<SpotResolution, string> = {
  nation: "National",
  state: "State-level",
  county: "County-level",
  station: "Station",
  spot: "Exact spot",
};

function asOfLabel(iso?: string | null): string {
  if (!iso) return "";
  // Date-only (YYYY-MM-DD): render as a date, never a spurious midnight time.
  // Parsing "1991-06-15" as UTC then formatting local shifts it to "Jun 14
  // 8:00 PM" — the exact artifact that made a dated dossier read as stale.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const d = new Date(iso + "T00:00:00");
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Small building blocks
 * ──────────────────────────────────────────────────────────────────────────── */

/** Section eyebrow — the quiet Palantir label above a block. */
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-400/80">
      {children}
    </div>
  );
}

/** An operational tile: label on top, big tabular figure, a whisper of context. */
function Tile({
  label,
  value,
  unit,
  sub,
  accent = false,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className={[
            "text-lg font-semibold leading-none tabular-nums",
            accent ? "text-teal-300" : "text-gray-100",
          ].join(" ")}
        >
          {value}
        </span>
        {unit && (
          <span className="text-xs font-medium text-gray-500">{unit}</span>
        )}
      </div>
      {sub && (
        <div className="mt-1 truncate text-[11px] leading-tight text-gray-500">
          {sub}
        </div>
      )}
    </div>
  );
}

/** The FRONT chip — the single most operational read. State encoded in color+form. */
function FrontChip({
  front,
  onClick,
}: {
  front: FrontSignal;
  onClick?: () => void;
}) {
  const moving = front.moving;
  const cls = moving
    ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
    : "border-white/10 bg-white/[0.03] text-gray-400";
  const label = moving
    ? `${front.kind ? front.kind[0].toUpperCase() + front.kind.slice(1) + " " : ""}front moving`
    : "No front";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "text-[11px] font-semibold tracking-wide transition-colors",
        onClick ? "hover:brightness-125" : "",
        cls,
      ].join(" ")}
    >
      <span
        className={[
          "inline-block h-1.5 w-1.5 rounded-full",
          moving ? "animate-pulse bg-amber-400" : "bg-gray-600",
        ].join(" ")}
      />
      {label}
    </Tag>
  );
}

/**
 * A LIVE chip — a recorded alert on file for the actual today. Amber like a
 * moving front (it is the operational "today" read), labeled "on file today"
 * because it's a recorded row, never a forecast.
 */
function LiveChip({ alert }: { alert: LiveAlert }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1",
        "border-amber-400/40 bg-amber-400/10 text-amber-300",
        "text-[11px] font-semibold tracking-wide",
      ].join(" ")}
      title={`${alert.type} — recorded row on file for today, not a forecast`}
    >
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
      {alert.title}
      {alert.count > 1 && (
        <span className="tabular-nums opacity-70">×{alert.count}</span>
      )}
      <span className="font-normal opacity-60">· on file today</span>
    </span>
  );
}

/** Solunar day-rating meter — 4 segments, teal fill. Form carries the state. */
function SolunarMeter({ rating }: { rating: number }) {
  const filled = Math.max(0, Math.min(4, Math.round(rating)));
  return (
    <div className="flex items-center gap-1" aria-label={`Solunar rating ${filled} of 4`}>
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={[
            "h-1.5 w-5 rounded-full",
            i < filled ? "bg-teal-400" : "bg-white/[0.08]",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

/** Quiet z-badge — "weird for here" with the denominator whispered. */
function AnomalyBadge({ anomaly }: { anomaly: AnomalyNow }) {
  if (anomaly.z === null || anomaly.z === undefined) return null;
  const az = Math.abs(anomaly.z);
  // form encodes intensity, quietly — never a loud gauge
  const tone =
    az >= 2.5
      ? "border-orange-400/40 bg-orange-400/10 text-orange-300"
      : az >= 1.5
      ? "border-teal-400/30 bg-teal-400/[0.07] text-teal-300"
      : "border-white/10 bg-white/[0.03] text-gray-400";
  const dir = anomaly.z > 0 ? "above" : "below";
  const metric = anomaly.metric ?? "reading";
  return (
    <div
      className={[
        "flex items-center justify-between gap-3 rounded-xl border px-3 py-2",
        tone,
      ].join(" ")}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {signed(anomaly.z, 1)}
          <span className="ml-0.5 text-xs font-normal opacity-70">σ</span>
        </span>
        <span className="text-xs opacity-90">
          {metric} {dir} normal for here
        </span>
      </div>
      {anomaly.n_years != null && (
        <span className="shrink-0 text-[11px] tabular-nums opacity-60">
          vs {anomaly.n_years} yrs
        </span>
      )}
    </div>
  );
}

/**
 * WHAT THIS DAY WAS — the recorded truth of the target date, rendered first.
 * Weather composed into a single serif lede, severity-ranked events with their
 * FULL narrative, tide residuals per gauge, quiet world context, and the honest
 * notes at the foot. Renders nothing unless the archive actually holds content.
 */
function ThatDayBlock({ report }: { report: ThatDayReport }) {
  const events = report.events ?? [];
  const tide = report.tide ?? [];
  const quakes = report.quakes ?? [];
  const world = report.world ?? [];
  const lede = report.weather ? thatDayWeatherLede(report.weather) : null;

  const hasContent =
    !!lede || events.length > 0 || tide.length > 0 || quakes.length > 0 || world.length > 0;
  if (!hasContent) return null;

  return (
    <div className="space-y-3 px-4 py-4">
      <Eyebrow>What this day was</Eyebrow>

      {/* Weather lede — one composed serif sentence, the product's dated voice. */}
      {lede && (
        <p className="font-display text-[19px] font-semibold leading-snug text-white">
          {lede}
        </p>
      )}

      {/* Severity-ranked events — stat idiom for the toll, FULL narrative below. */}
      {events.length > 0 && (
        <div className="space-y-2.5">
          {events.map((ev, i) => (
            <div
              key={`${ev.title}-${i}`}
              className="border-l-2 border-white/[0.08] pl-3"
            >
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-[13px] font-semibold text-gray-100">
                  {ev.title}
                </span>
                {ev.deaths != null && ev.deaths > 0 && (
                  <span className="text-[11px] font-semibold tabular-nums text-orange-300">
                    {ev.deaths} dead
                  </span>
                )}
                {ev.injuries != null && ev.injuries > 0 && (
                  <span className="text-[11px] tabular-nums text-gray-400">
                    {ev.injuries} injured
                  </span>
                )}
                {ev.damage_usd != null && ev.damage_usd > 0 && (
                  <span className="text-[11px] tabular-nums text-gray-400">
                    {formatDamage(ev.damage_usd)} damage
                  </span>
                )}
              </div>
              {ev.span_note && (
                <div className="mt-0.5 text-[10px] text-gray-600">
                  {ev.span_note}
                </div>
              )}
              {ev.narrative && (
                <p className="mt-1 font-body text-[12.5px] leading-relaxed text-gray-400">
                  {ev.narrative}
                </p>
              )}
              {ev.provenance_url && (
                <a
                  href={ev.provenance_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-[10px] text-gray-600 underline decoration-white/20 underline-offset-2 transition-colors hover:text-gray-400"
                >
                  source
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Quakes — one composed line per event, magnitude-desc from the backend. */}
      {quakes.length > 0 && (
        <div className="space-y-1">
          {quakes.map((q, i) => (
            <p
              key={`${q.place ?? "quake"}-${i}`}
              className="text-[11px] leading-snug tabular-nums text-gray-400"
            >
              {quakeLine(q)}
              {q.provenance_url && (
                <>
                  {" "}
                  <a
                    href={q.provenance_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-gray-600 underline decoration-white/20 underline-offset-2 transition-colors hover:text-gray-400"
                  >
                    source
                  </a>
                </>
              )}
            </p>
          ))}
        </div>
      )}

      {/* Tide residuals — one composed line per gauge. */}
      {tide.length > 0 && (
        <div className="space-y-1">
          {tide.map((t, i) => (
            <p
              key={`${t.station_name ?? "gauge"}-${i}`}
              className="text-[11px] leading-snug tabular-nums text-gray-400"
            >
              {tideLine(t)}
            </p>
          ))}
        </div>
      )}

      {/* World context — visually distinct; NOT ground truth of this state. */}
      {world.length > 0 && (
        <div className="space-y-1 rounded-lg bg-white/[0.02] px-2.5 py-2">
          {world.map((wd, i) => (
            <p
              key={`${wd.title}-${i}`}
              className="text-[11px] leading-snug text-gray-500"
            >
              <span className="text-gray-600">In the world: </span>
              <span className="text-gray-400">{wd.title}</span>
              {wd.content && <span> — {wd.content}</span>}{" "}
              {wd.provenance_url ? (
                <a
                  href={wd.provenance_url}
                  target="_blank"
                  rel="noreferrer"
                  className="whitespace-nowrap text-[10px] text-gray-600 underline decoration-white/20 underline-offset-2 hover:text-gray-400"
                >
                  source
                </a>
              ) : (
                <span className="whitespace-nowrap text-[10px] text-gray-600">
                  no receipt on file
                </span>
              )}
            </p>
          ))}
        </div>
      )}

      {/* Era note + honest note — the small, muted method lines. */}
      {report.era_note && (
        <p className="text-[10px] leading-relaxed text-gray-600">
          {report.era_note}
        </p>
      )}
      {report.honest_note && (
        <p className="text-[10px] leading-relaxed text-gray-600">
          {report.honest_note}
        </p>
      )}
    </div>
  );
}

/** Small provenance chips: "on file: Thunderstorm Wind — Accomack". */
function OnFileChips({
  items,
  className,
}: {
  items: OnFileChip[];
  className?: string;
}) {
  return (
    <div className={["flex flex-wrap gap-1.5", className ?? ""].join(" ")}>
      {items.map((it, i) => (
        <span
          key={`${it.type}-${i}`}
          className="inline-flex max-w-full items-center gap-1 truncate rounded-md bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-gray-500 ring-1 ring-inset ring-white/[0.06]"
          title={`${it.type}${it.scope ? ` · ${it.scope}` : ""}`}
        >
          <span className="shrink-0 text-gray-600">
            {it.scope === "in the world" ? "in the world:" : "on file:"}
          </span>
          <span className="truncate">{it.line}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * One rhyming-day row — the shared idiom for both rhyme lists (structured
 * "days like today" and semantic "days that read like today"): date,
 * match strength, why, what followed, provenance chips, click-through.
 */
function RhymeRow({
  day,
  onRhymeClick,
}: {
  day: RhymeDay;
  onRhymeClick?: (day: RhymeDay) => void;
}) {
  const flyable = onRhymeClick && day.lat != null && day.lng != null;
  const Row = flyable ? "button" : "div";
  return (
    <Row
      onClick={flyable ? () => onRhymeClick!(day) : undefined}
      className={[
        "group flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left",
        "border border-white/[0.05] bg-white/[0.015]",
        flyable
          ? "transition-colors hover:border-teal-400/30 hover:bg-teal-400/[0.05]"
          : "",
      ].join(" ")}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-gray-100 tabular-nums">
            {formatRhymeDate(day.date)}
          </span>
          {day.similarity != null && (
            <span className="text-[10px] tabular-nums text-teal-400/70">
              {Math.round(day.similarity * 100)}% match
            </span>
          )}
          {flyable && (
            <span className="ml-auto text-[10px] text-gray-600 opacity-0 transition-opacity group-hover:opacity-100">
              fly to →
            </span>
          )}
        </div>
        {day.summary && (
          <div className="mt-0.5 text-[11px] leading-snug text-gray-500">
            {day.summary}
          </div>
        )}
        {day.outcome && (
          <div className="mt-0.5 text-[11px] leading-snug text-gray-400">
            <span className="text-gray-600">→ </span>
            {day.outcome}
          </div>
        )}
        {!!day.on_file?.length && (
          <OnFileChips items={day.on_file} className="mt-1" />
        )}
      </div>
    </Row>
  );
}

/** Wind arrow — points the way the wind is going, rotated by bearing. */
function WindArrow({ deg }: { deg: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 text-gray-400"
      style={{ transform: `rotate(${deg}deg)` }}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 19V5M12 5l-5 5M12 5l5 5" />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * The card
 * ──────────────────────────────────────────────────────────────────────────── */

export default function SpotDossier({
  placeLabel,
  data,
  onRhymeClick,
  onFrontClick,
  datedVisit = false,
  className,
}: SpotDossierProps) {
  const { weather, front, moon, sun, tide, solunar, anomaly, rhyme, semantic } = data;
  const asOf = asOfLabel(data.as_of);
  const live = data.live ?? [];
  // The today's-conditions cluster (live alerts + front chip) describes the
  // ACTUAL today. On a dated visit (a birthday, a historical day) it must never
  // render over a decades-old dossier — a year-old "front read from archive, as
  // of 2025" NOW anchor above a 1991 day reads as if it belongs to that day.
  // So it shows only on the live, current-day dossier.
  const showTodayConditions = !datedVisit && (live.length > 0 || !!front);
  // Within that cluster: live chips are TODAY's recorded read; the front chip's
  // GHCN basis is ~a year old. When today has recorded alerts and the front
  // would say "No front", the live chips lead and the stale-basis chip stands down.
  const showFrontChip = !!front && !(live.length > 0 && !front.moving);

  // Shooting-light window (fall back to sunrise/sunset if legal-light not computed).
  const lightStart = sun?.shooting_light_start ?? sun?.sunrise ?? null;
  const lightEnd = sun?.shooting_light_end ?? sun?.sunset ?? null;

  const hasNow = !!(
    weather || moon || sun || tide || solunar || (anomaly && anomaly.z != null)
  );

  // ── Section elements ─────────────────────────────────────────────
  // Each renders its own hairline via the divide-y wrapper below, so ORDER is
  // free. The FUSED LINEUP HERO IS RETIRED (retrodiction 2026-07-17 — no
  // lift; see /court): the live dossier now leads with the semantic rhyme,
  // then the recorded blocks. On a DATED visit the that-day block leads — a
  // birthday visitor came for their own day.

  const headerEl = (
    <div className="px-4 pb-3.5 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold leading-tight tracking-tight text-white">
            {placeLabel}
          </h2>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-1 w-1 rounded-full bg-teal-500/70" />
              {RES_LABEL[data.resolution]}
            </span>
            {asOf && (
              <>
                <span className="text-gray-700">·</span>
                <span className="tabular-nums">{asOf}</span>
              </>
            )}
          </div>
        </div>
        {showTodayConditions && (
          <div className="flex max-w-[60%] flex-col items-end gap-1.5">
            {live.map((a, i) => (
              <LiveChip key={`${a.type}-${a.title}-${i}`} alert={a} />
            ))}
            {showFrontChip && front && (
              <FrontChip front={front} onClick={onFrontClick} />
            )}
            {showFrontChip && front?.as_of && (
              <span className="text-[9px] tabular-nums text-gray-600">
                {front.day0_source === "live" || front.day0_source === "live-yesterday"
                  ? `front read from live station feed, through ${front.as_of}`
                  : `front read from archive, as of ${front.as_of}`}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );

  const thatDayEl = data.thatDay ? <ThatDayBlock report={data.thatDay} /> : null;

  const nowEl = hasNow ? (
    <div className="space-y-3 px-4 py-4">
      <Eyebrow>Now</Eyebrow>

      {/* Weather hero: the temp is the headline number. */}
      {weather && (
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="text-4xl font-semibold leading-none tracking-tight text-white tabular-nums">
              {num(weather.temp_f)}
                <span className="align-top text-2xl font-normal text-gray-500">
                  °
                </span>
              </div>
              <div className="pt-1">
                {weather.sky && (
                  <div className="text-sm font-medium text-gray-200">
                    {weather.sky}
                  </div>
                )}
                {weather.feels_like_f != null && (
                  <div className="text-xs text-gray-500">
                    Feels {num(weather.feels_like_f)}°
                  </div>
                )}
              </div>
            </div>

            {/* Wind block — direction as arrow + figure. */}
            <div className="text-right">
              <div className="flex items-center justify-end gap-1.5">
                {weather.wind_dir_deg != null && (
                  <WindArrow deg={weather.wind_dir_deg} />
                )}
                <span className="text-lg font-semibold text-gray-100 tabular-nums">
                  {num(weather.wind_mph)}
                </span>
                <span className="text-xs text-gray-500">mph</span>
              </div>
              <div className="mt-0.5 text-[11px] text-gray-500 tabular-nums">
                {weather.wind_dir ?? DASH}
                {weather.wind_gust_mph != null &&
                  ` · G ${num(weather.wind_gust_mph)}`}
              </div>
              {weather.pressure_mb != null && (
                <div className="mt-0.5 text-[11px] text-gray-500 tabular-nums">
                  {num(weather.pressure_mb)} mb
                  {weather.pressure_trend &&
                    weather.pressure_trend !== "steady" &&
                    (weather.pressure_trend === "falling" ? " ↓" : " ↑")}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Anomaly — quiet "weird for here". */}
        {anomaly && anomaly.z != null && <AnomalyBadge anomaly={anomaly} />}

        {/* Operational tile grid: shooting light · moon · tide · solunar. */}
        <div className="grid grid-cols-2 gap-2">
          {sun && (
            <Tile
              label="Shooting light"
              value={lightStart ?? DASH}
              sub={lightEnd ? `to ${lightEnd}` : undefined}
              accent
            />
          )}
          {moon && (
            <Tile
              label="Moon"
              value={`${Math.round(moon.illumination * 100)}`}
              unit="%"
              sub={moon.phase}
            />
          )}
          {tide && (
            <Tile
              label="Tide"
              value={
                tide.height_ft != null ? num(tide.height_ft, 1) : capitalize(tide.state)
              }
              unit={tide.height_ft != null ? "ft" : undefined}
              sub={
                tide.next_event
                  ? `${capitalize(tide.next_event.type)} ${tide.next_event.time}`
                  : capitalize(tide.state)
              }
            />
          )}
          {solunar && (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                Solunar
              </div>
              <div className="mt-1.5">
                <SolunarMeter rating={solunar.day_rating} />
              </div>
              <div className="mt-1.5 text-[11px] leading-tight text-gray-500">
                {solunar.rating_label ??
                  ratingWord(solunar.day_rating)}
                {solunar.best_window &&
                  ` · ${solunar.best_window.start}`}
              </div>
            </div>
          )}
        </div>

        {/* Solunar feed windows — the operational when-to-be-there strip. */}
        {solunar && solunar.windows.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {solunar.windows.map((w, i) => (
              <span
                key={i}
                className={[
                  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] tabular-nums",
                  w.kind === "major"
                    ? "bg-teal-400/10 text-teal-300 ring-1 ring-inset ring-teal-400/20"
                    : "bg-white/[0.03] text-gray-400 ring-1 ring-inset ring-white/[0.06]",
                ].join(" ")}
              >
                <span className="font-semibold uppercase tracking-wide opacity-70">
                  {w.kind === "major" ? "Maj" : "Min"}
                </span>
                {w.start}
                <span className="opacity-40">–</span>
                {w.end}
              </span>
            ))}
          </div>
        )}
      </div>
  ) : null;

  // ── The receipts / almanac layer: "days like today" (one-number rhyme) +
  //    the control line. Quiet retrieval, never the hero. Denominator +
  //    honesty footer stay attached (honesty law #1).
  const rhymeEl =
    rhyme && rhyme.matches.length > 0 ? (
      <div className="space-y-2.5 px-4 py-4">
        <div className="flex items-center justify-between">
          <Eyebrow>Days like today, here</Eyebrow>
            {/* THE DENOMINATOR — always shown (honesty law #1). */}
            <span className="text-[10px] tabular-nums text-gray-600">
              {rhyme.base_rate ??
                (rhyme.n_candidates != null
                  ? `${rhyme.matches.length} of ${rhyme.n_candidates}`
                  : `${rhyme.matches.length} found`)}
            </span>
          </div>

          <ul className="space-y-1.5">
            {rhyme.matches.slice(0, 4).map((day, i) => (
              <RhymeRow
                key={`${day.date}-${i}`}
                day={day}
                onRhymeClick={onRhymeClick}
              />
            ))}
          </ul>

          {/* THE CONTROL LINE — the all-years base rate, always present.
              Honest counts; the retired lineup lane survives only here. */}
          {data.control && (
            <p className="pt-0.5 text-[10px] leading-relaxed tabular-nums text-gray-500">
              {controlSentence(data.control)}
            </p>
          )}

          {/* Honesty footer — no guessing, recorded fact only. */}
          <p className="pt-0.5 text-[10px] leading-relaxed text-gray-600">
            Recorded fact only — matched against this spot&apos;s own history, never a forecast.
          </p>
        </div>
    ) : null;

  // ── SEMANTIC RHYME — days that READ like today. The structured rhyme above
  //    matches one number; this matches meaning. On the live dossier this is
  //    the second-strongest surface (fusion first, then meaning). The novel
  //    state renders the no-precedent sentence at full weight — a hero line.
  const semanticEl =
    semantic && (semantic.novel || semantic.matches.length > 0) ? (
      <div className="space-y-2.5 px-4 py-4">
        <Eyebrow>Days that read like today</Eyebrow>

        {semantic.novel ? (
          <p className="font-display text-[19px] font-semibold leading-snug text-white">
            {semantic.note ??
              "Today doesn't read like anything on record here — that itself is the finding."}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {semantic.matches.slice(0, 4).map((day, i) => (
              <RhymeRow
                key={`${day.date}-${i}`}
                day={day}
                onRhymeClick={onRhymeClick}
              />
            ))}
          </ul>
        )}

        {/* The method line — small, honest, never forecast language. */}
        <p className="pt-0.5 text-[10px] leading-relaxed tabular-nums text-gray-600">
          matched by meaning
          {semantic.n_searched != null &&
            ` across ~${semantic.n_searched.toLocaleString()} recorded days`}
          {" — not a forecast."}
          {semantic.method && (
            <span className="text-gray-700"> {semantic.method}.</span>
          )}
        </p>
      </div>
    ) : null;

  return (
    <div
      className={[
        "w-full max-w-sm overflow-hidden rounded-2xl",
        "border border-white/[0.08] bg-gray-950",
        "shadow-2xl shadow-black/60 ring-1 ring-black/40",
        className ?? "",
      ].join(" ")}
      style={{
        fontFamily:
          'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      {/* One divider system for the whole stack: every section renders its own
          top hairline via divide-y, so the mode-dependent order below never
          doubles or drops a rule. The lineup hero is retired (2026-07-17);
          SEMANTIC RHYME leads the live dossier, WHAT THIS DAY WAS leads a
          dated visit. */}
      <div className="divide-y divide-white/[0.06]">
        {headerEl}
        {datedVisit ? (
          <>
            {thatDayEl}
            {semanticEl}
            {nowEl}
            {rhymeEl}
          </>
        ) : (
          <>
            {semanticEl}
            {thatDayEl}
            {nowEl}
            {rhymeEl}
          </>
        )}
      </div>
    </div>
  );
}

/* ── tiny utils ──────────────────────────────────────────────── */

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Integers show bare; anything else to one decimal. "92.6", "103", "0.5". */
function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * The weather lede — one composed sentence from the day's recorded numbers.
 * "An average high of 92.6°F across 48 stations — the warmest reading 103°F,
 *  no measurable rain." Returns null when there's nothing recorded to compose.
 */
function thatDayWeatherLede(w: ThatDayWeather): string | null {
  const lead =
    w.avg_high_f != null && Number.isFinite(w.avg_high_f)
      ? `An average high of ${trimNum(w.avg_high_f)}°F${
          w.stations != null && Number.isFinite(w.stations)
            ? ` across ${w.stations} station${w.stations === 1 ? "" : "s"}`
            : ""
        }`
      : null;

  const details: string[] = [];
  if (w.max_f != null && Number.isFinite(w.max_f)) {
    details.push(`the warmest reading ${trimNum(w.max_f)}°F`);
  }
  if (w.precip_in != null && Number.isFinite(w.precip_in)) {
    details.push(
      w.precip_in < 0.01
        ? "no measurable rain"
        : `${trimNum(w.precip_in)} in of rain`,
    );
  }

  if (!lead && details.length === 0) return null;
  const body = details.length ? ` — ${details.join(", ")}` : "";
  return `${lead ?? "On record"}${body}.`;
}

/** "$2.4M", "$1.3B", "$40K" — compact recorded damage. */
function formatDamage(usd: number): string {
  if (usd >= 1e9) return `$${trimNum(usd / 1e9)}B`;
  if (usd >= 1e6) return `$${trimNum(usd / 1e6)}M`;
  if (usd >= 1e3) return `$${Math.round(usd / 1e3)}K`;
  return `$${Math.round(usd)}`;
}

/** ISO-8601 UTC (or bare "HH:MM") → "HH:MM". null when unparseable. */
function formatUtcHHMM(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(
      d.getUTCMinutes(),
    ).padStart(2, "0")}`;
  }
  const m = /^(\d{1,2}):(\d{2})/.exec(iso);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/**
 * One tide gauge's recorded residual as a sentence.
 * "Baltimore gauge: +6.59 ft above predicted tide at 05:00 UTC (11.77 ft water level)."
 */
function tideLine(t: ThatDayTide): string {
  let s = t.station_name ? `${t.station_name} gauge` : "Gauge";
  const r = t.residual_max_ft;
  if (r != null && Number.isFinite(r)) {
    s += `: ${signed(r, 2)} ft ${r >= 0 ? "above" : "below"} predicted tide`;
    const hhmm = formatUtcHHMM(t.residual_max_time_utc);
    if (hhmm) s += ` at ${hhmm} UTC`;
    if (t.daily_max_ft != null && Number.isFinite(t.daily_max_ft)) {
      s += ` (${t.daily_max_ft.toFixed(2)} ft water level)`;
    }
    return `${s}.`;
  }
  // v1-era record: daily means, not maxima — say so on its own terms.
  const rm = t.residual_mean_ft;
  if (rm != null && Number.isFinite(rm)) {
    s += `: ${signed(rm, 2)} ft mean departure from predicted tide that day`;
    if (t.daily_mean_ft != null && Number.isFinite(t.daily_mean_ft)) {
      s += ` (${t.daily_mean_ft.toFixed(2)} ft mean water level)`;
    }
    return `${s} — daily-mean record.`;
  }
  if (t.daily_mean_ft != null && Number.isFinite(t.daily_mean_ft)) {
    return `${s}: ${t.daily_mean_ft.toFixed(2)} ft mean water level — daily-mean record.`;
  }
  return `${s}.`;
}

/**
 * One quake as a sentence.
 * "M7.1 — Ridgecrest Earthquake Sequence at 03:19 UTC (depth 8 km)."
 */
function quakeLine(q: ThatDayQuake): string {
  let s = q.magnitude != null ? `M${q.magnitude}` : "Quake";
  if (q.place) s += ` — ${q.place}`;
  const hhmm = formatUtcHHMM(q.event_time_utc);
  if (hhmm) s += ` at ${hhmm} UTC`;
  if (q.depth_km != null && Number.isFinite(q.depth_km)) {
    s += ` (depth ${q.depth_km} km)`;
  }
  return `${s}.`;
}

function ratingWord(r: number): string {
  if (r >= 3.5) return "Excellent";
  if (r >= 2.5) return "Good";
  if (r >= 1.5) return "Average";
  return "Poor";
}

/**
 * The control caption. Recorded counts only — no forecast words, ever.
 * "Across all 74 recorded years here, cooling ≥5° within a week happened 31
 *  of 74 times — the 17 lineup-matched days ran 12 of 17."
 */
function controlSentence(c: ControlLine): string {
  const what = c.outcome ?? "the counted outcome";
  const base = `Across all ${c.all_n} recorded years here, ${what} happened ${c.all_outcome_n} of ${c.all_n} times`;
  if (c.matched_n > 0) {
    return `${base} — the ${c.matched_n} lineup-matched day${c.matched_n === 1 ? "" : "s"} ran ${c.matched_outcome_n} of ${c.matched_n}.`;
  }
  return `${base}. No lineup-matched days carried a recorded week after them to compare.`;
}

function formatRhymeDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
