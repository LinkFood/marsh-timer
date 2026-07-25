/**
 * bake-series-columns.ts — fill the transposed column store (plan §3 option c).
 *
 * ONE row per (instrument, metric) holding that series' entire history as a
 * contiguous int16 column, so the frequency card is a single bounded read
 * instead of a scan over the 8.11 MB frame store. See the migration
 * 20260726000000_board_series_columns.sql header for the shape, the encoding,
 * and why this stores VALUES rather than plan §3's packed board byte.
 *
 * SOURCE: the same warm scripts/frames/.frame-cache that backfill-frames.ts
 * writes and bake-luts.ts reads. Read-only — this script writes no cache file
 * and no checkpoint, and it touches no table but board_series_columns.
 *
 * (Plan §3 says "fills it from board_frames". It cannot: board_frames holds the
 * quantized board BYTE and this column holds physical values, which the byte
 * cannot be inverted back to without loss. The cache is the byte's own upstream,
 * so this is the same numbers one step earlier, and it costs no read against the
 * cluster while another pipe holds the write lane.)
 *
 * IDEMPOTENT: every run rewrites all 89 rows through an upsert on the primary
 * key. There is no checkpoint because there is nothing to resume — the whole
 * bake is ~90 rows and a few seconds. Re-running is always safe and always
 * converges to the cache's current contents.
 *
 * Usage:
 *   npx tsx scripts/frames/bake-series-columns.ts --verify        # offline: round-trip + parity vs the committed pool definition
 *   npx tsx scripts/frames/bake-series-columns.ts --card MD 10-10 # offline: the real card numbers at every band
 *   npx tsx scripts/frames/bake-series-columns.ts --dry-run       # offline: the rows it would write, sized
 *   npx tsx scripts/frames/bake-series-columns.ts                 # THE BAKE (upserts board_series_columns)
 *   npx tsx scripts/frames/bake-series-columns.ts --only ghcn-md  # one instrument
 *
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI). Cache must be warm.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { doyOffset } from "../board/tailDepth.ts";
import { epochDay, isoOfEpochDay, mergeEpisodes, refusalReason, DEFAULT_EPISODE_GAP_DAYS } from "../board/episodes.ts";
import {
  DOY_HALF_WINDOW, MISSING, bandCensus, bandPhrase, decodeSeriesColumn, encodeSeriesColumn,
  mmddLabel, poolForDoy, thresholdPhrase, toByteaHex, windowPhrase,
  type SeriesColumn, type TailSide,
} from "../board/frequency.ts";
import { buildRegistry, type Instrument } from "./registry.ts";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(SCRIPTS_DIR, ".frame-cache");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
/** A GHCN row is ~111 KB of hex; 8 rows is a ~900 KB POST. */
const UPSERT_BATCH = 8;
/** The three bands under test. Ruling 1a: the band is set from data, not taste — so it is
 *  an input the card exposes, never a constant hidden in a component. */
const BANDS = [0.01, 0.02, 0.05];

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

// ─── Cache (READ-ONLY; backfill-frames.ts owns writes) ──────────────────────────
function loadCachedSeries(inst: Instrument): Map<string, Map<string, number>> {
  const p = join(CACHE_DIR, `series-${inst.id}.json`);
  if (!existsSync(p)) { console.error(`  ✗ cache miss series-${inst.id}.json — run backfill-frames.ts first (it warms the cache).`); process.exit(1); }
  const cached = JSON.parse(readFileSync(p, "utf-8")) as { endYear: number; fields: Record<string, Record<string, number>> };
  if (!cached.fields) { console.error(`  ✗ series-${inst.id}.json is not a { endYear, fields } envelope — re-warm it with backfill-frames.ts.`); process.exit(1); }
  const m = new Map<string, Map<string, number>>();
  for (const [f, obj] of Object.entries(cached.fields)) m.set(f, new Map(Object.entries(obj)));
  return m;
}

/** The lane a row came from, for the card's methods note. */
const SOURCE_BY_CT: Record<string, string> = {
  "ghcn-daily": "GHCN-Daily state-day means (NOAA ACIS)",
  "tide-gauge": "NOAA CO-OPS verified tide residuals",
  "ocean-buoy-historical": "NDBC buoy standard meteorological archive",
  "climate-index": "NOAA CPC / PSL monthly climate indices",
  "climate-index-daily": "NOAA CPC daily climate indices",
  "cpc-daily-ao": "NOAA CPC daily Arctic Oscillation",
};

type Job = { instId: string; metric: string; sourceCt: string };
function jobs(only?: string): Job[] {
  const { rows } = buildRegistry();
  const out: Job[] = [];
  for (const inst of rows) {
    if (only && inst.id !== only) continue;
    for (const m of inst.metrics) out.push({ instId: inst.id, metric: m.field, sourceCt: inst.source_ct });
  }
  if (only && out.length === 0) { console.error(`  ✗ --only ${only}: no such instrument in the registry.`); process.exit(1); }
  return out;
}

function buildRow(job: Job, series: Map<string, number>) {
  const enc = encodeSeriesColumn(series);
  return {
    instrument_id: job.instId,
    metric: job.metric,
    first_day: enc.firstDay,
    n_days: enc.nDays,
    scale: enc.scale,
    readings: toByteaHex(enc.bytes),
    n_present: enc.nPresent,
    first_year: enc.firstYear,
    last_year: enc.lastYear,
    min_value: enc.minValue,
    max_value: enc.maxValue,
    source: SOURCE_BY_CT[job.sourceCt] ?? job.sourceCt,
  };
}

/** A row, decoded back the way the browser will decode it. */
function decodeRow(row: ReturnType<typeof buildRow>): SeriesColumn {
  return decodeSeriesColumn(row as any);
}

// ─── THE BAKE ───────────────────────────────────────────────────────────────────
async function runBake(only?: string) {
  bootstrapKeys();
  const { rows } = buildRegistry();
  const instById = new Map<string, Instrument>(rows.map((r) => [r.id, r]));
  const list = jobs(only);
  console.log(`=== BAKE board_series_columns === ${list.length} (instrument,metric) row(s)`);
  console.log(`  source: warm .frame-cache (read-only) · upsert on (instrument_id, metric) · idempotent\n`);

  const batch: any[] = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    await fetchWithRetry(`${SUPABASE_URL}/rest/v1/board_series_columns?on_conflict=instrument_id,metric`, {
      method: "POST",
      headers: { ...supaHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(batch),
    }, "board_series_columns upsert");
    batch.length = 0;
  };

  for (const job of list) {
    const series = loadCachedSeries(instById.get(job.instId)!).get(job.metric);
    if (!series || series.size === 0) { console.log(`  – ${job.instId}:${job.metric}: no readings in cache, skipped`); continue; }
    const row = buildRow(job, series);
    bytes += row.n_days * 2;
    console.log(`  ✓ ${job.instId}:${job.metric.padEnd(16)} ${row.first_day} +${row.n_days}d · ${row.n_present} present · scale ×${row.scale} · ${(row.n_days * 2 / 1024).toFixed(1)} KB`);
    batch.push(row);
    if (batch.length >= UPSERT_BATCH) await flush();
  }
  await flush();
  console.log(`\n=== DONE — ${list.length} row(s), ${(bytes / 1048576).toFixed(2)} MB of column ===`);
}

// ─── DRY RUN — the rows, sized, writing nothing ──────────────────────────────────
function runDryRun(only?: string) {
  const { rows } = buildRegistry();
  const instById = new Map<string, Instrument>(rows.map((r) => [r.id, r]));
  const list = jobs(only);
  console.log(`=== DRY RUN — board_series_columns — NOTHING IS WRITTEN ===\n`);
  console.log(`  instrument:metric              first_day    days  present  scale   column  wire(hex)`);
  let bytes = 0, hex = 0, written = 0, empty = 0;
  const byKind = new Map<string, { rows: number; bytes: number; days: string }>();
  for (const job of list) {
    const series = loadCachedSeries(instById.get(job.instId)!).get(job.metric);
    if (!series || series.size === 0) { empty++; continue; }
    const row = buildRow(job, series);
    bytes += row.n_days * 2;
    hex += row.readings.length;
    written++;
    const kind = instById.get(job.instId)!.kind;
    const k = byKind.get(kind) ?? { rows: 0, bytes: 0, days: "" };
    k.rows++; k.bytes += row.n_days * 2;
    k.days = `${row.first_day} +${row.n_days}d`;
    byKind.set(kind, k);
    if (list.length <= 12 || job.instId.endsWith("-md") || job.instId.endsWith("-tx") || job.instId.endsWith("-nd")) {
      console.log(`  ${`${job.instId}:${job.metric}`.padEnd(30)} ${row.first_day}  ${String(row.n_days).padStart(6)}  ${String(row.n_present).padStart(7)}  ×${String(row.scale).padEnd(5)} ${(row.n_days * 2 / 1024).toFixed(1).padStart(7)} KB ${(row.readings.length / 1024).toFixed(1).padStart(8)} KB`);
    }
  }
  console.log(`\n  by kind:`);
  for (const [kind, k] of byKind) console.log(`    ${kind.padEnd(12)} ${String(k.rows).padStart(3)} rows  ${(k.bytes / 1048576).toFixed(2)} MB   (last: ${k.days})`);
  console.log(`\n  TOTAL ${written} rows written · ${empty} (instrument,metric) job(s) hold no readings in the cache and are skipped`);
  console.log(`        ${(bytes / 1048576).toFixed(2)} MB stored · ${(hex / 1048576).toFixed(2)} MB as PostgREST hex`);
  console.log(`\n=== DRY RUN COMPLETE — no database connection was opened ===`);
}

// ─── VERIFY — round trip, and parity with the committed definition of a match ────
function runVerify() {
  const { rows } = buildRegistry();
  const instById = new Map<string, Instrument>(rows.map((r) => [r.id, r]));
  const list = jobs();
  let fails = 0;

  // 1. ENCODE → DECODE is lossless on every present day, and every absent day
  //    decodes as absent. A silent rounding here would move a hunter's number.
  console.log(`=== VERIFY board_series_columns ===\n--- 1. round trip, every reading of every series ---`);
  let checked = 0, bad = 0;
  for (const job of list) {
    const series = loadCachedSeries(instById.get(job.instId)!).get(job.metric);
    if (!series || series.size === 0) continue;
    const col = decodeRow(buildRow(job, series));
    for (const [iso, v] of series) {
      if (!Number.isFinite(v)) continue;
      const i = epochDay(iso) - col.firstDay;
      checked++;
      if (col.raw[i] === MISSING || Math.abs(col.raw[i] / col.scale - v) > 1e-9) {
        bad++; if (bad <= 5) console.log(`    ✗ ${job.instId}:${job.metric} ${iso}: ${v} → ${col.raw[i]}/${col.scale}`);
      }
    }
    // and nothing was invented in the gaps
    for (let i = 0; i < col.raw.length; i++) {
      if (col.raw[i] === MISSING) continue;
      const iso = isoOfEpochDay(col.firstDay + i);
      if (!series.has(iso)) { bad++; if (bad <= 5) console.log(`    ✗ ${job.instId}:${job.metric} ${iso}: decoded a reading the cache does not hold`); }
    }
  }
  console.log(`  ${checked} readings across ${list.length} series → ${bad} mismatch(es)`);
  if (bad) fails++;

  // 2. The pool built from the DECODED column must be member-for-member the pool
  //    bake-luts.ts builds from the raw series. Same doyOffset window, same sort.
  //    This is the guarantee that the card counts the committed definition of a
  //    match and not a second one (the ±10-vs-±15 defect, never again).
  console.log(`\n--- 2. pool parity vs the committed definition (bake-luts.ts buildPool) ---`);
  const sample = ["ghcn-md", "ghcn-tx", "ghcn-nd", "ghcn-ca", "ghcn-me", "tide-8574680", "buoy-42035", "needle-ao"];
  let poolChecks = 0, poolBad = 0;
  for (const id of sample) {
    const inst = instById.get(id)!;
    const byField = loadCachedSeries(inst);
    for (const m of inst.metrics) {
      const series = byField.get(m.field);
      if (!series || series.size === 0) continue;
      const col = decodeRow(buildRow({ instId: id, metric: m.field, sourceCt: inst.source_ct }, series));
      for (const mmdd of ["01-01", "02-28", "03-01", "06-21", "10-10", "12-24", "12-31"]) {
        const truth = truthPool(series, m.n_days, mmdd);
        const mine = poolForDoy(col, mmdd, m.n_days);
        poolChecks++;
        const a = truth.map((p) => `${p.day}:${p.v}`).join(",");
        const b = mine.map((p) => `${p.day}:${p.v}`).join(",");
        if (a !== b) { poolBad++; if (poolBad <= 5) console.log(`    ✗ ${id}:${m.field} ${mmdd}: ${truth.length} vs ${mine.length} members`); }
      }
    }
  }
  console.log(`  ${poolChecks} (instrument × doy) pools → ${poolBad} mismatch(es)`);
  if (poolBad) fails++;

  // 3. The census arithmetic, against an independent re-derivation.
  console.log(`\n--- 3. census arithmetic vs an independent re-derivation ---`);
  let censusChecks = 0, censusBad = 0;
  for (const id of ["ghcn-md", "ghcn-tx", "ghcn-nd"]) {
    const inst = instById.get(id)!;
    const series = loadCachedSeries(inst).get("avg_high_f")!;
    const col = decodeRow(buildRow({ instId: id, metric: "avg_high_f", sourceCt: inst.source_ct }, series));
    for (const mmdd of ["01-15", "04-01", "10-10", "11-05"]) {
      for (const band of BANDS) {
        const truth = truthPool(series, DOY_HALF_WINDOW, mmdd);
        const c = bandCensus(poolForDoy(col, mmdd, DOY_HALF_WINDOW), band, "low");
        const take = Math.min(truth.length, Math.ceil(band * truth.length));
        const eps = mergeEpisodes(truth.slice(0, take).map((p) => p.day), DEFAULT_EPISODE_GAP_DAYS);
        const yrs = new Set(eps.map((e) => +isoOfEpochDay(e.startDay).slice(0, 4)));
        censusChecks++;
        const ok = c.count === eps.length && c.years.length === yrs.size && c.matchedDays === take
          && c.refusal === refusalReason(eps.length, yrs.size);
        if (!ok) { censusBad++; console.log(`    ✗ ${id} ${mmdd} ${band}: engine ${c.count}/${c.years.length} vs truth ${eps.length}/${yrs.size}`); }
      }
    }
  }
  console.log(`  ${censusChecks} (state × doy × band) censuses → ${censusBad} mismatch(es)`);
  if (censusBad) fails++;

  console.log(`\n${fails ? "✗ FAIL" : "✓ PASS"} — ${fails} failure(s)`);
  process.exit(fails ? 1 : 0);
}

/** The committed pool, rebuilt from the raw series exactly as bake-luts.ts does. */
function truthPool(series: Map<string, number>, nDays: number, mmdd: string) {
  const target = `2000-${mmdd}`;
  const pool: { v: number; day: number; year: number }[] = [];
  for (const [d, v] of series) {
    if (doyOffset(d, target) <= nDays && Number.isFinite(v)) pool.push({ v, day: epochDay(d), year: +d.slice(0, 4) });
  }
  pool.sort((a, b) => a.v - b.v || a.day - b.day);
  return pool;
}

// ─── CARD — the real rendered numbers, offline, before anything is written ───────
function runCard(states: string[], mmdd: string, side: TailSide) {
  const { rows } = buildRegistry();
  const instById = new Map<string, Instrument>(rows.map((r) => [r.id, r]));
  const w = windowPhrase(mmdd);
  console.log(`=== THE CARD, REAL NUMBERS === ${mmddLabel(mmdd)} · ${w.short} (${w.span}) · episode gap ${DEFAULT_EPISODE_GAP_DAYS}d\n`);

  for (const abbr of states) {
    const id = `ghcn-${abbr.toLowerCase()}`;
    const inst = instById.get(id);
    if (!inst) { console.log(`  ✗ ${abbr}: no such instrument`); continue; }
    const series = loadCachedSeries(inst).get("avg_high_f")!;
    const col = decodeRow(buildRow({ instId: id, metric: "avg_high_f", sourceCt: inst.source_ct }, series));

    for (const [minYear, label] of [[-Infinity, "full record"], [1979, "1979+ (ERA5-shaped)"]] as [number, string][]) {
      const pool = poolForDoy(col, mmdd, DOY_HALF_WINDOW, minYear);
      const since = pool.length ? Math.min(...pool.map((p) => p.year)) : 0;
      console.log(`  ${inst.label} — ${label}: pool n=${pool.length}, ${new Set(pool.map((p) => p.year)).size} years (${since}+)`);
      for (const band of BANDS) {
        const c = bandCensus(pool, band, side);
        const head = c.refusal
          ? `REFUSES — ${c.refusal}`
          : `${thresholdPhrase("avg_high_f", side, c.threshold)} ${w.short} has happened ${c.count} times since ${since}. Most recently ${c.lastOccurrence}.`;
        console.log(`    ${bandPhrase(band, side).padEnd(46)} days=${String(c.matchedDays).padStart(3)} times=${String(c.count).padStart(3)} years=${String(c.years.length).padStart(3)}`);
        console.log(`      ${head}`);
        console.log(`      bars: ${c.dist.bars.map((b) => `${b.decade}s ${b.count}/${b.yearsOfRecord}y=${b.perYear.toFixed(2)}${b.partial ? "*" : ""}`).join("  ") || "none"}`);
        if (c.dist.preBarCount || c.dist.preBarYears) console.log(`      pre-${c.dist.bars[0]?.decade ?? 1980} (counted, not drawn): ${c.dist.preBarCount} in ${c.dist.preBarYears}y`);
      }
      console.log("");
    }
  }
}

// ─── main ───────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx === -1 ? undefined : argv[onlyIdx + 1];
  if (argv.includes("--verify")) return runVerify();
  if (argv.includes("--dry-run")) return runDryRun(only);
  const cardIdx = argv.indexOf("--card");
  if (cardIdx !== -1) {
    const rest = argv.slice(cardIdx + 1).filter((a) => !a.startsWith("--"));
    const mmdd = rest.find((a) => /^\d{2}-\d{2}$/.test(a)) ?? "10-10";
    const states = rest.filter((a) => /^[A-Za-z]{2}$/.test(a)).map((a) => a.toUpperCase());
    return runCard(states.length ? states : ["MD"], mmdd, argv.includes("--high") ? "high" : "low");
  }
  return runBake(only);
}
main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
