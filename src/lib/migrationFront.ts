import type { Feature, LineString } from 'geojson';

// State centroids for latitude-based analysis
const STATE_LATS: Record<string, number> = {
  AL:32.8,AK:64.2,AZ:34.0,AR:34.8,CA:36.8,CO:39.1,CT:41.6,DE:39.0,FL:27.8,GA:32.2,
  HI:19.9,ID:44.1,IL:40.6,IN:40.3,IA:42.0,KS:38.5,KY:37.7,LA:30.5,ME:45.4,MD:39.0,
  MA:42.4,MI:44.3,MN:46.4,MS:32.3,MO:38.6,MT:46.8,NE:41.1,NV:38.8,NH:43.5,NJ:40.1,
  NM:34.2,NY:43.0,NC:35.8,ND:47.5,OH:40.4,OK:35.0,OR:43.8,PA:41.2,RI:41.6,SC:34.0,
  SD:43.9,TN:35.5,TX:31.0,UT:39.3,VT:44.6,VA:37.8,WA:47.8,WV:38.6,WI:43.8,WY:43.1,
};

interface SightingDensity {
  state: string;
  count: number;
}

/**
 * Estimate the migration front latitude from sighting density data.
 * The "front" is where sighting activity drops off significantly as you go north (fall)
 * or south (spring).
 *
 * Returns a GeoJSON LineString spanning the US at the estimated front latitude,
 * or null if insufficient data.
 */
export function estimateMigrationFront(
  sightings: SightingDensity[],
  season: 'fall' | 'spring'
): Feature<LineString> | null {
  if (sightings.length < 5) return null;

  // Group states by latitude bands (5-degree buckets)
  const bands: Map<number, number> = new Map();
  for (const s of sightings) {
    const lat = STATE_LATS[s.state];
    if (!lat) continue;
    const band = Math.floor(lat / 5) * 5;
    bands.set(band, (bands.get(band) || 0) + s.count);
  }

  // Sort bands by latitude
  const sortedBands = [...bands.entries()].sort((a, b) => a[0] - b[0]);

  if (sortedBands.length < 2) return null;

  // Find the front: in fall, scan from north to south and find where activity starts
  // In spring, scan from south to north
  let frontLat: number;

  if (season === 'fall') {
    // Fall: birds moving south. Front = northernmost band with significant activity
    const maxCount = Math.max(...sortedBands.map(b => b[1]));
    const threshold = maxCount * 0.2;
    // Scan from north
    let found = sortedBands[sortedBands.length - 1][0];
    for (let i = sortedBands.length - 1; i >= 0; i--) {
      if (sortedBands[i][1] >= threshold) {
        found = sortedBands[i][0] + 2.5; // center of band
        break;
      }
    }
    frontLat = found;
  } else {
    // Spring: birds moving north. Front = northernmost band with activity
    const maxCount = Math.max(...sortedBands.map(b => b[1]));
    const threshold = maxCount * 0.2;
    let found = sortedBands[0][0];
    for (let i = sortedBands.length - 1; i >= 0; i--) {
      if (sortedBands[i][1] >= threshold) {
        found = sortedBands[i][0] + 2.5;
        break;
      }
    }
    frontLat = found;
  }

  // Create a LineString spanning the continental US at the front latitude
  // Slight wave for visual interest (not perfectly straight)
  const points: [number, number][] = [];
  for (let lng = -125; lng <= -65; lng += 5) {
    const wave = Math.sin(lng * 0.1) * 1.5; // subtle wave
    points.push([lng, frontLat + wave]);
  }

  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: points },
    properties: {
      latitude: frontLat,
      season,
      label: `Migration front ~ ${frontLat.toFixed(0)}°N`,
    },
  };
}

/**
 * Determine if it's fall or spring migration season
 */
export function getMigrationSeason(): 'fall' | 'spring' {
  const month = new Date().getMonth(); // 0-indexed
  // Fall: Aug-Jan (7-0), Spring: Feb-Jul (1-6)
  return (month >= 7 || month <= 0) ? 'fall' : 'spring';
}
