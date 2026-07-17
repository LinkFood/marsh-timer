/**
 * backfill-frames.ts — THE BOARD Rung 2c/2d: the one-time 27,740-day frame
 * computation (spine §4). One row per day, 1950→today, every instrument's
 * depth-into-its-own-tail packed as a bytea of one-sided uint8 pcts.
 *
 * SHAPE (spine §4.2 — load-all-per-instrument, compute-all-in-memory, write-per-year):
 *   for each instrument:
 *     series = load full history        (bounded per-year reads, NO order-by → 57014,
 *                                        ≤1000-row pages, effective_date year-bounds)
 *     poolByMMDD = same-doy±N pools sliced once from the series (reused across all years)
 *     fill this instrument's slot column(s) of the byte matrix for all days
 *   assemble frames day-by-day from the matrix → pack bytea → upsert per year (365/txn)
 *
 * The percentile mirrors scripts/board/tailDepth.ts EXACTLY — it CALLS poolForDay +
 * tailDepth, the same engine verify-engine.ts proves against Rung 1. A two-sided
 * metric stores TWO one-sided bytes (low, high) per §2.3; the client renders max().
 *
 * Memory: the byte MATRIX is 144 slots × ~27,950 days ≈ 4 MB; only ONE instrument's
 * series + pools live at a time (built, used to fill the matrix, then freed).
 *
 * Checkpoint: { lastYearDone } — kill+resume is idempotent (day PK upsert). Series
 * are disk-cached (scripts/frames/.frame-cache) so a resume re-reads nothing.
 *
 * WRITE PIPE — one at a time (§4.1). Reads hunt_knowledge heavily (fan-out fine);
 * writes ONLY board_frames. Run alone in the claimed lane, off-peak.
 *
 * Usage:
 *   npx tsx scripts/frames/backfill-frames.ts --dry-run   # offline plan, NO DB, NO writes
 *   npx tsx scripts/frames/backfill-frames.ts --verify    # Rung-2b anchors (live reads + CPC)
 *   npx tsx scripts/frames/backfill-frames.ts --status    # checkpoint progress
 *   npx tsx scripts/frames/backfill-frames.ts             # THE RUN (write pipe)
 *   YEAR_FROM=2021 YEAR_TO=2021 npx tsx …                  # bounded (Rung 2c: 2021 only)
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI).
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tailDepth, poolForDay, doyOffset, type Direction } from "../board/tailDepth.ts";
import { buildRegistry, type SlotManifestEntry, type Instrument } from "./registry.ts";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPTS_DIR, ".frame-cache");
const CHECKPOINT_FILE = join(SCRIPTS_DIR, ".frame-checkpoint.json");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const AO_URL = "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.ao.index.b500101.current.ascii";
const PAGE = 1000;
const START_DAY = "1950-01-01";

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

// ─── Cache ───────────────────────────────────────────────────────────────────────
function cacheGet<T>(name: string): T | null {
  const p = join(CACHE_DIR, name);
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf-8")); } catch {} }
  return null;
}
function cacheSet(name: string, data: any) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, name), JSON.stringify(data));
}

// ─── Date axis ─────────────────────────────────────────────────────────────────
function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function dayList(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const d = new Date(fromIso + "T00:00:00Z"), end = new Date(toIso + "T00:00:00Z");
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

// ─── Series loaders (bounded, NO order-by) ──────────────────────────────────────
async function fetchAllBounded(baseQuery: string, y: number): Promise<any[]> {
  const out: any[] = []; let offset = 0;
  while (true) {
    const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/hunt_knowledge?${baseQuery}&effective_date=gte.${y}-01-01&effective_date=lte.${y}-12-31&limit=${PAGE}&offset=${offset}`, { headers: supaHeaders() }, `${baseQuery.slice(0, 30)}@${y}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`non-array @${y}: ${JSON.stringify(rows).slice(0, 120)}`);
    out.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

// Keep-extreme dedup aligned with a field's danger side (twin rows / null copies).
function put(map: Map<string, number>, date: string, v: number, side: "low" | "high" | "last") {
  if (!Number.isFinite(v)) return;
  const cur = map.get(date);
  if (cur === undefined) { map.set(date, v); return; }
  if (side === "low") map.set(date, Math.min(cur, v));
  else if (side === "high") map.set(date, Math.max(cur, v));
  else map.set(date, v);
}

// Load one instrument's per-field series (Map<field, Map<date, value>>), disk-cached.
async function loadSeries(inst: Instrument, endYear: number): Promise<Map<string, Map<string, number>>> {
  const cacheName = `series-${inst.id}.json`;
  const cached = cacheGet<Record<string, Record<string, number>>>(cacheName);
  if (cached) {
    const m = new Map<string, Map<string, number>>();
    for (const [f, obj] of Object.entries(cached)) m.set(f, new Map(Object.entries(obj)));
    return m;
  }
  const fields = inst.metrics.map((mt) => mt.field);
  const sideOf: Record<string, "low" | "high" | "last"> = {};
  for (const mt of inst.metrics) sideOf[mt.field] = mt.direction === "two-sided" ? "last" : mt.direction;
  const series = new Map<string, Map<string, number>>();
  for (const f of fields) series.set(f, new Map());

  if (inst.source_ct === "cpc-daily-ao") {
    // Daily CPC Arctic-Oscillation file (public ftp). The Uri anchor needs daily.
    let text = cacheGet<string>("cpc-ao.txt") as any;
    if (!text) { text = await (await fetchWithRetry(AO_URL, {}, "CPC AO")).text(); cacheSet("cpc-ao.txt", text); }
    const vm = series.get("value")!;
    for (const line of text.split("\n")) {
      const p = line.trim().split(/\s+/);
      if (p.length < 4) continue;
      const [y, mo, d, v] = p; const val = parseFloat(v);
      if (Number.isFinite(val)) put(vm, `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`, val, "last");
    }
  } else if (inst.source_ct === "climate-index-daily") {
    // Daily CPC index rows in the archive (the 2026-07-11 AO/NAO/PNA daily pipe).
    // Same read hunt-frame-daily's day-0 lane uses; -99 sentinel = missing.
    const id = inst.source_key.index_id;
    const vm = series.get("value")!;
    for (let y = 1950; y <= endYear; y++) {
      const rows = await fetchAllBounded(`content_type=eq.climate-index-daily&metadata->>index_id=eq.${id}&select=effective_date,val:metadata->>value`, y);
      for (const r of rows) { const val = parseFloat(r.val); if (Number.isFinite(val) && val > -99) put(vm, r.effective_date, val, "last"); }
    }
  } else if (inst.source_ct === "climate-index") {
    // Monthly index → month-held daily step (honest but coarse until daily-AO pipe; §4.4).
    const id = inst.source_key.index_id;
    const rows: any[] = [];
    for (let y = 1950; y <= endYear; y++) rows.push(...await fetchAllBounded(`content_type=eq.climate-index&metadata->>index_id=eq.${id}&select=effective_date,val:metadata->>value`, y));
    const vm = series.get("value")!;
    for (const r of rows) {
      const val = parseFloat(r.val);
      if (!Number.isFinite(val) || val <= -99) continue; // -99.9 = missing marker
      const [y, mo] = r.effective_date.split("-").map(Number);
      const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      for (let dd = 1; dd <= days; dd++) vm.set(`${y}-${String(mo).padStart(2, "0")}-${String(dd).padStart(2, "0")}`, val);
    }
  } else {
    // DB station/state lanes, per-year bounded, year-round.
    const key = inst.source_key.state_abbr ? `state_abbr=eq.${inst.source_key.state_abbr}` : `metadata->>station_id=eq.${inst.source_key.station_id}`;
    const sel = "select=effective_date," + fields.map((f, i) => `f${i}:metadata->>${f}`).join(",");
    const startYear = inst.source_ct === "ocean-buoy-historical" ? 1970 : inst.source_ct === "tide-gauge" ? 1900 : 1950;
    for (let y = startYear; y <= endYear; y++) {
      const rows = await fetchAllBounded(`content_type=eq.${inst.source_ct}&${key}&${sel}`, y);
      for (const r of rows) fields.forEach((f, i) => put(series.get(f)!, r.effective_date, parseFloat(r[`f${i}`]), sideOf[f]));
    }
  }

  const dump: Record<string, Record<string, number>> = {};
  for (const [f, m] of series) dump[f] = Object.fromEntries(m);
  cacheSet(cacheName, dump);
  return series;
}

// ─── Pool precompute (spine §4.2 — slice the ±N window once per calendar day) ────
type Pool = { pool: number[]; years: number };
function buildPoolByMMDD(series: Map<string, number>, nDays: number, mmdds: string[]): Map<string, Pool> {
  // Snapshot the series as [date, value] so we scan once per target mmdd.
  const entries = [...series.entries()];
  const out = new Map<string, Pool>();
  for (const mmdd of mmdds) {
    const target = `2000-${mmdd}`; // doyOffset ignores the year
    const pool: number[] = []; const yrs = new Set<string>();
    for (const [d, v] of entries) {
      if (doyOffset(d, target) <= nDays && Number.isFinite(v)) { pool.push(v); yrs.add(d.slice(0, 4)); }
    }
    out.set(mmdd, { pool, years: yrs.size });
  }
  return out;
}

// ─── Slot descriptors (from the shared registry manifest) ───────────────────────
type Slot = { offset: number; instId: string; field: string; side: "low" | "high"; nDays: number };
function buildSlots(rows: (Instrument & { slot_offset: number })[], manifest: SlotManifestEntry[]): Slot[] {
  const nDaysOf = new Map<string, number>(); // `${instId}:${field}` → n_days
  for (const inst of rows) for (const mt of inst.metrics) nDaysOf.set(`${inst.id}:${mt.field}`, mt.n_days);
  return manifest.map((e) => ({ offset: e.offset, instId: e.inst_id, field: e.metric, side: e.side, nDays: nDaysOf.get(`${e.inst_id}:${e.metric}`)! }));
}

const byteOf = (pct: number | null): number => (pct === null ? 255 : Math.round(pct * 254));

// ─── Checkpoint ──────────────────────────────────────────────────────────────────
type Checkpoint = { lastYearDone: number | null; layoutVersion: number };
function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) { try { return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8")); } catch {} }
  return { lastYearDone: null, layoutVersion: 0 };
}
function saveCheckpoint(cp: Checkpoint) { writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2) + "\n"); }

// ─── Upsert a year of frames ─────────────────────────────────────────────────────
async function upsertYear(rows: any[]) {
  await fetchWithRetry(`${SUPABASE_URL}/rest/v1/board_frames?on_conflict=day`, {
    method: "POST", headers: { ...supaHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  }, "board_frames upsert");
}

// ─── THE RUN ──────────────────────────────────────────────────────────────────────
async function runBackfill(dry: boolean) {
  const { rows, layout } = buildRegistry();
  const endToday = todayIso();
  const endYear = process.env.YEAR_TO ? parseInt(process.env.YEAR_TO, 10) : Number(endToday.slice(0, 4));
  const startYear = process.env.YEAR_FROM ? parseInt(process.env.YEAR_FROM, 10) : 1950;
  const fromDay = `${startYear}-01-01`;
  const toDay = endYear >= Number(endToday.slice(0, 4)) ? endToday : `${endYear}-12-31`;
  const days = dayList(fromDay < START_DAY ? START_DAY : fromDay, toDay);
  const dayIndex = new Map<string, number>(); days.forEach((d, i) => dayIndex.set(d, i));
  const mmdds = [...new Set(days.map((d) => d.slice(5)))];
  const slots = buildSlots(rows, layout.manifest);

  console.log(`=== BACKFILL FRAMES === ${days.length} days ${days[0]}…${days[days.length - 1]}`);
  console.log(`  ${rows.length} instruments, ${slots.length} slots, layout_version ${layout.version}`);
  console.log(`  matrix ${slots.length}×${days.length} = ${(slots.length * days.length / 1e6).toFixed(1)} MB; frame ${slots.length} B/day → ${(slots.length * 60 / 1024).toFixed(1)} KB per 60-day replay`);

  if (dry) {
    const yrs: number[] = []; for (let y = startYear; y <= endYear; y++) yrs.push(y);
    console.log(`  DRY RUN — no DB, no writes. Would compute+upsert years: ${yrs[0]}…${yrs[yrs.length - 1]} (${yrs.length} txns, ~${days.length} rows)`);
    console.log(`  needle-ao source=cpc-daily-ao (daily); NAO/PDO/ENSO=climate-index (month-held); state/tide/buoy=DB per-year bounded`);
    console.log(`  payload check: 60-day replay ${(slots.length * 60 / 1024).toFixed(1)} KB ${slots.length * 60 < 200 * 1024 ? "< 200 KB ✓" : "OVER ✗"}`);
    return;
  }

  bootstrapKeys();
  // Byte matrix — one Uint8Array per slot, 255 (null) default.
  const matrix: Uint8Array[] = slots.map(() => new Uint8Array(days.length).fill(255));

  // Fill the matrix instrument-by-instrument (series + pools freed after each).
  for (const inst of rows) {
    const series = await loadSeries(inst, endYear);
    const instSlots = slots.filter((s) => s.instId === inst.id);
    const poolCache = new Map<string, Map<string, Pool>>(); // `${field}:${nDays}` → poolByMMDD
    let cov = 0;
    for (const slot of instSlots) {
      const fieldSeries = series.get(slot.field)!;
      const pk = `${slot.field}:${slot.nDays}`;
      if (!poolCache.has(pk)) poolCache.set(pk, buildPoolByMMDD(fieldSeries, slot.nDays, mmdds));
      const poolByMMDD = poolCache.get(pk)!;
      const col = matrix[slot.offset];
      for (const [d, idx] of dayIndex) {
        const v = fieldSeries.get(d);
        if (v === undefined) continue; // stays 255
        const p = poolByMMDD.get(d.slice(5));
        if (!p || p.pool.length === 0) continue;
        const res = tailDepth(v, p.pool, slot.side as Direction, p.years);
        col[idx] = byteOf(res.pct);
        if (res.pct !== null) cov++;
      }
    }
    if (inst.id === "ghcn-tx") {
      const fs2 = series.get("avg_high_f");
      console.log(`  DEBUG ghcn-tx: seriesFields=${[...series.keys()].join(",")} n=${fs2?.size ?? -1} has20220712=${fs2?.has("2022-07-12")} slotFields=${instSlots.map(s=>s.field+"/"+s.side+"/"+s.nDays).join(",")}`);
    }
    console.log(`  ${inst.id}: ${instSlots.length} slot(s), ${cov} filled byte(s)`);
  }

  // Assemble + upsert per year, checkpointed.
  const cp = loadCheckpoint();
  if (cp.layoutVersion && cp.layoutVersion !== layout.version) {
    console.error(`  ✗ layout drift: checkpoint v${cp.layoutVersion} ≠ current v${layout.version}. Reset the checkpoint (registry changed).`); process.exit(1);
  }
  for (let y = startYear; y <= endYear; y++) {
    if (cp.lastYearDone !== null && y <= cp.lastYearDone) continue;
    const yearRows: any[] = [];
    for (const d of days) {
      if (d.slice(0, 4) !== String(y)) continue;
      const idx = dayIndex.get(d)!;
      const buf = Buffer.alloc(slots.length);
      for (let s = 0; s < slots.length; s++) buf[s] = matrix[s][idx];
      yearRows.push({ day: d, layout_version: layout.version, dots: "\\x" + buf.toString("hex"), day0_source: "archive" });
    }
    if (yearRows.length === 0) continue;
    await upsertYear(yearRows);
    cp.lastYearDone = y; cp.layoutVersion = layout.version; saveCheckpoint(cp);
    console.log(`  ✓ ${y}: upserted ${yearRows.length} frames`);
  }
  console.log(`\n=== DONE ===`);
}

// ─── Read a stored frame's packed bytes back (bytea → uint8[]) ───────────────────
// PostgREST returns bytea as a hex string "\x<hex>"; decode to the raw byte array
// so verify can assert the STORED byte at an anchor's manifest offset — not just a
// fresh recompute. This closes the gap the Sandy film exposed: a reader can read the
// WRONG slot even when the fresh math is right, so verify must read what's on disk.
async function readStoredBytes(day: string): Promise<Uint8Array | null> {
  const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/board_frames?day=eq.${day}&select=dots`, { headers: supaHeaders() }, `frame ${day}`);
  const rowsJson = await res.json();
  if (!Array.isArray(rowsJson) || rowsJson.length === 0 || typeof rowsJson[0].dots !== "string") return null;
  const hex = rowsJson[0].dots.startsWith("\\x") ? rowsJson[0].dots.slice(2) : rowsJson[0].dots;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ─── VERIFY — the Rung-2b anchors (spine §7.1) + a STORED read-back (spine §7.2) ──
async function runVerify() {
  bootstrapKeys();
  const { rows, layout } = buildRegistry();
  const slots = buildSlots(rows, layout.manifest);
  const endYear = Number(todayIso().slice(0, 4));
  // expectByte = the byte the STORED frame must carry at this slot's manifest offset.
  const anchors: { instId: string; field: string; side: "low" | "high"; day: string; expect: number; eps: number }[] = [
    { instId: "ghcn-tx", field: "avg_high_f", side: "low", day: "2021-02-15", expect: 1.000, eps: 0.002 },
    { instId: "needle-ao", field: "value", side: "low", day: "2021-02-10", expect: 0.997, eps: 0.005 },
    // The Battery's record 9.15 ft Sandy surge — the very reading the film agent
    // decoded as 0.272 by rebuilding offsets per-METRIC instead of per-SIDE. The
    // STORED byte at the manifest offset is 254; the read-back below proves it.
    { instId: "tide-8518750", field: "residual_max_ft", side: "high", day: "2012-10-30", expect: 0.999, eps: 0.003 },
    // 0.725 was the hand-bake's WHOLE-DJF pool value; the spine standardizes on
    // doy±15 pools (poolN 531 = 31d × 17y here), which yields 0.778 for the same
    // reading. Same engine, different denominator definition — recalibrated
    // 2026-07-11 when the store's doy±15 became canonical. The film rebake from
    // frames (Rung 2e) reconciles the JSON to this definition.
    { instId: "buoy-42035", field: "pressure_mb", side: "high", day: "2021-02-16", expect: 0.778, eps: 0.005 },
    // PNA anchor (appended instrument, layout v2 2026-07-12): 1955-12-24 is the
    // deepest WINTER PNA-negative day in the whole 77-year daily record (-2.683;
    // the all-time deepest, 1993-09-27's -3.971, is a quiet September with no
    // story). Christmas Eve 1955 is the crest of the documented December 1955
    // West Coast floods (~74 dead, CA/OR) — and a deep -PNA (trough pinned over
    // the West, Pacific storms aimed ashore) IS that event's circulation
    // signature, so the anchor ties the byte to a named catastrophe the archive
    // can cross-examine. Fresh math: poolN=2364, years=77, pct=1.000 → byte 254.
    { instId: "needle-pna", field: "value", side: "low", day: "1955-12-24", expect: 1.000, eps: 0.002 },
  ];
  let fails = 0;
  for (const a of anchors) {
    const inst = rows.find((r) => r.id === a.instId)!;
    const slot = slots.find((s) => s.instId === a.instId && s.field === a.field && s.side === a.side)!;
    const series = await loadSeries(inst, endYear);
    const fieldSeries = series.get(a.field)!;
    const v = fieldSeries.get(a.day);
    if (v === undefined) { console.log(`  ✗ ${a.instId} ${a.day}: no reading`); fails++; continue; }
    const { pool, years } = poolForDay(fieldSeries, a.day, slot.nDays);
    const res = tailDepth(v, pool, a.side as Direction, years);
    const pct = res.pct ?? -1;
    const freshByte = byteOf(res.pct);
    const okFresh = Math.abs(pct - a.expect) <= a.eps;

    // READ-BACK: the stored frame's byte at this slot's manifest offset MUST equal
    // the freshly computed byte (±1 rounding). A slot-order/packing drift lands a
    // neighbor's byte here and this fails — exactly the Sandy tell, caught on disk.
    const stored = await readStoredBytes(a.day);
    let okStored = false, storedByte = -1;
    if (stored && slot.offset < stored.length) { storedByte = stored[slot.offset]; okStored = Math.abs(storedByte - freshByte) <= 1; }
    const storedNote = stored ? `stored@off${slot.offset}=${storedByte} (pct=${(storedByte / 254).toFixed(3)})` : "NO STORED FRAME";

    const ok = okFresh && okStored;
    console.log(`  ${ok ? "✓" : "✗"} ${a.instId} ${a.day} ${a.side}: v=${v} poolN=${pool.length} years=${years} → pct=${pct} (expect ${a.expect}±${a.eps}) freshByte=${freshByte} | ${storedNote} ${okStored ? "✓match" : "✗DRIFT"}`);
    if (!ok) fails++;
  }
  console.log(`\n${fails ? "✗" : "✓"} verify — ${fails} anchor failure(s) [fresh math + stored read-back]`);
  process.exit(fails ? 1 : 0);
}

function status() {
  const cp = loadCheckpoint();
  console.log(`checkpoint: lastYearDone=${cp.lastYearDone ?? "none"} layoutVersion=${cp.layoutVersion || "none"}`);
}

async function main() {
  const arg = process.argv[2] || "";
  if (arg === "--status") return status();
  if (arg === "--verify") return runVerify();
  return runBackfill(arg === "--dry-run");
}
main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
