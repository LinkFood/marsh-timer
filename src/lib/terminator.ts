import type { Feature, Polygon } from 'geojson';

/** Day of year (1-365) */
function getDayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

/** Solar declination in radians using simplified formula */
function getSolarDeclination(date: Date): number {
  const dayOfYear = getDayOfYear(date);
  // Approximate declination: max +23.44 at summer solstice, min -23.44 at winter solstice
  const declDeg = -23.44 * Math.cos((2 * Math.PI * (dayOfYear + 10)) / 365);
  return declDeg * (Math.PI / 180);
}

/** Subsolar longitude based on UTC time */
function getSubSolarLng(date: Date): number {
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  // At UTC noon (12:00), the sun is at longitude 0. Each hour = 15 degrees west.
  return (12 - utcHours) * 15;
}

/** Normalize longitude to [-180, 180] */
function normalizeLng(lng: number): number {
  return ((lng + 180) % 360 + 360) % 360 - 180;
}

/**
 * Calculate the terminator (night/day boundary) as a GeoJSON polygon covering the dark side of Earth.
 * Pure trigonometry — no external dependencies.
 */
export function calculateTerminator(date: Date): Feature<Polygon> {
  const decRad = getSolarDeclination(date);
  const subSolarLng = getSubSolarLng(date);

  // Sunset side: for each latitude, find the longitude where sun hits the horizon
  // cos(hourAngle) = -tan(lat) * tan(declination)
  const sunsetPoints: [number, number][] = [];
  for (let lat = -90; lat <= 90; lat += 1) {
    const latRad = lat * (Math.PI / 180);
    const cosHA = -Math.tan(latRad) * Math.tan(decRad);
    let lng: number;
    if (cosHA <= -1) {
      // Polar day — sun never sets. Push to the dark side (opposite of subsolar).
      lng = subSolarLng + 180;
    } else if (cosHA >= 1) {
      // Polar night — sun never rises. Push to the lit side (subsolar).
      lng = subSolarLng;
    } else {
      lng = subSolarLng + Math.acos(cosHA) * (180 / Math.PI);
    }
    sunsetPoints.push([normalizeLng(lng), lat]);
  }

  // Sunrise side (mirror): go back from +90 to -90
  const sunrisePoints: [number, number][] = [];
  for (let lat = 90; lat >= -90; lat -= 1) {
    const latRad = lat * (Math.PI / 180);
    const cosHA = -Math.tan(latRad) * Math.tan(decRad);
    let lng: number;
    if (cosHA <= -1) {
      lng = subSolarLng - 180;
    } else if (cosHA >= 1) {
      lng = subSolarLng - 360;
    } else {
      lng = subSolarLng - Math.acos(cosHA) * (180 / Math.PI);
    }
    sunrisePoints.push([normalizeLng(lng), lat]);
  }

  const ring = [...sunsetPoints, ...sunrisePoints, sunsetPoints[0]];

  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {},
  };
}

/**
 * Golden hour band: ~6-degree band around BOTH edges of the terminator (sunrise + sunset).
 * Computed as the area between two offset terminators (solar altitude -3 to +3 degrees).
 * Returns a MultiPolygon with two bands — one on each edge of the day/night boundary.
 */
export function calculateGoldenHour(date: Date): Feature {
  const decRad = getSolarDeclination(date);
  const subSolarLng = getSubSolarLng(date);
  const offsetRad = 3 * (Math.PI / 180); // 3 degrees of solar altitude

  /** Compute hour angle longitude for a given solar altitude offset and latitude */
  function getHALng(latRad: number, altOffset: number, side: 1 | -1): number {
    const cosLat = Math.cos(latRad);
    if (Math.abs(cosLat) < 0.001) return normalizeLng(subSolarLng + 180);
    const cosHA = (Math.sin(altOffset) - Math.sin(latRad) * Math.sin(decRad)) / (cosLat * Math.cos(decRad));
    if (cosHA <= -1) return normalizeLng(subSolarLng + 180);
    if (cosHA >= 1) return normalizeLng(subSolarLng);
    return normalizeLng(subSolarLng + side * Math.acos(cosHA) * (180 / Math.PI));
  }

  // Build two rings: one for sunset edge, one for sunrise edge
  const rings: [number, number][][] = [];

  for (const side of [1, -1] as const) {
    // Outer edge: 3 degrees into night (altitude = -3)
    const outer: [number, number][] = [];
    for (let lat = -90; lat <= 90; lat += 1) {
      outer.push([getHALng(lat * (Math.PI / 180), -offsetRad, side), lat]);
    }
    // Inner edge: 3 degrees into day (altitude = +3), reversed direction to close polygon
    const inner: [number, number][] = [];
    for (let lat = 90; lat >= -90; lat -= 1) {
      inner.push([getHALng(lat * (Math.PI / 180), offsetRad, side), lat]);
    }
    const ring = [...outer, ...inner, outer[0]];
    rings.push(ring);
  }

  return {
    type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: rings.map(r => [r]) },
    properties: {},
  };
}
