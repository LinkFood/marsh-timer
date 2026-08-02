/**
 * sky.ts — the sky, on the phone, in airplane mode.
 *
 * This is the offline foundation of the hunter's tool. A blind at 5 a.m. in the
 * Blackwater marsh has no bars; a sunrise that arrives over HTTP is a sunrise
 * that does not arrive. So every number on this page is computed on the device
 * from the date and the coordinates and nothing else.
 *
 * THE ONE HARD RULE OF THIS FILE: no network. No `fetch`, no supabase client,
 * no import that could drag one in. If you are editing this file and reaching
 * for a request, you are in the wrong file.
 *
 * Ported from `supabase/functions/hunt-atlas-solunar/index.ts`, which stays
 * deployed as the parity oracle for `sky.test.ts`. Same algorithms, same
 * constants, same arithmetic — the port is intended to be numerically identical
 * to the function, and the golden-file test is what holds it to that.
 *
 * Algorithms (standard, well-tested):
 *   Sun     — NOAA solar-position / sunrise equation (closed form).
 *   Moon    — Schlyter low-precision lunar theory (main perturbation terms),
 *             geocentric RA/Dec, good to ~1–2 arcmin.
 *   Phase   — illuminated fraction from true sun–moon elongation.
 *   Rise/set/transit — altitude sampled across the UTC day, horizon crossings
 *             plus the genuine local maximum (transit) and minimum (underfoot).
 *   Solunar — major windows centred on lunar transit + underfoot (±1h);
 *             minor windows centred on moonrise + moonset (±0.5h).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS DELIBERATELY LEFT BEHIND, AND WHY. Read this before adding anything.
 *
 * 1. SHOOTING LIGHT IS NOT IN THIS FILE. The edge function computed
 *
 *        shooting_light_end = sunset + 30 min
 *
 *    under the comment "~30 min before sunrise to ~30 min after sunset". The
 *    back half of that is FALSE AND DANGEROUS. The federal migratory-bird
 *    framework — and Maryland under it — ends legal shooting light at SUNSET.
 *    Not sunset plus anything. A hunter watching a running clock tick through
 *    that half hour is a hunter this app walked into a federal violation.
 *
 *    The front half (sunrise − 30) happens to match the current federal
 *    framework, but it is still a REGULATION and not astronomy, it is not
 *    universal (states may and do set their own), and it changes when a state
 *    says it changes. Encoding it here would put a legal rule in a file with no
 *    citation, no jurisdiction and no effective date.
 *
 *    So this module publishes SUNRISE and SUNSET and stops. Legal shooting
 *    hours are law, they are per-state, they are cited, and they live in
 *    `src/data/regs/shootingHours.ts`. That table consumes `sunTimes()`.
 *    Do not put an offset in this file. Not for one state, not "temporarily".
 *
 * 2. NO RATING AND NO SCORE. The function graded each day `excellent | good |
 *    fair | poor` with a 1–4 score off the moon's age. This product counts and
 *    never predicts (CLAUDE.md, "Show don't predict"), and a rating is a
 *    prediction wearing a number: it tells a hunter the ducks will fly, from
 *    lunar geometry alone, with no evidence and no way to be wrong. It is gone.
 *    `solunarWindows()` reports WHERE THE MOON IS. What that is worth is the
 *    hunter's call, and he is better at it than we are.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything here is a total function of its arguments. No `Date.now()` inside
 * the math — the caller passes the day in. Same inputs, same output, forever,
 * which is what makes the golden-file test meaningful.
 */

/* ───────────────────────────── constants ───────────────────────────── */

/** Mean synodic month, days. */
const SYNODIC = 29.530588853;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/**
 * Geometric altitude of the sun's centre at rise/set: −0.833°, which is the
 * standard −0.5667° refraction allowance plus the ~16′ solar semi-diameter.
 * Used as `cos(90.833°)` below, the NOAA form.
 */
const SUN_H0_ZENITH = 90.833;

/** Standard geocentric altitude for moonrise / moonset, degrees. */
const MOON_H0 = 0.125;

/** Altitude sampling step across the UTC day, minutes. 5 min → 288 samples. */
const SAMPLE_STEP_MIN = 5;

/** Half-width of a major solunar window (lunar transit / underfoot), minutes. */
const MAJOR_HALF_WIDTH_MIN = 60;

/** Half-width of a minor solunar window (moonrise / moonset), minutes. */
const MINOR_HALF_WIDTH_MIN = 30;

/* ─────────────────────────── trig in degrees ─────────────────────────── */

/** Normalize to 0..360. */
const rev = (x: number): number => ((x % 360) + 360) % 360;
const sind = (d: number): number => Math.sin(d * DEG);
const cosd = (d: number): number => Math.cos(d * DEG);
const tand = (d: number): number => Math.tan(d * DEG);
const asind = (x: number): number => Math.asin(Math.max(-1, Math.min(1, x))) * RAD;
const atan2d = (y: number, x: number): number => Math.atan2(y, x) * RAD;

/* ──────────────────────────── time plumbing ──────────────────────────── */

/**
 * Midnight UTC of the calendar day a `Date` falls on.
 *
 * Every entry point floors its input through here first. The edge function did
 * not: it was always handed a `T00:00:00Z` instant parsed from a `YYYY-MM-DD`
 * param, so the question never came up, but its `noaaSun` derives "JD at 12:00
 * UTC" with a `floor(jd − 0.5) + 1` that quietly shifts by a day if it is ever
 * handed an afternoon instant. Flooring here makes the whole module answer the
 * same thing for any time of day on the same UTC date, which is the contract a
 * caller holding `new Date()` actually needs.
 *
 * NOTE THE FRAME: the day is the UTC day, and all returned instants are honest
 * UTC instants. For a spot far from Greenwich the "sunrise for 2028-01-01 UTC"
 * can land on 2027-12-31 or 2028-01-02 in local wall-clock. That is the edge
 * function's frame and this port keeps it; localizing to the spot's timezone is
 * the caller's job, exactly as before.
 */
export function utcDayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Julian Date from a JS `Date` (a UTC instant). */
function toJD(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/**
 * A `Date` from a minutes-of-day offset against a UTC day start. Minutes may be
 * negative or exceed 1440; the instant rolls into the neighbouring day, which
 * is how a moonrise at 23:50Z the previous day or a sunset past midnight Z is
 * reported honestly rather than clamped into a lie.
 */
function dateFromMinutes(dayStartUTC: Date, minutesUTC: number): Date {
  return new Date(dayStartUTC.getTime() + Math.round(minutesUTC * 60000));
}

/* ══════════════════════════════════ SUN ══════════════════════════════════ */

/** Why the sun has no rise or set on a given day at a given latitude. */
export type PolarState = "none" | "midnight-sun" | "polar-night";

export interface SunTimes {
  /** Sunrise instant (UTC), or null above the polar circles. */
  sunrise: Date | null;
  /** Sunset instant (UTC), or null above the polar circles. */
  sunset: Date | null;
  /** Solar noon. Always defined — the sun has a highest point every day. */
  solarNoon: Date;
  /**
   * Why `sunrise`/`sunset` are null. The edge function returned a bare null for
   * both cases, which leaves a caller unable to tell "the sun never came up"
   * from "the sun never went down" — opposite facts, and at Utqiagvik both
   * happen. This is astronomy the original computed and discarded; it is
   * reported here so the UI can render the true sentence.
   */
  polar: PolarState;
  /** Minutes-of-day UTC, unrounded. Exposed for window math and for testing. */
  sunriseMinUTC: number | null;
  sunsetMinUTC: number | null;
  solarNoonMinUTC: number;
}

/**
 * NOAA sunrise / sunset / solar noon for a spot on a UTC calendar day.
 *
 * Returns instants only. NO shooting light, no legal offset, nothing a game
 * warden could disagree with — see the file header, rule 1.
 */
export function sunTimes(lat: number, lng: number, date: Date): SunTimes {
  const dayStart = utcDayStart(date);

  // JD at 12:00 UTC of the date. NOAA evaluates the day's elements at midday;
  // the 0h/12h difference is well under a minute for these fields.
  const jd = Math.floor(toJD(dayStart) - 0.5) + 1;
  const T = (jd - 2451545.0) / 36525.0;

  const L0 = rev(280.46646 + T * (36000.76983 + 0.0003032 * T));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);

  const C =
    sind(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    sind(2 * M) * (0.019993 - 0.000101 * T) +
    sind(3 * M) * 0.000289;

  const trueLong = L0 + C;
  const appLong = trueLong - 0.00569 - 0.00478 * sind(125.04 - 1934.136 * T);

  const eps0 =
    23 + (26 + 21.448 / 60) / 60 -
    (46.815 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600;
  const eps = eps0 + 0.00256 * cosd(125.04 - 1934.136 * T);

  const dec = asind(sind(eps) * sind(appLong));

  // Equation of time, minutes.
  const y = tand(eps / 2) * tand(eps / 2);
  const eqTime =
    4 * RAD *
    (y * sind(2 * L0) -
      2 * e * sind(M) +
      4 * e * y * sind(M) * cosd(2 * L0) -
      0.5 * y * y * sind(4 * L0) -
      1.25 * e * e * sind(2 * M));

  const solarNoonMinUTC = 720 - 4 * lng - eqTime;
  const solarNoon = dateFromMinutes(dayStart, solarNoonMinUTC);

  // Hour angle at the rise/set zenith. |cos H| > 1 means the sun's daily circle
  // never meets the horizon at this latitude on this day.
  const cosH = (cosd(SUN_H0_ZENITH) - sind(lat) * sind(dec)) / (cosd(lat) * cosd(dec));

  if (cosH > 1) {
    return {
      sunrise: null,
      sunset: null,
      solarNoon,
      polar: "polar-night",
      sunriseMinUTC: null,
      sunsetMinUTC: null,
      solarNoonMinUTC,
    };
  }
  if (cosH < -1) {
    return {
      sunrise: null,
      sunset: null,
      solarNoon,
      polar: "midnight-sun",
      sunriseMinUTC: null,
      sunsetMinUTC: null,
      solarNoonMinUTC,
    };
  }

  const HA = Math.acos(cosH) * RAD; // degrees
  const sunriseMinUTC = solarNoonMinUTC - 4 * HA;
  const sunsetMinUTC = solarNoonMinUTC + 4 * HA;

  return {
    sunrise: dateFromMinutes(dayStart, sunriseMinUTC),
    sunset: dateFromMinutes(dayStart, sunsetMinUTC),
    solarNoon,
    polar: "none",
    sunriseMinUTC,
    sunsetMinUTC,
    solarNoonMinUTC,
  };
}

/* ══════════════════════════════════ MOON ══════════════════════════════════ */

interface MoonPos {
  /** Right ascension, degrees. */
  ra: number;
  /** Declination, degrees. */
  dec: number;
  /** Apparent geocentric ecliptic longitude, degrees. */
  lonEcl: number;
}

/** Schlyter low-precision geocentric lunar position. */
function moonPosition(jd: number): MoonPos {
  const d = jd - 2451543.5; // Schlyter epoch, 2000 Jan 0.0

  // Sun — needed for the perturbation arguments and for the elongation.
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = rev(356.047 + 0.9856002585 * d);
  const Ls = rev(ws + Ms);

  // Moon orbital elements.
  const N = 125.1228 - 0.0529538083 * d;
  const i = 5.1454;
  const w = 318.0634 + 0.1643573223 * d;
  const a = 60.2666; // Earth radii
  const ecc = 0.0549;
  const M = rev(115.3654 + 13.0649929509 * d);

  // Eccentric anomaly, iterated.
  let E = M + RAD * ecc * sind(M) * (1 + ecc * cosd(M));
  for (let k = 0; k < 6; k++) {
    E = E - (E - RAD * ecc * sind(E) - M) / (1 - ecc * cosd(E));
  }

  // Position in the orbital plane.
  const x = a * (cosd(E) - ecc);
  const yy = a * Math.sqrt(1 - ecc * ecc) * sind(E);
  const r = Math.sqrt(x * x + yy * yy);
  const v = rev(atan2d(yy, x));

  // Geocentric ecliptic rectangular.
  const xeclip = r * (cosd(N) * cosd(v + w) - sind(N) * sind(v + w) * cosd(i));
  const yeclip = r * (sind(N) * cosd(v + w) + cosd(N) * sind(v + w) * cosd(i));
  const zeclip = r * sind(v + w) * sind(i);

  let lon = rev(atan2d(yeclip, xeclip));
  let lat = atan2d(zeclip, Math.sqrt(xeclip * xeclip + yeclip * yeclip));

  // Perturbation arguments.
  const Lm = rev(N + w + M); // moon mean longitude
  const Mm = M;              // moon mean anomaly
  const D = rev(Lm - Ls);    // mean elongation
  const F = rev(Lm - N);     // argument of latitude

  // Longitude perturbations, degrees.
  lon +=
    -1.274 * sind(Mm - 2 * D) +
    0.658 * sind(2 * D) +
    -0.186 * sind(Ms) +
    -0.059 * sind(2 * Mm - 2 * D) +
    -0.057 * sind(Mm - 2 * D + Ms) +
    0.053 * sind(Mm + 2 * D) +
    0.046 * sind(2 * D - Ms) +
    0.041 * sind(Mm - Ms) +
    -0.035 * sind(D) +
    -0.031 * sind(Mm + Ms) +
    -0.015 * sind(2 * F - 2 * D) +
    0.011 * sind(Mm - 4 * D);

  // Latitude perturbations, degrees.
  lat +=
    -0.173 * sind(F - 2 * D) +
    -0.055 * sind(Mm - F - 2 * D) +
    -0.046 * sind(Mm + F - 2 * D) +
    0.033 * sind(F + 2 * D) +
    0.017 * sind(2 * Mm + F);

  lon = rev(lon);

  // Ecliptic → equatorial.
  const ecl = 23.4393 - 3.563e-7 * d;
  const xg = cosd(lon) * cosd(lat);
  const yg = sind(lon) * cosd(lat);
  const zg = sind(lat);

  const xe = xg;
  const ye = yg * cosd(ecl) - zg * sind(ecl);
  const ze = yg * sind(ecl) + zg * cosd(ecl);

  return {
    ra: rev(atan2d(ye, xe)),
    dec: atan2d(ze, Math.sqrt(xe * xe + ye * ye)),
    lonEcl: lon,
  };
}

/** Sun's apparent ecliptic longitude (Schlyter), degrees — for the elongation. */
function sunLongitude(jd: number): number {
  const d = jd - 2451543.5;
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = rev(356.047 + 0.9856002585 * d);
  const ecc = 0.016709 - 1.151e-9 * d;
  let E = Ms + RAD * ecc * sind(Ms) * (1 + ecc * cosd(Ms));
  for (let k = 0; k < 5; k++) {
    E = E - (E - RAD * ecc * sind(E) - Ms) / (1 - ecc * cosd(E));
  }
  const xv = cosd(E) - ecc;
  const yv = Math.sqrt(1 - ecc * ecc) * sind(E);
  const v = rev(atan2d(yv, xv));
  return rev(v + ws);
}

/** Greenwich Mean Sidereal Time (hours) at a JD, Schlyter. */
function gmstHours(jd: number): number {
  const d = jd - 2451543.5;
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = rev(356.047 + 0.9856002585 * d);
  const Ls = rev(ws + Ms);
  const gmst0 = rev(Ls + 180) / 15; // hours
  const ut = (jd + 0.5 - Math.floor(jd + 0.5)) * 24; // UT hours
  return gmst0 + ut;
}

/** Moon altitude in degrees at a UTC instant for a spot. */
function moonAltitude(jd: number, lat: number, lng: number): number {
  const { ra, dec } = moonPosition(jd);
  const lst = (gmstHours(jd) + lng / 15) * 15; // degrees
  const ha = rev(lst - ra);
  const haNorm = ha > 180 ? ha - 360 : ha;
  return asind(sind(lat) * sind(dec) + cosd(lat) * cosd(dec) * cosd(haNorm));
}

/* ────────────────────────────── moon phase ────────────────────────────── */

export type MoonPhase =
  | "New Moon"
  | "Waxing Crescent"
  | "First Quarter"
  | "Waxing Gibbous"
  | "Full Moon"
  | "Waning Gibbous"
  | "Last Quarter"
  | "Waning Crescent";

/** Phase name from age in days since new moon (0..SYNODIC). */
function moonPhaseName(age: number): MoonPhase {
  if (age < 1.84566) return "New Moon";
  if (age < 5.53699) return "Waxing Crescent";
  if (age < 9.22831) return "First Quarter";
  if (age < 12.91963) return "Waxing Gibbous";
  if (age < 16.61096) return "Full Moon";
  if (age < 20.30228) return "Waning Gibbous";
  if (age < 23.99361) return "Last Quarter";
  if (age < 27.68493) return "Waning Crescent";
  return "New Moon";
}

export interface MoonState {
  phase: MoonPhase;
  /**
   * Illuminated fraction of the disc, 0..1. The edge function returned a
   * percent rounded to 0.1; the raw fraction is kept here and rounding is left
   * to whatever is drawing it.
   */
  illumination: number;
  /** Days since new moon, 0..SYNODIC. */
  age: number;
  /** Days until the next full moon. 0 at full. */
  daysToFull: number;
}

/**
 * The moon's phase for a UTC calendar day.
 *
 * Geocentric — phase is the same moon from every blind on earth, so this takes
 * no coordinates. Evaluated at 12:00 UTC of the day so the day carries one
 * stable value rather than drifting across a page render.
 *
 * NO RATING, NO SCORE. See the file header, rule 2.
 */
export function moonState(date: Date): MoonState {
  const dayStart = utcDayStart(date);
  const noonJD = toJD(dayStart) + 0.5;

  const moonLon = moonPosition(noonJD).lonEcl;
  const sunLon = sunLongitude(noonJD);

  const elong = rev(moonLon - sunLon); // 0° at new, 180° at full
  const illumination = (1 - cosd(elong)) / 2;
  const age = (elong / 360) * SYNODIC;
  const daysToFull = rev(180 - elong) / (360 / SYNODIC);

  return { phase: moonPhaseName(age), illumination, age, daysToFull };
}

/* ─────────────────────── moon rise / set / transit ─────────────────────── */

export interface MoonEvents {
  /** First moonrise of the UTC day, or null if the moon does not rise in it. */
  rise: Date | null;
  /** First moonset of the UTC day, or null. */
  set: Date | null;
  /** Lunar transit — the moon overhead. Null when it stays below the horizon. */
  transit: Date | null;
  /** Anti-transit — the moon underfoot, on the far side of the earth. */
  underfoot: Date | null;
  /** Minutes-of-day UTC, unrounded. */
  riseMinUTC: number | null;
  setMinUTC: number | null;
  transitMinUTC: number | null;
  underfootMinUTC: number | null;
}

/**
 * Moon rise / set / transit / underfoot for a spot on a UTC calendar day, found
 * by sampling the altitude curve every 5 minutes and reading its crossings and
 * its genuine local extrema.
 *
 * TRANSIT IS A REAL TURNING POINT, NEVER A BARE WITHIN-DAY MAXIMUM. This is
 * load-bearing and it is the fix the edge function carries from 2026-07-17: a
 * plain max-of-the-day scan produced a phantom major window pinned exactly to
 * the UTC day boundary whenever the true transit sat in the adjacent day (the
 * 5:00–7:00 p.m. MDT wart). So the two samples just OUTSIDE the day are taken
 * as well, and a boundary sample only counts as a turning point when the
 * outside neighbour confirms the turn happens here. An interior true transit is
 * still found even when a boundary sample happens to sit higher.
 */
export function moonEvents(lat: number, lng: number, date: Date): MoonEvents {
  const dayStart = utcDayStart(date);
  const dayStartJD = toJD(dayStart);

  const steps = (24 * 60) / SAMPLE_STEP_MIN; // 288
  const altAt = (min: number) => moonAltitude(dayStartJD + min / 1440, lat, lng);

  const alts: number[] = [];
  for (let s = 0; s <= steps; s++) alts.push(altAt(s * SAMPLE_STEP_MIN));
  const altPre = altAt(-SAMPLE_STEP_MIN);
  const altPost = altAt((steps + 1) * SAMPLE_STEP_MIN);

  // Horizon crossings relative to MOON_H0 — first rise, first set.
  let riseMinUTC: number | null = null;
  let setMinUTC: number | null = null;
  for (let s = 1; s <= steps; s++) {
    const a0 = alts[s - 1] - MOON_H0;
    const a1 = alts[s] - MOON_H0;
    if (a0 <= 0 && a1 > 0 && riseMinUTC === null) {
      riseMinUTC = (s - 1) * SAMPLE_STEP_MIN + (a0 / (a0 - a1)) * SAMPLE_STEP_MIN;
    }
    if (a0 >= 0 && a1 < 0 && setMinUTC === null) {
      setMinUTC = (s - 1) * SAMPLE_STEP_MIN + (a0 / (a0 - a1)) * SAMPLE_STEP_MIN;
    }
  }

  const neighbours = (i: number): [number, number] => [
    i === 0 ? altPre : alts[i - 1],
    i === steps ? altPost : alts[i + 1],
  ];

  let transitMinUTC: number | null = null;
  let transitAlt = -Infinity;
  let underfootMinUTC: number | null = null;
  let underfootAlt = Infinity;
  for (let s = 0; s <= steps; s++) {
    const [before, after] = neighbours(s);
    if (alts[s] >= before && alts[s] >= after && alts[s] > transitAlt) {
      transitMinUTC = s * SAMPLE_STEP_MIN;
      transitAlt = alts[s];
    }
    if (alts[s] <= before && alts[s] <= after && alts[s] < underfootAlt) {
      underfootMinUTC = s * SAMPLE_STEP_MIN;
      underfootAlt = alts[s];
    }
  }

  // A transit only means something if the moon actually clears the horizon.
  if (transitMinUTC !== null && transitAlt <= MOON_H0) transitMinUTC = null;

  const at = (m: number | null) => (m === null ? null : dateFromMinutes(dayStart, m));

  return {
    rise: at(riseMinUTC),
    set: at(setMinUTC),
    transit: at(transitMinUTC),
    underfoot: at(underfootMinUTC),
    riseMinUTC,
    setMinUTC,
    transitMinUTC,
    underfootMinUTC,
  };
}

/* ════════════════════════════════ SOLUNAR ════════════════════════════════ */

export interface SolunarWindow {
  start: Date;
  end: Date;
}

export interface SolunarWindows {
  /** Centred on lunar transit and underfoot, ±1h. */
  major: SolunarWindow[];
  /** Centred on moonrise and moonset, ±30 min. */
  minor: SolunarWindow[];
  /** The events the windows were built from, so the UI can show its work. */
  events: MoonEvents;
}

/**
 * The solunar windows for a spot on a UTC calendar day: where the moon is,
 * stated as time spans.
 *
 * A window is a geometric fact — the moon is overhead, or underfoot, or on the
 * horizon — and nothing here claims a bird will be moving through it. There is
 * DELIBERATELY no rating and no score attached; see the file header, rule 2.
 */
export function solunarWindows(lat: number, lng: number, date: Date): SolunarWindows {
  const dayStart = utcDayStart(date);
  const events = moonEvents(lat, lng, date);

  const win = (centreMin: number | null, halfWidthMin: number): SolunarWindow | null =>
    centreMin === null
      ? null
      : {
          start: dateFromMinutes(dayStart, centreMin - halfWidthMin),
          end: dateFromMinutes(dayStart, centreMin + halfWidthMin),
        };

  const keep = (w: SolunarWindow | null): w is SolunarWindow => w !== null;

  return {
    major: [
      win(events.transitMinUTC, MAJOR_HALF_WIDTH_MIN),
      win(events.underfootMinUTC, MAJOR_HALF_WIDTH_MIN),
    ].filter(keep),
    minor: [
      win(events.riseMinUTC, MINOR_HALF_WIDTH_MIN),
      win(events.setMinUTC, MINOR_HALF_WIDTH_MIN),
    ].filter(keep),
    events,
  };
}
