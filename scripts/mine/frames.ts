/**
 * scripts/mine/frames.ts — LOOKOUT MINE frame-store loader (read-only).
 *
 * Loads the full board substrate into RAM for the mine's in-memory sweep:
 *   - board_layout      (the slot manifest — THE decode authority)
 *   - board_instruments (display metadata + slot_offset/slot_count)
 *   - board_frames      (~27,952 days × 142 packed bytes)
 *   - board_pool_luts   (32,208 rows — the doy-quantile tables, for INVERSION:
 *                        percentile → raw units, because a percentile is not a
 *                        product sentence)
 *
 * ─── THE LAW (the 07-11 bake-film bug) ────────────────────────────────────────
 * Slot offsets come ONLY from board_layout.slot_manifest. They are NEVER rebuilt
 * by counting instruments or metrics in this module or any caller. Read a byte
 * via slotOffset() / the manifest — nothing else. The bake-film bug was exactly
 * a re-derived offset drifting from the stored manifest.
 *
 * Byte semantics (board_frame_store migration): 255 = null/unreadable;
 * else pct = byte / 254, pct ∈ [0,1] = depth into the slot's danger tail.
 *
 * READ-ONLY: every request in this file is a GET. No writes, ever.
 *
 * Patterns copied verbatim from scripts/frames/rhyme.ts: service-key bootstrap,
 * fetchLayout, ordered day-PK pagination, hex-bytea decode. LUT math mirrors
 * scripts/frames/bake-luts.ts (the forward direction) — inversion here is its
 * exact inverse plus documented interpolation.
 *
 * Self-test:
 *   npx tsx scripts/mine/frames.ts --check
 */

import { execSync } from "child_process";

export const SUPABASE_URL = "https://rvhyotvklfowklzjahdd.supabase.co";
export const NSLOT = 142;

// ─── key + headers (rhyme.ts idiom, made lazy so importing this module does no IO) ─
let KEY: string | null = null;
function serviceKey(): string {
  if (KEY) return KEY;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return (KEY = process.env.SUPABASE_SERVICE_ROLE_KEY);
  const out = execSync(
    "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd --output json 2>/dev/null",
    { encoding: "utf-8", timeout: 30_000 },
  );
  const arr = JSON.parse(out);
  const k = (Array.isArray(arr) ? arr : []).find(
    (x: any) => x.id === "service_role" || x.name === "service_role",
  )?.api_key;
  if (!k) throw new Error("no service_role key");
  return (KEY = k);
}
function headers() {
  const k = serviceKey();
  return { Authorization: `Bearer ${k}`, apikey: k };
}

// ─── layout + instruments ──────────────────────────────────────────────────────
export interface SlotDef { offset: number; inst_id: string; metric: string; side: "low" | "high"; }
export interface InstrumentRow {
  id: string; kind: string; label: string; sublabel: string | null; lane: string;
  albers_x: number | null; albers_y: number | null;
  slot_offset: number; slot_count: number;
}

// Module state so invertPct/slotOffset can be plain exported functions.
let LAYOUT: { version: number; slots: SlotDef[] } | null = null;
// (inst_id|metric) → the sides that metric occupies in the manifest.
let METRIC_SIDES: Map<string, ("low" | "high")[]> | null = null;

/** board_layout latest by created_at. slots[offset] = manifest entry (THE LAW). */
export async function fetchLayout(): Promise<{ version: number; slots: SlotDef[] }> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/board_layout?select=version,slot_manifest&order=created_at.desc&limit=1`,
    { headers: headers() },
  );
  if (!res.ok) throw new Error(`board_layout ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("no board_layout row");
  const manifest = rows[0].slot_manifest as SlotDef[];
  const slots = new Array(NSLOT);
  for (const s of manifest) slots[s.offset] = s;
  LAYOUT = { version: rows[0].version, slots };
  METRIC_SIDES = new Map();
  for (const s of manifest) {
    const key = `${s.inst_id}|${s.metric}`;
    const arr = METRIC_SIDES.get(key) ?? [];
    arr.push(s.side);
    METRIC_SIDES.set(key, arr);
  }
  return LAYOUT;
}

/** Byte offset for (instrument, metric, side) — from the manifest ONLY (THE LAW). */
export function slotOffset(instId: string, metric: string, side: "low" | "high"): number {
  if (!LAYOUT) throw new Error("slotOffset: call fetchLayout() first");
  const hit = LAYOUT.slots.find(
    (s) => s && s.inst_id === instId && s.metric === metric && s.side === side,
  );
  if (!hit) throw new Error(`slotOffset: no manifest entry for ${instId}:${metric}:${side}`);
  return hit.offset;
}

/** board_instruments active, keyed by id, with slot span + display metadata. */
export async function fetchInstruments(): Promise<Map<string, InstrumentRow>> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/board_instruments?select=id,kind,label,sublabel,lane,albers_x,albers_y,slot_offset,slot_count&active=eq.true`,
    { headers: headers() },
  );
  if (!res.ok) throw new Error(`board_instruments ${res.status}`);
  const rows = await res.json();
  const m = new Map<string, InstrumentRow>();
  for (const r of rows) m.set(r.id, r as InstrumentRow);
  return m;
}

// ─── load ALL frames into RAM (rhyme.ts §3.5 pattern: one bounded read, ~4 MB) ──
// board_frames.day is the PK, so ordered pagination is index-backed (no 57014).
function decodeHexBytea(hex: string): Uint8Array {
  // PostgREST returns bytea as '\x7688d8...'
  const h = hex.startsWith("\\x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

/**
 * All frames, RAW bytes (255 = null; else pct = byte/254).
 * Returns the day→bytes map AND the sorted day array (pagination is day.asc,
 * so `days` arrives sorted; it is the sweep's iteration order).
 */
export async function fetchAllFrames(): Promise<{ days: string[]; frames: Map<string, Uint8Array> }> {
  const days: string[] = [];
  const frames = new Map<string, Uint8Array>();
  const PAGE = 1000;
  let offset = 0;
  process.stderr.write("loading frames");
  for (;;) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/board_frames?select=day,dots&order=day.asc&limit=${PAGE}&offset=${offset}`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error(`board_frames ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      days.push(r.day);
      frames.set(r.day, decodeHexBytea(r.dots));
    }
    process.stderr.write(".");
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  process.stderr.write(` ${days.length} frames\n`);
  return { days, frames };
}

// ─── pool LUTs — the percentile→raw-units inverter ──────────────────────────────
// board_pool_luts row (bake-luts.ts): per (instrument, metric, doy 1..366) the
// pool's sorted DISTINCT values `vals` with `below[j]` = count of pool values
// strictly < vals[j] (below[0]=0), pool size `n`, distinct `years`.
// Forward math (what made the byte): below(v) by binary search, then
//   lowRank = 1 − below/n ; highRank = below/n ; years<10 → pct clamped ≤0.6.
export interface Lut { vals: number[]; below: number[]; n: number; years: number; }

let LUTS: Map<string, Lut> | null = null;
const lutKey = (instId: string, metric: string, doy: number) => `${instId}|${metric}|${doy}`;

/** doy key: leap-year/2000 ordinal, EXACTLY bake-luts.ts's doyOfIso (Feb 29 = 60). */
export function doyOfIso(iso: string): number {
  const [, m, d] = iso.split("-").map(Number);
  return Math.round((Date.UTC(2000, m - 1, d) - Date.UTC(2000, 0, 1)) / 86400000) + 1;
}

/** All board_pool_luts rows for the current layout version, into RAM. */
export async function fetchLuts(): Promise<Map<string, Lut>> {
  if (!LAYOUT) await fetchLayout();
  const version = LAYOUT!.version;
  const luts = new Map<string, Lut>();
  const PAGE = 1000;
  let offset = 0;
  process.stderr.write("loading LUTs");
  for (;;) {
    // PK-ordered pagination (layout_version, instrument_id, metric, doy) — index-backed.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/board_pool_luts?select=instrument_id,metric,doy,vals,below,n,years` +
        `&layout_version=eq.${version}&order=instrument_id.asc,metric.asc,doy.asc&limit=${PAGE}&offset=${offset}`,
      { headers: headers() },
    );
    if (!res.ok) throw new Error(`board_pool_luts ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      luts.set(lutKey(r.instrument_id, r.metric, r.doy), {
        vals: r.vals, below: r.below, n: r.n, years: r.years,
      });
    }
    process.stderr.write(".");
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  process.stderr.write(` ${luts.size} LUT rows\n`);
  LUTS = luts;
  return luts;
}

/**
 * Invert a slot percentile back to raw units (°F, ft, mb, index value) so report
 * copy can say the number, not the rank.
 *
 * `side` may be omitted for metrics that occupy exactly ONE manifest slot
 * (residual_max_ft, residual_min_ft, min_pressure_mb, pressure_mb); two-sided
 * metrics (avg_high_f, needle value) occupy a low AND a high slot whose pcts
 * invert differently, so the caller must say which slot the pct came from.
 *
 * Math: the forward byte used the strict-less-than count b = below(v), with
 *   pct = (side==low) ? 1 − b/n : b/n.
 * So the target count is b* = (side==low ? 1−pct : pct) · n, and we invert the
 * step-function ECDF stored as (vals[j], below[j]): find the largest j with
 * below[j] ≤ b*, then linearly interpolate toward vals[j+1] across the tie mass
 * (standard quantile interpolation).
 *
 * PRECISION (honest): exact at every distinct pool value; between them the
 * answer is within one distinct-value gap at that rank. The pct itself is
 * byte-quantized (1/254 ≈ 0.004) and rank-quantized (1/n). CAVEAT: if the
 * pool has years < 10 the forward pct was CLAMPED to ≤ 0.6 (honesty floor) —
 * inverting pct = 0.6 there is a floor readout, the true value may be deeper.
 *
 * Returns null when the LUT row is missing or its pool is empty.
 */
export function invertPct(
  instId: string, metric: string, doy: number, pct: number, side?: "low" | "high",
): number | null {
  if (!LUTS) throw new Error("invertPct: call fetchLuts() first");
  const lut = LUTS.get(lutKey(instId, metric, doy));
  if (!lut || lut.n === 0 || lut.vals.length === 0) return null;

  let s = side;
  if (!s) {
    if (!METRIC_SIDES) throw new Error("invertPct: call fetchLayout() first");
    const sides = METRIC_SIDES.get(`${instId}|${metric}`);
    if (!sides || sides.length === 0) return null;
    if (sides.length > 1) {
      throw new Error(`invertPct: ${instId}:${metric} is two-sided — pass side "low"|"high"`);
    }
    s = sides[0];
  }

  const p = Math.min(1, Math.max(0, pct));
  const b = (s === "low" ? 1 - p : p) * lut.n; // target strict-less-than count
  const { vals, below } = lut;
  if (b <= 0) return vals[0];

  // largest j with below[j] <= b
  let lo = 0, hi = vals.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (below[mid] <= b) lo = mid; else hi = mid - 1;
  }
  if (lo === vals.length - 1) return vals[lo]; // at/deeper than the pool max
  const span = below[lo + 1] - below[lo]; // tie mass at vals[lo]
  const frac = span > 0 ? (b - below[lo]) / span : 0;
  return vals[lo] + frac * (vals[lo + 1] - vals[lo]);
}

// ─── moon pseudo-slots — deterministic, zero IO ─────────────────────────────────
/**
 * Synodic (mean-phase) approximation from the JPL new-moon epoch
 * 2000-01-06 18:14 UTC, mean synodic month 29.530588853 d.
 *
 * ACCURACY: a linear mean-cycle model ignores the Moon's orbital eccentricity
 * (real lunations vary 29.27–29.83 d), so instantaneous phase can be off by up
 * to ~±0.6 d near quarter phases, typically ±0.5 d or better near new/full.
 * Good enough for a moon PSEUDO-SLOT (pool bucketing / report color), never for
 * an ephemeris claim. Evaluated at 00:00 UTC of the given day.
 *
 * Returns phaseDays ∈ [0, 29.53) (0 = new, ~14.77 = full) and illumination ∈ [0,1]
 * via the standard (1 − cos)/2 phase-angle proxy.
 */
export const SYNODIC_DAYS = 29.530588853;
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14); // 2000-01-06 18:14 UTC (JPL)

export function moonPhase(dayStr: string): { phaseDays: number; illumination: number } {
  const [y, m, d] = dayStr.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d); // 00:00 UTC
  let phase = ((t - NEW_MOON_EPOCH_MS) / 86400000) % SYNODIC_DAYS;
  if (phase < 0) phase += SYNODIC_DAYS;
  const illumination = (1 - Math.cos((2 * Math.PI * phase) / SYNODIC_DAYS)) / 2;
  return { phaseDays: phase, illumination };
}

// ─── one-call loader for the mine ───────────────────────────────────────────────
export interface FrameStore {
  version: number;
  slots: SlotDef[];
  instruments: Map<string, InstrumentRow>;
  days: string[];
  frames: Map<string, Uint8Array>;
  luts: Map<string, Lut>;
}

/** Load everything the sweep needs, in parallel. */
export async function loadFrameStore(): Promise<FrameStore> {
  const [{ version, slots }, instruments, { days, frames }, luts] = await Promise.all([
    fetchLayout(), fetchInstruments(), fetchAllFrames(), fetchLuts(),
  ]);
  return { version, slots, instruments, days, frames, luts };
}

// ─── CLI self-test ──────────────────────────────────────────────────────────────
async function check() {
  let fails = 0;
  const assert = (ok: boolean, label: string, detail = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) fails++;
  };

  console.log("=== mine/frames.ts --check ===\n");

  // Moon first — zero IO, fails fast. Anchors from ephemeris:
  //   1969-07-20  Apollo 11 landing — waxing crescent ~6 d old (new moon 1969-07-14)
  //   2021-02-11  new moon 19:06 UTC — at 00:00 UTC age ≈ 28.7 d (≈0.8 d before new)
  //   2012-10-29  full moon 19:49 UTC (Sandy's landfall tide) — at 00:00 age ≈ 13.9 d
  const apollo = moonPhase("1969-07-20");
  assert(
    apollo.phaseDays >= 4.5 && apollo.phaseDays <= 7.5 && apollo.illumination > 0.1 && apollo.illumination < 0.5,
    "moon 1969-07-20 waxing crescent ~6d",
    `phaseDays=${apollo.phaseDays.toFixed(2)} illum=${apollo.illumination.toFixed(3)}`,
  );
  const uriNew = moonPhase("2021-02-11");
  assert(
    (uriNew.phaseDays >= 28.0 || uriNew.phaseDays <= 1.2) && uriNew.illumination < 0.04,
    "moon 2021-02-11 new moon",
    `phaseDays=${uriNew.phaseDays.toFixed(2)} illum=${uriNew.illumination.toFixed(3)}`,
  );
  const sandyFull = moonPhase("2012-10-29");
  assert(
    sandyFull.phaseDays >= 13.2 && sandyFull.phaseDays <= 16.2 && sandyFull.illumination > 0.94,
    "moon 2012-10-29 full moon (Sandy)",
    `phaseDays=${sandyFull.phaseDays.toFixed(2)} illum=${sandyFull.illumination.toFixed(3)}`,
  );

  // Full store load, timed.
  console.log("");
  const t0 = Date.now();
  const store = await loadFrameStore();
  const loadS = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nstore loaded in ${loadS}s — layout v${store.version}, ` +
    `${store.instruments.size} instruments, ${store.days.length} frames, ${store.luts.size} LUT rows\n`);

  // 142 slots — every offset 0..141 filled from the manifest.
  const filled = store.slots.filter(Boolean).length;
  assert(filled === NSLOT, `manifest fills all ${NSLOT} slots`, `filled=${filled}`);

  // ≥27,900 frames.
  assert(store.days.length >= 27_900, "≥27,900 frames", `${store.days.length}`);

  // Battery surge on Sandy: byte 254 via MANIFEST offset (the canonical anchor).
  {
    const off = slotOffset("tide-8518750", "residual_max_ft", "high");
    const b = store.frames.get("2012-10-30")?.[off];
    assert(b === 254, "Battery (tide-8518750) surge 2012-10-30 byte=254", `offset=${off} byte=${b}`);
  }

  // AO needle low slot on Uri's plunge: byte 254.
  {
    const off = slotOffset("needle-ao", "value", "low");
    const b = store.frames.get("2021-02-10")?.[off];
    assert(b === 254, "AO (needle-ao) low 2021-02-10 byte=254", `offset=${off} byte=${b}`);
  }

  // LUT inversion round-trip: AO low pct 1.0 at Feb-10's doy must land near Uri's
  // record daily AO of -5.285 (the pool minimum — pct 1.0 on the low side IS the min).
  {
    const doy = doyOfIso("2021-02-10");
    const v = invertPct("needle-ao", "value", doy, 1.0, "low");
    assert(
      v !== null && v <= -4.5 && v >= -6.5,
      "invertPct(needle-ao, value, low, pct=1.0) ≈ Uri's -5.285",
      `doy=${doy} → ${v?.toFixed(3)}`,
    );
  }

  console.log(`\n${fails ? "✗ FAIL" : "✓ PASS"} — ${fails} failure(s)`);
  process.exit(fails ? 1 : 0);
}

// Run the self-test only when invoked directly with --check (import-safe module).
if (process.argv.includes("--check")) {
  check().catch((e) => { console.error("FATAL:", e); process.exit(1); });
} else if (process.argv[1] && process.argv[1].endsWith("frames.ts") && process.argv[1].includes("mine")) {
  console.error("usage: npx tsx scripts/mine/frames.ts --check   (loader module — import it for the sweep)");
}
