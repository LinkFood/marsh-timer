/**
 * stateGeo.ts — the one copy of the per-state polygon machinery.
 *
 * Rings come from src/data/atlas/stateShapesAlbers.ts (51 states + DC, AK/HI in
 * their conventional insets), already in THE BOARD's 975x610 Albers space, so
 * anything drawn here registers with conusBorders and with the film ground.
 *
 * Built once at module load: an SVG `d` string, a bbox, and a center per state.
 * Hit-testing is even-odd point-in-polygon with a bbox pre-filter — proven at
 * interactive rates on /atlas over this exact ring set, which is why it is
 * lifted here rather than reinvented for the front door's rarity map.
 *
 * NOTE ON REGISTRATION: these rings and board_instruments.albers_x/y were baked
 * with different Albers fits and do NOT register with each other (31 of 50 dots
 * fall outside their own state's bbox). That defect only bites when placing
 * POINTS. Everything in this module joins by state abbreviation, so it is
 * immune — do not "fix" the dots on its account.
 */

import { STATE_SHAPES, ATLAS_PROJECTION } from "@/data/atlas/stateShapesAlbers";

export const STATE_VIEW = { width: ATLAS_PROJECTION.width, height: ATLAS_PROJECTION.height } as const;

export interface StateGeo {
  abbr: string;
  d: string; // SVG path
  rings: readonly (readonly number[])[];
  bbox: [number, number, number, number]; // minX, minY, maxX, maxY
  cx: number;
  cy: number;
}

export const STATE_GEO: Record<string, StateGeo> = {};
for (const [abbr, rings] of Object.entries(STATE_SHAPES)) {
  let d = "";
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    d += `M${ring[0]} ${ring[1]}`;
    for (let i = 2; i < ring.length; i += 2) d += `L${ring[i]} ${ring[i + 1]}`;
    d += "Z";
    for (let i = 0; i < ring.length; i += 2) {
      if (ring[i] < minX) minX = ring[i];
      if (ring[i] > maxX) maxX = ring[i];
      if (ring[i + 1] < minY) minY = ring[i + 1];
      if (ring[i + 1] > maxY) maxY = ring[i + 1];
    }
  }
  STATE_GEO[abbr] = {
    abbr,
    d,
    rings,
    bbox: [minX, minY, maxX, maxY],
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

/** Every state abbr the ground can draw, in the ring file's order. */
export const STATE_GEO_LIST: StateGeo[] = Object.values(STATE_GEO);

/** Even-odd point-in-polygon across all of a state's rings. */
export function pointInState(geo: StateGeo, x: number, y: number): boolean {
  const [minX, minY, maxX, maxY] = geo.bbox;
  if (x < minX || x > maxX || y < minY || y > maxY) return false;
  let inside = false;
  for (const ring of geo.rings) {
    const n = ring.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const xi = ring[i], yi = ring[i + 1];
      const xj = ring[j], yj = ring[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Which state a projection-space point lands in; falls back to the nearest
 *  state center within `near` projection px (small-state tap forgiveness). */
export function hitState(x: number, y: number, near: number): string | null {
  for (const geo of STATE_GEO_LIST) {
    if (pointInState(geo, x, y)) return geo.abbr;
  }
  let best: string | null = null;
  let bestD = near;
  for (const geo of STATE_GEO_LIST) {
    const d = Math.hypot(geo.cx - x, geo.cy - y);
    if (d < bestD) {
      bestD = d;
      best = geo.abbr;
    }
  }
  return best;
}
