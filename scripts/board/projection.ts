/**
 * projection.ts — THE BOARD's canonical CONUS projector (spine §1.3).
 *
 * The one place the Albers equal-area transform + CONUS-fit lives. Rung 1 baked
 * this inline in bake-uri.ts; the spine makes it shared and precomputed-once:
 * `board_instruments.albers_x/y` are this function's output at the canonical
 * 975×610 frame, and the client rescales linearly (x' = x·W/975). Standard
 * parallels 29.5/45.5, origin −96/37.5, fit into 975×610 with padX 34 /
 * padTop 70 / padBot 40 (top pad leaves room for the AO needle at y≈28).
 *
 * REGRESSION ANCHOR (spine §1.3, uri-2021.json): project(31.054, −97.563) — the
 * Texas centroid — must equal (461.1, 442.9). proj_version = 1. Bump PROJ_VERSION
 * if any constant here changes; every stored albers coord is stamped with it.
 */

export const WIDTH = 975;
export const HEIGHT = 610;
export const PROJ_VERSION = 1;

const D2R = Math.PI / 180;
const PHI1 = 29.5 * D2R, PHI2 = 45.5 * D2R, PHI0 = 37.5 * D2R, LAM0 = -96 * D2R;
const N = (Math.sin(PHI1) + Math.sin(PHI2)) / 2;
const C = Math.cos(PHI1) ** 2 + 2 * N * Math.sin(PHI1);
const RHO0 = Math.sqrt(C - 2 * N * Math.sin(PHI0)) / N;

function albersRaw(lat: number, lng: number): { x: number; y: number } {
  const phi = lat * D2R, lam = lng * D2R;
  const rho = Math.sqrt(C - 2 * N * Math.sin(phi)) / N;
  const theta = N * (lam - LAM0);
  return { x: rho * Math.sin(theta), y: RHO0 - rho * Math.cos(theta) };
}

/** Build the deterministic lat/lng → 975×610 projector by fitting the sampled
 *  CONUS extent into the frame (aspect-preserved), so framing is stable
 *  regardless of which instruments are present. */
function buildProjector(): (lat: number, lng: number) => { x: number; y: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let lat = 24; lat <= 49.5; lat += 0.5)
    for (let lng = -125; lng <= -66.5; lng += 0.5) {
      const p = albersRaw(lat, lng);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  const padX = 34, padTop = 70, padBot = 40;
  const availW = WIDTH - 2 * padX, availH = HEIGHT - padTop - padBot;
  const scale = Math.min(availW / (maxX - minX), availH / (maxY - minY));
  const drawW = (maxX - minX) * scale, drawH = (maxY - minY) * scale;
  const offX = padX + (availW - drawW) / 2;
  const offY = padTop + (availH - drawH) / 2;
  return (lat: number, lng: number) => {
    const p = albersRaw(lat, lng);
    return {
      x: Math.round((offX + (p.x - minX) * scale) * 10) / 10,
      y: Math.round((offY + (maxY - p.y) * scale) * 10) / 10,
    };
  };
}

const _project = buildProjector();

/** Project a lat/lng to the canonical 975×610 frame (rounded to 0.1). */
export function project(lat: number, lng: number): { x: number; y: number } {
  return _project(lat, lng);
}
