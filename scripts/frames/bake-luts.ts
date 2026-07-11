/**
 * bake-luts.ts — THE BOARD Rung 2: bake the pool LUTs (spine §2, §5.1).
 *
 * The live edge (hunt-frame-daily) can't recompute 77-year same-doy pools per
 * invocation (it hangs past the edge wall). This bakes those pools ONCE, from the
 * SAME disk-cached series backfill-frames.ts uses, into board_pool_luts: per
 * (layout_version, instrument, metric, doy 1..366) a byte-quantile lookup that
 * converts a raw reading to the board byte via a single binary search, reproducing
 * scripts/board/tailDepth.ts EXACTLY (see the migration header for the math).
 *
 * SHARED ENGINE: pools are built with the identical doyOffset window the backfill
 * uses (buildPoolByMMDD → `2000-${mmdd}` target, doyOffset ≤ n_days); the byte is
 * the same tailDepth path. Anchors + a broad exactness sweep prove parity.
 *
 * SAFE ALONGSIDE THE BACKFILL: reads the frame cache READ-ONLY (never writes the
 * backfill's .frame-checkpoint.json — own checkpoint .lut-checkpoint.json), and
 * WRITES only board_pool_luts (a different table from board_frames — no contention).
 *
 * Usage:
 *   npx tsx scripts/frames/bake-luts.ts --verify   # anchors + broad exactness (offline, cache only)
 *   npx tsx scripts/frames/bake-luts.ts --status    # checkpoint progress
 *   npx tsx scripts/frames/bake-luts.ts             # THE BAKE (upserts board_pool_luts)
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI). Cache must be warm
 * (backfill-frames.ts populates scripts/frames/.frame-cache — all 71 series present).
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tailDepth, doyOffset, type Direction } from "../board/tailDepth.ts";
import { buildRegistry, type Instrument } from "./registry.ts";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPTS_DIR, ".frame-cache");
const CHECKPOINT_FILE = join(SCRIPTS_DIR, ".lut-checkpoint.json"); // OUR checkpoint, not the backfill's
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const UPSERT_BATCH = 400;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Keys / HTTP (5xx + network retry only, NEVER 4xx) ──────────────────────────
function bootstrapKeys() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const out = execSync("npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd --output json 2>/dev/null", { encoding: "utf-8", timeout: 30000 }).trim();
    const key = JSON.parse(out).find((k: any) => k.id === "service_role" || k.name === "service_role")?.api_key;
    if (!key || !key.startsWith("ey")) { console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI returned no key."); process.exit(1); }
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  }
}
function supaHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
}
class FatalHttpError extends Error {}
async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 6): Promise<Response> {
  let lastErr: any;
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = (await res.text()).slice(0, 200);
      if (res.status >= 400 && res.status < 500) throw new FatalHttpError(`${label} ${res.status}: ${body}`);
      lastErr = new Error(`${label} ${res.status}: ${body}`);
    } catch (e: any) { if (e instanceof FatalHttpError) throw e; lastErr = e; }
    if (a < attempts) await sleep(Math.min(1500 * 2 ** (a - 1), 30000));
  }
  throw lastErr;
}

// ─── Cache (READ-ONLY; the backfill owns writes) ────────────────────────────────
function cacheGet<T>(name: string): T | null {
  const p = join(CACHE_DIR, name);
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf-8")); } catch {} }
  return null;
}
// Load one instrument's per-field series from the warm cache (Map<field, Map<date,value>>).
function loadCachedSeries(inst: Instrument): Map<string, Map<string, number>> {
  const cached = cacheGet<Record<string, Record<string, number>>>(`series-${inst.id}.json`);
  if (!cached) { console.error(`  ✗ cache miss series-${inst.id}.json — run backfill-frames.ts first (it warms the cache).`); process.exit(1); }
  const m = new Map<string, Map<string, number>>();
  for (const [f, obj] of Object.entries(cached)) m.set(f, new Map(Object.entries(obj)));
  return m;
}

// ─── doy key (leap-year/2000 ordinal — bijective over the 366 mmdd pool-centers) ──
const DOY_EPOCH = Date.UTC(2000, 0, 1);
function doyOfMMDD(mmdd: string): number {
  const [m, d] = mmdd.split("-").map(Number);
  return Math.round((Date.UTC(2000, m - 1, d) - DOY_EPOCH) / 86400000) + 1;
}
function doyOfIso(iso: string): number { return doyOfMMDD(iso.slice(5)); }

// ─── The LUT for one (instrument, field, mmdd): sorted-distinct vals + strict-below ──
type Lut = { vals: number[]; below: number[]; n: number; years: number };
function buildLut(series: Map<string, number>, nDays: number, mmdd: string): Lut {
  const target = `2000-${mmdd}`; // doyOffset ignores year — identical membership to the backfill
  const pool: number[] = []; const yrs = new Set<string>();
  for (const [d, v] of series) if (doyOffset(d, target) <= nDays && Number.isFinite(v)) { pool.push(v); yrs.add(d.slice(0, 4)); }
  pool.sort((a, b) => a - b);
  const vals: number[] = []; const below: number[] = [];
  for (let i = 0; i < pool.length; i++) if (i === 0 || pool[i] !== pool[i - 1]) { vals.push(pool[i]); below.push(i); } // i = strict-less-than count
  return { vals, below, n: pool.length, years: yrs.size };
}

// ─── The daily lookup this LUT enables — one binary search → exact `below` → byte ──
// (mirrors, verbatim, what hunt-frame-daily will run; the parity check exercises it.)
function belowOf(lut: Lut, v: number): number {
  let lo = 0, hi = lut.vals.length; // first index with vals[j] >= v
  while (lo < hi) { const mid = (lo + hi) >> 1; if (lut.vals[mid] < v) lo = mid + 1; else hi = mid; }
  return lo < lut.below.length ? lut.below[lo] : lut.n;
}
const round3 = (x: number) => Math.round(x * 1000) / 1000;
const byteOf = (pct: number | null): number => (pct === null ? 255 : Math.round(pct * 254));
function byteFromLut(lut: Lut, v: number, side: Direction): number {
  if (lut.n === 0) return 255;
  const below = belowOf(lut, v);
  let pct = side === "low" ? 1 - below / lut.n : below / lut.n; // directional slot (two-sided expands to two slots)
  if (lut.years < 10) pct = Math.min(pct, 0.6);
  return byteOf(round3(pct));
}

// ─── Slot descriptors from the shared registry ──────────────────────────────────
type FieldJob = { instId: string; field: string; nDays: number };
function fieldJobs(): FieldJob[] {
  const { rows } = buildRegistry();
  const out: FieldJob[] = [];
  for (const inst of rows) for (const m of inst.metrics) out.push({ instId: inst.id, field: m.field, nDays: m.n_days });
  return out;
}

// ─── Checkpoint (OUR file) ──────────────────────────────────────────────────────
type Checkpoint = { doneJobs: string[]; layoutVersion: number };
function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) { try { return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8")); } catch {} }
  return { doneJobs: [], layoutVersion: 0 };
}
function saveCheckpoint(cp: Checkpoint) { writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2) + "\n"); }

async function upsertRows(rows: any[]) {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    await fetchWithRetry(`${SUPABASE_URL}/rest/v1/board_pool_luts?on_conflict=layout_version,instrument_id,metric,doy`, {
      method: "POST", headers: { ...supaHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + UPSERT_BATCH)),
    }, "board_pool_luts upsert");
  }
}

// ─── THE BAKE ───────────────────────────────────────────────────────────────────
async function runBake() {
  bootstrapKeys();
  const { rows, layout } = buildRegistry();
  const instById = new Map<string, Instrument>(rows.map((r) => [r.id, r]));
  const mmdds: string[] = []; // all 366 pool-centers (leap included)
  for (let m = 1; m <= 12; m++) { const days = new Date(Date.UTC(2000, m, 0)).getUTCDate(); for (let d = 1; d <= days; d++) mmdds.push(`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`); }

  const jobs = fieldJobs();
  console.log(`=== BAKE POOL LUTs === layout_version ${layout.version}`);
  console.log(`  ${jobs.length} (instrument,field) jobs × ${mmdds.length} doy = ${jobs.length * mmdds.length} LUT rows`);

  const cp = loadCheckpoint();
  if (cp.layoutVersion && cp.layoutVersion !== layout.version) { console.error(`  ✗ layout drift: checkpoint v${cp.layoutVersion} ≠ current v${layout.version}. Delete .lut-checkpoint.json (registry changed).`); process.exit(1); }
  const done = new Set(cp.doneJobs);

  for (const job of jobs) {
    const jobKey = `${job.instId}:${job.field}`;
    if (done.has(jobKey)) continue;
    const series = loadCachedSeries(instById.get(job.instId)!).get(job.field)!;
    const out: any[] = [];
    for (const mmdd of mmdds) {
      const lut = buildLut(series, job.nDays, mmdd);
      out.push({ layout_version: layout.version, instrument_id: job.instId, metric: job.field, doy: doyOfMMDD(mmdd), vals: lut.vals, below: lut.below, n: lut.n, years: lut.years });
    }
    await upsertRows(out);
    done.add(jobKey); cp.doneJobs = [...done]; cp.layoutVersion = layout.version; saveCheckpoint(cp);
    const nonEmpty = out.filter((r) => r.n > 0).length;
    console.log(`  ✓ ${jobKey}: ${out.length} doy rows (${nonEmpty} non-empty pools)`);
  }
  console.log(`\n=== DONE — ${jobs.length} jobs baked ===`);
}

// ─── VERIFY — Rung-2b anchors THROUGH THE LUT + a broad exactness sweep ──────────
function runVerify() {
  const { rows, layout } = buildRegistry();
  const instById = new Map<string, Instrument>(rows.map((r) => [r.id, r]));
  const nDaysOf = new Map<string, number>();
  for (const inst of rows) for (const m of inst.metrics) nDaysOf.set(`${inst.id}:${m.field}`, m.n_days);

  console.log(`=== VERIFY LUTs (layout_version ${layout.version}) ===\n`);
  // Anchors: raw v → LUT byte must equal the backfill's tailDepth byte (task acceptance).
  const anchors: { instId: string; field: string; side: Direction; day: string; expectByte: number }[] = [
    { instId: "ghcn-tx", field: "avg_high_f", side: "low", day: "2021-02-15", expectByte: 254 },
    { instId: "needle-ao", field: "value", side: "low", day: "2021-02-10", expectByte: 254 },
    { instId: "buoy-42035", field: "pressure_mb", side: "high", day: "2021-02-16", expectByte: 198 },
  ];
  let fails = 0;
  for (const a of anchors) {
    const series = loadCachedSeries(instById.get(a.instId)!).get(a.field)!;
    const nDays = nDaysOf.get(`${a.instId}:${a.field}`)!;
    const v = series.get(a.day);
    if (v === undefined) { console.log(`  ✗ ${a.instId} ${a.day}: no reading in cache`); fails++; continue; }
    const lut = buildLut(series, nDays, a.day.slice(5));
    const lutByte = byteFromLut(lut, v, a.side);
    // Independent ground truth: tailDepth over the SAME pool (rebuilt fresh here).
    const pool: number[] = []; const yrs = new Set<string>();
    for (const [d, val] of series) if (doyOffset(d, `2000-${a.day.slice(5)}`) <= nDays && Number.isFinite(val)) { pool.push(val); yrs.add(d.slice(0, 4)); }
    const truth = byteOf(tailDepth(v, pool, a.side, yrs.size).pct);
    const ok = lutByte === a.expectByte && lutByte === truth;
    console.log(`  ${ok ? "✓" : "✗"} ${a.instId} ${a.day} ${a.side}: v=${v} n=${lut.n} years=${lut.years} → LUT byte=${lutByte} (tailDepth=${truth}, expect ${a.expectByte})`);
    if (!ok) fails++;
  }

  // Broad sweep: for a spread of instruments × real days, LUT byte must equal
  // tailDepth byte for BOTH sides. This proves the representation is byte-exact,
  // not just at the three anchors.
  console.log(`\n  --- broad exactness sweep ---`);
  const sample = ["ghcn-tx", "ghcn-ca", "ghcn-me", "ghcn-fl", "tide-8574680", "tide-8518750", "buoy-42035", "buoy-44025", "needle-ao", "needle-nao"];
  let checks = 0, mismatches = 0;
  for (const id of sample) {
    const inst = instById.get(id)!;
    const seriesByField = loadCachedSeries(inst);
    for (const m of inst.metrics) {
      const series = seriesByField.get(m.field)!;
      const nDays = m.n_days;
      const sides: Direction[] = m.direction === "two-sided" ? ["low", "high"] : [m.direction];
      const dates = [...series.keys()];
      // Sample ~200 days spread across the whole record.
      const step = Math.max(1, Math.floor(dates.length / 200));
      for (let i = 0; i < dates.length; i += step) {
        const day = dates[i]; const v = series.get(day)!;
        const lut = buildLut(series, nDays, day.slice(5));
        const pool: number[] = []; const yrs = new Set<string>();
        for (const [d, val] of series) if (doyOffset(d, `2000-${day.slice(5)}`) <= nDays && Number.isFinite(val)) { pool.push(val); yrs.add(d.slice(0, 4)); }
        for (const side of sides) {
          const lb = byteFromLut(lut, v, side);
          const tb = byteOf(tailDepth(v, pool, side, yrs.size).pct);
          checks++; if (lb !== tb) { mismatches++; if (mismatches <= 8) console.log(`    ✗ ${id}:${m.field} ${day} ${side}: LUT ${lb} ≠ tailDepth ${tb} (v=${v})`); }
        }
      }
    }
  }
  console.log(`  swept ${checks} (day×side) checks across ${sample.length} instruments → ${mismatches} mismatch(es)`);
  if (mismatches) fails++;

  console.log(`\n${fails ? "✗ FAIL" : "✓ PASS"} — ${fails} failure(s)`);
  process.exit(fails ? 1 : 0);
}

function status() {
  const cp = loadCheckpoint();
  console.log(`lut checkpoint: ${cp.doneJobs.length} job(s) done, layoutVersion=${cp.layoutVersion || "none"}`);
}

async function main() {
  const arg = process.argv[2] || "";
  if (arg === "--status") return status();
  if (arg === "--verify") return runVerify();
  return runBake();
}
main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
