/**
 * almanac.ts — the TODAY fitted block's computed furniture (blueprint §2a).
 *
 * Sky data comes from hunt-atlas-solunar — a READ-ONLY pure-computation edge
 * function (NOAA sun equations + Schlyter lunar theory, no DB, no forecast) —
 * called at the ground state's centroid and localized here to the state's
 * civil timezone. The function scans one UTC day; a US local day spans two of
 * them, so we fetch today + tomorrow (both pure compute, cheap) and keep only
 * the events that land on the ground's local calendar day.
 *
 * Everything else (day-of-year, season counter, full-moon names) is plain
 * calendar math. No astrology — moon phase and its traditional month name
 * only, the 1950 left-hand-page grade of furniture.
 */

import { STATE_CENTROIDS } from "@/data/atlas/stateCentroids";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

/** Dominant IANA civil timezone per state (the centroid's zone). */
const STATE_TZ: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix",
  AR: "America/Chicago", CA: "America/Los_Angeles", CO: "America/Denver",
  CT: "America/New_York", DE: "America/New_York", FL: "America/New_York",
  GA: "America/New_York", HI: "Pacific/Honolulu", ID: "America/Boise",
  IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago",
  KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago",
  ME: "America/New_York", MD: "America/New_York", MA: "America/New_York",
  MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago",
  MO: "America/Chicago", MT: "America/Denver", NE: "America/Chicago",
  NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York",
  NM: "America/Denver", NY: "America/New_York", NC: "America/New_York",
  ND: "America/Chicago", OH: "America/New_York", OK: "America/Chicago",
  OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York",
  SC: "America/New_York", SD: "America/Chicago", TN: "America/Chicago",
  TX: "America/Chicago", UT: "America/Denver", VT: "America/New_York",
  VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York",
  WI: "America/Chicago", WY: "America/Denver",
};

export function stateTz(abbr: string): string {
  return STATE_TZ[abbr] ?? "America/New_York";
}

/** Today's ISO calendar date in a timezone. */
export function localDateIso(tz: string, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(at);
}

/** ISO instant → "5:55a" wall-clock in a timezone. */
export function fmtClock(iso: string, tz: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === "hour")?.value ?? "";
  const m = parts.find((p) => p.type === "minute")?.value ?? "";
  const ap = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toLowerCase().startsWith("p") ? "p" : "a";
  return `${h}:${m}${ap}`;
}

/** ISO instant → the local calendar date it lands on in a timezone. */
function localDayOf(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
}

/** "14h 36m" between two instants. */
export function fmtSpan(startIso: string, endIso: string): string {
  const mins = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

// ── Calendar counters (the 1950 dateline, verbatim grade) ──────────────────────

export function dayOfYear(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000) + 1;
}

const SEASON_MARKS: { m: number; d: number; name: string }[] = [
  { m: 3, d: 20, name: "spring" },
  { m: 6, d: 21, name: "summer" },
  { m: 9, d: 22, name: "fall" },
  { m: 12, d: 21, name: "winter" },
];

/** "66 days until fall" / "fall begins today" — nearest upcoming season mark. */
export function seasonCounter(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  for (const yr of [y, y + 1]) {
    for (const mark of SEASON_MARKS) {
      const mt = Date.UTC(yr, mark.m - 1, mark.d);
      if (mt < t) continue;
      const days = Math.round((mt - t) / 86400000);
      if (days === 0) return `${mark.name} begins today`;
      return `${days} day${days === 1 ? "" : "s"} until ${mark.name}`;
    }
  }
  return "";
}

// ── Full-moon names (traditional, by month) ─────────────────────────────────────

const FULL_MOON_NAMES = [
  "Wolf Moon", "Snow Moon", "Worm Moon", "Pink Moon", "Flower Moon",
  "Strawberry Moon", "Buck Moon", "Sturgeon Moon", "Harvest Moon",
  "Hunter's Moon", "Beaver Moon", "Cold Moon",
];

export interface FullMoonAhead {
  /** local ISO date the full moon lands on */
  date: string;
  /** "Buck Moon" — the traditional name of that month's full moon */
  name: string;
  /** whole days from today (0 = tonight) */
  days: number;
}

/** The next full moon from `days_to_full`, named for the month it lands in. */
export function nextFullMoon(todayLocalIso: string, daysToFull: number): FullMoonAhead {
  const [y, m, d] = todayLocalIso.split("-").map(Number);
  const days = Math.round(daysToFull);
  const dt = new Date(Date.UTC(y, m - 1, d) + days * 86400000);
  return {
    date: dt.toISOString().slice(0, 10),
    name: FULL_MOON_NAMES[dt.getUTCMonth()],
    days,
  };
}

// ── The sky fetch ───────────────────────────────────────────────────────────────

interface SolunarWindow { start: string; end: string }

interface AtlasSolunarResp {
  date?: string;
  moon?: {
    phase?: string; illum?: number; age?: number; days_to_full?: number;
    rise?: string | null; set?: string | null;
  } | null;
  sun?: { sunrise?: string | null; sunset?: string | null } | null;
  solunar?: { major?: SolunarWindow[]; minor?: SolunarWindow[] } | null;
}

export interface GroundSky {
  /** the ground's local calendar date the block speaks of */
  day: string;
  tz: string;
  sunrise: string | null; // ISO instants — format with fmtClock(_, tz)
  sunset: string | null;
  moonPhase: string | null;
  moonIllum: number | null; // percent
  moonAge: number | null; // days since new
  moonrise: string | null; // ISO instant landing on `day`, if the moon rises that day
  fullMoon: FullMoonAhead | null;
  majors: SolunarWindow[]; // windows landing on `day`, chronological
  minors: SolunarWindow[];
}

async function getSolunar(lat: number, lng: number, date: string): Promise<AtlasSolunarResp> {
  const res = await fetch(
    `${SUPABASE_URL}/functions/v1/hunt-atlas-solunar?lat=${lat}&lng=${lng}&date=${date}`,
    { headers: { apikey: SUPABASE_KEY ?? "", Authorization: `Bearer ${SUPABASE_KEY ?? ""}` } },
  );
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as AtlasSolunarResp;
}

function isoPlusDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
}

/**
 * The fitted sky for a ground state's local today. Two pure-compute calls
 * (today + tomorrow UTC days) merged, every event filtered to the local
 * calendar day. Throws on failure — the block renders nothing rather than a
 * placeholder (house law).
 */
export async function fetchGroundSky(stateAbbr: string): Promise<GroundSky> {
  const c = STATE_CENTROIDS[stateAbbr]; // [lng, lat]
  if (!c || !SUPABASE_URL) throw new Error("no centroid");
  const tz = stateTz(stateAbbr);
  const day = localDateIso(tz);
  const [lng, lat] = c;
  const [d0, d1] = await Promise.all([
    getSolunar(lat, lng, day),
    getSolunar(lat, lng, isoPlusDays(day, 1)),
  ]);

  const onDay = (w: SolunarWindow) => localDayOf(w.start, tz) === day;
  const byStart = (a: SolunarWindow, b: SolunarWindow) => (a.start < b.start ? -1 : 1);
  const majors = [...(d0.solunar?.major ?? []), ...(d1.solunar?.major ?? [])].filter(onDay).sort(byStart);
  const minors = [...(d0.solunar?.minor ?? []), ...(d1.solunar?.minor ?? [])].filter(onDay).sort(byStart);

  // The UTC-day query whose sun events land on the local day (for US
  // longitudes that's the same-date query; keep the guard anyway).
  const sunrise = [d0.sun?.sunrise, d1.sun?.sunrise].find((s) => s && localDayOf(s, tz) === day) ?? null;
  const sunset = [d0.sun?.sunset, d1.sun?.sunset].find((s) => s && localDayOf(s, tz) === day) ?? null;

  const moonrise = [d0.moon?.rise, d1.moon?.rise].find((s) => s && localDayOf(s, tz) === day) ?? null;

  const m = d0.moon ?? null;
  return {
    day,
    tz,
    sunrise,
    sunset,
    moonPhase: m?.phase ?? null,
    moonIllum: typeof m?.illum === "number" ? m.illum : null,
    moonAge: typeof m?.age === "number" ? m.age : null,
    moonrise,
    fullMoon: typeof m?.days_to_full === "number" ? nextFullMoon(day, m.days_to_full) : null,
    majors,
    minors,
  };
}

/**
 * The footer lore line (1950 insight 8): one rotating computed sentence,
 * moon-phase only — never astrology, never a forecast.
 */
export function loreLine(sky: GroundSky): string | null {
  const fm = sky.fullMoon;
  if (!fm) return null;
  const [, m, d] = fm.date.split("-").map(Number);
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
    "August", "September", "October", "November", "December"];
  const when = `${MONTHS[m - 1]} ${d}`;
  if (fm.days === 0) return `The ${fm.name} stands full tonight.`;
  if (fm.days === 1) return `The ${fm.name} rises full tomorrow night.`;
  if (sky.moonAge !== null && (sky.moonAge < 1.85 || sky.moonAge > 27.68)) {
    return `New moon — the darkest nights of the month. The ${fm.name} comes full ${when}.`;
  }
  return `The ${fm.name} comes full ${when} — ${fm.days} nights out.`;
}
