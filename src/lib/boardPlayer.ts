/**
 * boardPlayer.ts — the hand-rolled canvas engine behind THE BOARD's first film
 * (docs/THE-WEEK.md PARK LIST → THE BOARD / THE SENTRY).
 *
 * A detective's evidence board come alive: dark ground, embers that swell with
 * how deep a reading sits in its own historical tail, strings that tighten as a
 * fusion forms, one bloom that lands like a gut punch, strings etched permanent
 * after. No dependencies — just Canvas2D, a projection transform, and linear
 * interpolation eased per frame.
 *
 * All drawing happens in the film's projection space (975x610 by contract); a
 * single setTransform folds in devicePixelRatio and the fit-to-viewport scale,
 * so the composition is identical on a phone and a desktop and the baked
 * CONUS ground (src/data/board/conusBorders.ts, same projection) registers with
 * every dot. Sizes below are projection-space units.
 */

import { CONUS_BORDERS } from "@/data/board/conusBorders";

// ── The data contract (mirrors /board/uri-2021.json) ──────────────────────────

export interface BoardDatum {
  v: number | null;
  pct: number | null; // 0..1 tail depth (1 = deepest); null = no data that day
}
export interface BoardDot {
  id: string;
  label: string;
  sublabel?: string;
  kind: "needle" | "state-temp" | "buoy-pressure" | "tide-surge" | "tide-setdown" | string;
  /** Which tail is deeper (live one-day films set this; baked story films omit
   *  it and keep the classic teal→gold ramp). Temp dots tint by it: amber for
   *  high, ice-blue for low — hue shift only, same luminance discipline. */
  side?: "low" | "high" | null;
  x: number;
  y: number;
  series: Record<string, BoardDatum>;
}
export interface BoardString {
  from: string;
  to: string;
  receipt: string;
  activation: Record<string, number>;
}
export interface BoardBloom {
  date: string;
  x: number;
  y: number;
  label: string;
  anchor?: string;
}
export interface BoardBeat {
  date: string;
  line: string;
}
export interface BoardFilm {
  story: string;
  title: string;
  subtitle: string;
  window: [string, string];
  projection: { width: number; height: number };
  dots: BoardDot[];
  strings: BoardString[];
  blooms: BoardBloom[];
  beats: BoardBeat[];
}

// ── The compiled model (dense arrays aligned to a master day axis) ────────────

interface DotTrack {
  dot: BoardDot;
  pct: number[]; // resolved 0..1 per master day
  v: number[]; // resolved value per master day
  dim: boolean[]; // true where the source said "no data" (null)
}
interface StringTrack {
  str: BoardString;
  from: BoardDot | null;
  to: BoardDot | null;
  act: number[]; // resolved 0..1 activation per master day
  peak: number[]; // running max activation up to and including each day
}
interface BloomMark {
  bloom: BoardBloom;
  anchor: BoardDot | null;
  index: number; // fractional master-day index
}
export interface BoardModel {
  film: BoardFilm;
  days: string[]; // master day axis (ISO), sorted unique
  epochs: number[]; // ms per master day
  dots: DotTrack[];
  strings: StringTrack[];
  blooms: BloomMark[];
  beatIndex: { beat: BoardBeat; index: number }[];
  firstBloomIndex: number; // earliest bloom fractional index, or Infinity
}

const BLOOM_DAYS = 2.5; // ~2s of bloom at 0.8s/day
const BEAT_FADE_DAYS = 0.55;

function toEpoch(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

/** Fractional position of an arbitrary ISO date on the master day axis. */
function dateToIndex(days: string[], epochs: number[], iso: string): number {
  const t = toEpoch(iso);
  if (t <= epochs[0]) return 0;
  if (t >= epochs[epochs.length - 1]) return epochs.length - 1;
  for (let i = 0; i < epochs.length - 1; i++) {
    if (t >= epochs[i] && t <= epochs[i + 1]) {
      const span = epochs[i + 1] - epochs[i] || 1;
      return i + (t - epochs[i]) / span;
    }
  }
  return days.length - 1;
}

/** Resolve a sparse date→number series onto the dense master axis (hold ends,
 *  linear-interp gaps). Returns values + a per-day "was this null" flag. */
function densify(
  days: string[],
  epochs: number[],
  series: Record<string, { value: number | null } | number>,
): { vals: number[]; missing: boolean[] } {
  // Collect the known numeric keyframes present in the series, in axis order.
  const known: { idx: number; val: number }[] = [];
  const nullDays = new Set<number>();
  days.forEach((d, i) => {
    if (!(d in series)) return;
    const raw = series[d];
    const val = typeof raw === "number" ? raw : raw.value;
    if (val === null || val === undefined || Number.isNaN(val)) {
      nullDays.add(i);
    } else {
      known.push({ idx: i, val });
    }
  });
  const vals = new Array<number>(days.length).fill(0);
  const missing = new Array<boolean>(days.length).fill(false);
  if (known.length === 0) {
    days.forEach((_, i) => (missing[i] = true));
    return { vals, missing };
  }
  for (let i = 0; i < days.length; i++) {
    // Find surrounding known keyframes.
    let lo = -1, hi = -1;
    for (let k = 0; k < known.length; k++) {
      if (known[k].idx <= i) lo = k;
      if (known[k].idx >= i) { hi = k; break; }
    }
    if (lo === -1) vals[i] = known[hi].val;
    else if (hi === -1) vals[i] = known[lo].val;
    else if (lo === hi) vals[i] = known[lo].val;
    else {
      const a = known[lo], b = known[hi];
      const f = (i - a.idx) / (b.idx - a.idx || 1);
      vals[i] = a.val + (b.val - a.val) * f;
    }
    if (nullDays.has(i)) missing[i] = true;
  }
  return { vals, missing };
}

/** Compile a film into the dense, playback-ready model. */
export function compileFilm(film: BoardFilm): BoardModel {
  const dateSet = new Set<string>();
  for (const dot of film.dots) for (const d of Object.keys(dot.series)) dateSet.add(d);
  for (const s of film.strings) for (const d of Object.keys(s.activation)) dateSet.add(d);
  for (const b of film.blooms) dateSet.add(b.date);
  for (const b of film.beats) dateSet.add(b.date);
  // Anchor the axis to the declared window even if sparse inside.
  if (film.window?.[0]) dateSet.add(film.window[0]);
  if (film.window?.[1]) dateSet.add(film.window[1]);
  const days = Array.from(dateSet).sort();
  const epochs = days.map(toEpoch);
  const byId = new Map(film.dots.map((d) => [d.id, d]));

  const dots: DotTrack[] = film.dots.map((dot) => {
    const pctSeries: Record<string, { value: number | null }> = {};
    const vSeries: Record<string, { value: number | null }> = {};
    for (const [d, datum] of Object.entries(dot.series)) {
      pctSeries[d] = { value: datum.pct };
      vSeries[d] = { value: datum.v };
    }
    const pctR = densify(days, epochs, pctSeries);
    const vR = densify(days, epochs, vSeries);
    return { dot, pct: pctR.vals, v: vR.vals, dim: pctR.missing };
  });

  const strings: StringTrack[] = film.strings.map((str) => {
    const act = densify(days, epochs, str.activation).vals;
    const peak = new Array<number>(days.length);
    let run = 0;
    for (let i = 0; i < days.length; i++) {
      run = Math.max(run, act[i]);
      peak[i] = run;
    }
    return { str, from: byId.get(str.from) ?? null, to: byId.get(str.to) ?? null, act, peak };
  });

  const blooms: BloomMark[] = film.blooms.map((bloom) => ({
    bloom,
    anchor: bloom.anchor ? byId.get(bloom.anchor) ?? null : null,
    index: dateToIndex(days, epochs, bloom.date),
  }));
  const firstBloomIndex = blooms.reduce((m, b) => Math.min(m, b.index), Infinity);

  const beatIndex = film.beats
    .map((beat) => ({ beat, index: dateToIndex(days, epochs, beat.date) }))
    .sort((a, b) => a.index - b.index);

  return { film, days, epochs, dots, strings, blooms, beatIndex, firstBloomIndex };
}

// ── Sampling ──────────────────────────────────────────────────────────────────

const smooth = (f: number) => f * f * (3 - 2 * f); // smoothstep
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

interface DotSample { pct: number; v: number; dim: boolean; }

function sampleTrack(track: DotTrack, tRaw: number): DotSample {
  const n = track.pct.length;
  // Clamp the cursor into [0, n-1] so a stray out-of-range value (e.g. a tiny
  // negative first-frame dt) can never index off the ends and produce NaN.
  const t = Number.isFinite(tRaw) ? Math.min(n - 1, Math.max(0, tRaw)) : 0;
  const i = Math.floor(t);
  if (i >= n - 1) return { pct: track.pct[n - 1], v: track.v[n - 1], dim: track.dim[n - 1] };
  const f = smooth(t - i);
  return {
    pct: lerp(track.pct[i], track.pct[i + 1], f),
    v: lerp(track.v[i], track.v[i + 1], f),
    dim: f < 0.5 ? track.dim[i] : track.dim[i + 1],
  };
}

export function sampleDotById(model: BoardModel, id: string, t: number): (DotSample & { dot: BoardDot }) | null {
  const track = model.dots.find((d) => d.dot.id === id);
  if (!track) return null;
  return { ...sampleTrack(track, t), dot: track.dot };
}

function sampleString(track: StringTrack, tRaw: number): { act: number; peak: number } {
  const n = track.act.length;
  const t = Number.isFinite(tRaw) ? Math.min(n - 1, Math.max(0, tRaw)) : 0;
  const i = Math.floor(t);
  if (i >= n - 1) return { act: track.act[n - 1], peak: track.peak[n - 1] };
  const f = smooth(t - i);
  return { act: lerp(track.act[i], track.act[i + 1], f), peak: track.peak[i] };
}

/** ISO date at a fractional cursor (rounded to the nearer keyframe day). */
export function dayAt(model: BoardModel, t: number): string {
  const i = Math.round(clamp01(t / Math.max(1, model.days.length - 1)) * (model.days.length - 1));
  return model.days[Math.min(model.days.length - 1, Math.max(0, i))];
}

export function activeBeat(model: BoardModel, t: number): { line: string; date: string; key: number } | null {
  let active: { beat: BoardBeat; index: number } | null = null;
  for (const b of model.beatIndex) {
    if (b.index <= t + 1e-6) active = b;
    else break;
  }
  if (!active) return null;
  return { line: active.beat.line, date: active.beat.date, key: model.beatIndex.indexOf(active) };
}

// ── Color ramp ────────────────────────────────────────────────────────────────

// ember teal (#2dd4bf) → hot coal (cyan-white core, warm halo). Temp dots with
// a known side tint by it — amber for a hot tail, ice-blue for a cold one —
// same easing, same alphas, hue shift only.
type EmberTint = "default" | "warm" | "cold";

function tintFor(dot: BoardDot): EmberTint {
  if (dot.kind !== "state-temp") return "default";
  if (dot.side === "high") return "warm";
  if (dot.side === "low") return "cold";
  return "default";
}

const HALO_TO: Record<EmberTint, [number, number, number]> = {
  default: [255, 236, 179], // warm gold-white edge
  warm: [255, 176, 96], // amber
  cold: [148, 196, 255], // ice blue
};
const CORE_TO: Record<EmberTint, [number, number, number]> = {
  default: [245, 255, 252], // near-white cyan
  warm: [255, 243, 224], // warm white
  cold: [227, 241, 255], // blue-white
};

function haloColor(pct: number, alpha: number, tint: EmberTint = "default"): string {
  const to = HALO_TO[tint];
  const r = Math.round(lerp(45, to[0], pct * pct));
  const g = Math.round(lerp(212, to[1], pct));
  const b = Math.round(lerp(191, to[2], pct));
  return `rgba(${r},${g},${b},${alpha})`;
}
function coreColor(pct: number, alpha: number, tint: EmberTint = "default"): string {
  const to = CORE_TO[tint];
  const r = Math.round(lerp(120, to[0], pct));
  const g = Math.round(lerp(240, to[1], pct));
  const b = Math.round(lerp(230, to[2], pct));
  return `rgba(${r},${g},${b},${alpha})`;
}
const BRASS = "184,160,106"; // etched-string brass

// ── Drawing ─────────────────────────────────────────────────────────────────

export interface FitTransform {
  scale: number; // device px per projection unit
  cssW: number;
  cssH: number;
}

/** Size the canvas crisply for the current CSS width; returns the fit. */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  cssW: number,
  proj: { width: number; height: number },
): FitTransform {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cssH = (cssW * proj.height) / proj.width;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const s = (cssW / proj.width) * dpr;
    ctx.setTransform(s, 0, 0, s, 0, 0); // now draw in projection units
  }
  return { scale: (cssW / proj.width) * dpr, cssW, cssH };
}

function drawGround(ctx: CanvasRenderingContext2D, proj: { width: number; height: number }) {
  // near-black ground over the page's gray-950
  ctx.fillStyle = "#0a0f14";
  ctx.fillRect(0, 0, proj.width, proj.height);
  // state hairlines at ~8% white
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1.1;
  ctx.lineJoin = "round";
  for (const ring of CONUS_BORDERS) {
    ctx.beginPath();
    ctx.moveTo(ring[0], ring[1]);
    for (let i = 2; i < ring.length; i += 2) ctx.lineTo(ring[i], ring[i + 1]);
    ctx.stroke();
  }
}

function drawString(
  ctx: CanvasRenderingContext2D,
  track: StringTrack,
  t: number,
  nowMs: number,
  pastBloom: boolean,
  etchGlint: number,
) {
  const { from, to } = track;
  if (!from || !to) return;
  const { act, peak } = sampleString(track, t);
  const etched = pastBloom && peak >= 0.9;
  // A string barely earns ink below a floor unless it's etched.
  if (!etched && act < 0.04) return;

  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  // perpendicular sag that tightens toward 0 as activation → 1
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const sag = (1 - act) * Math.min(60, len * 0.16);
  const cx = mx + nx * sag;
  const cy = my + ny * sag;

  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.quadraticCurveTo(cx, cy, to.x, to.y);

  if (etched) {
    // Quietly permanent: the court made visible. Stronger than a live string so
    // it reads clearly in the final hold, but brass — never gold confetti.
    ctx.strokeStyle = `rgba(${BRASS},0.92)`;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // A single, restrained glint as the string sets — a pale brass sheen laid
    // over the same path in the ~1.6 days right after the bloom, then gone.
    if (etchGlint > 0.01) {
      ctx.strokeStyle = `rgba(230,212,168,${0.5 * etchGlint})`;
      ctx.lineWidth = 1.4 + etchGlint * 1.3;
      ctx.stroke();
    }
    return;
  }
  let alpha = 0.12 + act * 0.6;
  if (act >= 0.9) {
    // faint pulse at full tautness
    const pulse = 0.12 * (0.5 + 0.5 * Math.sin(nowMs / 380));
    alpha = Math.min(1, alpha + pulse);
  }
  ctx.strokeStyle = `rgba(120,220,210,${alpha})`;
  ctx.lineWidth = 0.5 + act * 2;
  ctx.stroke();
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  track: DotTrack,
  t: number,
) {
  const s = sampleTrack(track, t);
  const isNeedle = track.dot.kind === "needle";
  const tint = tintFor(track.dot);
  // no-data → minimum ember, slightly dimmer
  const pct = s.dim ? 0.03 : clamp01(s.pct);
  const coreR = 1.5 + pct * pct * 22;
  const glowR = coreR * 2.7 + (isNeedle ? 10 : 6);
  const dimK = s.dim ? 0.55 : 1;

  // soft outer glow (radial)
  const g = ctx.createRadialGradient(track.dot.x, track.dot.y, 0, track.dot.x, track.dot.y, glowR);
  g.addColorStop(0, haloColor(pct, 0.5 * dimK, tint));
  g.addColorStop(0.45, haloColor(pct, 0.18 * dimK, tint));
  g.addColorStop(1, haloColor(pct, 0, tint));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(track.dot.x, track.dot.y, glowR, 0, Math.PI * 2);
  ctx.fill();

  // bright core
  ctx.fillStyle = coreColor(pct, (0.85 + pct * 0.15) * dimK, tint);
  ctx.beginPath();
  ctx.arc(track.dot.x, track.dot.y, coreR, 0, Math.PI * 2);
  ctx.fill();

  // the needle is the sky, not the ground — a cool ring sets it apart
  if (isNeedle) {
    ctx.strokeStyle = `rgba(180,235,255,${0.25 + pct * 0.4})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(track.dot.x, track.dot.y, glowR + 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  // the board names a thing only when it matters
  if (pct > 0.75 && !s.dim) {
    ctx.fillStyle = "rgba(190,205,215,0.82)";
    ctx.font = "500 9px ui-monospace, 'SF Mono', Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(track.dot.label, track.dot.x, track.dot.y - coreR - 5);
  }
}

function drawBloom(ctx: CanvasRenderingContext2D, mark: BloomMark, t: number) {
  const raw = (t - mark.index) / BLOOM_DAYS;
  if (raw <= 0) return;
  const p = clamp01(raw);
  const eased = smooth(p);
  const x = mark.bloom.x || mark.anchor?.x || 0;
  const y = mark.bloom.y || mark.anchor?.y || 0;

  // expanding ring — lands like a gut punch, not a firework (restraint)
  if (p < 1) {
    const ringR = 6 + eased * 46;
    ctx.strokeStyle = `rgba(245,230,190,${(1 - eased) * 0.7})`;
    ctx.lineWidth = 2.4 * (1 - eased) + 0.6;
    ctx.beginPath();
    ctx.arc(x, y, ringR, 0, Math.PI * 2);
    ctx.stroke();
    // core flash
    const fg = ctx.createRadialGradient(x, y, 0, x, y, 26);
    fg.addColorStop(0, `rgba(255,246,224,${(1 - eased) * 0.85})`);
    fg.addColorStop(1, "rgba(255,246,224,0)");
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();
  }

  // permanent marker
  const mg = ctx.createRadialGradient(x, y, 0, x, y, 12);
  mg.addColorStop(0, "rgba(245,230,190,0.95)");
  mg.addColorStop(1, "rgba(245,230,190,0)");
  ctx.fillStyle = mg;
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,248,232,0.95)";
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();

  // The bloom's name is NOT drawn on the canvas — at phone width the whole
  // projection is scaled to ~0.34, so canvas text renders ~4px and clips into
  // the swollen dots below. The gravestone is a DOM card (BoardPage), which
  // stays crisp and readable at 375px. Here we mark the spot; the card names it.
}

/** Draw one full frame at cursor t (fractional master-day index). */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  model: BoardModel,
  t: number,
  nowMs: number,
) {
  const proj = model.film.projection;
  // Defensive: a 0-width layout transient can hand us a non-finite cursor;
  // never let one bad frame throw (which would unmount the film).
  if (!Number.isFinite(t)) t = 0;
  drawGround(ctx, proj);
  const pastBloom = t >= model.firstBloomIndex - 1e-6;
  // A short, decaying glint window right after the bloom lands (in master-days),
  // so the strings set with one quiet sheen instead of a permanent shimmer.
  const GLINT_DAYS = 1.6;
  const etchGlint =
    pastBloom && Number.isFinite(model.firstBloomIndex)
      ? clamp01(1 - (t - model.firstBloomIndex) / GLINT_DAYS)
      : 0;

  // strings beneath dots
  ctx.lineCap = "round";
  for (const s of model.strings) drawString(ctx, s, t, nowMs, pastBloom, etchGlint);

  // blooms beneath the ground dots but above strings (the flash reads as depth)
  for (const b of model.blooms) drawBloom(ctx, b, t);

  // dots on top; needle(s) last so the sky sits above the ground
  const ground = model.dots.filter((d) => d.dot.kind !== "needle");
  const sky = model.dots.filter((d) => d.dot.kind === "needle");
  for (const d of ground) drawDot(ctx, d, t);
  for (const d of sky) drawDot(ctx, d, t);
}

// ── Hit testing (for tap → overlay card) ──────────────────────────────────────

export type BoardHit =
  | { type: "dot"; dot: BoardDot; pct: number; v: number; dim: boolean }
  | { type: "string"; str: BoardString; act: number };

/** Nearest dot within 24 units, else nearest string midpoint within 18 units. */
export function hitTest(
  model: BoardModel,
  projX: number,
  projY: number,
  t: number,
): BoardHit | null {
  let best: { d: number; track: DotTrack } | null = null;
  for (const track of model.dots) {
    const dist = Math.hypot(track.dot.x - projX, track.dot.y - projY);
    if (dist <= 24 && (!best || dist < best.d)) best = { d: dist, track };
  }
  if (best) {
    const s = sampleTrack(best.track, t);
    return { type: "dot", dot: best.track.dot, pct: s.pct, v: s.v, dim: s.dim };
  }
  let bestStr: { d: number; track: StringTrack } | null = null;
  for (const track of model.strings) {
    if (!track.from || !track.to) continue;
    const mx = (track.from.x + track.to.x) / 2;
    const my = (track.from.y + track.to.y) / 2;
    const dist = Math.hypot(mx - projX, my - projY);
    if (dist <= 18 && (!bestStr || dist < bestStr.d)) bestStr = { d: dist, track };
  }
  if (bestStr) {
    const s = sampleString(bestStr.track, t);
    return { type: "string", str: bestStr.track.str, act: s.act };
  }
  return null;
}

export function totalDays(model: BoardModel): number {
  return model.days.length;
}
