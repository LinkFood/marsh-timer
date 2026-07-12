/**
 * bake-film.ts — THE BOARD's generalized film baker (spine Rung past 1).
 *
 * bake-uri.ts hand-built one story. This bakes ANY event from an event-spec by
 * letting the DATA pick the cast: it reads the national frame store
 * (board_frames_range) over the run-up window, decodes each day's packed
 * per-instrument tail-depth against board_instruments' slot manifest, and selects
 * the instruments that went deep in their own tails coincident with the bloom's
 * landfall — in the order they moved. No hand-picking of who is in the film.
 *
 * Then, for the chosen instruments only, it reads their real values (bounded
 * effective_date windows, no order-by → no 57014) and computes each day's
 * percentile with the SAME engine the spine is built on (tailDepth over doy±N
 * pools). Every {v, pct} is real and traceable to rows in hunt_knowledge.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY pct IS RECOMPUTED, NOT READ FROM THE FRAME BYTES (a method-test finding):
 * The Sandy bake exposed that the PACKED frame bytes are corrupt at storm
 * extremes — The Battery's record 9.15 ft surge (2012-10-30) decodes to pct
 * 0.272 on its surge slot, while calm pre-storm days read 0.96+. Hand-computing
 * that same cell over The Battery's own doy±15 pool (n=1395 / 45 yr, max=9.15)
 * gives highRank = 0.999, and the board_pool_luts LUT agrees (0.999). So the LUT
 * and the pools are correct; the daily FRAME-PACKING step mis-wrote the tail
 * (the store's --verify only checked LUT-vs-tailDepth, never the packed frames).
 * The frame store is therefore used ONLY to PROPOSE the cast (a relative signal
 * that survives at the shoulder); the film's actual {v, pct} come from the honest
 * engine over live pools — byte-parity with the LUT, and the ONLY way the film
 * tells the truth instead of running backwards. See the returned report.
 *
 * Idempotent, READ-ONLY on the database, per-instrument disk cache.
 *
 * Usage:  npx tsx scripts/board/bake-film.ts sandy        (default: sandy)
 * Keys:   SUPABASE_SERVICE_ROLE_KEY (env) or the Supabase CLI.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { project } from "./projection.ts";
import { tailDepth, poolForDay, type Direction } from "./tailDepth.ts";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPTS_DIR, "..", "..");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";

// ─── Event specs ──────────────────────────────────────────────────────────────
interface EventSpec {
  id: string;                 // file stem → public/board/<id>.json
  title: string;
  subtitle: string;
  window: [string, string];   // run-up window (inclusive)
  landfall: string;           // the bloom day (storm's ground-truth date)
  coreRadius: number;         // ± days around landfall = the "core" gate window
  bloomStates: string[];      // storm-event states to tally for the bloom
  bloomLatLng: [number, number]; // where the bloom lands on the map
  bloomPlace: string;         // human name for the bloom card
  // Verified physical anchors that MUST surface as exact values (row spot-check).
  anchors: { inst: string; day: string; field: string; value: number; note: string }[];
}

const SPECS: Record<string, EventSpec> = {
  sandy: {
    id: "sandy-2012",
    title: "The October",
    subtitle: "Hurricane Sandy, as the instruments saw it come ashore",
    window: ["2012-10-08", "2012-11-08"],
    landfall: "2012-10-29", // ~2330Z near Brigantine, NJ
    coreRadius: 2,          // 10-27 … 10-31
    bloomStates: ["NJ", "NY"],
    bloomLatLng: [39.41, -74.36], // Brigantine / Atlantic City NJ landfall
    bloomPlace: "New Jersey & New York",
    anchors: [
      { inst: "tide-8518750", day: "2012-10-30", field: "residual_max_ft", value: 9.15, note: "The Battery record surge" },
      { inst: "tide-8516945", day: "2012-10-29", field: "residual_max_ft", value: 12.57, note: "Kings Point (LI Sound amplification)" },
      { inst: "buoy-44025", day: "2012-10-29", field: "min_pressure_mb", value: 958.2, note: "offshore buoy 44025 minimum pressure" },
    ],
  },
};

// ─── Selection knobs ──────────────────────────────────────────────────────────
// A candidate is PROPOSED by the frame store (lenient, so the corrupt-at-peak
// bytes still surface the real cast) then CONFIRMED by the honest engine.
const FRAME_PROPOSE_MIN = 0.62; // max-slot decoded pct within the core → candidate
// Ground instruments (tide/buoy/state-temp) EARN a place only at a near-record
// tail (top ~2%) whose PEAK lands on the storm (±LANDFALL_PEAK_RADIUS days) — the
// Uri lesson made structural: an ember must peak ON the storm, not on ambient
// autumn noise elsewhere on the continent. The SKY (a climate needle) is the
// driver: it LEADS the storm, so it is admitted on "went deep" (≥ SKY_MIN)
// anywhere in the run-up, never held to the landfall-day timing. This sky/ground
// split is the spine's own line ("instruments swell, the needle is the sky").
const HONEST_CAST_MIN = 0.98;   // ground: near-record tail depth
const LANDFALL_PEAK_RADIUS = 1; // ground: overall-peak day must be within ±1 of landfall
const SKY_MIN = 0.85;           // sky (needle): "went deep" in the run-up
const HONEST_RISE = 0.75;       // "first moved" = first day honest pct crosses this
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ─── Keys / headers ───────────────────────────────────────────────────────────
function bootstrapKeys() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const out = execSync(
      "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd --output json 2>/dev/null",
      { encoding: "utf-8", timeout: 30_000 },
    ).trim();
    const parsed = JSON.parse(out);
    const key = (Array.isArray(parsed) ? parsed : parsed.keys || []).find(
      (k: any) => k.name === "service_role" || k.id === "service_role",
    )?.api_key;
    if (!key || !key.startsWith("ey")) { console.error("  ✗ no service_role key"); process.exit(1); }
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  }
}
function headers() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
}

// ─── Retry — 5xx/network only ────────────────────────────────────────────────
class FatalHttpError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 5): Promise<Response> {
  let lastErr: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = (await res.text()).slice(0, 200);
      if (res.status >= 400 && res.status < 500) throw new FatalHttpError(`${label} ${res.status}: ${body}`);
      lastErr = new Error(`${label} ${res.status}: ${body}`);
    } catch (err: any) {
      if (err instanceof FatalHttpError) throw err;
      lastErr = err;
    }
    if (attempt < attempts) await sleep(Math.min(1500 * 2 ** (attempt - 1), 30_000));
  }
  throw lastErr;
}
async function fetchAll(query: string, label: string): Promise<any[]> {
  const out: any[] = []; let offset = 0; const PAGE = 1000;
  while (true) {
    const res = await fetchWithRetry(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?${query}&limit=${PAGE}&offset=${offset}`,
      { headers: headers() }, `${label}@${offset}`,
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`${label}: ${JSON.stringify(rows).slice(0, 160)}`);
    out.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function daysBetween(a: string, b: string): string[] {
  const out: string[] = [];
  const d = new Date(a + "T00:00:00Z"), end = new Date(b + "T00:00:00Z");
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
}
function coreWindow(landfall: string, radius: number): Set<string> {
  const s = new Set<string>();
  const d = new Date(landfall + "T00:00:00Z");
  for (let i = -radius; i <= radius; i++) {
    const c = new Date(d); c.setUTCDate(c.getUTCDate() + i);
    s.add(c.toISOString().slice(0, 10));
  }
  return s;
}

// ─── Disk cache (per-event) ───────────────────────────────────────────────────
function cacheDir(id: string) { return join(SCRIPTS_DIR, `.${id}-cache`); }
function cacheGet<T>(id: string, name: string): T | null {
  const p = join(cacheDir(id), name);
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf-8")); } catch {} }
  return null;
}
function cacheSet(id: string, name: string, data: any) {
  const dir = cacheDir(id);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(data));
}

// ─── Registry (live) ──────────────────────────────────────────────────────────
interface Metric { field: string; direction: Direction; n_days: number; min_years: number; label: string; }
interface Instrument {
  id: string; kind: string; label: string; sublabel: string | null; lane: string;
  lat: number | null; lng: number | null; albers_x: number; albers_y: number;
  source_ct: string; source_key: Record<string, string>; metrics: Metric[];
  slot_offset: number; slot_count: number;
}
async function loadRegistry(): Promise<Instrument[]> {
  const res = await fetchWithRetry(
    `${SUPABASE_URL}/rest/v1/board_instruments?select=*&active=eq.true&order=slot_offset.asc`,
    { headers: headers() }, "registry",
  );
  return await res.json();
}

// ─── Frame store: propose the cast ────────────────────────────────────────────
interface FrameDoc { instruments: any[]; frames: { day: string; dots: string }[]; layout_version: number; }
async function loadFrames(win: [string, string]): Promise<FrameDoc> {
  const res = await fetchWithRetry(
    `${SUPABASE_URL}/rest/v1/rpc/board_frames_range`,
    { method: "POST", headers: headers(), body: JSON.stringify({ p_from: win[0], p_to: win[1] }) },
    "frames",
  );
  return await res.json();
}
/** Decode frames → per-instrument max decoded pct within the core window. The
 *  frame bytes are unreliable at the tip (see header) so this only NOMINATES;
 *  the honest engine confirms. Returns id → { proposePeak, slotByField }. */
function proposeFromFrames(doc: FrameDoc, reg: Instrument[], core: Set<string>): Map<string, number> {
  // Build slot layout in slot_offset order (each instrument's metrics expand to slots).
  const slots: { instId: string; offset: number }[] = [];
  let off = 0;
  for (const inst of doc.instruments) for (const _ of inst.slots) { slots.push({ instId: inst.id, offset: off }); off++; }
  const propose = new Map<string, number>();
  for (const f of doc.frames) {
    if (!core.has(f.day)) continue;
    const bytes = Uint8Array.from(Buffer.from(f.dots, "base64"));
    for (const s of slots) {
      const byte = bytes[s.offset];
      if (byte === 255) continue;
      const pct = byte / 254;
      propose.set(s.instId, Math.max(propose.get(s.instId) ?? 0, pct));
    }
  }
  return propose;
}

// ─── Honest per-instrument series over the window ─────────────────────────────
interface SlotSeries { field: string; direction: Direction; nDays: number; day: Record<string, { v: number | null; pct: number | null }>; won: Record<string, "low" | "high" | null>; peak: number; peakDay: string; corePeak: number; coreDay: string; coreValDay: string; rise: string | null; }
interface DotBuild { inst: Instrument; winner: SlotSeries; }

// Season band (MM-DD) covering doy±maxN of the whole window, so per-year bounded
// reads (NO 57014) still hold the full same-doy pool. Sandy: Sep 23 → Nov 23.
let BAND_START = "09-23", BAND_END = "11-23", BAND_WRAP = false, BAND_FLOOR = 1900, BAND_CEIL = 2012;
function computeBand(win: string[], maxN: number, floorYear: number, ceilYear: number) {
  const buf = maxN + 3;
  const first = new Date(win[0] + "T00:00:00Z"); first.setUTCDate(first.getUTCDate() - buf);
  const last = new Date(win[win.length - 1] + "T00:00:00Z"); last.setUTCDate(last.getUTCDate() + buf);
  BAND_START = first.toISOString().slice(5, 10);
  BAND_END = last.toISOString().slice(5, 10);
  BAND_WRAP = BAND_START > BAND_END; // window straddles New Year (winter events)
  BAND_FLOOR = floorYear; BAND_CEIL = ceilYear;
}

// The daily Arctic-Oscillation needle isn't in hunt_knowledge (content_type
// 'cpc-daily-ao' is empty); its canonical source is the CPC file, 1950→now —
// exactly what Rung 1 (bake-uri) read. Shape it as {effective_date, value} rows
// so the generic per-metric loop below works unchanged.
const AO_URL = "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.ao.index.b500101.current.ascii";
async function loadCpcAoRows(): Promise<{ effective_date: string; value: string }[]> {
  const res = await fetchWithRetry(AO_URL, {}, "CPC AO");
  const text = await res.text();
  const out: { effective_date: string; value: string }[] = [];
  for (const line of text.split("\n")) {
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    const [y, mo, d, v] = p;
    if (!Number.isFinite(parseFloat(v))) continue;
    out.push({ effective_date: `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`, value: v });
  }
  return out;
}

async function loadInstrumentSeries(id: string, inst: Instrument, win: string[]): Promise<SlotSeries[]> {
  // Per-year bounded reads over the season band (btree effective_date, NO order-by
  // → no 57014). Empty years cost one tiny query (bake-uri's proven pattern).
  const keyEntries = Object.entries(inst.source_key);
  const keyFilter = keyEntries
    .map(([k, v]) => (k === "state_abbr" ? `state_abbr=eq.${v}` : `metadata->>${k}=eq.${v}`))
    .join("&");
  const fields = inst.metrics.map((m) => `${m.field}:metadata->>${m.field}`).join(",");
  const cacheName = `${id}.json`;
  let rows = cacheGet<any[]>(SPEC_ID, cacheName);
  if (!rows && inst.source_ct === "cpc-daily-ao") {
    rows = await loadCpcAoRows();
    cacheSet(SPEC_ID, cacheName, rows);
  }
  if (!rows) {
    rows = [];
    for (let y = BAND_FLOOR; y <= BAND_CEIL; y++) {
      const ranges = BAND_WRAP
        ? [[`${y - 1}-${BAND_START}`, `${y - 1}-12-31`], [`${y}-01-01`, `${y}-${BAND_END}`]]
        : [[`${y}-${BAND_START}`, `${y}-${BAND_END}`]];
      for (const [lo, hi] of ranges) {
        const page = await fetchAll(
          `content_type=eq.${inst.source_ct}&${keyFilter}` +
            `&effective_date=gte.${lo}&effective_date=lte.${hi}&select=effective_date,${fields}`,
          `${id} ${y}`,
        );
        rows.push(...page);
      }
    }
    cacheSet(SPEC_ID, cacheName, rows);
  }
  const out: SlotSeries[] = [];
  for (const m of inst.metrics) {
    // Build a per-day series (dedupe: keep the more-extreme reading on the danger side).
    const series = new Map<string, number>();
    for (const r of rows) {
      const v = parseFloat(r[m.field]);
      if (!Number.isFinite(v)) continue;
      const cur = series.get(r.effective_date);
      if (cur === undefined) series.set(r.effective_date, v);
      else series.set(r.effective_date, m.direction === "high" ? Math.max(cur, v) : m.direction === "low" ? Math.min(cur, v) : (Math.abs(v) > Math.abs(cur) ? v : cur));
    }
    const day: Record<string, { v: number | null; pct: number | null }> = {};
    const won: Record<string, "low" | "high" | null> = {};
    let peak = -1, peakDay = "", corePeak = -1, coreDay = "", rise: string | null = null;
    for (const d of win) {
      const v = series.get(d);
      if (v === undefined) { day[d] = { v: null, pct: null }; continue; }
      const { pool, years } = poolForDay(series, d, m.n_days);
      const t = tailDepth(v, pool, m.direction, years);
      day[d] = { v: round2(v), pct: t.pct };
      won[d] = t.won;
      if (t.pct !== null) {
        if (t.pct > peak) { peak = t.pct; peakDay = d; }
        if (rise === null && t.pct >= HONEST_RISE) rise = d;
      }
    }
    out.push({ field: m.field, direction: m.direction, nDays: m.n_days, day, won, peak, peakDay, corePeak: -1, coreDay: "", coreValDay: "", rise });
  }
  return out;
}

let SPEC_ID = "sandy-2012";

// ─── Player-contract kind mapping ─────────────────────────────────────────────
// The player (src/lib/boardPlayer.ts) + verify-film accept a fixed kind set.
// Map (registry kind + winning slot direction) → player kind + honest reading.
function playerKind(inst: Instrument, winner: SlotSeries): string {
  if (inst.kind === "needle") return "needle";
  if (inst.kind === "state-temp") return "state-temp";
  if (inst.kind === "tide") return winner.direction === "high" ? "tide-surge" : "tide-setdown";
  if (inst.kind === "buoy") return "buoy-pressure"; // low = storm low, high = ridge; reading keys on the value
  return inst.kind;
}
function sublabelFor(inst: Instrument, winner: SlotSeries): string {
  if (inst.kind === "tide") return winner.direction === "high" ? "storm surge" : "tide setdown";
  if (inst.kind === "buoy") return winner.direction === "low" ? "storm pressure" : "ridge pressure";
  if (inst.kind === "state-temp") return winner.won[winner.coreValDay] === "high" ? "air temperature · warm side" : "air temperature · cold side";
  return inst.sublabel ?? "";
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  bootstrapKeys();
  const which = (process.argv[2] || "sandy").toLowerCase();
  const spec = SPECS[which];
  if (!spec) { console.error(`unknown event "${which}" — known: ${Object.keys(SPECS).join(", ")}`); process.exit(1); }
  SPEC_ID = spec.id;
  console.log(`=== BAKING THE BOARD: ${spec.title} (${spec.id}) ===\n`);

  const win = daysBetween(spec.window[0], spec.window[1]);
  const core = coreWindow(spec.landfall, spec.coreRadius);
  const reg = await loadRegistry();
  console.log(`registry: ${reg.length} instruments`);
  const maxN = Math.max(...reg.flatMap((i) => i.metrics.map((m) => m.n_days)));
  computeBand(win, maxN, 1950, Number(spec.landfall.slice(0, 4)));
  console.log(`season band per year: ${BAND_START} → ${BAND_END}${BAND_WRAP ? " (wraps year)" : ""}, ${BAND_FLOOR}–${BAND_CEIL}`);

  // 1) The frame store PROPOSES the cast (decode packed pcts in the core window).
  const frames = await loadFrames(spec.window);
  const proposed = proposeFromFrames(frames, reg, core);
  const candidates = reg.filter((i) => (proposed.get(i.id) ?? 0) >= FRAME_PROPOSE_MIN);
  console.log(`frame store proposes ${candidates.length}/${reg.length} candidates (core max-slot ≥ ${FRAME_PROPOSE_MIN})\n`);

  // 2) The honest engine CONFIRMS: recompute each candidate's true tail-depth and
  //    keep only those that go near-record with their PEAK DAY on the landfall.
  const kept: DotBuild[] = [];
  const rejected: { id: string; why: string; honestPeak: number; peakDay: string }[] = [];
  for (const inst of candidates) {
    const slots = await loadInstrumentSeries(inst.id, inst, win);
    // winning slot = the one that goes deepest inside the core window. pct saturates
    // (many landfall days read 0.999), so also track coreValDay = the RECORD day
    // (max |v|) for honest display in beats/receipts.
    for (const s of slots) {
      for (const d of core) {
        const datum = s.day[d]; if (!datum || datum.pct == null) continue;
        if (datum.pct > s.corePeak) { s.corePeak = datum.pct; s.coreDay = d; }
      }
      // The RECORD day = the day whose value is most extreme IN THE WINNING
      // DIRECTION (a low-pressure buoy's record is its MINIMUM, not its |max|).
      // Two-sided (temp) has no fixed direction → the deepest-pct day is the record.
      let bestVal: number | null = null;
      for (const d of core) {
        const datum = s.day[d]; if (!datum || datum.v == null || datum.pct == null) continue;
        const better = s.direction === "high" ? bestVal == null || datum.v > bestVal
          : s.direction === "low" ? bestVal == null || datum.v < bestVal
          : false; // two-sided handled below
        if (better) { bestVal = datum.v; s.coreValDay = d; }
      }
      if (!s.coreValDay) s.coreValDay = s.coreDay; // two-sided → deepest-pct day
    }
    const winner = slots.reduce((a, b) => (b.corePeak > a.corePeak ? b : a));
    const isSky = inst.kind === "needle";
    if (isSky) {
      // The driver: admitted on depth alone (it leads, no landfall-timing gate).
      if (winner.peak >= SKY_MIN) kept.push({ inst, winner });
      else rejected.push({ id: inst.id, why: `sky peak ${winner.peak.toFixed(3)} < ${SKY_MIN}`, honestPeak: winner.peak, peakDay: winner.peakDay });
    } else {
      const onLandfall = Math.abs(dayDiff(winner.peakDay, spec.landfall)) <= LANDFALL_PEAK_RADIUS;
      if (winner.corePeak >= HONEST_CAST_MIN && onLandfall) {
        kept.push({ inst, winner });
      } else {
        rejected.push({ id: inst.id, why: winner.corePeak < HONEST_CAST_MIN ? `honest corePeak ${winner.corePeak.toFixed(3)} < ${HONEST_CAST_MIN}` : `peak ${winner.peakDay} not within ±${LANDFALL_PEAK_RADIUS}d of landfall`, honestPeak: winner.peak, peakDay: winner.peakDay });
      }
    }
  }
  // Order by the day each instrument first moved (rise), then by core depth.
  kept.sort((a, b) => {
    const ra = a.winner.rise ?? "9999", rb = b.winner.rise ?? "9999";
    if (ra !== rb) return ra < rb ? -1 : 1;
    return b.winner.corePeak - a.winner.corePeak;
  });

  console.log(`\n── THE CAST (${kept.length}) — the data picked these, in the order they moved ──`);
  for (const k of kept) console.log(`  ${(k.winner.rise ?? "—").padEnd(10)} ${k.inst.id.padEnd(15)} [${playerKind(k.inst, k.winner)}] corePeak=${k.winner.corePeak.toFixed(3)}@${k.winner.coreDay} via ${k.winner.field}`);
  console.log(`\n── REJECTED (proposed by frames, failed honest confirm) ──`);
  for (const r of rejected) console.log(`  ${r.id.padEnd(15)} ${r.why} (overall ${r.honestPeak.toFixed(3)}@${r.peakDay})`);

  // 3) Build the dots (series {v, pct} straight from the honest engine).
  const dots = kept.map(({ inst, winner }) => {
    const x = inst.lat != null && inst.lng != null ? project(inst.lat, inst.lng).x : inst.albers_x;
    const y = inst.lat != null && inst.lng != null ? project(inst.lat, inst.lng).y : inst.albers_y;
    const series: Record<string, { v: number | null; pct: number | null }> = {};
    for (const d of win) {
      const datum = winner.day[d];
      series[d] = datum ?? { v: null, pct: null };
    }
    return {
      id: inst.id, label: inst.label, sublabel: sublabelFor(inst, winner),
      kind: playerKind(inst, winner), x, y, series,
    };
  });

  // 4) Bloom — verified storm-event tally + the physical anchors.
  const tally = await stormTally(spec.bloomStates, spec.landfall);
  console.log(`\n${spec.bloomPlace} storm tally: ${tally.count} events · ${tally.deaths} deaths · $${tally.damage.toLocaleString()}`);
  const blooms = [{
    date: spec.landfall,
    x: project(spec.bloomLatLng[0], spec.bloomLatLng[1]).x,
    y: project(spec.bloomLatLng[0], spec.bloomLatLng[1]).y,
    label: `${spec.bloomPlace}: ${tally.count} recorded events · ${tally.deaths} deaths · $${(tally.damage / 1e6).toFixed(0)}M`,
  }];

  // 5) Strings — EARNED only (Uri gating): a thread tightens only when its source
  //    is extreme AND the landfall surge is present the SAME day, so it peaks ON
  //    the storm, never on pre-storm noise. Target = the strongest surge gauge.
  const strings = buildStrings(kept, win, core, spec);

  // 6) Beats — porch voice, every number pulled from the baked series / anchors.
  const beats = buildBeats(kept, dots, win, spec, tally);

  const doc = {
    story: spec.id, title: spec.title, subtitle: spec.subtitle,
    window: spec.window, projection: { width: 975, height: 610 },
    generated: new Date().toISOString(),
    dots, strings, blooms, beats,
  };
  const outPath = join(REPO_ROOT, "public", "board", `${spec.id}.json`);
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(doc));
  const bytes = readFileSync(outPath).length;
  console.log(`\n✓ wrote ${outPath} — ${dots.length} dots, ${strings.length} strings, ${blooms.length} bloom, ${beats.length} beats · ${(bytes / 1024).toFixed(1)} KB`);

  // Spot-check the verified anchors surface as exact values.
  console.log(`\n── ANCHOR SPOT-CHECK ──`);
  for (const a of spec.anchors) {
    const dot = dots.find((d) => d.id === a.inst);
    const got = dot?.series[a.day]?.v;
    const ok = got != null && Math.abs(got - a.value) < 0.01;
    console.log(`  ${ok ? "✓" : "✗"} ${a.inst} ${a.day} ${a.field} = ${got} (want ${a.value}) — ${a.note}`);
  }
}

// ─── Storm-event tally (bloom) ────────────────────────────────────────────────
async function stormTally(states: string[], landfall: string): Promise<{ count: number; deaths: number; damage: number }> {
  const from = shiftDay(landfall, -3), to = shiftDay(landfall, 4);
  let count = 0, deaths = 0, damage = 0;
  for (const st of states) {
    const rows = await fetchAll(
      `content_type=eq.storm-event&state_abbr=eq.${st}` +
        `&effective_date=gte.${from}&effective_date=lte.${to}&metadata->>superseded=is.null` +
        `&select=deaths:metadata->>deaths,damage:metadata->>damage_usd`,
      `storm ${st}`,
    );
    count += rows.length;
    for (const r of rows) { deaths += parseFloat(r.deaths) || 0; damage += parseFloat(r.damage) || 0; }
  }
  return { count, deaths, damage };
}
function shiftDay(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

// ─── Strings (earned) ─────────────────────────────────────────────────────────
function buildStrings(kept: DotBuild[], win: string[], core: Set<string>, spec: EventSpec) {
  // Target = the surge gauge with the highest RECORD surge (the harbor the water
  // hit hardest). pct saturates at 0.999 across gauges, so rank by feet of surge —
  // Kings Point's 12.57 ft, not whichever gauge's byte tied first.
  const surges = kept.filter((k) => k.inst.kind === "tide" && k.winner.direction === "high");
  const surgeVal = (k: DotBuild) => k.winner.day[k.winner.coreValDay]?.v ?? -Infinity;
  const target = surges.reduce<DotBuild | null>((a, b) => (!a || surgeVal(b) > surgeVal(a) ? b : a), null);
  if (!target) return [];
  const targetPct = (d: string) => target.winner.day[d]?.pct ?? null;

  const strings: any[] = [];

  // (A) The offshore low → the harbor: the buoy whose pressure crashed, gated on
  //     the surge response the same day (coincidence = part of THIS fusion).
  const buoy = kept.filter((k) => k.inst.kind === "buoy").sort((a, b) => b.winner.corePeak - a.winner.corePeak)[0];
  if (buoy && buoy.inst.id !== target.inst.id) {
    const act: Record<string, number> = {};
    for (const d of win) {
      const src = buoy.winner.day[d]?.pct, tp = targetPct(d);
      act[d] = src == null || tp == null ? 0 : round3(clamp01((src - 0.35) / 0.6) * clamp01(tp));
    }
    const anchorDay = buoy.winner.coreValDay;
    const mb = buoy.winner.day[buoy.winner.coreValDay]?.v;
    strings.push({
      from: buoy.inst.id, to: target.inst.id,
      receipt: `The storm was a collapsing low: buoy ${buoy.inst.id.replace("buoy-", "")} bottomed at ${mb} mb on ${niceDay(anchorDay)} — the offshore pressure that drove the water into the harbor, the same day the surge came ashore.`,
      activation: act,
    });
  }

  // (B) The block → the harbor: the climate needle (AO). It leads, so tautness
  //     follows its 7-day trailing depth × the surge response (Uri's AO→TX rule),
  //     so it stays taut through the surge the block steered in, not before.
  const needle = kept.find((k) => k.inst.kind === "needle");
  if (needle && needle.inst.id !== target.inst.id) {
    const act: Record<string, number> = {};
    for (let i = 0; i < win.length; i++) {
      let trace = 0;
      for (let j = Math.max(0, i - 7); j <= i; j++) { const ap = needle.winner.day[win[j]]?.pct; if (ap != null && ap > trace) trace = ap; }
      const tp = targetPct(win[i]);
      act[win[i]] = tp == null ? 0 : round3(clamp01(2 * (trace - 0.5)) * clamp01(tp));
    }
    const nv = needle.winner.day[needle.winner.coreValDay]?.v;
    strings.push({
      from: needle.inst.id, to: target.inst.id,
      receipt: `A blocking ridge stood over the North Atlantic — the ${needle.inst.label} held near ${nv} through the storm, the wall that turned Sandy hard west into the coast instead of out to sea.`,
      activation: act,
    });
  }

  // (C) The surge cluster → the harbor: the OTHER surge gauges tightening together
  //     as one wall of water (strongest neighbor, coincident with the target).
  const others = surges.filter((s) => s.inst.id !== target.inst.id);
  if (others.length) {
    const act: Record<string, number> = {};
    for (const d of win) {
      const srcMax = Math.max(0, ...others.map((o) => o.winner.day[d]?.pct ?? 0));
      const tp = targetPct(d);
      act[d] = tp == null ? 0 : round3(clamp01((srcMax - 0.35) / 0.6) * clamp01(tp));
    }
    const strongest = others.reduce((a, b) => (b.winner.corePeak > a.winner.corePeak ? b : a));
    const sv = strongest.winner.day[strongest.winner.coreValDay]?.v;
    strings.push({
      from: strongest.inst.id, to: target.inst.id,
      receipt: `The whole coast rose at once: ${strongest.inst.label} crested ${sv} ft above prediction the same day the harbor did — one wall of water, not a local quirk.`,
      activation: act,
    });
  }

  return strings;
}

// ─── Beats (porch voice) ──────────────────────────────────────────────────────
function niceDay(iso: string): string {
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [, m, d] = iso.split("-").map(Number);
  return `${M[m - 1]} ${d}`;
}
// "than P% of …" but never "100%": a saturated tail reads "any day it has on record".
function tailPhrase(pct: number | null): string {
  if (pct == null) return "";
  return pct >= 0.995 ? "any day it has on record" : `${Math.round(pct * 100)}% of its record`;
}
function buildBeats(kept: DotBuild[], dots: any[], win: string[], spec: EventSpec, tally: { count: number; deaths: number; damage: number }) {
  const beats: { date: string; line: string }[] = [];
  const needle = kept.find((k) => k.inst.kind === "needle");
  const buoy = kept.filter((k) => k.inst.kind === "buoy").sort((a, b) => b.winner.corePeak - a.winner.corePeak)[0];
  const surges = kept.filter((k) => k.inst.kind === "tide" && k.winner.direction === "high").sort((a, b) => (b.winner.day[b.winner.coreValDay]?.v ?? 0) - (a.winner.day[a.winner.coreValDay]?.v ?? 0));
  const v = (k: DotBuild | undefined, d: string) => (k ? k.winner.day[d]?.v ?? null : null);
  const pctOf = (k: DotBuild | undefined, d: string) => (k ? k.winner.day[d]?.pct ?? null : null);
  const push = (date: string, line: string) => beats.push({ date, line });

  // 1 — the quiet open, but the needle is already leaning.
  const ao0 = needle ? v(needle, spec.window[0]) : null;
  push(spec.window[0], ao0 != null
    ? `The ground is quiet. But the ${needle!.inst.label} already reads ${ao0} — out over the Atlantic a block is setting up before anyone on the coast has felt a thing.`
    : `The ground is quiet. Out over the Atlantic, though, a low is already deepening where nobody lives.`);

  // 2 — the block hardens (needle's deepest core day).
  if (needle) {
    const nd = needle.winner.coreValDay;
    push(shiftDay(spec.landfall, -6), `The block hardens. The ${needle.inst.label} settles to ${v(needle, nd)} and holds — a wall of high pressure over the North Atlantic with nowhere for a storm to escape but west.`);
  }
  // 3 — the offshore low forms (buoy, three days out).
  if (buoy) {
    const d = shiftDay(spec.landfall, -3);
    const bv = v(buoy, d);
    if (bv != null) push(d, `Offshore, the barometer starts to fall. Buoy ${buoy.inst.id.replace("buoy-", "")} reads ${bv} mb and dropping — the low is finding its footing over open water.`);
  }
  // 4 — still falling, the day before landfall.
  if (buoy) {
    const d = shiftDay(spec.landfall, -1);
    const bv = v(buoy, d);
    if (bv != null) push(d, `The fall keeps steepening. By ${niceDay(d)} buoy ${buoy.inst.id.replace("buoy-", "")} is down to ${bv} mb, and the track bends hard toward the coast the block walled off.`);
  }
  // 5 — landfall: the low bottoms AND the water comes ashore (the record day).
  const battery = surges.find((s) => s.inst.id === "tide-8518750");
  const kings = surges.find((s) => s.inst.id === "tide-8516945");
  const lead = battery ?? surges[0];
  const second = kings ?? surges.find((s) => s.inst.id !== lead?.inst.id);
  if (lead) {
    const ld = lead.winner.coreValDay;
    let line = "";
    if (buoy) { const bd = buoy.winner.coreValDay; line += `The barometer bottoms at ${v(buoy, bd)} mb offshore and the water comes for the harbor. `; }
    else line += `The water comes for the harbor. `;
    line += `${lead.inst.label} crests ${v(lead, ld)} feet above the tide it was owed — higher than ${tailPhrase(pctOf(lead, ld))}`;
    if (second) { const sd = second.winner.coreValDay; line += `; up the Sound ${second.inst.label} tops ${v(second, sd)} feet, Long Island funneling a bad tide into a record one`; }
    push(spec.landfall, line + `.`);
  }
  // 6 — the toll (the bloom), the morning the count comes in.
  push(shiftDay(spec.landfall, 1), `Then the ground answers. ${spec.bloomPlace}: ${tally.count} recorded storm events, ${tally.deaths} deaths, $${(tally.damage / 1e9).toFixed(0)} billion in losses on the books — the water the offshore low foretold.`);
  // 7 — the block lets go.
  if (needle) push(shiftDay(spec.landfall, 2), `The block finally lets go and the storm's remains spin inland. But the bill on the ground has already come due.`);
  // 8 — the close.
  push(spec.window[1], `The archive kept every thread of it: the block, the offshore low, the harbor gauges that all rose on the same day. Nobody had to draw the lines — the readings did.`);

  // Distinct dates only (the player shows the last beat on a shared day), window-bounded.
  const seen = new Set<string>();
  return beats.filter((b) => {
    if (b.date < spec.window[0] || b.date > spec.window[1] || seen.has(b.date)) return false;
    seen.add(b.date); return true;
  });
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
