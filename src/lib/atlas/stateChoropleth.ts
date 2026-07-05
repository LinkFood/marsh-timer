// stateChoropleth — the "boxes shaded by NOW" module for the Atlas map.
//
// Pure TS, no JSX. AtlasPage imports these helpers to paint a MapLibre states
// fill layer by each state's current weather anomaly (z-score vs that state's
// own GHCN day-of-year history), served READ-ONLY by hunt-atlas-anomaly.
//
// DESIGN — Apple x Palantir, CALM by construction (Vision "NESTED BOXES"):
//   Most states sit near-neutral and recede into the (light, positron) basemap.
//   Only anomalous states light up. Encoding is a DIVERGING ramp:
//     - sign of z  -> hue    (cold anomaly = steel blue, warm anomaly = brick red)
//     - |z|        -> darkness + saturation (quiet = light/gray, lit = deep/colored)
//   The neutral center is intentionally a desaturated gray dead-zone so a state
//   doing nothing shows nothing. This is a diverging choropleth, not a
//   categorical palette — a gray, low-contrast midpoint is the whole point.
//
// The palette was chosen against the dataviz skill's diverging discipline:
// two opposite hues + a neutral gray midpoint, lightness monotonic from each
// pole to the light center. Validated vs the positron light surface (#fcfcfb).

import { SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Map of state abbreviation -> current anomaly z-score. */
export type ZByState = Record<string, number>;

/** One state row as returned by hunt-atlas-anomaly. */
export interface AnomalyStateRow {
  state: string;
  name: string;
  lat: number;
  lng: number;
  resolution: 'state';
  value: number | null;
  as_of_year: number | null;
  baseline_mean: number | null;
  baseline_std: number | null;
  z: number | null;
  n_years: number;
}

export interface AnomalyResponse {
  metric: string;
  month_day: string;
  resolution: string;
  source: string;
  baseline: string;
  min_years: number;
  generated_at: string;
  count: number;
  count_with_data: number;
  states: AnomalyStateRow[];
}

export type ChoroplethTheme = 'light' | 'dark';

// A MapLibre expression is an untyped JSON array; keep it loose so callers can
// hand it straight to layer paint without wrestling the maplibre-gl types.
type MapLibreExpression = unknown[];

// ---------------------------------------------------------------------------
// (1) Fetch — READ-ONLY GET against hunt-atlas-anomaly
// ---------------------------------------------------------------------------

const APIKEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/**
 * Fetch the full anomaly response for a given day (default: today, server-side).
 * READ-ONLY. Sends both Authorization + apikey (the Supabase gateway rewrites
 * Authorization to an ES256 JWT; apikey passes through unmodified).
 *
 * @param date  optional YYYY-MM-DD | MM-DD (server only uses month-day)
 * @param signal optional AbortSignal for cancellation
 */
export async function fetchStateAnomalyResponse(
  date?: string,
  signal?: AbortSignal,
): Promise<AnomalyResponse> {
  if (!SUPABASE_FUNCTIONS_URL) {
    throw new Error('SUPABASE_FUNCTIONS_URL is empty — Supabase env not configured.');
  }
  const url = new URL(`${SUPABASE_FUNCTIONS_URL}/hunt-atlas-anomaly`);
  if (date) url.searchParams.set('date', date);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (APIKEY) {
    headers.apikey = APIKEY;
    headers.Authorization = `Bearer ${APIKEY}`;
  }

  const res = await fetch(url.toString(), { method: 'GET', headers, signal });
  if (!res.ok) {
    throw new Error(`hunt-atlas-anomaly ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const json = (await res.json()) as AnomalyResponse;
  if (!Array.isArray(json?.states)) {
    throw new Error('hunt-atlas-anomaly returned no states array.');
  }
  return json;
}

/**
 * Convenience: fetch and reduce to a { [stateAbbr]: z } map, dropping states
 * whose baseline was too thin to score (z === null).
 */
export async function fetchStateAnomaly(
  date?: string,
  signal?: AbortSignal,
): Promise<ZByState> {
  const json = await fetchStateAnomalyResponse(date, signal);
  const out: ZByState = {};
  for (const s of json.states) {
    if (s.z !== null && Number.isFinite(s.z)) out[s.state] = s.z;
  }
  return out;
}

// ---------------------------------------------------------------------------
// (2) The CALM diverging palette
// ---------------------------------------------------------------------------

// Anchor stops keyed on z. Lightest/most-neutral at the center (z=0) so quiet
// states recede; darkening + gaining hue toward each pole. |z| is clamped to
// Z_CLAMP so a freak outlier can't blow past the deepest tone.
export const Z_CLAMP = 3;

interface Anchor {
  z: number;
  hex: string;
}

// LIGHT surface (positron basemap). Cold = steel blue, warm = brick red.
const LIGHT_ANCHORS: Anchor[] = [
  { z: -3, hex: '#4f7fb5' }, // deep muted steel blue  — very cold for here
  { z: -2, hex: '#94b2d6' }, // muted blue
  { z: -1, hex: '#cfdced' }, // faint cool wash
  { z: 0, hex: '#e9e7e2' }, //  neutral warm-gray — QUIET (blends into positron)
  { z: 1, hex: '#ecd4cb' }, // faint warm wash
  { z: 2, hex: '#d69277' }, // muted terracotta
  { z: 3, hex: '#c25a45' }, // deep muted brick red    — very warm for here
];

// DARK surface (#1a1a19), if the map ever renders on a dark basemap.
const DARK_ANCHORS: Anchor[] = [
  { z: -3, hex: '#5a93cf' },
  { z: -2, hex: '#3f6a95' },
  { z: -1, hex: '#33414f' },
  { z: 0, hex: '#2b2b29' }, //  quiet — near the dark surface
  { z: 1, hex: '#45372f' },
  { z: 2, hex: '#9a5f4a' },
  { z: 3, hex: '#d07655' },
];

/** Neutral "quiet"/no-data fill per theme (the z=0 anchor). */
export const QUIET_COLOR: Record<ChoroplethTheme, string> = {
  light: '#e9e7e2',
  dark: '#2b2b29',
};

function anchorsFor(theme: ChoroplethTheme): Anchor[] {
  return theme === 'dark' ? DARK_ANCHORS : LIGHT_ANCHORS;
}

// --- sRGB hex <-> rgb helpers + linear interpolation between anchors --------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Map a z-score to a hex color on the calm diverging ramp (linear sRGB
 * interpolation between the two bracketing anchors). z is clamped to ±Z_CLAMP.
 */
export function colorForZ(z: number, theme: ChoroplethTheme = 'light'): string {
  const anchors = anchorsFor(theme);
  if (!Number.isFinite(z)) return QUIET_COLOR[theme];
  const zc = Math.max(-Z_CLAMP, Math.min(Z_CLAMP, z));

  // Find the bracketing anchor pair.
  let lo = anchors[0];
  let hi = anchors[anchors.length - 1];
  for (let i = 0; i < anchors.length - 1; i++) {
    if (zc >= anchors[i].z && zc <= anchors[i + 1].z) {
      lo = anchors[i];
      hi = anchors[i + 1];
      break;
    }
  }
  const span = hi.z - lo.z || 1;
  const t = (zc - lo.z) / span;
  const [r1, g1, b1] = hexToRgb(lo.hex);
  const [r2, g2, b2] = hexToRgb(hi.hex);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

// ---------------------------------------------------------------------------
// (3) MapLibre paint builders — keyed on properties.<stateProp>
// ---------------------------------------------------------------------------

export interface PaintOptions {
  /** geojson feature property holding the 2-letter abbr. Default 'state'. */
  stateProp?: string;
  /** which surface the fill renders on. Default 'light' (positron). */
  theme?: ChoroplethTheme;
  /**
   * |z| at which a state is considered "lit". Below this it stays quiet.
   * Only affects opacity, not hue. Default 1.5.
   */
  litThreshold?: number;
  /** opacity floor for quiet / no-data states. Default 0.32. */
  quietOpacity?: number;
  /** opacity ceiling for the most anomalous states. Default 0.85. */
  litOpacity?: number;
}

/**
 * Build a MapLibre `match` expression that maps each state's abbr (read from
 * properties.<stateProp>) to its diverging color. States absent from zByState
 * (no data / thin baseline) fall through to the neutral QUIET color, so the
 * default view stays calm — only lit boxes stand out.
 *
 * Returns the paint object: { 'fill-color': <expression> }.
 * Merge with buildFillOpacity() (or spread both) onto the layer's paint.
 */
export function buildFillPaint(
  zByState: ZByState,
  opts: PaintOptions = {},
): { 'fill-color': MapLibreExpression } {
  const stateProp = opts.stateProp ?? 'state';
  const theme = opts.theme ?? 'light';

  const cases: (string | MapLibreExpression)[] = [];
  for (const [abbr, z] of Object.entries(zByState)) {
    cases.push(abbr, colorForZ(z, theme));
  }

  // ['match', ['get', stateProp], 'VA', '#..', 'MD', '#..', ..., <fallback>]
  const expr: MapLibreExpression = ['match', ['get', stateProp], ...cases, QUIET_COLOR[theme]];
  return { 'fill-color': expr };
}

/**
 * Build a subtle diverging fill-OPACITY expression: quiet/no-data states sit at
 * a low floor and nearly vanish into the basemap; opacity rises with |z| so the
 * anomalous boxes read as "lit". This is what makes the map calm — the color
 * ramp says which direction, the opacity says how loud.
 *
 * Returns the expression to assign to the layer's 'fill-opacity'.
 */
export function buildFillOpacity(
  zByState: ZByState,
  opts: PaintOptions = {},
): MapLibreExpression {
  const stateProp = opts.stateProp ?? 'state';
  const quiet = opts.quietOpacity ?? 0.32;
  const lit = opts.litOpacity ?? 0.85;
  const litThreshold = opts.litThreshold ?? 1.5;

  const cases: (string | number)[] = [];
  for (const [abbr, z] of Object.entries(zByState)) {
    const mag = Math.min(Z_CLAMP, Math.abs(z));
    // Below the lit threshold: hold at the quiet floor (truly calm).
    // At/above: ramp quiet -> lit across [litThreshold, Z_CLAMP].
    let o: number;
    if (mag <= litThreshold) {
      o = quiet;
    } else {
      const t = (mag - litThreshold) / (Z_CLAMP - litThreshold || 1);
      o = quiet + (lit - quiet) * Math.min(1, t);
    }
    cases.push(abbr, Math.round(o * 1000) / 1000);
  }

  return ['match', ['get', stateProp], ...cases, quiet];
}

/**
 * Convenience: the full paint object (color + opacity + a hairline outline),
 * ready to spread onto a fill layer's `paint`.
 */
export function buildChoroplethPaint(
  zByState: ZByState,
  opts: PaintOptions = {},
): Record<string, unknown> {
  const theme = opts.theme ?? 'light';
  return {
    ...buildFillPaint(zByState, opts),
    'fill-opacity': buildFillOpacity(zByState, opts),
    // Hairline seam between boxes — recessive, theme-aware.
    'fill-outline-color': theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(11,11,11,0.10)',
  };
}
