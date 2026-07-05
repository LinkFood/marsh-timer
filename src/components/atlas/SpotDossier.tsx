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
 * The LINEUP — the card's lead. "Last time the moon, the tide, and the cold
 * lined up like this here: October 22, 1961." A dated sentence, not a stat.
 * last_date === null with n_years > 0 is the honest "never in N recorded
 * years" state — a hero line too, never faked into a match.
 */
export interface LineupLead {
  /** "YYYY-MM-DD" of the last joint match, or null (never) */
  last_date: string | null;
  n_matches: number;
  /** DENOMINATOR — distinct recorded years actually searched */
  n_years: number | null;
  /** which components lined up, e.g. ["moon","tide","temperature"] */
  components: string[];
  /** gauge name when tide is one of the components */
  tide_station?: string | null;
  /** the backend's full honest note (thresholds, as-of dates, resolution) */
  note?: string | null;
  /** the named date's own recorded numbers — the date stops being a stranger */
  that_day?: {
    high?: number | null;
    anomaly_f?: number | null;
    tide_residual_ft?: number | null;
    moon_phase?: string | null;
  } | null;
  /** what the recorded days after the named date did, e.g. "cooled 9°F within 4 days" */
  followed?: string | null;
  /** provenance chips for the named date */
  on_file?: OnFileChip[] | null;
}

/**
 * THE CONTROL LINE — the all-years base rate for the lineup's outcome claim.
 * "12 of 17 lineup days cooled within a week — vs 31 of 74 ordinary years."
 * Mandatory whenever a lineup renders; without it the sentence is a horoscope.
 */
export interface ControlLine {
  /** the recorded outcome being counted, e.g. "avg high cooled ≥5°F within the next 7 recorded days" */
  outcome?: string | null;
  matched_n: number;
  matched_outcome_n: number;
  all_n: number;
  all_outcome_n: number;
}

/** The full dossier payload — the merged hunt-atlas-spot + hunt-atlas-solunar shape. */
export interface SpotData {
  resolution: SpotResolution;
  /** ISO timestamp the NOW reading is as-of */
  as_of?: string | null;
  coords?: { lat: number; lng: number } | null;
  lineup?: LineupLead | null;
  weather?: WeatherNow | null;
  front?: FrontSignal | null;
  moon?: MoonNow | null;
  sun?: SunNow | null;
  tide?: TideNow | null;
  solunar?: SolunarNow | null;
  anomaly?: AnomalyNow | null;
  rhyme?: RhymeResult | null;
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
 * The LEAD — the product's thesis as a dated serif sentence above the NOW
 * grid. Fact-only, denominator directly beneath it, never a forecast. The
 * zero-match state ("Never in N recorded years…") renders with the same
 * weight: an honest "never" is as much of a shiver as a named date.
 */
function LineupLeadBlock({ lineup }: { lineup: LineupLead }) {
  const phrase = lineupPhrase(lineup.components);
  const compLabel = lineup.components.join(" + ");
  const resLabel = lineup.tide_station
    ? `state-level · tide at ${lineup.tide_station}`
    : "state-level";
  return (
    <div
      className="border-b border-white/[0.06] px-4 py-4"
      title={lineup.note ?? undefined}
    >
      {lineup.last_date ? (
        <p className="font-display text-[19px] font-semibold leading-snug text-white">
          Last time {phrase} lined up like this here:{" "}
          <span className="whitespace-nowrap text-teal-300">
            {formatLineupDate(lineup.last_date)}
          </span>
          .
        </p>
      ) : (
        <p className="font-display text-[19px] font-semibold leading-snug text-white">
          Never in {lineup.n_years ?? "the"} recorded years have {phrase} lined
          up like today.
        </p>
      )}
      <div className="mt-1.5 text-[11px] tabular-nums text-gray-500">
        {lineup.last_date
          ? `${countPhrase(lineup.n_matches)} in ${lineup.n_years} years`
          : `0 matches in ${lineup.n_years} years`}
        {" · "}
        {compLabel}
        {" · "}
        {resLabel}
      </div>

      {/* The named date's own story — its numbers, then what followed. */}
      {lineup.last_date && lineup.that_day && (
        <p className="mt-2 font-body text-[12.5px] leading-relaxed text-gray-400">
          That day: {thatDaySentence(lineup.that_day)}.
          {lineup.followed && (
            <>
              {" "}What followed:{" "}
              <span className="text-gray-300">{lineup.followed}</span>.
            </>
          )}
        </p>
      )}
      {lineup.last_date && !!lineup.on_file?.length && (
        <OnFileChips items={lineup.on_file} className="mt-1.5" />
      )}
    </div>
  );
}

/** "89° (+3° for here) · tide 0.6 ft over predicted · waning gibbous" */
function thatDaySentence(td: NonNullable<LineupLead["that_day"]>): string {
  const parts: string[] = [];
  if (td.high != null) {
    const anom =
      td.anomaly_f != null ? ` (${signed(td.anomaly_f, 0)}° for here)` : "";
    parts.push(`${Math.round(td.high)}°${anom}`);
  }
  if (td.tide_residual_ft != null) {
    const r = td.tide_residual_ft;
    parts.push(
      Math.abs(r) < 0.05
        ? "tide at predicted"
        : `tide ${Math.abs(r).toFixed(1)} ft ${r > 0 ? "over" : "under"} predicted`,
    );
  }
  if (td.moon_phase) parts.push(td.moon_phase.toLowerCase());
  return parts.join(" · ");
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
  className,
}: SpotDossierProps) {
  const { lineup, weather, front, moon, sun, tide, solunar, anomaly, rhyme } = data;
  const asOf = asOfLabel(data.as_of);

  // Shooting-light window (fall back to sunrise/sunset if legal-light not computed).
  const lightStart = sun?.shooting_light_start ?? sun?.sunrise ?? null;
  const lightEnd = sun?.shooting_light_end ?? sun?.sunset ?? null;

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
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="border-b border-white/[0.06] px-4 pb-3.5 pt-4">
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
          {front && <FrontChip front={front} onClick={onFrontClick} />}
        </div>
      </div>

      {/* ── THE LEAD — the lineup sentence (the product's thesis) ─ */}
      {lineup && <LineupLeadBlock lineup={lineup} />}

      {/* ── NOW ────────────────────────────────────────────────── */}
      <div className="space-y-3 px-4 py-4">
        <Eyebrow>Now</Eyebrow>

        {/* Weather hero: the temp is the headline number. */}
        {weather && (
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="text-5xl font-semibold leading-none tracking-tight text-white tabular-nums">
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

      {/* ── PAST ───────────────────────────────────────────────── */}
      {rhyme && rhyme.matches.length > 0 && (
        <div className="space-y-2.5 border-t border-white/[0.06] px-4 py-4">
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
            {rhyme.matches.slice(0, 4).map((day, i) => {
              const flyable = onRhymeClick && day.lat != null && day.lng != null;
              const Row = flyable ? "button" : "div";
              return (
                <Row
                  key={`${day.date}-${i}`}
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
            })}
          </ul>

          {/* THE CONTROL LINE — the all-years base rate, always present.
              Without it the lineup claim is a horoscope. */}
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
      )}
    </div>
  );
}

/* ── tiny utils ──────────────────────────────────────────────── */

function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function ratingWord(r: number): string {
  if (r >= 3.5) return "Excellent";
  if (r >= 2.5) return "Good";
  if (r >= 1.5) return "Average";
  return "Poor";
}

/** ["moon","tide","temperature"] → "the moon, the tide, and the cold" */
function lineupPhrase(components: string[]): string {
  const words = components.map((c) =>
    c === "moon" ? "the moon" : c === "tide" ? "the tide" : "the cold",
  );
  if (words.length <= 1) return words[0] ?? "these";
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
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

function countPhrase(n: number): string {
  if (n === 1) return "Once";
  if (n === 2) return "Twice";
  return `${n} times`;
}

function formatLineupDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
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
