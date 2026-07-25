/**
 * backfill-era5-pressure.ts — TRACK A: the per-state daily surface-pressure
 * series, 1979-forward, from ERA5 via Open-Meteo's archive API.
 *
 * WHY THIS EXISTS (Amendment 1.3 Ruling 3). The v1 card counts pressure falls.
 * No such series exists in the archive: `ghcn-daily` carries no pressure field at
 * all, and `hunt_weather_history.pressure_avg_msl` starts 2020-09-01. ERA5 is a
 * reanalysis — physically consistent, gridded, and NOT an average over a station
 * network that grew from 6,121 to 7,771 stations. That inhomogeneity is the
 * defect underneath the temperature analysis and no downstream statistics fix
 * it; changing the source removes it at the root.
 *
 * SCOPE — binding, do not widen without a ruling:
 *   • 1979-forward ONLY. ERA5's 1940-1978 back-extension is materially less
 *     observation-constrained and is explicitly out of v1 (Ruling 3). The script
 *     REFUSES YEAR_FROM < 1979 rather than quietly obeying it. A later tier can
 *     lift that floor under its own label; this one will not do it by accident.
 *   • 5 sample points per state, averaged, from the frozen scheme in
 *     ./sampling.ts (Ruling 3a). A centroid would claim one grid point as a
 *     state; this does not.
 *   • Daily pressure_msl_mean / _min / _max. All three verified live against the
 *     archive API. Costs nothing extra: Open-Meteo's weighting only surcharges
 *     past TEN variables, and a *fall* is the product metric, so the min matters.
 *
 * ── THE CALL BUDGET, WHICH IS THE WHOLE PROBLEM ──────────────────────────────
 * Open-Meteo counts a call as (locations) × (days / 14) × (variables / 10, min 1).
 * Their words, from open-meteo.com/en/pricing:
 *   "Requests for data covering more than 10 weather variables or extending over
 *    a period of more than 2 weeks for a single location are considered multiple
 *    API calls … a request for 2 weeks of data with 15 weather variables will be
 *    calculated as 1.5 API calls, while 4 weeks of data equals 3.0 API calls."
 * So the full backfill is 250 locations × 17,371 days ÷ 14 ≈ 310,000 weighted
 * calls — which EXCEEDS the free tier's entire 300,000/month allowance, never
 * mind its 10,000/day. Chunking does not help: the total is location-days, and
 * location-days are fixed by the scope. Run `--plan` for the exact arithmetic
 * against your dates, and read docs/ERA5-SAMPLING-SCHEME.md §"The call budget"
 * before starting anything long.
 *
 * The script therefore refuses to sleepwalk into that. DAILY_CALL_BUDGET is
 * enforced locally against a per-UTC-day ledger in the checkpoint; when it is
 * spent the run stops CLEANLY and tells you when to resume. A 429 from the API
 * is treated as quota exhaustion and stops the run — it is never retried, both
 * because the project law says never retry 4xx and because retrying a quota wall
 * is how you get IP-banned.
 *
 * ── SEPARATION OF LANES (THE EMBEDDING LAW) ─────────────────────────────────
 * This script writes ONE table: era5_state_pressure. It does NOT embed and it
 * does NOT touch hunt_knowledge. The Embedding Law lane is a separate, resumable
 * script — scripts/era5/embed-era5-pressure.ts — because 868,550 day-rows is
 * ~43,428 Voyage batches and that is a decision someone has to actually make,
 * not a side effect of an ingest. See that file's header for the priced options.
 *
 * ── ONE WRITE PIPE ───────────────────────────────────────────────────────────
 * Permanent project doctrine. This is a write pipe. Claim the lane in the state
 * log before running it, run it alone, and do not start the embedding lane
 * beside it.
 *
 * Usage:
 *   npx tsx scripts/era5/backfill-era5-pressure.ts --points     # print the frozen scheme, exit
 *   npx tsx scripts/era5/backfill-era5-pressure.ts --plan       # offline budget, NO network, NO DB
 *   npx tsx scripts/era5/backfill-era5-pressure.ts --verify-points # snapped ERA5 cells, ~18 calls, NO DB
 *   npx tsx scripts/era5/backfill-era5-pressure.ts --dry-run    # ONE state-year, live fetch, ZERO writes
 *   npx tsx scripts/era5/backfill-era5-pressure.ts --status     # checkpoint + today's spend
 *   npx tsx scripts/era5/backfill-era5-pressure.ts --freeze-points # write the 250 coords to era5_sampling_points
 *   npx tsx scripts/era5/backfill-era5-pressure.ts --emit-cache # DB → .frame-cache series files
 *   npx tsx scripts/era5/backfill-era5-pressure.ts              # THE RUN (write pipe)
 *
 * Env:
 *   SUPABASE_SERVICE_ROLE_KEY   required for writes (bootstraps from the CLI if absent)
 *   YEAR_FROM / YEAR_TO         default 1979 / current year. YEAR_FROM < 1979 is refused.
 *   ONLY_STATES=MD,VA           restrict the roster
 *   DAILY_CALL_BUDGET=8000      weighted calls per UTC day (default 8000, leaves ~1,800
 *                               under the free 10k for the live crons' ~222/day baseline)
 *   OM_API_KEY / OM_HOST        paid key → customer-api.open-meteo.com, budget check skipped
 *   DRY_STATE=MD DRY_YEAR=1979  which slice --dry-run exercises
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  SAMPLING_VERSION, POINTS_PER_STATE, GEOMETRY_SOURCE, ERA5_STATES,
  resolveStatePoints, resolveAllPoints, schemeHash, coordParams, isInState, type SamplePoint,
} from "./sampling.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, "..", "frames", ".frame-cache");
const CHECKPOINT_FILE = join(HERE, ".era5-checkpoint.json");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";

/** Ruling 3. Not a default — a floor. */
const ERA5_V1_FLOOR_YEAR = 1979;
const DAILY_VARS = ["pressure_msl_mean", "pressure_msl_min", "pressure_msl_max"] as const;
const OM_HOST = process.env.OM_HOST || (process.env.OM_API_KEY ? "customer-api.open-meteo.com" : "archive-api.open-meteo.com");
const OM_KEY = process.env.OM_API_KEY || null;
const DAILY_CALL_BUDGET = process.env.DAILY_CALL_BUDGET ? Number(process.env.DAILY_CALL_BUDGET) : 8000;

const YEAR_TO = process.env.YEAR_TO ? parseInt(process.env.YEAR_TO, 10) : new Date().getUTCFullYear();
const YEAR_FROM = process.env.YEAR_FROM ? parseInt(process.env.YEAR_FROM, 10) : ERA5_V1_FLOOR_YEAR;
const ONLY_STATES = process.env.ONLY_STATES
  ? process.env.ONLY_STATES.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)
  : null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

// ─── Keys / HTTP (5xx + network retry ONLY; never 4xx; 429 stops the run) ─────

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
/** A 429 from Open-Meteo means the quota wall. Stop the pipe; never hammer it. */
class QuotaExhausted extends Error {}

async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 5): Promise<Response> {
  let lastErr: any;
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = (await res.text()).slice(0, 300);
      if (res.status === 429) throw new QuotaExhausted(`${label} 429: ${body}`);
      if (res.status >= 400 && res.status < 500) throw new FatalHttpError(`${label} ${res.status}: ${body}`);
      lastErr = new Error(`${label} ${res.status}: ${body}`);
    } catch (e: any) {
      if (e instanceof FatalHttpError || e instanceof QuotaExhausted) throw e;
      lastErr = e;
    }
    if (a < attempts) await sleep(Math.min(2000 * 2 ** (a - 1), 30000));
  }
  throw lastErr;
}

// ─── Checkpoint: unit ledger + per-UTC-day call ledger ───────────────────────

type Checkpoint = {
  samplingVersion: number;
  schemeHash: number;
  /** "MD:1979" → true. The unit of work is one state-year. */
  done: Record<string, true>;
  /** "2026-07-25" → weighted calls spent that UTC day. */
  spend: Record<string, number>;
  rowsWritten: number;
};
function emptyCheckpoint(): Checkpoint {
  return { samplingVersion: SAMPLING_VERSION, schemeHash: schemeHash(), done: {}, spend: {}, rowsWritten: 0 };
}
function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) {
    try {
      const cp = JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8")) as Checkpoint;
      // THE FROZEN-SCHEME GUARD. If the points moved, every number computed after
      // this moment is incomparable to every number computed before it, and
      // nothing in the data would say so. Hard stop.
      const live = schemeHash();
      if (cp.samplingVersion !== SAMPLING_VERSION || cp.schemeHash !== live) {
        console.error(
          `  ✗ SAMPLING SCHEME DRIFT — checkpoint v${cp.samplingVersion}/hash ${cp.schemeHash}` +
          ` ≠ current v${SAMPLING_VERSION}/hash ${live}.\n` +
          `    The sample points moved. Resuming would blend two schemes into one series.\n` +
          `    Either restore scripts/era5/sampling.ts, or bump SAMPLING_VERSION and start a` +
          ` clean checkpoint (rows are keyed by sampling_version, so both tiers can coexist).`,
        );
        process.exit(1);
      }
      return cp;
    } catch (e: any) {
      if (e?.code === undefined && String(e).includes("SAMPLING")) throw e;
    }
  }
  return emptyCheckpoint();
}
function saveCheckpoint(cp: Checkpoint) { writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2) + "\n"); }

const utcDay = () => new Date().toISOString().slice(0, 10);

// ─── The weighting arithmetic, in one place so --plan and the run agree ──────

/** Open-Meteo's published weighting. ≤10 variables carries no surcharge. */
function weightedCalls(locations: number, days: number, vars: number): number {
  return locations * (days / 14) * Math.max(1, vars / 10);
}
/**
 * ERA5 lands with a lag (Open-Meteo documents ~5 days for the archive). Asking
 * for tomorrow returns a short array, not an error, so the end of the window is
 * clamped here rather than discovered as a mystery gap in December.
 */
const ARCHIVE_LAG_DAYS = 6;
function archiveEnd(): string {
  return new Date(Date.now() - ARCHIVE_LAG_DAYS * 86400000).toISOString().slice(0, 10);
}
function windowEnd(): string {
  const hard = `${YEAR_TO}-12-31`, lag = archiveEnd();
  return hard < lag ? hard : lag;
}

function daysInYear(y: number, from: string, to: string): number {
  const a = Date.UTC(y, 0, 1), b = Date.UTC(y, 11, 31);
  const lo = Math.max(a, Date.parse(from + "T00:00:00Z"));
  const hi = Math.min(b, Date.parse(to + "T00:00:00Z"));
  return hi < lo ? 0 : Math.round((hi - lo) / 86400000) + 1;
}

// ─── Fetch one state-year ────────────────────────────────────────────────────

type PointSeries = { time: string[]; vals: Record<string, (number | null)[]> };

function buildUrl(points: SamplePoint[], startDate: string, endDate: string): string {
  const { latitude, longitude } = coordParams(points);
  const p = new URLSearchParams({
    latitude, longitude,
    start_date: startDate, end_date: endDate,
    daily: DAILY_VARS.join(","),
    timezone: "UTC",
  });
  if (OM_KEY) p.set("apikey", OM_KEY);
  return `https://${OM_HOST}/v1/archive?${p.toString()}`;
}

/**
 * The parser. Open-Meteo returns a bare object for one coordinate and a JSON
 * ARRAY of per-location objects for a comma-separated list — verified live. Only
 * entries after the first carry `location_id`, so ORDER is the contract, not the
 * id. We assert the returned lat/lon is within one ERA5 cell (0.25°) of what we
 * asked for; a silent reorder would otherwise attribute Ocean City's pressure to
 * Garrett County and nothing downstream would ever notice.
 */
function parseLocations(json: any, points: SamplePoint[], label: string): PointSeries[] {
  const arr = Array.isArray(json) ? json : [json];
  if (arr.length !== points.length) {
    throw new Error(`${label}: expected ${points.length} locations, got ${arr.length}`);
  }
  return arr.map((loc, i) => {
    const want = points[i];
    if (Math.abs(loc.latitude - want.lat) > 0.3 || Math.abs(loc.longitude - want.lon) > 0.3) {
      throw new Error(
        `${label}: location ${i} (${want.state}/${want.role}) came back at ` +
        `${loc.latitude},${loc.longitude} but was requested at ${want.lat},${want.lon} — ` +
        `response order is not the request order, refusing to attribute it`,
      );
    }
    const d = loc.daily;
    if (!d || !Array.isArray(d.time)) throw new Error(`${label}: location ${i} has no daily block`);
    const vals: Record<string, (number | null)[]> = {};
    for (const v of DAILY_VARS) {
      if (!Array.isArray(d[v])) throw new Error(`${label}: location ${i} missing ${v}`);
      vals[v] = d[v];
    }
    return { time: d.time as string[], vals };
  });
}

type StateDay = {
  day: string;
  mean: number | null;
  min: number | null;
  max: number | null;
  nPoints: number;
  spread: number | null;
};

/**
 * The 5-point average. Ruling 3a: a state number is the mean of its five points,
 * not a reading at one of them.
 *
 * `spread` is the max-minus-min of the five points' daily means — the receipt for
 * the words "Maryland statewide" on the card. A 2 hPa spread across Maryland on a
 * frontal day is the field genuinely tilting; a 12 hPa spread would mean the
 * average is describing two different weather systems and the label is lying.
 * Stored so that claim can be audited later instead of assumed now.
 */
function averagePoints(series: PointSeries[], label: string): StateDay[] {
  const time = series[0].time;
  for (const s of series) {
    if (s.time.length !== time.length || s.time[0] !== time[0]) {
      throw new Error(`${label}: locations disagree on the date axis`);
    }
  }
  return time.map((day, i) => {
    const means: number[] = [], mins: number[] = [], maxs: number[] = [];
    for (const s of series) {
      const m = s.vals.pressure_msl_mean[i];
      if (m === null || !Number.isFinite(m)) continue; // a point with no mean does not vote
      means.push(m);
      const lo = s.vals.pressure_msl_min[i];
      const hi = s.vals.pressure_msl_max[i];
      if (lo !== null && Number.isFinite(lo)) mins.push(lo);
      if (hi !== null && Number.isFinite(hi)) maxs.push(hi);
    }
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    const mean = avg(means);
    return {
      day,
      mean: mean === null ? null : r2(mean),
      min: mins.length ? r2(avg(mins)!) : null,
      max: maxs.length ? r2(avg(maxs)!) : null,
      nPoints: means.length,
      spread: means.length > 1 ? r2(Math.max(...means) - Math.min(...means)) : null,
    };
  });
}

// ─── Row builder ─────────────────────────────────────────────────────────────

/**
 * Rows for one state-year. `lead` is the day BEFORE Jan 1, fetched so that
 * pressure_delta_24h is exact at the year boundary instead of null every
 * January 1 — 48 extra location-days across the whole backfill, 0.06% of the
 * budget, and it removes a systematic hole from the metric the card counts.
 */
function buildRows(state: string, days: StateDay[], yearStart: string, url: string, hash: number) {
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (d.day < yearStart) continue; // the lead day is context, not a row
    if (d.mean === null) continue;   // no point reported: write nothing, do not fabricate
    const prev = i > 0 ? days[i - 1] : null;
    const delta = prev && prev.mean !== null && prev.day === isoMinus1(d.day) ? r2(d.mean - prev.mean) : null;
    rows.push({
      state_abbr: state,
      day: d.day,
      pressure_msl_mean: d.mean,
      pressure_msl_min: d.min,
      pressure_msl_max: d.max,
      pressure_delta_24h: delta,
      n_points: d.nPoints,
      spread_hpa: d.spread,
      sampling_version: SAMPLING_VERSION,
      scheme_hash: hash,
      source: "ERA5 (0.25°) via Open-Meteo archive-api, 5-point state mean",
      source_url: url,
      source_event_id: `era5-pressure:v${SAMPLING_VERSION}:${state}:${d.day}`,
    });
  }
  return rows;
}
function isoMinus1(iso: string): string {
  return new Date(Date.parse(iso + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
}

async function upsertRows(rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) {
    await fetchWithRetry(
      `${SUPABASE_URL}/rest/v1/era5_state_pressure?on_conflict=state_abbr,day,sampling_version`,
      {
        method: "POST",
        headers: { ...supaHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(rows.slice(i, i + 500)),
      },
      "era5_state_pressure upsert",
    );
  }
}

// ─── Modes ───────────────────────────────────────────────────────────────────

function roster(): string[] {
  return ONLY_STATES ? ERA5_STATES.filter((s) => ONLY_STATES.includes(s)) : ERA5_STATES;
}

function showPoints() {
  const pts = resolveAllPoints();
  console.log(`=== ERA5 SAMPLING SCHEME v${SAMPLING_VERSION} ===`);
  console.log(`  geometry: ${GEOMETRY_SOURCE}`);
  console.log(`  ${ERA5_STATES.length} states × ${POINTS_PER_STATE} points = ${pts.length} coordinates`);
  console.log(`  scheme_hash: ${schemeHash(pts)}`);
  const counts: Record<string, number> = {};
  for (const p of pts) counts[p.resolution] = (counts[p.resolution] || 0) + 1;
  console.log(`  resolution: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  console.log(`\n  state  idx role   lon         lat        resolution  ring`);
  for (const p of pts) {
    console.log(`  ${p.state}     ${p.idx}  ${p.role.padEnd(3)}  ${String(p.lon).padStart(10)}  ${String(p.lat).padStart(9)}  ${p.resolution.padEnd(10)}  ${p.repair_rings}`);
  }
}

function plan() {
  const states = roster();
  const from = `${YEAR_FROM}-01-01`;
  const to = windowEnd();
  let totalDays = 0, units = 0;
  for (const _ of states) for (let y = YEAR_FROM; y <= YEAR_TO; y++) { const d = daysInYear(y, from, to); if (d) { totalDays += d; units++; } }
  const locDays = totalDays * POINTS_PER_STATE;
  const calls = weightedCalls(POINTS_PER_STATE, totalDays, DAILY_VARS.length);

  console.log(`=== ERA5 PRESSURE BACKFILL — PLAN (offline, no network, no DB) ===`);
  console.log(`  sampling v${SAMPLING_VERSION}, scheme_hash ${schemeHash()}, ${POINTS_PER_STATE} points/state`);
  console.log(`  states ${states.length} | window ${from} … ${to} | units (state-year) ${units}`);
  console.log(`  variables: ${DAILY_VARS.join(", ")} (${DAILY_VARS.length} ≤ 10 → no variable surcharge)`);
  console.log(`  archive rows: ${totalDays.toLocaleString()}`);
  console.log(`  location-days: ${locDays.toLocaleString()}`);
  console.log(`\n  --- Open-Meteo weighted calls (locations × days/14) ---`);
  console.log(`  per state-year (5 pts × ~365 d):  ${r1(weightedCalls(POINTS_PER_STATE, 365, DAILY_VARS.length))}`);
  console.log(`  TOTAL:                            ${Math.round(calls).toLocaleString()}`);
  console.log(`\n  --- against the FREE tier (10,000/day · 300,000/month · 5,000/hr · 600/min) ---`);
  console.log(`  measured live-cron baseline:      ~222/day weighted (~6,760/month)`);
  console.log(`  days at DAILY_CALL_BUDGET=${DAILY_CALL_BUDGET}:   ${Math.ceil(calls / DAILY_CALL_BUDGET)}`);
  console.log(`  months of the 300k cap consumed:  ${(calls / 300000).toFixed(2)}  ${calls > 300000 ? "← EXCEEDS ONE MONTH'S ENTIRE FREE ALLOWANCE" : ""}`);
  console.log(`\n  --- with a paid key (OM_API_KEY, Professional = 5M/month) ---`);
  console.log(`  fraction of a Professional month: ${(calls / 5e6 * 100).toFixed(1)}%`);
  console.log(`  wall clock at ~5 s/unit, serial:  ${(units * 5 / 3600).toFixed(1)} h`);
  console.log(`\n  Ruling 10.5 escape hatch: ERA5 is Copernicus data. The CDS product`);
  console.log(`  "derived-era5-single-levels-daily-statistics" serves the same daily`);
  console.log(`  mean/min/max under attribution with no per-call quota and no`);
  console.log(`  non-commercial restriction. Same table, same sampling scheme, different`);
  console.log(`  faucet. See docs/ERA5-SAMPLING-SCHEME.md §"The call budget".`);
}

/** --dry-run: ONE state-year, live fetch, ZERO database access of any kind. */
async function dryRun() {
  const state = (process.env.DRY_STATE || "MD").toUpperCase();
  const year = process.env.DRY_YEAR ? parseInt(process.env.DRY_YEAR, 10) : 1979;
  const points = resolveStatePoints(state);
  const hash = schemeHash();
  const lead = isoMinus1(`${year}-01-01`);
  const url = buildUrl(points, lead, `${year}-12-31`);

  console.log(`=== DRY RUN — ${state} ${year} — NO DATABASE WRITES, NO DATABASE READS ===`);
  console.log(`  sampling v${SAMPLING_VERSION}  scheme_hash ${hash}`);
  console.log(`  points:`);
  for (const p of points) console.log(`    ${p.idx} ${p.role.padEnd(3)} ${String(p.lon).padStart(10)},${String(p.lat).padStart(8)}  ${p.resolution}${p.repair_rings ? ` (ring ${p.repair_rings})` : ""}`);
  console.log(`  weighted calls for this slice: ${r1(weightedCalls(POINTS_PER_STATE, 366, DAILY_VARS.length))}`);
  console.log(`  GET ${url.slice(0, 200)}${url.length > 200 ? "…" : ""}`);

  const t0 = Date.now();
  const res = await fetchWithRetry(url, {}, `archive ${state}/${year}`);
  const json = await res.json();
  const ms = Date.now() - t0;

  const series = parseLocations(json, points, `${state}/${year}`);
  console.log(`\n  ✓ ${series.length} locations parsed in ${ms} ms`);
  for (let i = 0; i < series.length; i++) {
    const loc = (Array.isArray(json) ? json : [json])[i];
    console.log(`    ${points[i].role.padEnd(3)} requested ${points[i].lat},${points[i].lon} → snapped ${loc.latitude},${loc.longitude} elev ${loc.elevation} m, ${series[i].time.length} days`);
  }

  const days = averagePoints(series, `${state}/${year}`);
  const rows = buildRows(state, days, `${year}-01-01`, url, hash);
  console.log(`\n  ${days.length} fetched days (incl. 1 lead) → ${rows.length} rows for ${year}`);

  // Show the averaging arithmetic explicitly on a handful of days.
  console.log(`\n  --- per-point means vs the state average (first 5 days of ${year}) ---`);
  const idxOfJan1 = days.findIndex((d) => d.day === `${year}-01-01`);
  console.log(`  day         ${points.map((p) => p.role.padStart(8)).join("")}   →  mean    min     max    spread  n`);
  for (let k = idxOfJan1; k < idxOfJan1 + 5 && k < days.length; k++) {
    const per = series.map((s) => String(s.vals.pressure_msl_mean[k] ?? "—").padStart(8)).join("");
    const d = days[k];
    console.log(`  ${d.day}${per}   →  ${String(d.mean).padStart(7)} ${String(d.min).padStart(7)} ${String(d.max).padStart(7)} ${String(d.spread).padStart(6)}  ${d.nPoints}`);
  }

  // Independent arithmetic check of the average on one day.
  const k = idxOfJan1 + 2;
  const raw = series.map((s) => s.vals.pressure_msl_mean[k]!).filter((v) => Number.isFinite(v));
  const handAvg = raw.reduce((a, b) => a + b, 0) / raw.length;
  const ok = Math.abs(handAvg - days[k].mean!) < 0.005;
  console.log(`\n  averaging check ${days[k].day}: hand mean of [${raw.join(", ")}] = ${handAvg.toFixed(4)} vs stored ${days[k].mean} → ${ok ? "✓ MATCH" : "✗ MISMATCH"}`);

  // The delta — the metric the card actually counts.
  const withDelta = rows.filter((r) => r.pressure_delta_24h !== null);
  const falls = withDelta.map((r) => r.pressure_delta_24h as number).filter((v) => v < 0);
  console.log(`\n  --- pressure_delta_24h (the v1 metric) ---`);
  console.log(`  rows with a delta: ${withDelta.length}/${rows.length}  (Jan 1 has one because of the lead day)`);
  console.log(`  jan 1 delta: ${rows[0].pressure_delta_24h} hPa  ← the lead day earning its keep`);
  const sorted = [...withDelta].sort((a, b) => (a.pressure_delta_24h as number) - (b.pressure_delta_24h as number));
  console.log(`  5 deepest 24h falls in ${state} ${year}:`);
  for (const r of sorted.slice(0, 5)) console.log(`    ${r.day}  ${r.pressure_delta_24h} hPa  (mean ${r.pressure_msl_mean}, min ${r.pressure_msl_min}, spread ${r.spread_hpa}, n=${r.n_points})`);
  console.log(`  falls / days: ${falls.length}/${withDelta.length}`);

  const spreads = rows.map((r) => r.spread_hpa as number).filter((v) => v !== null);
  console.log(`\n  --- "${state} statewide" audit: spread across the 5 points (hPa) ---`);
  spreads.sort((a, b) => a - b);
  console.log(`  median ${spreads[spreads.length >> 1]}  p90 ${spreads[Math.floor(spreads.length * 0.9)]}  max ${spreads[spreads.length - 1]}`);
  console.log(`  n_points = 5 on ${rows.filter((r) => r.n_points === 5).length}/${rows.length} days`);

  console.log(`\n  --- one row exactly as it would be written ---`);
  console.log(JSON.stringify({ ...rows[280], source_url: (rows[280].source_url as string).slice(0, 90) + "…" }, null, 2));
  console.log(`\n=== DRY RUN COMPLETE — nothing was written anywhere ===`);
}

/**
 * Freeze the 250 coordinates into era5_sampling_points. Ruling 3a's literal
 * instruction — "store the actual coordinates used per state" — so a future run
 * can PROVE it used the same points instead of asserting it from the rule. Runs
 * as the first act of every backfill session; idempotent upsert.
 */
async function freezePoints() {
  const pts = resolveAllPoints();
  const hash = schemeHash(pts);
  const rows = pts.map((p) => ({
    sampling_version: SAMPLING_VERSION,
    state_abbr: p.state, idx: p.idx, role: p.role,
    lon: p.lon, lat: p.lat,
    resolution: p.resolution, repair_rings: p.repair_rings,
    scheme_hash: hash, geometry_source: GEOMETRY_SOURCE,
  }));
  await fetchWithRetry(
    `${SUPABASE_URL}/rest/v1/era5_sampling_points?on_conflict=sampling_version,state_abbr,idx`,
    {
      method: "POST",
      headers: { ...supaHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
    },
    "era5_sampling_points upsert",
  );
  console.log(`  ✓ froze ${rows.length} sampling points at v${SAMPLING_VERSION}, hash ${hash}`);
}

/** THE RUN. Writes era5_state_pressure (and era5_sampling_points once). */
async function run() {
  if (YEAR_FROM < ERA5_V1_FLOOR_YEAR) {
    console.error(
      `  ✗ YEAR_FROM=${YEAR_FROM} is before ${ERA5_V1_FLOOR_YEAR}. Ruling 3 scopes v1 to 1979-forward:\n` +
      `    ERA5's back extension to 1940 is materially less observation-constrained and has not\n` +
      `    been validated here for daily surface pressure. It may become a separately-LABELLED\n` +
      `    tier later — which means its own sampling_version and its own words on the card, not\n` +
      `    a quiet extension of this one.`,
    );
    process.exit(1);
  }
  bootstrapKeys();
  const cp = loadCheckpoint();
  await freezePoints();
  const hash = cp.schemeHash;
  const states = roster();
  const today = utcDay();
  cp.spend[today] ??= 0;

  const from = `${YEAR_FROM}-01-01`, to = windowEnd();
  const units: { state: string; year: number; days: number }[] = [];
  for (const s of states) for (let y = YEAR_FROM; y <= YEAR_TO; y++) {
    const d = daysInYear(y, from, to);
    if (d && !cp.done[`${s}:${y}`]) units.push({ state: s, year: y, days: d });
  }
  const remaining = units.reduce((n, u) => n + weightedCalls(POINTS_PER_STATE, u.days, DAILY_VARS.length), 0);

  console.log(`=== ERA5 PRESSURE BACKFILL === sampling v${SAMPLING_VERSION} hash ${hash}`);
  console.log(`  host ${OM_HOST}${OM_KEY ? " (paid key)" : " (free tier)"}`);
  console.log(`  ${units.length} unit(s) remaining, ~${Math.round(remaining).toLocaleString()} weighted calls`);
  console.log(`  budget today: ${cp.spend[today]} / ${OM_KEY ? "unlimited" : DAILY_CALL_BUDGET}`);
  if (!OM_KEY && remaining > DAILY_CALL_BUDGET) {
    console.log(`  ⚠ this will take ~${Math.ceil(remaining / DAILY_CALL_BUDGET)} day(s) of budget. Re-run daily; it resumes.`);
  }

  let wrote = 0, unitsDone = 0;
  for (const u of units) {
    const cost = weightedCalls(POINTS_PER_STATE, u.days + 1, DAILY_VARS.length);
    if (!OM_KEY && cp.spend[today] + cost > DAILY_CALL_BUDGET) {
      console.log(`\n  ⏸ daily budget reached (${r1(cp.spend[today])}/${DAILY_CALL_BUDGET}). Stopping cleanly.`);
      console.log(`     Resume tomorrow (UTC) with the same command — the checkpoint carries ${units.length - unitsDone} unit(s).`);
      break;
    }

    const points = resolveStatePoints(u.state);
    const lead = isoMinus1(`${u.year}-01-01`);
    const end = `${u.year}-12-31` < to ? `${u.year}-12-31` : to;
    const url = buildUrl(points, lead, end);

    try {
      const res = await fetchWithRetry(url, {}, `archive ${u.state}/${u.year}`);
      const series = parseLocations(await res.json(), points, `${u.state}/${u.year}`);
      const rows = buildRows(u.state, averagePoints(series, `${u.state}/${u.year}`), `${u.year}-01-01`, url, hash);
      if (rows.length) await upsertRows(rows);
      cp.spend[today] += cost;
      cp.done[`${u.state}:${u.year}`] = true;
      cp.rowsWritten += rows.length;
      wrote += rows.length; unitsDone++;
      saveCheckpoint(cp);
      if (unitsDone % 20 === 0 || u.year === YEAR_TO) {
        console.log(`  ${u.state} ${u.year}: ${rows.length} rows | spent ${r1(cp.spend[today])} | ${unitsDone}/${units.length}`);
      }
    } catch (e: any) {
      if (e instanceof QuotaExhausted) {
        cp.spend[today] = DAILY_CALL_BUDGET; saveCheckpoint(cp);
        console.error(`\n  ✗ Open-Meteo returned 429 — quota wall. Stopping (429 is never retried).`);
        console.error(`    ${e.message}`);
        console.error(`    Resume after the next UTC-day rollover, or supply OM_API_KEY.`);
        process.exit(2);
      }
      if (e instanceof FatalHttpError) { console.error(`  ✗ ${u.state}/${u.year} 4xx (not retried, not marked done): ${e.message}`); continue; }
      console.error(`  ✗ ${u.state}/${u.year} failed after retries (not marked done): ${e.message ?? e}`);
    }
    await sleep(300); // stay far under the 600/min ceiling
  }

  console.log(`\n=== ${wrote.toLocaleString()} rows this session; ${cp.rowsWritten.toLocaleString()} total ===`);
  const left = units.length - unitsDone;
  if (left > 0) console.log(`  ${left} unit(s) still to go — re-run to continue.`);
  else console.log(`  Archive complete for ${YEAR_FROM}–${YEAR_TO}. Next: --emit-cache, then the LUT bake.`);
}

/**
 * --emit-cache: era5_state_pressure → scripts/frames/.frame-cache/series-era5-XX.json
 *
 * Shape is the envelope backfill-frames.ts writes and reads:
 *   { endYear, fields: { <metric>: { "YYYY-MM-DD": value } } }
 * so the existing pool/LUT machinery consumes these with no new loader.
 *
 * NOTE (hand-off, not a decision this script makes): the cache alone is inert.
 * For the board to carry these instruments, registry.ts must gain 50 `era5-XX`
 * instruments via APPEND_ORDER — which changes layout_version and therefore
 * forces a board_frames re-bake. That is the main session's call; the exact patch
 * is written out in docs/ERA5-SAMPLING-SCHEME.md §"Wiring it to the board".
 */
async function emitCache() {
  bootstrapKeys();
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const states = roster();
  console.log(`=== EMIT FRAME CACHE === ${states.length} state(s) → ${CACHE_DIR}`);
  for (const s of states) {
    const fields: Record<string, Record<string, number>> = {
      pressure_msl_mean: {}, pressure_msl_min: {}, pressure_msl_max: {}, pressure_delta_24h: {},
    };
    let offset = 0, n = 0;
    while (true) {
      const res = await fetchWithRetry(
        `${SUPABASE_URL}/rest/v1/era5_state_pressure?state_abbr=eq.${s}` +
        `&sampling_version=eq.${SAMPLING_VERSION}` +
        `&select=day,pressure_msl_mean,pressure_msl_min,pressure_msl_max,pressure_delta_24h` +
        `&limit=1000&offset=${offset}`,
        { headers: supaHeaders() }, `era5 read ${s}`,
      );
      const rows = await res.json();
      if (!Array.isArray(rows)) throw new Error(`non-array for ${s}`);
      for (const r of rows) {
        for (const f of Object.keys(fields)) {
          const v = r[f];
          if (v !== null && Number.isFinite(Number(v))) fields[f][r.day] = Number(v);
        }
      }
      n += rows.length;
      if (rows.length < 1000) break;
      offset += 1000;
    }
    const endYear = Math.max(...Object.keys(fields.pressure_msl_mean).map((d) => Number(d.slice(0, 4))));
    writeFileSync(join(CACHE_DIR, `series-era5-${s.toLowerCase()}.json`), JSON.stringify({ endYear, fields }));
    console.log(`  ✓ series-era5-${s.toLowerCase()}.json — ${n} days, endYear ${endYear}`);
  }
}

/**
 * --verify-points: the auditable receipt for Ruling 3a.
 *
 * The scheme freezes the coordinates we ASK for. Open-Meteo answers from the
 * nearest ERA5 grid-cell centre, which is up to ~0.125° away — so the cell
 * actually sampled is a second fact, and it is the one the numbers come from.
 * This resolves all 250 in one request per state (1-day window ≈ 18 weighted
 * calls for the whole roster) and re-runs the point-in-polygon test on the
 * SNAPPED coordinate, so "these five cells are inside Maryland" is a checked
 * claim rather than an assumption. Writes nothing.
 */
async function verifyPoints() {
  const day = archiveEnd();
  const states = roster();
  let outside = 0, maxShift = 0;
  console.log(`=== VERIFY POINTS v${SAMPLING_VERSION} — snapped ERA5 cells on ${day} (no writes) ===`);
  console.log(`  state role  requested lon,lat        snapped lon,lat         shift°  elev m  in-state`);
  for (const s of states) {
    const points = resolveStatePoints(s);
    const url = buildUrl(points, day, day);
    const json = await (await fetchWithRetry(url, {}, `verify ${s}`)).json();
    const locs: any[] = Array.isArray(json) ? json : [json];
    for (let i = 0; i < points.length; i++) {
      const p = points[i], l = locs[i];
      const shift = Math.hypot(l.longitude - p.lon, l.latitude - p.lat);
      maxShift = Math.max(maxShift, shift);
      const inside = isInState(s, l.longitude, l.latitude);
      if (!inside) outside++;
      console.log(
        `  ${s}    ${p.role.padEnd(3)}  ${String(p.lon).padStart(9)},${String(p.lat).padStart(8)}  ` +
        `${String(l.longitude).padStart(10)},${String(l.latitude).padStart(9)}  ${shift.toFixed(3)}  ` +
        `${String(l.elevation).padStart(6)}  ${inside ? "✓" : "✗ OUTSIDE"}`,
      );
    }
    await sleep(200);
  }
  console.log(`\n  max snap shift ${maxShift.toFixed(3)}° (one ERA5 half-cell is 0.125°)`);
  console.log(`  snapped cells outside their own state polygon: ${outside}/${states.length * POINTS_PER_STATE}`);
  console.log(`  NOTE: an outside cell is not automatically wrong — MSL pressure is a smooth`);
  console.log(`  synoptic field and a cell centre 15 km offshore still reports the state's`);
  console.log(`  weather system. It is reported so the count is known, not assumed.`);
}

function status() {
  const cp = loadCheckpoint();
  const total = ERA5_STATES.length * (YEAR_TO - YEAR_FROM + 1);
  console.log(`sampling v${cp.samplingVersion} hash ${cp.schemeHash} (live ${schemeHash()})`);
  console.log(`units done: ${Object.keys(cp.done).length}/${total}`);
  console.log(`rows written: ${cp.rowsWritten.toLocaleString()}`);
  console.log(`spend ledger (weighted calls per UTC day):`);
  for (const [d, v] of Object.entries(cp.spend).sort()) console.log(`  ${d}  ${r1(v)}`);
}

async function main() {
  const arg = process.argv[2] || "";
  if (arg === "--points") return showPoints();
  if (arg === "--plan") return plan();
  if (arg === "--dry-run") return dryRun();
  if (arg === "--verify-points") return verifyPoints();
  if (arg === "--freeze-points") { bootstrapKeys(); return freezePoints(); }
  if (arg === "--status") return status();
  if (arg === "--emit-cache") return emitCache();
  return run();
}
// Only run when executed directly — the entry builders are importable for tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
}
