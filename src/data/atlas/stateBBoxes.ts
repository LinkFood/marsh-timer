/**
 * stateBBoxes.ts — per-state geographic bounding boxes + full names, derived
 * at module load from the committed usStates.geojson polygons (US Census
 * TIGER lineage). Zero runtime fetches, zero new deps.
 *
 * Purpose: the Atlas tile grid is abbreviation BOXES, not geography. When the
 * Sonar Ring places a real storm-event lat/lng inside a descended tile, we
 * map the coordinate proportionally into the tile via the state's bbox
 * (plain equirectangular normalization — the box IS the map at this
 * altitude). This is deliberately approximate and the UI labels it as such:
 * the dossier is state-level; the ring is a located memory placed
 * proportionally.
 *
 * Alaska gotcha: the Aleutians cross the antimeridian; positive longitudes
 * are normalized to lng-360 so AK's bbox doesn't span the whole globe.
 */
import { US_STATES_GEOJSON } from './usStates.geojson';

/** [minLng, minLat, maxLng, maxLat] per USPS abbreviation. */
export const STATE_BBOXES: Record<string, [number, number, number, number]> = {};

/** Full state name per USPS abbreviation ("PA" → "Pennsylvania"). */
export const STATE_NAMES: Record<string, string> = {};

for (const feature of US_STATES_GEOJSON.features) {
  const abbr = feature.properties.state;
  STATE_NAMES[abbr] = feature.properties.name;

  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const rings =
    feature.geometry.type === 'Polygon'
      ? feature.geometry.coordinates
      : feature.geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [rawLng, lat] of ring) {
      const lng = abbr === 'AK' && rawLng > 0 ? rawLng - 360 : rawLng;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  STATE_BBOXES[abbr] = [minLng, minLat, maxLng, maxLat];
}

/**
 * Project a lat/lng proportionally into a tile box. Returns coordinates in
 * the tile's own units, clamped to sit visibly inside the box (6%–94%).
 * Returns null when the state has no bbox or the point is non-finite.
 */
export function projectToTile(
  abbr: string,
  lat: number,
  lng: number,
  tileX: number,
  tileY: number,
  tileSize: number,
): { x: number; y: number } | null {
  const bbox = STATE_BBOXES[abbr];
  if (!bbox || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const spanLng = maxLng - minLng;
  const spanLat = maxLat - minLat;
  if (spanLng <= 0 || spanLat <= 0) return null;
  const nLng = abbr === 'AK' && lng > 0 ? lng - 360 : lng;
  const clamp = (v: number) => Math.min(0.94, Math.max(0.06, v));
  const fx = clamp((nLng - minLng) / spanLng);
  const fy = clamp((maxLat - lat) / spanLat); // lat increases upward; SVG y increases downward
  return { x: tileX + fx * tileSize, y: tileY + fy * tileSize };
}
