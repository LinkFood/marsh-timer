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
 * THE FREQUENCY DICTIONARY (Amendment 1.3 Ruling 4a, plan §2.4): the same row also
 * carries what the v1 card needs to say "a pressure fall this size over Maryland in
 * the second week of October has happened 34 times since 1979" — see buildPoolFacts.
 *
 * Usage:
 *   npx tsx scripts/frames/bake-luts.ts --verify    # anchors + broad exactness (offline, cache only)
 *   npx tsx scripts/frames/bake-luts.ts --dry-run   # dictionary fields, real numbers, WRITES NOTHING
 *   npx tsx scripts/frames/bake-luts.ts --status    # checkpoint progress
 *   npx tsx scripts/frames/bake-luts.ts             # THE BAKE (upserts board_pool_luts)
 *   npx tsx scripts/frames/bake-luts.ts --gap 2     # bake/dry-run at a 2-day episode gap
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI). Cache must be warm
 * (backfill-frames.ts populates scripts/frames/.frame-cache — all 71 series present).
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { tailDepth, doyOffset, type Direction } from "../board/tailDepth.ts";
import {
  DEFAULT_EPISODE_GAP_DAYS, decadeDistribution, epochDay, isoOfEpochDay,
  mergeEpisodes, refusalReason,
} from "../board/episodes.ts";
import { buildRegistry, type Instrument } from "./registry.ts";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPTS_DIR, ".frame-cache");
const CHECKPOINT_FILE = join(SCRIPTS_DIR, ".lut-checkpoint.json"); // OUR checkpoint, not the backfill's
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
// 400 was right when a row was vals+below (~4 KB). With `days` (one int per pool
// member, ~1,600 for a state) a row is ~15 KB of JSON, so 400 would be a 6 MB POST.
const UPSERT_BATCH = 50;
/**
 * Bumped whenever a bake emits COLUMNS a previous bake did not. A checkpoint written
 * by an older version means the finished jobs are missing the new columns, so their
 * "done" marks are lies — the job list resets. (Layout drift is a different guard:
 * that one exits, because a changed registry means the rows are keyed wrong.)
 */
const DICT_VERSION = 1;

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
// backfill-frames.ts writes the { endYear, fields } envelope (its SeriesCache type);
// read through `fields` or every metric lookup returns undefined.
function loadCachedSeries(inst: Instrument): Map<string, Map<string, number>> {
  const cached = cacheGet<{ endYear: number; fields: Record<string, Record<string, number>> }>(`series-${inst.id}.json`);
  if (!cached) { console.error(`  ✗ cache miss series-${inst.id}.json — run backfill-frames.ts first (it warms the cache).`); process.exit(1); }
  if (!cached.fields) { console.error(`  ✗ series-${inst.id}.json is not a { endYear, fields } envelope — re-warm it with backfill-frames.ts.`); process.exit(1); }
  const m = new Map<string, Map<string, number>>();
  for (const [f, obj] of Object.entries(cached.fields)) m.set(f, new Map(Object.entries(obj)));
  return m;
}

// ─── doy key (leap-year/2000 ordinal — bijective over the 366 mmdd pool-centers) ──
const DOY_EPOCH = Date.UTC(2000, 0, 1);
function doyOfMMDD(mmdd: string): number {
  const [m, d] = mmdd.split("-").map(Number);
  return Math.round((Date.UTC(2000, m - 1, d) - DOY_EPOCH) / 86400000) + 1;
}
function doyOfIso(iso: string): number { return doyOfMMDD(iso.slice(5)); }

// ─── The pool for one (instrument, field, mmdd) — VALUES *AND* DATES, rank-ordered ──
// The dates used to be thrown away here; keeping them is the whole frequency
// dictionary (Ruling 4a). Sorted by value ascending, ties broken by day ascending so
// the order is deterministic. Sorting by (value, day) leaves the value multiset — and
// therefore vals/below/n/years and every baked byte — bit-for-bit unchanged.
type PoolMember = { v: number; d: number; y: number }; // value, epoch day, calendar year
function buildPool(series: Map<string, number>, nDays: number, mmdd: string): PoolMember[] {
  const target = `2000-${mmdd}`; // doyOffset ignores year — identical membership to the backfill
  const pool: PoolMember[] = [];
  for (const [d, v] of series) if (doyOffset(d, target) <= nDays && Number.isFinite(v)) pool.push({ v, d: epochDay(d), y: +d.slice(0, 4) });
  pool.sort((a, b) => a.v - b.v || a.d - b.d);
  return pool;
}

// ─── The LUT: sorted-distinct vals + strict-below (unchanged wire format) ───────────
type Lut = { vals: number[]; below: number[]; n: number; years: number };
function lutFromPool(pool: PoolMember[]): Lut {
  const vals: number[] = []; const below: number[] = []; const yrs = new Set<number>();
  for (let i = 0; i < pool.length; i++) {
    yrs.add(pool[i].y);
    if (i === 0 || pool[i].v !== pool[i - 1].v) { vals.push(pool[i].v); below.push(i); } // i = strict-less-than count
  }
  return { vals, below, n: pool.length, years: yrs.size };
}
function buildLut(series: Map<string, number>, nDays: number, mmdd: string): Lut {
  return lutFromPool(buildPool(series, nDays, mmdd));
}

// ─── THE FREQUENCY DICTIONARY — the ~40-line sibling (Ruling 4a, plan §2.4) ─────────
// What the card needs that `vals`/`below` cannot give: the IDENTITY of the matched
// days. The card's count is band-conditional and the band is deliberately undecided
// until the ERA5 pressure delta lands, so a baked count would price in a decision
// nobody has made and force a re-bake the moment it changed. `days` prices in nothing:
// it is rank-ordered, so ANY band is a contiguous slice — [below(lo), below(hi)) —
// and the slice's episodes, years and most-recent start fall straight out of it.
// `episodes`/`last_occurrence` here are the WHOLE-POOL census (the unconditional
// denominator, ≈ one occasion per year of record by construction, since the ±N window
// is contiguous); the card's "34 times" is the same math over a slice.
type PoolFacts = {
  days: number[];         // epoch day of every pool member, in `pool` order (by value)
  yearsList: number[];    // distinct calendar years in the pool, ascending
  episodes: number;       // occasions in the whole pool at `gapDays` (Ruling 2)
  lastOccurrence: string | null; // START date of the most recent episode (Ruling 2)
};
function buildPoolFacts(pool: PoolMember[], gapDays: number): PoolFacts {
  const days = pool.map((m) => m.d);
  const yearsList = [...new Set(pool.map((m) => m.y))].sort((a, b) => a - b);
  const eps = mergeEpisodes(days, gapDays);
  return {
    days,
    yearsList,
    episodes: eps.length,
    lastOccurrence: eps.length ? isoOfEpochDay(eps[eps.length - 1].startDay) : null,
  };
}

/**
 * The query-time half, run against ONE baked row. A band is a rank window over the
 * pool, so it is a slice of `days` — no re-bake, no band baked in. This is the exact
 * code path the browser card will take once the LUT row is in hand.
 * `rankLo`/`rankHi` are fractions of the pool in [0,1], rankLo < rankHi.
 */
function bandFacts(facts: PoolFacts, n: number, rankLo: number, rankHi: number, gapDays: number) {
  const lo = Math.max(0, Math.floor(rankLo * n));
  const hi = Math.min(n, Math.ceil(rankHi * n));
  const matched = facts.days.slice(lo, hi);
  const eps = mergeEpisodes(matched, gapDays);
  const starts = eps.map((e) => e.startDay);
  const dist = decadeDistribution(starts, facts.yearsList);
  const years = [...new Set(starts.map((d) => +isoOfEpochDay(d).slice(0, 4)))];
  return {
    matchedDays: matched.length,
    count: eps.length,
    years,
    lastOccurrence: eps.length ? isoOfEpochDay(starts[starts.length - 1]) : null,
    dist,
    refusal: refusalReason(eps.length, years.length),
  };
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
type Checkpoint = { doneJobs: string[]; layoutVersion: number; dictVersion: number };
function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) { try { return { dictVersion: 0, ...JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8")) }; } catch {} }
  return { doneJobs: [], layoutVersion: 0, dictVersion: DICT_VERSION };
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
async function runBake(gapDays: number) {
  bootstrapKeys();
  const { rows, layout } = buildRegistry();
  const instById = new Map<string, Instrument>(rows.map((r) => [r.id, r]));
  const mmdds: string[] = []; // all 366 pool-centers (leap included)
  for (let m = 1; m <= 12; m++) { const days = new Date(Date.UTC(2000, m, 0)).getUTCDate(); for (let d = 1; d <= days; d++) mmdds.push(`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`); }

  const jobs = fieldJobs();
  console.log(`=== BAKE POOL LUTs + FREQUENCY DICTIONARY === layout_version ${layout.version}, episode gap ${gapDays}d`);
  console.log(`  ${jobs.length} (instrument,field) jobs × ${mmdds.length} doy = ${jobs.length * mmdds.length} LUT rows`);
  console.log(`  older layout_versions are NOT touched — the PK carries the version and this bake writes only v${layout.version}.`);

  const cp = loadCheckpoint();
  if (cp.layoutVersion && cp.layoutVersion !== layout.version) { console.error(`  ✗ layout drift: checkpoint v${cp.layoutVersion} ≠ current v${layout.version}. Delete .lut-checkpoint.json (registry changed).`); process.exit(1); }
  if (cp.dictVersion !== DICT_VERSION) {
    console.log(`  ↻ checkpoint dictVersion ${cp.dictVersion} ≠ ${DICT_VERSION} — the row gained columns since those jobs ran; re-baking all ${jobs.length}.`);
    cp.doneJobs = []; cp.dictVersion = DICT_VERSION;
  }
  const done = new Set(cp.doneJobs);

  for (const job of jobs) {
    const jobKey = `${job.instId}:${job.field}`;
    if (done.has(jobKey)) continue;
    const series = loadCachedSeries(instById.get(job.instId)!).get(job.field)!;
    const out: any[] = [];
    for (const mmdd of mmdds) {
      const pool = buildPool(series, job.nDays, mmdd);
      const lut = lutFromPool(pool);
      const facts = buildPoolFacts(pool, gapDays);
      out.push({
        layout_version: layout.version, instrument_id: job.instId, metric: job.field, doy: doyOfMMDD(mmdd),
        vals: lut.vals, below: lut.below, n: lut.n, years: lut.years,
        days: facts.days, years_list: facts.yearsList, episodes: facts.episodes,
        last_occurrence: facts.lastOccurrence, episode_gap_days: gapDays,
      });
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
    // PNA anchor — deepest winter -PNA on record (-2.683), the crest of the
    // documented Christmas 1955 West Coast floods. See backfill-frames.ts anchors.
    { instId: "needle-pna", field: "value", side: "low", day: "1955-12-24", expectByte: 254 },
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
  const sample = ["ghcn-tx", "ghcn-ca", "ghcn-me", "ghcn-fl", "tide-8574680", "tide-8518750", "buoy-42035", "buoy-44025", "needle-ao", "needle-nao", "needle-pna"];
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

// ─── DRY RUN — the dictionary fields on real data, WRITING NOTHING ──────────────
// Proves the three ruled fields compute, and reports the Ruling-2 gap sensitivity.
// Bucketing dates by doyOffset's OWN ordinal (non-leap cum table, Feb 29 sharing
// ordinal 60 with Mar 1) makes the 366-doy sweep tractable; a self-check below
// asserts it reproduces buildPool member-for-member.
const CUM = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
const ordOfIso = (iso: string) => CUM[+iso.slice(5, 7) - 1] + +iso.slice(8, 10);
function bucketByOrd(series: Map<string, number>): PoolMember[][] {
  const b: PoolMember[][] = Array.from({ length: 366 }, () => []);
  for (const [iso, v] of series) if (Number.isFinite(v)) b[ordOfIso(iso)].push({ v, d: epochDay(iso), y: +iso.slice(0, 4) });
  return b;
}
function fastPool(buckets: PoolMember[][], targetOrd: number, nDays: number): PoolMember[] {
  const pool: PoolMember[] = [];
  for (let o = -nDays; o <= nDays; o++) pool.push(...buckets[((targetOrd - 1 + o + 365) % 365) + 1]);
  pool.sort((a, b) => a.v - b.v || a.d - b.d);
  return pool;
}
/** 24-hour change: v[d] − v[d−1], only where the previous calendar day is present. */
function deltaSeries(series: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [iso, v] of series) {
    const prev = isoOfEpochDay(epochDay(iso) - 1);
    const pv = series.get(prev);
    if (pv !== undefined && Number.isFinite(v) && Number.isFinite(pv)) out.set(iso, v - pv);
  }
  return out;
}

function runDryRun(gapDays: number) {
  const { rows } = buildRegistry();
  const instById = new Map<string, Instrument>(rows.map((r) => [r.id, r]));
  const nDaysOf = new Map<string, number>();
  for (const inst of rows) for (const m of inst.metrics) nDaysOf.set(`${inst.id}:${m.field}`, m.n_days);

  console.log(`=== DRY RUN — frequency dictionary — NOTHING IS WRITTEN ===`);
  console.log(`episode gap ${gapDays}d · window ±${nDaysOf.get("ghcn-md:avg_high_f")}d (DOY_HALF_WINDOW) · source: warm .frame-cache\n`);

  const demos = [
    { instId: "ghcn-md", mmdd: "10-10", label: "Maryland · second week of October" },
    { instId: "ghcn-tx", mmdd: "02-15", label: "Texas · mid-February" },
    { instId: "ghcn-nd", mmdd: "06-21", label: "North Dakota · summer solstice" },
    { instId: "ghcn-ca", mmdd: "12-24", label: "California · Christmas Eve (Dec/Jan wrap)" },
  ];

  console.log(`--- 1. THE THREE RULED FIELDS, PER ROW (whole-pool census) ---`);
  for (const demo of demos) {
    const field = "avg_high_f";
    const series = loadCachedSeries(instById.get(demo.instId)!).get(field)!;
    const nDays = nDaysOf.get(`${demo.instId}:${field}`)!;
    const pool = buildPool(series, nDays, demo.mmdd);
    const lut = lutFromPool(pool);
    const facts = buildPoolFacts(pool, gapDays);
    const bytes = JSON.stringify({ vals: lut.vals, below: lut.below, days: facts.days, years_list: facts.yearsList }).length;
    console.log(`\n  ${demo.label}  [${demo.instId}:${field} doy ${doyOfMMDD(demo.mmdd)}]`);
    console.log(`    n=${lut.n} days · ${lut.vals.length} distinct values · years=${lut.years} (${facts.yearsList[0]}–${facts.yearsList[facts.yearsList.length - 1]})`);
    console.log(`    years_list      ${facts.yearsList.length} entries, first 6: [${facts.yearsList.slice(0, 6).join(",")}…] gaps: ${facts.yearsList.length === facts.yearsList[facts.yearsList.length - 1] - facts.yearsList[0] + 1 ? "none" : "YES"}`);
    console.log(`    episodes        ${facts.episodes} (whole pool, gap ${gapDays}d — the unconditional denominator)`);
    console.log(`    last_occurrence ${facts.lastOccurrence}`);
    console.log(`    days[]          ${facts.days.length} ints, rank-ordered · row payload ≈ ${(bytes / 1024).toFixed(1)} KB JSON`);
  }

  console.log(`\n\n--- 2. ANY BAND, NO RE-BAKE — the card, from one row (ERA5-shaped: 1979+) ---`);
  for (const demo of demos.slice(0, 3)) {
    const field = "avg_high_f";
    const series = loadCachedSeries(instById.get(demo.instId)!).get(field)!;
    const nDays = nDaysOf.get(`${demo.instId}:${field}`)!;
    const full = buildPool(series, nDays, demo.mmdd);
    const pool = full.filter((m) => m.y >= 1979); // what ERA5 pressure will look like (Ruling 3)
    const facts = buildPoolFacts(pool, gapDays);
    console.log(`\n  ${demo.label}  — pool 1979+ : n=${pool.length}, years=${facts.yearsList.length}`);
    for (const [lo, hi, name] of [[0, 0.01, "deepest 1%"], [0, 0.02, "deepest 2%"], [0, 0.05, "deepest 5%"]] as [number, number, string][]) {
      const b = bandFacts(facts, pool.length, lo, hi, gapDays);
      const bars = b.dist.bars.map((x) => `${x.decade}s ${x.count}/${x.yearsOfRecord}y=${x.perYear.toFixed(2)}${x.partial ? "*" : ""}`).join("  ");
      console.log(`    ${name.padEnd(11)} days=${String(b.matchedDays).padStart(3)} → count=${String(b.count).padStart(3)} times · years=${String(b.years.length).padStart(2)} · last_occurrence=${b.lastOccurrence} · ${b.refusal ? `REFUSE (${b.refusal})` : "states a frequency"}`);
      console.log(`                 pre-bar(1979) ${b.dist.preBarCount}/${b.dist.preBarYears}y · bars: ${bars}   (* = partial decade)`);
    }
  }

  console.log(`\n\n--- 3. EPISODE-GAP SENSITIVITY (Ruling 2) — pooled over all 366 doy cards ---`);
  const sens = ["ghcn-md", "ghcn-tx", "ghcn-nd", "ghcn-ca", "ghcn-me"];
  const nDays = nDaysOf.get(`ghcn-md:avg_high_f`)!;
  type Row = { metric: string; band: number; days: number; e: number[] };
  const table: Row[] = [];
  const perState: string[] = [];
  for (const metricName of ["level", "delta"]) {
    for (const band of [0.005, 0.01, 0.02]) {
      const agg: Row = { metric: metricName, band, days: 0, e: [0, 0, 0] };
      for (const id of sens) {
        const raw = loadCachedSeries(instById.get(id)!).get("avg_high_f")!;
        const series = metricName === "delta" ? deltaSeries(raw) : raw;
        const buckets = bucketByOrd(series);
        const st: Row = { metric: metricName, band, days: 0, e: [0, 0, 0] };
        for (let ord = 1; ord <= 365; ord++) {
          const pool = fastPool(buckets, ord, nDays);
          if (pool.length === 0) continue;
          const cut = Math.max(1, Math.floor(band * pool.length)); // the deep-fall tail
          const matched = pool.slice(0, cut).map((m) => m.d);
          st.days += matched.length;
          for (let g = 0; g <= 2; g++) st.e[g] += mergeEpisodes(matched, g).length;
        }
        agg.days += st.days; for (let g = 0; g <= 2; g++) agg.e[g] += st.e[g];
        if (band === 0.01) perState.push(`    ${id} ${metricName.padEnd(5)} days=${st.days} → ${(st.days / st.e[0]).toFixed(2)} / ${(st.days / st.e[1]).toFixed(2)} / ${(st.days / st.e[2]).toFixed(2)}`);
      }
      table.push(agg);
    }
  }
  console.log(`  5 states × 365 doy cards. "matches/episode" = matched days ÷ episodes.\n`);
  console.log(`  metric  band    matched days   ep@gap0   ep@gap1   ep@gap2   m/e@0  m/e@1  m/e@2`);
  for (const r of table) {
    console.log(
      `  ${r.metric.padEnd(6)}  ${(r.band * 100).toFixed(1).padStart(4)}%  ${String(r.days).padStart(12)}` +
      `  ${String(r.e[0]).padStart(8)}  ${String(r.e[1]).padStart(8)}  ${String(r.e[2]).padStart(8)}` +
      `  ${(r.days / r.e[0]).toFixed(2).padStart(5)}  ${(r.days / r.e[1]).toFixed(2).padStart(5)}  ${(r.days / r.e[2]).toFixed(2).padStart(5)}`,
    );
  }
  console.log(`\n  per-state at the 1.0% band (m/e @ gap 0 / 1 / 2):`);
  for (const l of perState) console.log(l);

  // Self-check: the fast ordinal bucketing must reproduce buildPool exactly.
  const chk = loadCachedSeries(instById.get("ghcn-md")!).get("avg_high_f")!;
  const buckets = bucketByOrd(chk);
  let bad = 0;
  for (const mmdd of ["01-01", "02-28", "03-01", "07-04", "12-31"]) {
    const a = buildPool(chk, nDays, mmdd).map((m) => m.d).join(",");
    const b = fastPool(buckets, ordOfIso(`2000-${mmdd}`), nDays).map((m) => m.d).join(",");
    if (a !== b) { bad++; console.log(`  ✗ fast-pool mismatch at ${mmdd}`); }
  }
  console.log(`\n  self-check: fast ordinal pool ≡ buildPool on 5 doys → ${bad ? `${bad} MISMATCH` : "identical"}`);
  console.log(`\n=== DRY RUN COMPLETE — no database connection was opened ===`);
}

function status() {
  const cp = loadCheckpoint();
  console.log(`lut checkpoint: ${cp.doneJobs.length} job(s) done, layoutVersion=${cp.layoutVersion || "none"}, dictVersion=${cp.dictVersion} (current ${DICT_VERSION})`);
}

async function main() {
  const argv = process.argv.slice(2);
  const gapIdx = argv.indexOf("--gap");
  const gapDays = gapIdx === -1 ? DEFAULT_EPISODE_GAP_DAYS : Number(argv[gapIdx + 1]);
  if (!Number.isInteger(gapDays) || gapDays < 0) { console.error(`  ✗ --gap must be a non-negative integer`); process.exit(1); }
  if (argv.includes("--status")) return status();
  if (argv.includes("--verify")) return runVerify();
  if (argv.includes("--dry-run")) return runDryRun(gapDays);
  return runBake(gapDays);
}
main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
