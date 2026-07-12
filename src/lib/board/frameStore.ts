/**
 * frameStore.ts — the reader side of THE BOARD's frame store.
 *
 * The board is a fixed set of instruments (needles, state temps, tide gauges,
 * Gulf buoys) laid out in the same 975x610 Albers projection the Uri film uses.
 * Every day, a packed frame records how deep each instrument's reading sits in
 * its own historical tail — a byte per slot, two slots per instrument (a low
 * tail and a high tail). 255 means "no reading on file that day"; otherwise the
 * byte / 254 is the tail depth (1 = deepest ever recorded).
 *
 * This module fetches instruments + frames through the anon client, decodes the
 * packed dots, resolves each instrument's swell for a day, and — critically —
 * reuses the film's renderer (src/lib/boardPlayer.ts) by synthesizing a
 * one-day BoardFilm. That means the room's embers are drawn by the exact same
 * hand-rolled canvas engine that draws the film: same glow, same needle rings,
 * same color ramp. No second renderer to keep honest.
 */

import { supabase } from "@/lib/supabase";
import { compileFilm, type BoardFilm } from "@/lib/boardPlayer";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Instrument {
  id: string;
  kind: "needle" | "state-temp" | "tide" | "buoy" | string;
  label: string;
  sublabel: string | null;
  lane: string;
  albers_x: number;
  albers_y: number;
  slot_offset: number;
  slot_count: number;
  metrics: { direction?: string }[] | null;
}

export interface DayFrame {
  day: string; // ISO date
  dots: string; // base64 packed bytes, one per slot
  blooms: unknown[];
  strings: Record<string, unknown>;
  day0_source: string | null;
}

/** One instrument resolved for a single day. */
export interface ResolvedInstrument {
  inst: Instrument;
  lowPct: number | null;
  highPct: number | null;
  pct: number | null; // the deeper of the two tails (null = no reading)
  side: "low" | "high" | null; // which tail is deeper
  hasData: boolean;
}

export const BOARD_PROJECTION = { width: 975, height: 610 } as const;

// ── Fetch ─────────────────────────────────────────────────────────────────────

export async function fetchInstruments(): Promise<Instrument[]> {
  if (!supabase) throw new Error("no supabase client");
  const { data, error } = await supabase
    .from("board_instruments")
    .select("id,kind,label,sublabel,lane,albers_x,albers_y,slot_offset,slot_count,metrics")
    .eq("active", true)
    .order("slot_offset", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Instrument[];
}

/** Frames in [from, to] inclusive, newest first. */
export async function fetchFrames(from: string, to: string): Promise<DayFrame[]> {
  if (!supabase) throw new Error("no supabase client");
  const { data, error } = await supabase.rpc("board_frames_range", { p_from: from, p_to: to });
  if (error) throw error;
  const frames = ((data as { frames?: DayFrame[] })?.frames ?? []) as DayFrame[];
  // Newest first so "scroll down = fall backward through time" is a straight map.
  return frames.slice().sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

// ── Decode ────────────────────────────────────────────────────────────────────

/** Decode a base64 packed-dots string to raw bytes (255 = null slot). */
export function decodeDots(b64: string): Uint8Array {
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const pctOf = (b: number): number | null => (b === 255 ? null : b / 254);

/** Resolve every instrument's swell for one decoded frame. */
export function resolveDay(frame: DayFrame, instruments: Instrument[]): ResolvedInstrument[] {
  const bytes = decodeDots(frame.dots);
  return instruments.map((inst) => {
    const lo = pctOf(bytes[inst.slot_offset] ?? 255);
    const hi = pctOf(bytes[inst.slot_offset + 1] ?? 255);
    let pct: number | null = null;
    let side: "low" | "high" | null = null;
    if (lo !== null || hi !== null) {
      if (hi !== null && (lo === null || hi >= lo)) {
        pct = hi;
        side = "high";
      } else {
        pct = lo;
        side = "low";
      }
    }
    return { inst, lowPct: lo, highPct: hi, pct, side, hasData: pct !== null };
  });
}

// ── Render bridge: a one-day BoardFilm the film engine can draw ─────────────────

/**
 * Build a BoardFilm containing exactly one day, so compileFilm + drawFrame(t=0)
 * render today's embers with the film's own renderer. Instruments with no
 * reading are still placed (they glow to the renderer's dim minimum), so the
 * ground reads as a full board, quiet where the archive is silent.
 */
export function buildDayFilm(day: string, resolved: ResolvedInstrument[]): BoardFilm {
  return {
    story: "today",
    title: "Today",
    subtitle: "",
    window: [day, day],
    projection: { ...BOARD_PROJECTION },
    dots: resolved.map((r) => ({
      id: r.inst.id,
      label: r.inst.label,
      sublabel: r.inst.sublabel ?? undefined,
      kind: r.inst.kind,
      x: r.inst.albers_x,
      y: r.inst.albers_y,
      series: {
        [day]: { v: r.pct, pct: r.pct },
      },
    })),
    strings: [],
    blooms: [],
    beats: [],
  };
}

export function compileDayFilm(day: string, resolved: ResolvedInstrument[]) {
  return compileFilm(buildDayFilm(day, resolved));
}

// ── The porch voice: one true line, computed from what actually swelled ─────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A single instrument's swell as a short, honest clause. */
function clauseFor(r: ResolvedInstrument): string {
  const name = r.inst.label;
  const high = r.side === "high";
  switch (r.inst.kind) {
    case "needle":
      return high ? `the ${name} is riding high` : `the ${name} has sunk low`;
    case "state-temp":
      return high ? `${name} is running hot` : `${name} is running cold`;
    case "tide":
      return high ? `${name} is running high` : `${name} is running low`;
    case "buoy":
      return high ? `pressure is climbing off ${name}` : `pressure is sinking off ${name}`;
    default:
      return high ? `${name} is running high` : `${name} is running low`;
  }
}

/** Join clauses as a natural, comma-then-and list. */
function joinClauses(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return `${parts[0]}, and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

export interface PorchLine {
  lead: string; // the swell, named
  coda: string; // what it means, honestly
  swollen: ResolvedInstrument[]; // the instruments the lead named
}

/**
 * Derive the porch sentence for a day. Deep = tail depth >= 0.85. We name at
 * most the three deepest, capitalize the sentence, and close with an honest
 * coda: nothing is "forming" unless the frame carries strings or blooms — and
 * today's frames carry neither, so the coda tells the truth ("nothing forming").
 */
export function porchLine(day: string, resolved: ResolvedInstrument[], frame: DayFrame): PorchLine {
  const withData = resolved.filter((r) => r.hasData);
  const deep = withData
    .filter((r) => (r.pct ?? 0) >= 0.85)
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  const named = deep.slice(0, 3);

  const forming = (frame.strings && Object.keys(frame.strings).length > 0) || (frame.blooms?.length ?? 0) > 0;

  let lead: string;
  if (named.length === 0) {
    // Nothing deep. Say so plainly, but stay specific about coverage.
    lead =
      withData.length === 0
        ? "The board is dark today — no instrument has reported."
        : "Nothing is deep in its tail today.";
  } else {
    const sentence = joinClauses(named.map(clauseFor));
    lead = sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
  }

  let coda: string;
  if (forming) {
    coda = "Something is starting to line up.";
  } else if (deep.length === 0) {
    coda = "Nothing forming.";
  } else if (deep.length === 1) {
    coda = "One needle in its tail; nothing forming.";
  } else {
    coda = `${deep.length} readings deep in their tails; nothing forming yet.`;
  }

  return { lead, coda, swollen: named };
}

// ── Small helpers for the room ──────────────────────────────────────────────────

export function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

/** ISO date N days before `iso` (UTC-safe, no timezone drift). */
export function isoDaysBefore(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) - n * 86400000;
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

export function todayIso(): string {
  const dt = new Date();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/** The x range of on-projection instruments (AK/HI insets excluded). */
export function albersXRange(instruments: Instrument[]): [number, number] {
  const xs = instruments.map((i) => i.albers_x).filter((x) => x > 0 && x < 975);
  return xs.length ? [Math.min(...xs), Math.max(...xs)] : [0, 975];
}

/**
 * Draw a day's swell as a heat-ribbon: each reporting instrument a warm ember
 * laid west→east by its Albers x, brightness and size by tail depth. The same
 * teal→gold ramp the film's embers use, so a ribbon reads as the board seen
 * edge-on. Static — call once per mount and on resize.
 */
export function drawRibbon(
  canvas: HTMLCanvasElement,
  resolved: ResolvedInstrument[],
  xMin: number,
  xMax: number,
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  if (cssW <= 0) return;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, cssH - 1);
  ctx.lineTo(cssW, cssH - 1);
  ctx.stroke();

  const span = xMax - xMin || 1;
  const cy = cssH / 2;
  for (const r of resolved) {
    if (!r.hasData || r.pct === null) continue;
    const nx = (r.inst.albers_x - xMin) / span;
    const x = 6 + Math.min(1, Math.max(0, nx)) * (cssW - 12);
    const pct = r.pct;
    const rr = Math.round(45 + (255 - 45) * pct * pct);
    const gg = Math.round(212 + (236 - 212) * pct);
    const bb = Math.round(191 + (179 - 191) * pct);
    const radius = 1.2 + pct * pct * 4.5;
    const g = ctx.createRadialGradient(x, cy, 0, x, cy, radius * 3);
    g.addColorStop(0, `rgba(${rr},${gg},${bb},${0.5 + pct * 0.4})`);
    g.addColorStop(1, `rgba(${rr},${gg},${bb},0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, cy, radius * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgba(${rr},${gg},${bb},0.85)`;
    ctx.beginPath();
    ctx.arc(x, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
