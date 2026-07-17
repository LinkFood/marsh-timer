import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';

// ---------------------------------------------------------------------------
// hunt-atlas-solunar  (READ-ONLY — PURE COMPUTATION, NO DATABASE)
//
// The hunter's precise sky data for a spot, from astronomy math only. No DB
// read, no DB write, no network. Everything is computed from the date + coords.
//
// GET params:
//   lat   number   REQUIRED   latitude  (deg, +N)
//   lng   number   REQUIRED   longitude (deg, +E, -W)
//   date  ISO date default today (UTC)   YYYY-MM-DD
//
// Returns:
//   {
//     date, lat, lng,
//     moon: { phase, illum, age, days_to_full },
//     sun:  { sunrise, sunset, shooting_light_start, shooting_light_end,
//             solar_noon },
//     solunar: { major:[{start,end}], minor:[{start,end}], rating, score },
//     note
//   }
//
// All timestamps are ISO-8601 UTC (…Z). The client localizes to the spot's
// timezone. Times are honest UTC instants, not faked local wall-clock.
//
// Algorithms (standard, well-tested):
//   Sun     — NOAA solar-position / sunrise-equation (closed form).
//   Moon    — Schlyter low-precision lunar theory (main perturbation terms),
//             geocentric RA/Dec, good to ~1-2 arcmin.
//   Phase   — illuminated fraction from true sun-moon elongation.
//   Rise/set/transit — altitude sampled across the UTC day, crossings + the
//             altitude max (transit / overhead) and min (underfoot).
//   Solunar — major windows centered on lunar transit + underfoot (±1h);
//             minor windows centered on moonrise + moonset (±0.5h).
//
// READ-ONLY: performs zero I/O. No SELECT, no write, no DDL. Cannot touch the
// archive because it never opens a client.
// ---------------------------------------------------------------------------

const SYNODIC = 29.530588853; // days, mean synodic month
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const rev = (x: number): number => ((x % 360) + 360) % 360; // normalize 0..360
const sind = (d: number): number => Math.sin(d * DEG);
const cosd = (d: number): number => Math.cos(d * DEG);
const tand = (d: number): number => Math.tan(d * DEG);
const asind = (x: number): number => Math.asin(Math.max(-1, Math.min(1, x))) * RAD;
const atan2d = (y: number, x: number): number => Math.atan2(y, x) * RAD;

// --- Julian Date from a JS Date (UTC instant) ---
function toJD(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

// --- ISO-8601 UTC string from a UTC-minutes-of-day on a given date ---
function isoFromMinutes(baseDateUTC: Date, minutesUTC: number): string {
  const ms = Date.UTC(
    baseDateUTC.getUTCFullYear(),
    baseDateUTC.getUTCMonth(),
    baseDateUTC.getUTCDate(),
  ) + Math.round(minutesUTC * 60000);
  return new Date(ms).toISOString();
}

// ===========================================================================
// SUN — NOAA sunrise/sunset (closed form)
// Returns minutes-of-day UTC for sunrise, sunset, solar noon, or null if the
// sun never crosses the horizon (polar day/night).
// ===========================================================================
interface SunTimes {
  sunriseMin: number | null;
  sunsetMin: number | null;
  solarNoonMin: number;
}

function noaaSun(dateUTC: Date, lat: number, lng: number): SunTimes {
  // Julian day at 12:00 UTC of the date (NOAA evaluates at local noon; 0h/12h
  // difference is < ~1 min for these fields).
  const jd = Math.floor(toJD(dateUTC) - 0.5) + 0.5 + 0.5; // JD at 12:00 UTC
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

  // Equation of time (minutes)
  const y = tand(eps / 2) * tand(eps / 2);
  const eqTime =
    4 * RAD *
    (y * sind(2 * L0) -
      2 * e * sind(M) +
      4 * e * y * sind(M) * cosd(2 * L0) -
      0.5 * y * y * sind(4 * L0) -
      1.25 * e * e * sind(2 * M));

  const solarNoonMin = 720 - 4 * lng - eqTime; // minutes UTC

  // Hour angle for geometric sunrise/sunset (center at -0.833°, refraction+radius)
  const cosH =
    (cosd(90.833) - sind(lat) * sind(dec)) / (cosd(lat) * cosd(dec));

  if (cosH > 1) {
    // Sun never rises (polar night)
    return { sunriseMin: null, sunsetMin: null, solarNoonMin };
  }
  if (cosH < -1) {
    // Sun never sets (polar day)
    return { sunriseMin: null, sunsetMin: null, solarNoonMin };
  }

  const HA = Math.acos(cosH) * RAD; // degrees
  const sunriseMin = solarNoonMin - 4 * HA;
  const sunsetMin = solarNoonMin + 4 * HA;

  return { sunriseMin, sunsetMin, solarNoonMin };
}

// ===========================================================================
// MOON — Schlyter low-precision geocentric position → RA/Dec + ecliptic long
// ===========================================================================
interface MoonPos {
  ra: number;   // deg
  dec: number;  // deg
  lonEcl: number; // deg, apparent geocentric ecliptic longitude
}

function moonPosition(jd: number): MoonPos {
  const d = jd - 2451543.5; // Schlyter epoch (2000 Jan 0.0)

  // Sun (needed for perturbations + elongation)
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = rev(356.0470 + 0.9856002585 * d);
  const Ls = rev(ws + Ms);

  // Moon orbital elements
  const N = 125.1228 - 0.0529538083 * d;
  const i = 5.1454;
  const w = 318.0634 + 0.1643573223 * d;
  const a = 60.2666; // Earth radii
  const ecc = 0.054900;
  const M = rev(115.3654 + 13.0649929509 * d);

  // Eccentric anomaly (iterate)
  let E = M + RAD * ecc * sind(M) * (1 + ecc * cosd(M));
  for (let k = 0; k < 6; k++) {
    E = E - (E - RAD * ecc * sind(E) - M) / (1 - ecc * cosd(E));
  }

  // Position in orbital plane
  const x = a * (cosd(E) - ecc);
  const yy = a * Math.sqrt(1 - ecc * ecc) * sind(E);
  const r = Math.sqrt(x * x + yy * yy);
  const v = rev(atan2d(yy, x));

  // Geocentric ecliptic rectangular
  const xeclip = r * (cosd(N) * cosd(v + w) - sind(N) * sind(v + w) * cosd(i));
  const yeclip = r * (sind(N) * cosd(v + w) + cosd(N) * sind(v + w) * cosd(i));
  const zeclip = r * sind(v + w) * sind(i);

  let lon = rev(atan2d(yeclip, xeclip));
  let lat = atan2d(zeclip, Math.sqrt(xeclip * xeclip + yeclip * yeclip));

  // Perturbation arguments
  const Lm = rev(N + w + M);   // Moon mean longitude
  const Mm = M;                // Moon mean anomaly
  const D = rev(Lm - Ls);      // Mean elongation
  const F = rev(Lm - N);       // Argument of latitude

  // Longitude perturbations (degrees)
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

  // Latitude perturbations (degrees)
  lat +=
    -0.173 * sind(F - 2 * D) +
    -0.055 * sind(Mm - F - 2 * D) +
    -0.046 * sind(Mm + F - 2 * D) +
    0.033 * sind(F + 2 * D) +
    0.017 * sind(2 * Mm + F);

  lon = rev(lon);

  // Ecliptic → equatorial
  const ecl = 23.4393 - 3.563e-7 * d;
  const xg = cosd(lon) * cosd(lat);
  const yg = sind(lon) * cosd(lat);
  const zg = sind(lat);

  const xe = xg;
  const ye = yg * cosd(ecl) - zg * sind(ecl);
  const ze = yg * sind(ecl) + zg * cosd(ecl);

  const ra = rev(atan2d(ye, xe));
  const dec = atan2d(ze, Math.sqrt(xe * xe + ye * ye));

  return { ra, dec, lonEcl: lon };
}

// Sun apparent ecliptic longitude (for elongation / phase), Schlyter
function sunLongitude(jd: number): number {
  const d = jd - 2451543.5;
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = rev(356.0470 + 0.9856002585 * d);
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

// Greenwich Mean Sidereal Time (hours) at a JD, Schlyter
function gmstHours(jd: number): number {
  const d = jd - 2451543.5;
  const ws = 282.9404 + 4.70935e-5 * d;
  const Ms = rev(356.0470 + 0.9856002585 * d);
  const Ls = rev(ws + Ms);
  const gmst0 = rev(Ls + 180) / 15; // hours
  const ut = ((jd + 0.5) - Math.floor(jd + 0.5)) * 24; // UT hours
  return gmst0 + ut;
}

// Moon altitude (deg) at a UTC instant for a location
function moonAltitude(jd: number, lat: number, lng: number): number {
  const { ra, dec } = moonPosition(jd);
  const lst = (gmstHours(jd) + lng / 15) * 15; // deg
  const ha = rev(lst - ra); // 0..360
  const haNorm = ha > 180 ? ha - 360 : ha;
  const alt = asind(
    sind(lat) * sind(dec) + cosd(lat) * cosd(dec) * cosd(haNorm),
  );
  return alt;
}

// ===========================================================================
// Rise / set / transit / underfoot by sampling the moon's altitude
// across the 24h UTC day. Returns minutes-of-day UTC (may exceed [0,1440)
// only at the crossing interpolation; we clamp reporting to the day).
// ===========================================================================
interface MoonEvents {
  riseMin: number | null;
  setMin: number | null;
  transitMin: number | null;   // overhead (max altitude)
  underfootMin: number | null; // anti-transit (min altitude)
}

const MOON_H0 = 0.125; // deg — standard geocentric moonrise/set altitude

function moonEvents(dateUTC: Date, lat: number, lng: number): MoonEvents {
  const dayStartJD = toJD(new Date(Date.UTC(
    dateUTC.getUTCFullYear(),
    dateUTC.getUTCMonth(),
    dateUTC.getUTCDate(),
  )));

  const stepMin = 5;
  const steps = (24 * 60) / stepMin; // 288

  let prevAlt = moonAltitude(dayStartJD, lat, lng);
  let prevMin = 0;

  let riseMin: number | null = null;
  let setMin: number | null = null;
  let maxAlt = prevAlt;
  let transitMin = 0;
  let minAlt = prevAlt;
  let underfootMin = 0;

  for (let s = 1; s <= steps; s++) {
    const min = s * stepMin;
    const jd = dayStartJD + min / 1440;
    const alt = moonAltitude(jd, lat, lng);

    // horizon crossings (relative to MOON_H0)
    const a0 = prevAlt - MOON_H0;
    const a1 = alt - MOON_H0;
    if (a0 <= 0 && a1 > 0 && riseMin === null) {
      // rising crossing — linear interpolate
      const frac = a0 / (a0 - a1);
      riseMin = prevMin + frac * stepMin;
    }
    if (a0 >= 0 && a1 < 0 && setMin === null) {
      const frac = a0 / (a0 - a1);
      setMin = prevMin + frac * stepMin;
    }

    if (alt > maxAlt) { maxAlt = alt; transitMin = min; }
    if (alt < minAlt) { minAlt = alt; underfootMin = min; }

    prevAlt = alt;
    prevMin = min;
  }

  // Transit is only meaningful if the moon actually gets above the horizon
  const transit = maxAlt > MOON_H0 ? transitMin : null;
  const underfoot = underfootMin >= 0 ? underfootMin : null;

  return {
    riseMin,
    setMin,
    transitMin: transit,
    underfootMin: underfoot,
  };
}

// ===========================================================================
// Moon phase from true elongation at local (date) noon-ish (use 0h UTC anchor)
// ===========================================================================
function moonPhaseName(age: number): string {
  // age in days since new moon (0..SYNODIC)
  if (age < 1.84566) return 'New Moon';
  if (age < 5.53699) return 'Waxing Crescent';
  if (age < 9.22831) return 'First Quarter';
  if (age < 12.91963) return 'Waxing Gibbous';
  if (age < 16.61096) return 'Full Moon';
  if (age < 20.30228) return 'Waning Gibbous';
  if (age < 23.99361) return 'Last Quarter';
  if (age < 27.68493) return 'Waning Crescent';
  return 'New Moon';
}

// ===========================================================================
// Solunar day rating — best near new & full moon, weakest at quarters.
// ===========================================================================
function solunarRating(age: number): { rating: string; score: number } {
  // distance (days) to nearest new (0 / SYNODIC) or full (SYNODIC/2)
  const half = SYNODIC / 2;
  const toNew = Math.min(age, SYNODIC - age);
  const toFull = Math.abs(age - half);
  const prox = Math.min(toNew, toFull);
  if (prox < 1.5) return { rating: 'excellent', score: 4 };
  if (prox < 3.0) return { rating: 'good', score: 3 };
  if (prox < 5.0) return { rating: 'fair', score: 2 };
  return { rating: 'poor', score: 1 };
}

serve((req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const url = new URL(req.url);
    const p = url.searchParams;

    const lat = parseFloat(p.get('lat') ?? '');
    const lng = parseFloat(p.get('lng') ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return errorResponse(req, 'lat and lng are required numeric params', 400);
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return errorResponse(req, 'lat must be -90..90, lng -180..180', 400);
    }

    // date param (YYYY-MM-DD), default today UTC
    const dateRaw = p.get('date');
    let dateUTC: Date;
    if (dateRaw) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
        return errorResponse(req, 'date must be YYYY-MM-DD', 400);
      }
      dateUTC = new Date(`${dateRaw}T00:00:00Z`);
      if (isNaN(dateUTC.getTime())) {
        return errorResponse(req, 'invalid date', 400);
      }
    } else {
      const now = new Date();
      dateUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    }
    const dateStr = dateUTC.toISOString().slice(0, 10);

    // --- MOON phase (evaluate at midday of the date for a stable daily value) ---
    const noonJD = toJD(dateUTC) + 0.5; // 12:00 UTC of the date
    const moonLon = moonPosition(noonJD).lonEcl;
    const sunLon = sunLongitude(noonJD);
    const elong = rev(moonLon - sunLon); // 0 at new, 180 at full
    const illum = (1 - cosd(elong)) / 2; // illuminated fraction 0..1
    const age = (elong / 360) * SYNODIC; // days since new
    // days to full: full when elong = 180
    const deltaToFull = rev(180 - elong);
    const daysToFull = deltaToFull / (360 / SYNODIC);

    const phase = moonPhaseName(age);
    const { rating, score } = solunarRating(age);

    // --- SUN ---
    const sun = noaaSun(dateUTC, lat, lng);
    const sunrise = sun.sunriseMin !== null ? isoFromMinutes(dateUTC, sun.sunriseMin) : null;
    const sunset = sun.sunsetMin !== null ? isoFromMinutes(dateUTC, sun.sunsetMin) : null;
    const solarNoon = isoFromMinutes(dateUTC, sun.solarNoonMin);
    // Shooting light: ~30 min before sunrise to ~30 min after sunset
    const shootingStart = sun.sunriseMin !== null ? isoFromMinutes(dateUTC, sun.sunriseMin - 30) : null;
    const shootingEnd = sun.sunsetMin !== null ? isoFromMinutes(dateUTC, sun.sunsetMin + 30) : null;

    // --- SOLUNAR windows ---
    const ev = moonEvents(dateUTC, lat, lng);
    const win = (center: number | null, halfWidthMin: number) =>
      center === null
        ? null
        : { start: isoFromMinutes(dateUTC, center - halfWidthMin), end: isoFromMinutes(dateUTC, center + halfWidthMin) };

    const major = [win(ev.transitMin, 60), win(ev.underfootMin, 60)].filter(Boolean);
    const minor = [win(ev.riseMin, 30), win(ev.setMin, 30)].filter(Boolean);

    return successResponse(req, {
      date: dateStr,
      lat,
      lng,
      moon: {
        phase,
        illum: Math.round(illum * 1000) / 10, // percent, 0.1 precision
        age: Math.round(age * 100) / 100,       // days since new
        days_to_full: Math.round(daysToFull * 100) / 100,
        // Rise/set instants for the UTC day (additive, 2026-07-17 — the TODAY
        // fitted block reads them; null when the moon doesn't cross that day).
        rise: ev.riseMin !== null ? isoFromMinutes(dateUTC, ev.riseMin) : null,
        set: ev.setMin !== null ? isoFromMinutes(dateUTC, ev.setMin) : null,
      },
      sun: {
        sunrise,
        sunset,
        shooting_light_start: shootingStart,
        shooting_light_end: shootingEnd,
        solar_noon: solarNoon,
      },
      solunar: {
        major,       // [{start,end}] centered on lunar transit + underfoot (±1h)
        minor,       // [{start,end}] centered on moonrise + moonset (±0.5h)
        rating,      // excellent | good | fair | poor (by moon phase)
        score,       // 1..4
      },
      note: 'All timestamps are ISO-8601 UTC (Z). Client localizes to spot timezone. Computed from astronomy math only — no database, no forecast.',
    });
  } catch (err) {
    return errorResponse(req, `unexpected error: ${err instanceof Error ? err.message : String(err)}`, 500);
  }
});
