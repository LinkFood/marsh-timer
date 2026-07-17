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

/** What followed a rhyme day, if the record holds anything. */
export interface RhymeFollowed {
  title: string;
  began: string | null;
  days_after: number;
  deaths: number | null;
  injuries: number | null;
  damage_usd: number | null;
}

/** One row of board_rhymes: the day the archive says `day` reads most like. */
export interface BoardRhyme {
  day: string;
  rank: number;
  rhyme_day: string;
  score: number;
  cos: number;
  mag: number;
  drivers: { label: string; side: string; kind: string }[] | null;
  followed: RhymeFollowed | null;
}

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

/**
 * Rank-1 rhymes for every day in [from, to], keyed by day. The table is
 * anon-readable like board_frames; if it doesn't exist yet or the query fails,
 * return an empty map — the room renders NOTHING for a missing rhyme, never a
 * placeholder lie.
 */
export async function fetchRhymes(from: string, to: string): Promise<Map<string, BoardRhyme>> {
  const out = new Map<string, BoardRhyme>();
  if (!supabase) return out;
  try {
    const { data, error } = await supabase
      .from("board_rhymes")
      .select("day,rank,rhyme_day,score,cos,mag,drivers,followed")
      .eq("rank", 1)
      .gte("day", from)
      .lte("day", to);
    if (error || !data) return out;
    for (const row of data as BoardRhyme[]) out.set(row.day, row);
  } catch {
    /* absent table = no rhymes yet; say nothing */
  }
  return out;
}

// ── Active NWS alerts: the ground's own corroboration ─────────────────────────

/** The one alert the board names for a state: highest severity, then the most
 *  common event type under it. Names are NWS facts, verbatim. */
export interface StateAlert {
  state: string; // postal abbr, "TX"
  eventType: string; // "Flood Watch" — the NWS event name, never invented
  severity: string; // "Severe" | "Extreme"
}

let alertsPromise: Promise<Map<string, StateAlert>> | null = null;

/**
 * Active severe/extreme NWS alerts grouped by state, cached for the session.
 * hunt_nws_alerts is anon-readable; we pull only (states, event_type, severity)
 * for unexpired Severe/Extreme rows — a few dozen rows, one round trip. A failed
 * fetch resolves empty (the board just renders without corroboration) and does
 * not poison the cache.
 */
export function fetchActiveAlerts(): Promise<Map<string, StateAlert>> {
  if (!alertsPromise) {
    alertsPromise = loadActiveAlerts().catch(() => {
      alertsPromise = null;
      return new Map<string, StateAlert>();
    });
  }
  return alertsPromise;
}

async function loadActiveAlerts(): Promise<Map<string, StateAlert>> {
  const out = new Map<string, StateAlert>();
  if (!supabase) return out;
  const { data, error } = await supabase
    .from("hunt_nws_alerts")
    .select("states,event_type,severity")
    .in("severity", ["Severe", "Extreme"])
    .gt("expires", new Date().toISOString())
    .limit(1000);
  if (error || !data) return out;
  // Tally (state → event type → { best severity, count }), then pick per state:
  // Extreme beats Severe; ties break to the most common event type, then A→Z.
  const tally = new Map<string, Map<string, { sev: number; n: number }>>();
  for (const row of data as { states: string[] | null; event_type: string | null; severity: string | null }[]) {
    if (!row.event_type || !row.severity) continue;
    const sev = row.severity === "Extreme" ? 2 : 1;
    for (const st of row.states ?? []) {
      const byEvent = tally.get(st) ?? new Map<string, { sev: number; n: number }>();
      const cur = byEvent.get(row.event_type) ?? { sev: 0, n: 0 };
      byEvent.set(row.event_type, { sev: Math.max(cur.sev, sev), n: cur.n + 1 });
      tally.set(st, byEvent);
    }
  }
  for (const [st, byEvent] of tally) {
    let best: { eventType: string; sev: number; n: number } | null = null;
    for (const [eventType, { sev, n }] of byEvent) {
      if (
        !best ||
        sev > best.sev ||
        (sev === best.sev && (n > best.n || (n === best.n && eventType < best.eventType)))
      ) {
        best = { eventType, sev, n };
      }
    }
    if (best) out.set(st, { state: st, eventType: best.eventType, severity: best.sev === 2 ? "Extreme" : "Severe" });
  }
  return out;
}

/** The state a state-temp instrument reads, as a postal abbr ("ghcn-tx" → "TX"). */
export function instrumentState(inst: Instrument): string | null {
  if (inst.kind !== "state-temp") return null;
  const m = inst.id.match(/-([a-z]{2})$/i);
  return m ? m[1].toUpperCase() : null;
}

/** Tail depth at which a reading counts as EXTREME (byte ≥ 249 of 254). */
export const EXTREME_DEPTH = 249 / 254;

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
 * ground reads as a full board, quiet where the archive is silent. When `alerts`
 * is passed (the live board only — active alerts corroborate NOW, never a past
 * day), state dots under an active severe NWS alert carry it into the renderer,
 * which marks them with the slow amber alert ring.
 */
export function buildDayFilm(
  day: string,
  resolved: ResolvedInstrument[],
  alerts?: Map<string, StateAlert>,
): BoardFilm {
  return {
    story: "today",
    title: "Today",
    subtitle: "",
    window: [day, day],
    projection: { ...BOARD_PROJECTION },
    dots: resolved.map((r) => {
      const st = alerts ? instrumentState(r.inst) : null;
      const alert = (st && alerts?.get(st)) || null;
      return {
        id: r.inst.id,
        label: r.inst.label,
        sublabel: r.inst.sublabel ?? undefined,
        kind: r.inst.kind,
        side: r.side,
        alert: alert ? { eventType: alert.eventType, severity: alert.severity } : null,
        x: r.inst.albers_x,
        y: r.inst.albers_y,
        series: {
          [day]: { v: r.pct, pct: r.pct },
        },
      };
    }),
    strings: [],
    blooms: [],
    beats: [],
  };
}

export function compileDayFilm(day: string, resolved: ResolvedInstrument[], alerts?: Map<string, StateAlert>) {
  return compileFilm(buildDayFilm(day, resolved, alerts));
}

// ── The porch voice: one true line, computed from what actually swelled ─────────

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Deterministic per-day seed so a day's sentence is stable across renders but
 *  consecutive days phrase themselves differently. FNV-1a over the ISO date. */
function daySeed(day: string): number {
  let h = 2166136261;
  for (let i = 0; i < day.length; i++) {
    h ^= day.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Avalanche-mix a seed with a salt so nearby days (and different clause slots)
 *  pick variants independently — raw FNV seeds of adjacent dates collide mod 3. */
function mix(seed: number, salt: number): number {
  let x = (seed + Math.imul(salt, 0x9e3779b9)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

const pickBy = (seed: number, variants: string[]): string => variants[seed % variants.length];

/** A single instrument's swell as a short, honest, kind-aware clause. */
function clauseFor(r: ResolvedInstrument, seed: number): string {
  const name = r.inst.label;
  const high = r.side === "high";
  switch (r.inst.kind) {
    case "needle":
      return high
        ? pickBy(seed, [`the ${name} is riding high`, `the ${name} needle leans high`, `the ${name} is pinned high`])
        : pickBy(seed, [`the ${name} has sunk low`, `the ${name} needle leans low`, `the ${name} is pinned low`]);
    case "state-temp":
      return high
        ? pickBy(seed, [`${name} is running hot`, `${name} sits deep in its warm tail`, `heat is leaning on ${name}`])
        : pickBy(seed, [`${name} is running cold`, `${name} sits deep in its cold tail`, `cold has settled over ${name}`]);
    case "tide":
      return high
        ? pickBy(seed, [`${name} harbor is riding high`, `the water stands high at ${name}`, `${name} tide is running above its history`])
        : pickBy(seed, [`${name} harbor has drawn down`, `the water sits low at ${name}`, `${name} tide is running under its history`]);
    case "buoy": {
      const n = name.replace(/^Buoy\s+/i, "");
      return high
        ? pickBy(seed, [`pressure is riding high off ${n}`, `${n} pressure is climbing`])
        : pickBy(seed, [`pressure is falling off ${n}`, `${n} pressure has sunk low`]);
    }
    default:
      return high ? `${name} is running high` : `${name} is running low`;
  }
}

/** Join 1–3 clauses with a per-day connective so days don't read identically. */
function joinClauses(parts: string[], seed: number): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  if (parts.length === 2)
    return pickBy(seed, [
      `${parts[0]}, and ${parts[1]}`,
      `${parts[0]} while ${parts[1]}`,
      `${parts[0]} — and ${parts[1]}`,
    ]);
  return pickBy(seed, [
    `${parts[0]}, ${parts[1]}, and ${parts[2]}`,
    `${parts[0]}; ${parts[1]}; and ${parts[2]}`,
    `${parts[0]}, ${parts[1]} — and ${parts[2]}`,
  ]);
}

export interface PorchLine {
  lead: string; // the swell, named
  coda: string; // what it means, honestly
  swollen: ResolvedInstrument[]; // the instruments the lead named
}

/** "a Flood Watch" / "an Excessive Heat Warning" — NWS name verbatim. */
const withArticle = (s: string): string => (/^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`);

/**
 * A corroborated extreme, named plainly: both facts, no seeded variety, no
 * invented adjectives. Tail pools are day-of-year windows (±10 days) over the
 * full record, so "its July" is what the byte actually measured.
 */
function corroboratedClause(r: ResolvedInstrument, alert: StateAlert, day: string): string {
  const name = r.inst.label;
  const month = MONTHS[Number(day.slice(5, 7)) - 1];
  const hot = r.side === "high";
  const under = `under ${withArticle(alert.eventType)}`;
  if ((r.pct ?? 0) >= 1 - 1e-9) {
    return `${name} is running as ${hot ? "hot" : "cold"} as its ${month} has ever recorded, ${under}`;
  }
  const p = Math.floor((r.pct ?? 0) * 100);
  return `${name} is running ${hot ? "hotter" : "colder"} than ${p}% of its ${month} record, ${under}`;
}

/**
 * Derive the porch sentence for a day. Deep = tail depth >= 0.85. Selection law:
 * a state whose temp sits at EXTREME depth (byte >= 249) while the state is
 * under an active severe NWS alert is a CORROBORATED EXTREME — it outranks
 * everything and leads the sentence naming both facts plainly. Seeded variety
 * applies only to the uncorroborated follow-ons, which still prefer KIND
 * DIVERSITY (a tide or a buoy beats a fourth hot state). The coda stays honest:
 * with a corroborated extreme standing, "nothing forming yet" never renders —
 * the coda names what is actually standing out instead.
 */
export function porchLine(
  day: string,
  resolved: ResolvedInstrument[],
  frame: DayFrame,
  alerts?: Map<string, StateAlert>,
): PorchLine {
  const seed = daySeed(day);
  const withData = resolved.filter((r) => r.hasData);
  const deep = withData
    .filter((r) => (r.pct ?? 0) >= 0.85)
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));

  const alertFor = (r: ResolvedInstrument): StateAlert | null => {
    if (!alerts) return null;
    const st = instrumentState(r.inst);
    return (st && alerts.get(st)) || null;
  };
  const corroborated = deep.filter((r) => (r.pct ?? 0) >= EXTREME_DEPTH && alertFor(r) !== null);

  // Corroborated extremes first (deepest first), then fill to three preferring
  // instruments of a kind not yet named.
  const named: ResolvedInstrument[] = corroborated.slice(0, 3);
  const rest = deep.filter((r) => !named.includes(r));
  while (named.length < 3 && rest.length > 0) {
    const kinds = new Set(named.map((r) => r.inst.kind));
    const i = rest.findIndex((r) => !kinds.has(r.inst.kind));
    named.push(rest.splice(i === -1 ? 0 : i, 1)[0]);
  }

  const forming = (frame.strings && Object.keys(frame.strings).length > 0) || (frame.blooms?.length ?? 0) > 0;

  let lead: string;
  if (named.length === 0) {
    // Nothing deep. Say so plainly, but stay specific about coverage.
    lead =
      withData.length === 0
        ? "The board is dark — no instrument has reported."
        : pickBy(mix(seed, 7), [
            "Nothing is deep in its tail.",
            "A quiet board — nothing deep.",
            "No instrument sits deep in its history.",
          ]);
  } else {
    const sentence = joinClauses(
      named.map((r, i) => {
        const alert = corroborated.includes(r) ? alertFor(r) : null;
        return alert ? corroboratedClause(r, alert, day) : clauseFor(r, mix(seed, daySeed(r.inst.id) + i));
      }),
      mix(seed, 97),
    );
    lead = sentence.charAt(0).toUpperCase() + sentence.slice(1) + ".";
  }

  let coda: string;
  if (corroborated.length > 0) {
    // Fact-only: what is standing out, never "nothing forming".
    const atLimit = corroborated.filter((r) => (r.pct ?? 0) >= 1 - 1e-9).length;
    const head =
      corroborated.length === 1
        ? atLimit === 1
          ? "One reading at its recorded limit"
          : "One reading at extreme depth"
        : `${corroborated.length} readings at extreme depth`;
    const only = corroborated.length === 1 ? alertFor(corroborated[0]) : null;
    const underBit = only ? `under an active ${only.eventType}` : "under active NWS alerts";
    const tailBit = deep.length > corroborated.length ? `; ${deep.length} readings deep in their tails` : "";
    coda = `${head}, ${underBit}${tailBit}.`;
    if (forming) coda += " Something is starting to line up.";
  } else if (forming) {
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

/** "Jan 30, 2014" — for rhyme lines, where the year is the whole point. */
export function medDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`;
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
