/**
 * Tide roster + daily-MAX residual backfill — PIPE 3 of THE-WEEK sprint.
 *
 * WHY (docs/HORSE-RIDE-SCORECARD.md blind spot 3): the archive has no NY/NJ/CT
 * gauge (Sandy's record 9.40-ft Battery surge exists as a 2.68-ft ripple at
 * Newport) and no LA/MS/AL gauge (Katrina's 27.8-ft record surge exists as
 * 3.47 ft at Pensacola). Worse, daily-MEAN residuals structurally cannot show
 * surge peaks even where gauges exist — the story metric is the daily MAX.
 *
 * WHAT IT DOES: for the 7 roster stations (THE-WEEK pipe 3 list), per month:
 * CO-OPS hourly_height (verified obs) + predictions (interval=h), residual per
 * hour, then daily rollup: mean level, mean residual, MAX residual + its UTC
 * hour, max water level. One hunt_knowledge row per station-day under the full
 * row contract (source_event_id "{station}-{date}", provenance_url, granularity
 * point, ingest_v 2, numerics in metadata). Same content_type as the existing
 * tide rows ('tide-gauge') — new stations, no v1 twins per the scorecard.
 *
 * Usage:
 *   npx tsx scripts/tide-roster-backfill.ts --dry-run   # CO-OPS fetch of two proof
 *       months (Battery Oct 2012, Grand Isle Aug 2005), print max residuals.
 *       Read-only: NO database, NO embeds.
 *   npx tsx scripts/tide-roster-backfill.ts             # THE RUN (write pipe — one at
 *       a time). Checkpointed per station-year, nohup-ready, kill+rerun safe.
 *   npx tsx scripts/tide-roster-backfill.ts --status
 *
 * Env: START_YEAR (default 1980), END_YEAR (default current), STATIONS=8518750,…
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI), VOYAGE_API_KEY (env or .env.local).
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const COOPS_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const CHECKPOINT_FILE = join(SCRIPTS_DIR, ".tide-roster-checkpoint.json");
const CONTENT_TYPE = "tide-gauge";
const EMBED_BATCH = 20; // HARD LIMIT
const PAGE_SIZE = 1000; // PostgREST cap
const COOPS_SPACING_MS = 350; // ~3 req/s is polite; CO-OPS throttles hard bursts

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// THE-WEEK pipe 3 roster. startYear = when hourly verified data plausibly begins
// for our purposes (CO-OPS returns "No data" earlier — handled, marked done).
type Station = { id: string; name: string; state: string; lat: number; lng: number; startYear: number };
const ROSTER: Station[] = [
  { id: "8518750", name: "The Battery", state: "NY", lat: 40.7006, lng: -74.0142, startYear: 1920 },
  { id: "8531680", name: "Sandy Hook", state: "NJ", lat: 40.4669, lng: -74.0094, startYear: 1932 },
  { id: "8516945", name: "Kings Point", state: "NY", lat: 40.8103, lng: -73.7649, startYear: 1998 },
  { id: "8461490", name: "New London", state: "CT", lat: 41.3717, lng: -72.0956, startYear: 1938 },
  { id: "8761724", name: "Grand Isle", state: "LA", lat: 29.2633, lng: -89.9567, startYear: 1980 },
  { id: "8747437", name: "Bay Waveland", state: "MS", lat: 30.3264, lng: -89.3258, startYear: 1978 },
  { id: "8735180", name: "Dauphin Island", state: "AL", lat: 30.25, lng: -88.075, startYear: 1966 },
];

// ─── Key bootstrap (same pattern as ncei-reingest.ts) ────────────────────────
function bootstrapKeys() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const out = execSync("npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null", { encoding: "utf-8", timeout: 30_000 }).trim();
      let key = "";
      try {
        const parsed = JSON.parse(out);
        key = (parsed.keys || parsed || []).find?.((k: any) => k.name === "service_role" || k.id === "service_role")?.api_key || "";
      } catch {
        const line = out.split("\n").find((l) => l.includes("service_role"));
        key = line ? line.trim().split(/\s+/).pop() || "" : "";
      }
      if (key && key.startsWith("ey")) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
      else { console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI returned empty."); process.exit(1); }
    } catch { console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI fetch failed."); process.exit(1); }
  }
  if (!process.env.VOYAGE_API_KEY) {
    const envLocalPath = join(SCRIPTS_DIR, "..", ".env.local");
    if (existsSync(envLocalPath)) {
      for (const line of readFileSync(envLocalPath, "utf-8").split("\n")) {
        const m = line.match(/^VOYAGE_API_KEY=(.+)$/);
        if (m) process.env.VOYAGE_API_KEY = m[1].trim();
      }
    }
  }
  if (!process.env.VOYAGE_API_KEY) { console.error("  ✗ VOYAGE_API_KEY required."); process.exit(1); }
}
function supaHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
}

// ─── Retry — 5xx/network only, NEVER 4xx ─────────────────────────────────────
class FatalHttpError extends Error {}
async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 5): Promise<Response> {
  let lastErr: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = (await res.text()).slice(0, 300);
      if (res.status >= 400 && res.status < 500) throw new FatalHttpError(`${label} ${res.status} (4xx, no retry): ${body}`);
      lastErr = new Error(`${label} ${res.status}: ${body}`);
    } catch (err: any) {
      if (err instanceof FatalHttpError) throw err;
      lastErr = err;
    }
    if (attempt < attempts) {
      const wait = Math.min(2000 * 2 ** (attempt - 1), 60_000);
      console.log(`  ${label}: attempt ${attempt} failed, retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// ─── CO-OPS fetch (monthly; "No data" is a normal answer, never a retry) ─────
async function coopsMonth(stationId: string, product: "hourly_height" | "predictions", begin: string, end: string): Promise<Map<string, number>> {
  const url = `${COOPS_BASE}?begin_date=${begin}&end_date=${end}&station=${stationId}&product=${product}` +
    `&datum=STND&units=english&time_zone=gmt${product === "predictions" ? "&interval=h" : ""}&format=json`;
  let res: Response;
  try {
    res = await fetchWithRetry(url, {}, `coops ${stationId} ${product} ${begin}`);
  } catch (err) {
    if (err instanceof FatalHttpError) return new Map(); // 400 = out of range for station
    throw err;
  }
  const data = await res.json();
  if (data.error) return new Map(); // "No data was found" — honest empty
  const arr = product === "hourly_height" ? data.data : data.predictions;
  const out = new Map<string, number>();
  for (const e of Array.isArray(arr) ? arr : []) {
    const v = parseFloat(e.v);
    if (Number.isFinite(v)) out.set(e.t, v); // t = "YYYY-MM-DD HH:MM" GMT
  }
  return out;
}

// ─── Daily rollup ─────────────────────────────────────────────────────────────
type DayTide = {
  date: string;
  meanLevel: number; maxLevel: number;
  meanResidual: number | null; maxResidual: number | null; maxResidualTimeUtc: string | null;
  minResidual: number | null; // setdown matters too (Galveston, Uri)
  hours: number;
};

function rollupDaily(obs: Map<string, number>, pred: Map<string, number>): DayTide[] {
  const byDay = new Map<string, { t: string; o: number; p: number | null }[]>();
  for (const [t, o] of obs) {
    const date = t.slice(0, 10);
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date)!.push({ t, o, p: pred.get(t) ?? null });
  }
  const out: DayTide[] = [];
  for (const [date, rows] of byDay) {
    if (rows.length < 4) continue; // <4 hourly obs = not a usable day; skip honestly
    const levels = rows.map((r) => r.o);
    const withPred = rows.filter((r) => r.p !== null) as { t: string; o: number; p: number }[];
    let meanResidual: number | null = null, maxResidual: number | null = null, maxT: string | null = null, minResidual: number | null = null;
    if (withPred.length >= 4) {
      const residuals = withPred.map((r) => ({ t: r.t, v: r.o - r.p }));
      meanResidual = residuals.reduce((a, b) => a + b.v, 0) / residuals.length;
      const maxR = residuals.reduce((a, b) => (b.v > a.v ? b : a));
      const minR = residuals.reduce((a, b) => (b.v < a.v ? b : a));
      maxResidual = maxR.v; maxT = maxR.t.replace(" ", "T") + ":00Z"; minResidual = minR.v;
    }
    const r2 = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);
    out.push({
      date,
      meanLevel: r2(levels.reduce((a, b) => a + b, 0) / levels.length)!,
      maxLevel: r2(Math.max(...levels))!,
      meanResidual: r2(meanResidual), maxResidual: r2(maxResidual), maxResidualTimeUtc: maxT,
      minResidual: r2(minResidual),
      hours: rows.length,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Row build (THE ROW CONTRACT) ────────────────────────────────────────────
function buildRow(st: Station, d: DayTide) {
  const pretty = new Date(d.date + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  let text = `On ${pretty}, the tide gauge at ${st.name} (${st.state}) recorded a daily mean water level of ${d.meanLevel.toFixed(2)} ft (STND), peaking at ${d.maxLevel.toFixed(2)} ft.`;
  if (d.maxResidual !== null) {
    text += ` The residual (observed minus predicted tide) averaged ${d.meanResidual!.toFixed(2)} ft and peaked at ${d.maxResidual.toFixed(2)} ft at ${d.maxResidualTimeUtc} UTC.`;
    if (d.maxResidual >= 3) text += ` A peak residual this high is major storm surge.`;
    else if (d.maxResidual >= 1.5) text += ` A peak residual this high indicates significant storm surge or strong onshore forcing.`;
    if (d.minResidual !== null && d.minResidual <= -1.5) text += ` The residual also dropped to ${d.minResidual.toFixed(2)} ft — strong offshore wind setdown.`;
  }
  const tags = [st.state, "tide", "water-level", "coastal"];
  if (d.maxResidual !== null && d.maxResidual >= 1.5) tags.push("storm-surge");
  return {
    title: `Tide gauge ${st.name} ${st.state} ${d.date}`,
    content: text,
    content_type: CONTENT_TYPE,
    tags,
    state_abbr: st.state,
    species: null,
    effective_date: d.date,
    metadata: {
      source: "noaa-coops",
      ingest_v: 2,
      source_event_id: `${st.id}-${d.date}`,
      station_id: st.id,
      station_name: st.name,
      lat: st.lat,
      lng: st.lng,
      granularity: "point",
      provenance_url: `https://tidesandcurrents.noaa.gov/waterlevels.html?id=${st.id}&bdate=${d.date.replace(/-/g, "")}&edate=${d.date.replace(/-/g, "")}`,
      datum: "STND",
      daily_mean_ft: d.meanLevel,
      daily_max_ft: d.maxLevel,
      residual_mean_ft: d.meanResidual,
      residual_max_ft: d.maxResidual,
      residual_max_time_utc: d.maxResidualTimeUtc,
      residual_min_ft: d.minResidual,
      hours_reporting: d.hours,
    },
  };
}

// ─── Checkpoint / idempotency ────────────────────────────────────────────────
type Checkpoint = { stationYears: Record<string, { days: number; inserted: number; done: boolean }> };
function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) { try { return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8")); } catch {} }
  return { stationYears: {} };
}
function saveCheckpoint(cp: Checkpoint) { writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2) + "\n"); }

async function existingSourceIds(stationId: string, year: number): Promise<Set<string>> {
  const ids = new Set<string>();
  let offset = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/hunt_knowledge` +
      `?content_type=eq.${CONTENT_TYPE}` +
      `&effective_date=gte.${year}-01-01&effective_date=lte.${year}-12-31` +
      `&metadata->>station_id=eq.${stationId}&metadata->>ingest_v=eq.2` +
      `&select=sid:metadata->>source_event_id&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetchWithRetry(url, { headers: supaHeaders() }, `existing ${stationId}/${year}@${offset}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`existing ${stationId}/${year}: non-array`);
    for (const r of rows) if (r.sid) ids.add(String(r.sid));
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return ids;
}

// ─── Voyage + insert ──────────────────────────────────────────────────────────
async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetchWithRetry("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "voyage-3-lite", input: texts, input_type: "document" }),
  }, "Voyage");
  const data = await res.json();
  if (!Array.isArray(data.data)) throw new Error("Voyage returned no data array");
  return data.data.map((d: any) => d.embedding);
}
async function insertRows(rows: any[]) {
  await fetchWithRetry(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
    method: "POST",
    headers: { ...supaHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  }, "insert");
}

// ─── Year worker ──────────────────────────────────────────────────────────────
async function fetchYearDays(st: Station, year: number): Promise<DayTide[]> {
  const days: DayTide[] = [];
  const endMonth = year === new Date().getUTCFullYear() ? new Date().getUTCMonth() + 1 : 12;
  for (let month = 1; month <= endMonth; month++) {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const begin = `${year}${String(month).padStart(2, "0")}01`;
    const end = `${year}${String(month).padStart(2, "0")}${last}`;
    const obs = await coopsMonth(st.id, "hourly_height", begin, end);
    await sleep(COOPS_SPACING_MS);
    if (obs.size === 0) continue; // gauge silent that month — no rows, honestly
    const pred = await coopsMonth(st.id, "predictions", begin, end);
    await sleep(COOPS_SPACING_MS);
    days.push(...rollupDaily(obs, pred));
  }
  return days;
}

// ─── THE RUN ──────────────────────────────────────────────────────────────────
async function runBackfill() {
  bootstrapKeys();
  const startEnv = process.env.START_YEAR ? parseInt(process.env.START_YEAR, 10) : 1980;
  const endYear = process.env.END_YEAR ? parseInt(process.env.END_YEAR, 10) : new Date().getUTCFullYear();
  const stationFilter = process.env.STATIONS ? new Set(process.env.STATIONS.split(",").map((s) => s.trim())) : null;
  const stations = ROSTER.filter((s) => !stationFilter || stationFilter.has(s.id));
  console.log(`\n=== TIDE ROSTER BACKFILL === ${stations.length} stations, ${startEnv}–${endYear}`);
  const cp = loadCheckpoint();
  let grand = 0;
  const failed: string[] = [];

  for (const st of stations) {
    for (let year = Math.max(startEnv, st.startYear); year <= endYear; year++) {
      const key = `${st.id}/${year}`;
      if (cp.stationYears[key]?.done) continue;
      try {
        const days = await fetchYearDays(st, year);
        if (days.length === 0) { cp.stationYears[key] = { days: 0, inserted: 0, done: true }; saveCheckpoint(cp); continue; }
        const existing = await existingSourceIds(st.id, year);
        const rows = days.map((d) => buildRow(st, d)).filter((r) => !existing.has(r.metadata.source_event_id));
        let inserted = 0;
        for (let i = 0; i < rows.length; i += EMBED_BATCH) {
          const batch = rows.slice(i, i + EMBED_BATCH);
          const embeddings = await embed(batch.map((r) => r.content));
          await insertRows(batch.map((r, j) => ({ ...r, embedding: JSON.stringify(embeddings[j]) })));
          inserted += batch.length;
          await sleep(150);
        }
        grand += inserted;
        cp.stationYears[key] = { days: days.length, inserted, done: true };
        saveCheckpoint(cp);
        console.log(`  ${key}: ${days.length} days → +${inserted} (${existing.size} already present)`);
      } catch (err) {
        failed.push(key);
        console.error(`  ${key} FAILED: ${String(err).slice(0, 200)} — rerun to retry`);
      }
    }
  }
  console.log(`\n=== DONE: +${grand} station-day rows ===`);
  if (failed.length) { console.error(`FAILED: ${failed.join(", ")} — rerun the same command.`); process.exitCode = 1; }
}

// ─── Dry run: two proof months, read-only ────────────────────────────────────
async function runDryRun() {
  console.log("\n=== DRY RUN — CO-OPS reads only, no database, no embeds ===");
  const probes: { st: Station; begin: string; end: string; note: string }[] = [
    { st: ROSTER[0], begin: "20121001", end: "20121031", note: "SANDY (scorecard: record 9.40-ft Battery surge — 6-min peak; hourly max will read slightly lower)" },
    { st: ROSTER[4], begin: "20050801", end: "20050831", note: "KATRINA (Grand Isle gauge may have failed at peak — honest gaps expected)" },
    { st: ROSTER[2], begin: "20121001", end: "20121031", note: "SANDY at Kings Point (western LI Sound amplification)" },
  ];
  for (const p of probes) {
    console.log(`\n▶ ${p.st.name} ${p.begin}..${p.end} — ${p.note}`);
    const obs = await coopsMonth(p.st.id, "hourly_height", p.begin, p.end);
    await sleep(COOPS_SPACING_MS);
    const pred = await coopsMonth(p.st.id, "predictions", p.begin, p.end);
    await sleep(COOPS_SPACING_MS);
    if (obs.size === 0) { console.log("  no verified hourly data returned for this month"); continue; }
    const days = rollupDaily(obs, pred);
    const top = [...days].filter((d) => d.maxResidual !== null).sort((a, b) => b.maxResidual! - a.maxResidual!).slice(0, 4);
    console.log(`  ${days.length} days rolled up; top max-residual days:`);
    for (const d of top) console.log(`    ${d.date}: max residual ${d.maxResidual} ft at ${d.maxResidualTimeUtc} (mean ${d.meanResidual} ft, max level ${d.maxLevel} ft, ${d.hours}h)`);
    const sample = top[0] && buildRow(p.st, top[0]);
    if (sample) console.log(`  sample content: ${sample.content}`);
  }
}

function status() {
  const cp = loadCheckpoint();
  const keys = Object.keys(cp.stationYears);
  const done = keys.filter((k) => cp.stationYears[k].done);
  const ins = keys.reduce((a, k) => a + cp.stationYears[k].inserted, 0);
  console.log(`${done.length}/${keys.length} station-years done — ${ins.toLocaleString()} rows inserted`);
}

async function main() {
  const arg = process.argv[2] || "";
  if (arg === "--status") return status();
  if (arg === "--dry-run") return runDryRun();
  return runBackfill();
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
