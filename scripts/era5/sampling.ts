/**
 * sampling.ts — THE FROZEN ERA5 STATE-SAMPLING SCHEME (Amendment 1.3, Ruling 3a
 * / PLAN §10.3).
 *
 *   "Freeze and version the scheme. Document the point-selection rule, store the
 *    actual coordinates used per state, add a sampling_version column. If those
 *    points ever move, every historical number moves with them and the archive
 *    silently stops being comparable to itself — invisible for a year, then
 *    unfixable."
 *
 * This file IS the rule. It is deterministic, offline, and dependency-free: the
 * same 250 coordinates come out on every machine, every run, forever, as long as
 * SAMPLING_VERSION is 1 and the source geometry below is untouched.
 *
 * ── THE RULE (v1) ────────────────────────────────────────────────────────────
 *  1. GEOMETRY. src/data/atlas/usStates.geojson.ts — 51 features (50 states +
 *     DC), US Census TIGER lineage via PublicaMundi, [lon,lat], coordinates
 *     rounded to 2 decimals (~1.1 km). DC is not sampled; the 50 keys of
 *     supabase/functions/_shared/states.ts are the roster (same roster the board
 *     registry uses).
 *  2. PRINCIPAL RING. Of every ring in the feature, the one with the largest
 *     |shoelace area| is the principal ring. Rings whose bbox-center longitude
 *     lies more than 60° from the principal ring's bbox-center longitude are
 *     EXCLUDED from the sampling bbox. This is the antimeridian guard: Alaska's
 *     western Aleutians sit at +172°E and would otherwise stretch the bbox
 *     across the whole Pacific. 60° keeps the Hawaiian chain (spans ~5°) intact.
 *     Excluded rings still count for CONTAINMENT (step 5) — a point that lands
 *     on an Aleutian island is still in Alaska.
 *  3. BBOX. Union bounding box of the kept rings → (minLon,minLat,maxLon,maxLat),
 *     center (cx,cy), width w, height h.
 *  4. THE FIVE CANDIDATES, in this fixed order and no other:
 *        0  C   (cx,            cy           )
 *        1  NW  (cx - 0.25·w,   cy + 0.25·h  )
 *        2  NE  (cx + 0.25·w,   cy + 0.25·h  )
 *        3  SW  (cx - 0.25·w,   cy - 0.25·h  )
 *        4  SE  (cx + 0.25·w,   cy - 0.25·h  )
 *     ±0.25 of the bbox span puts the quadrant points at the centers of the four
 *     bbox quadrants — the widest fixed spread that still leaves every point a
 *     quarter-span from an edge, so a state of any shape gets four genuinely
 *     separated samples rather than four near-corner points that keep falling in
 *     the ocean.
 *  5. CONTAINMENT. Even-odd ray casting over ALL rings of the feature (holes
 *     flip parity, which is what even-odd is for). Identical arithmetic to
 *     src/pages/AtlasPage.tsx:83 `pointInState`, which is already proven at
 *     interactive rates on this exact geometry.
 *  6. REPAIR (deterministic). A candidate outside the polygon is replaced by the
 *     FIRST inside point found on a fixed elliptical lattice anchored at the
 *     candidate:
 *        for r = 1 … 60:
 *          for k = 0 … 8r-1:   θ = 2πk / (8r)
 *            test ( x + r·0.02·w·cos θ ,  y + r·0.02·h·sin θ )
 *     Ring order, then bearing order, then first hit. No randomness, no nearest-
 *     distance tie-break, nothing that can reorder between runs.
 *  7. TERMINAL FALLBACK. If 60 rings find nothing, the point becomes the
 *     principal ring's vertex nearest the candidate, moved 2% of the way toward
 *     the principal ring's bbox center. Recorded as resolution "fallback" so it
 *     is never mistaken for a pattern point. (v1 uses this zero times — see
 *     docs/ERA5-SAMPLING-SCHEME.md.)
 *  8. ROUNDING. Every resolved coordinate is rounded to 4 decimals (~11 m) and
 *     that rounded value is what is stored, what is sent to the API, and what is
 *     hashed. Float formatting can never drift the request URL.
 *  9. SCHEME HASH. djb2 over "state:idx:role:lon:lat" for all 250 points, in
 *     roster order. Written on every archive row's metadata and into
 *     era5_sampling_points. A mismatch is a hard stop, not a warning.
 *
 * ── WHAT LANDING ON WATER MEANS HERE (asked and answered honestly) ───────────
 * The containment test is NOT a land mask and is not trying to be one. The
 * variable is mean-sea-level pressure, a smooth synoptic field that ERA5 defines
 * everywhere on the globe, ocean included, at 0.25° (~28 km). A sample 5 km
 * offshore of Ocean City reports the same weather system as one 5 km inland; MSL
 * pressure has no coastline discontinuity the way 2 m temperature does. The
 * containment test exists for a different reason: so that a point called
 * "Maryland" is inside Maryland. It is a provenance constraint, not a physics
 * one.
 *
 * Two consequences follow, and both are accepted rather than papered over:
 *   • Inland water is not excluded. The simplified TIGER polygons do not cut out
 *     the Great Salt Lake, Lake Okeechobee, Michigan's share of the Great Lakes,
 *     or Chesapeake Bay, so a point may land on them. For MSL pressure this is
 *     immaterial (above).
 *   • The 2-decimal simplification means the boundary is accurate to ~1.1 km,
 *     while an ERA5 cell is ~28 km across. A point that the simplified polygon
 *     accepts but the true border rejects (or vice versa) is at worst 4% of a
 *     grid cell from where it should be, and in the overwhelming majority of
 *     cases resolves to the same cell either way. The scheme does not pretend to
 *     sub-cell precision.
 *
 * ── THE LAW OF THIS FILE ─────────────────────────────────────────────────────
 * DO NOT edit any constant above without bumping SAMPLING_VERSION and leaving
 * v1 intact and reachable. Editing v1 in place re-points 868,550 archive rows at
 * coordinates they were never measured at, and nothing in the data will say so.
 */

import { US_STATES_GEOJSON } from "../../src/data/atlas/usStates.geojson.ts";
import { STATE_CENTROIDS } from "../../supabase/functions/_shared/states.ts";

/** Bump this — never edit v1 in place — if any rule above changes. */
export const SAMPLING_VERSION = 1;

/** Points per state. Ruling 3a condition (a): five, averaged. Not a centroid. */
export const POINTS_PER_STATE = 5;

/** Fixed candidate roles, in the fixed order the rule prescribes. */
export const POINT_ROLES = ["C", "NW", "NE", "SW", "SE"] as const;
export type PointRole = (typeof POINT_ROLES)[number];

/** Provenance of the archive: the exact geometry the rule reads. */
export const GEOMETRY_SOURCE =
  "src/data/atlas/usStates.geojson.ts (US Census TIGER lineage via PublicaMundi, simplified to 2dp)";

export type SamplePoint = {
  state: string;
  idx: number; // 0..4, the fixed candidate order
  role: PointRole;
  lon: number; // 4dp, exactly as sent to the API
  lat: number; // 4dp, exactly as sent to the API
  resolution: "pattern" | "repaired" | "fallback";
  repair_rings: number; // 0 for "pattern"; the lattice ring that resolved it otherwise
};

// ─── Geometry primitives (dependency-free, mirrors AtlasPage.tsx:83) ──────────

type Ring = number[][]; // [[lon,lat], …]

function ringsOf(state: string): Ring[] {
  const f = US_STATES_GEOJSON.features.find((x) => x.properties.state === state);
  if (!f) throw new Error(`no geometry for ${state}`);
  const g = f.geometry;
  if (g.type === "Polygon") return g.coordinates as Ring[];
  return (g.coordinates as Ring[][]).flat();
}

/** Shoelace, absolute — ring orientation is not trusted in simplified sources. */
function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i, i++) {
    a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]);
  }
  return Math.abs(a / 2);
}

function bboxOf(rings: Ring[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rings) {
    for (const [x, y] of r) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

/** Even-odd ray cast over every ring. Holes flip parity — that is the point. */
function pointInRings(rings: Ring[], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

// ─── The rule ────────────────────────────────────────────────────────────────

/** Resolve one state's five points. Pure, deterministic, offline. */
export function resolveStatePoints(state: string): SamplePoint[] {
  const rings = ringsOf(state);

  // (2) principal ring + the 60° antimeridian guard
  let principal = rings[0];
  let bestArea = -1;
  for (const r of rings) {
    const a = ringArea(r);
    if (a > bestArea) {
      bestArea = a;
      principal = r;
    }
  }
  const pb = bboxOf([principal]);
  const pLon = (pb[0] + pb[2]) / 2;
  const kept = rings.filter((r) => {
    const b = bboxOf([r]);
    return Math.abs((b[0] + b[2]) / 2 - pLon) <= 60;
  });

  // (3) sampling bbox
  const [minX, minY, maxX, maxY] = bboxOf(kept);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const w = maxX - minX;
  const h = maxY - minY;

  // (4) the five candidates, fixed order
  const candidates: [number, number][] = [
    [cx, cy],
    [cx - 0.25 * w, cy + 0.25 * h],
    [cx + 0.25 * w, cy + 0.25 * h],
    [cx - 0.25 * w, cy - 0.25 * h],
    [cx + 0.25 * w, cy - 0.25 * h],
  ];

  return candidates.map(([x0, y0], idx): SamplePoint => {
    // (5) containment against ALL rings (excluded-from-bbox rings still count)
    if (pointInRings(rings, x0, y0)) {
      return {
        state, idx, role: POINT_ROLES[idx],
        lon: r4(x0), lat: r4(y0), resolution: "pattern", repair_rings: 0,
      };
    }

    // (6) deterministic elliptical lattice repair
    for (let r = 1; r <= 60; r++) {
      const rx = r * 0.02 * w;
      const ry = r * 0.02 * h;
      const k = 8 * r;
      for (let i = 0; i < k; i++) {
        const t = (2 * Math.PI * i) / k;
        const x = x0 + rx * Math.cos(t);
        const y = y0 + ry * Math.sin(t);
        if (pointInRings(rings, x, y)) {
          return {
            state, idx, role: POINT_ROLES[idx],
            lon: r4(x), lat: r4(y), resolution: "repaired", repair_rings: r,
          };
        }
      }
    }

    // (7) terminal fallback — nearest principal-ring vertex, nudged inward
    let bx = principal[0][0], by = principal[0][1], bd = Infinity;
    for (const [vx, vy] of principal) {
      const d = (vx - x0) ** 2 + (vy - y0) ** 2;
      if (d < bd) { bd = d; bx = vx; by = vy; }
    }
    const pcx = (pb[0] + pb[2]) / 2, pcy = (pb[1] + pb[3]) / 2;
    return {
      state, idx, role: POINT_ROLES[idx],
      lon: r4(bx + 0.02 * (pcx - bx)), lat: r4(by + 0.02 * (pcy - by)),
      resolution: "fallback", repair_rings: 60,
    };
  });
}

/**
 * The rule's containment test, exposed so an auditor can re-run it on a
 * coordinate the rule did not produce — e.g. the ERA5 grid-cell centre
 * Open-Meteo snapped a request to. Same arithmetic, no special cases.
 */
export function isInState(state: string, lon: number, lat: number): boolean {
  return pointInRings(ringsOf(state), lon, lat);
}

/** The 50-state roster, in the same order every other subsystem uses. */
export const ERA5_STATES: string[] = Object.keys(STATE_CENTROIDS);

/** Every point for every state, roster order then candidate order. */
export function resolveAllPoints(): SamplePoint[] {
  return ERA5_STATES.flatMap((s) => resolveStatePoints(s));
}

/**
 * (9) The scheme hash — djb2 over the resolved coordinates, the same hash shape
 * registry.ts:137 uses for layout_version. Stored on every row. If a future run
 * computes a different hash, the points moved and the archive is no longer
 * comparable to itself: stop, do not write.
 */
export function schemeHash(points: SamplePoint[] = resolveAllPoints()): number {
  const sig = points
    .map((p) => `${p.state}:${p.idx}:${p.role}:${p.lon}:${p.lat}`)
    .join("|");
  let h = 5381;
  for (let i = 0; i < sig.length; i++) h = ((h * 33) ^ sig.charCodeAt(i)) >>> 0;
  return h % 2147483647;
}

/** Open-Meteo takes comma-joined parallel lists; order defines the response order. */
export function coordParams(points: SamplePoint[]): { latitude: string; longitude: string } {
  return {
    latitude: points.map((p) => p.lat).join(","),
    longitude: points.map((p) => p.lon).join(","),
  };
}
