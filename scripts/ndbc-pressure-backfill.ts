/**
 * NDBC pressure backfill — PIPE 4 of THE-WEEK sprint.
 *
 * WHY (docs/HORSE-RIDE-SCORECARD.md §2.5 + blind spot 4): the archive holds ZERO
 * barometric pressure anywhere, and told the horse-ride test that Katrina's
 * pressure signature "doesn't exist here" — while the raw NDBC file carries BAR
 * the whole time (bottoming 979.3 mb at 42040 on landfall day). Root cause:
 * pre-2007 NDBC historical stdmet files name the pressure column BAR, and the
 * v1 ingest read only PRES (fixed in backfill-ndbc-deep.ts, same one-liner here).
 * Second structural miss: only daily AVG pressure was stored — the story metric
 * for storms is the daily MIN (the bottom of the barograph), stored nowhere.
 *
 * WHAT IT DOES (per horse-ride buoy, per year):
 *   1. Download NDBC historical stdmet {station}h{year}.txt.gz.
 *   2. Parse pressure (BAR or PRES), aggregate daily avg + MIN (+ time of min).
 *   3. Fetch that station-year's existing ocean-buoy-historical rows (paginated).
 *   4. Rows missing pressure data get: narrative extended with the pressure
 *      sentence, metadata.pressure_mb / min_pressure_mb / min_pressure_time_utc
 *      set, and the row RE-EMBEDDED (embedding law — content changed, vector
 *      must follow). Updates land as batched upserts on id (full row provided).
 *   5. Days with pressure but NO existing row are inserted fresh (full row
 *      contract: source_event_id station-date, provenance_url, granularity point).
 *
 * Usage:
 *   npx tsx scripts/ndbc-pressure-backfill.ts --dry-run FILE [FILE...]  # parse local
 *       stdmet .txt files, print daily min/avg pressure + Katrina verification.
 *       NO network, NO database, NO embeds.
 *   npx tsx scripts/ndbc-pressure-backfill.ts            # THE RUN (write pipe — one at
 *       a time). Checkpointed per station-year, nohup-ready, kill+rerun safe.
 *   npx tsx scripts/ndbc-pressure-backfill.ts --status
 *
 * Env: STATIONS=42040,42001,44025 (default: the horse-ride three)
 *      START_YEAR / END_YEAR to bound.
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI), VOYAGE_API_KEY (env or .env.local).
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { gunzipSync } from "node:zlib";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const CHECKPOINT_FILE = join(SCRIPTS_DIR, ".ndbc-pressure-checkpoint.json");
const CONTENT_TYPE = "ocean-buoy-historical";
const EMBED_BATCH = 20; // HARD LIMIT — Voyage times out above 20
const PAGE_SIZE = 1000; // PostgREST cap

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The horse-ride buoys (scorecard money quotes): 42040 Katrina 55.5ft/979.3mb,
// 42001 mid-Gulf Katrina, 44025 Long Island 9/11 + Sandy. Env-overridable.
type StationDef = { id: string; name: string; state: string; lat: number; lon: number; startYear: number };
const ALL_STATIONS: Record<string, StationDef> = {
  "42040": { id: "42040", name: "Luke Island", state: "MS", lat: 29.2, lon: -88.2, startYear: 2004 },
  "42001": { id: "42001", name: "Mid Gulf", state: "LA", lat: 25.9, lon: -89.7, startYear: 1975 },
  "44025": { id: "44025", name: "Long Island", state: "NY", lat: 40.3, lon: -73.2, startYear: 1991 },
};
const STATION_IDS = (process.env.STATIONS || "42040,42001,44025").split(",").map((s) => s.trim());

// ─── Key bootstrap (same pattern as otd-ingest.ts / ncei-reingest.ts) ────────
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

// ─── stdmet parsing (pressure-focused; BAR pre-2007, PRES 2007+) ─────────────
type DayPressure = { date: string; avg: number | null; min: number | null; minTimeUtc: string | null; hours: number };

function parsePressure(text: string): DayPressure[] {
  const lines = text.split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].replace(/^#\s*/, "").trim().split(/\s+/);
  const idx: Record<string, number> = {};
  header.forEach((c, i) => (idx[c] = i));
  const yearIdx = idx["YYYY"] ?? idx["#YY"] ?? idx["YY"];
  const mmIdx = idx["MM"], ddIdx = idx["DD"], hhIdx = idx["hh"];
  const mnIdx = idx["mm"]; // minute col absent pre-2005
  const presIdx = idx["PRES"] !== undefined ? idx["PRES"] : idx["BAR"]; // THE one-line fix
  if (yearIdx === undefined || mmIdx === undefined || ddIdx === undefined || presIdx === undefined) return [];

  const byDay = new Map<string, { v: number; t: string }[]>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || !/^\d/.test(line)) continue; // skips the units line when present
    const p = line.split(/\s+/);
    if (p.length <= presIdx) continue;
    let year = p[yearIdx];
    if (year.length === 2) year = parseInt(year, 10) < 50 ? `20${year}` : `19${year}`;
    const date = `${year}-${p[mmIdx].padStart(2, "0")}-${p[ddIdx].padStart(2, "0")}`;
    const raw = p[presIdx];
    const v = parseFloat(raw);
    // NDBC missing markers: MM, 999, 9999, 99.0 variants — pressure is never <800 or >1100 mb for real
    if (!Number.isFinite(v) || v < 800 || v > 1100) continue;
    const hh = hhIdx !== undefined ? p[hhIdx].padStart(2, "0") : "00";
    const mn = mnIdx !== undefined && p[mnIdx] !== undefined ? p[mnIdx].padStart(2, "0") : "00";
    const t = `${date}T${hh}:${mn}:00Z`; // stdmet timestamps are UTC
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date)!.push({ v, t });
  }

  const out: DayPressure[] = [];
  for (const [date, obs] of byDay) {
    const minObs = obs.reduce((a, b) => (b.v < a.v ? b : a));
    out.push({
      date,
      avg: Math.round((obs.reduce((a, b) => a + b.v, 0) / obs.length) * 10) / 10,
      min: Math.round(minObs.v * 10) / 10,
      minTimeUtc: minObs.t,
      hours: obs.length,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function pressureSentence(day: DayPressure): string {
  let s = ` Barometric pressure averaged ${day.avg} millibars, bottoming at ${day.min} millibars`;
  if (day.min !== null && day.min < 1000) s += " — a low pressure system";
  return s + ".";
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────
type Checkpoint = { stationYears: Record<string, { updated: number; inserted: number; done: boolean }> };
function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) { try { return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8")); } catch {} }
  return { stationYears: {} };
}
function saveCheckpoint(cp: Checkpoint) { writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2) + "\n"); }

// ─── Voyage ───────────────────────────────────────────────────────────────────
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

// ─── Existing rows for a station-year ────────────────────────────────────────
type ExistingRow = { id: string; title: string; content: string; tags: string[]; state_abbr: string; effective_date: string; metadata: any };
async function existingRows(stationId: string, year: number): Promise<Map<string, ExistingRow[]>> {
  const byDate = new Map<string, ExistingRow[]>();
  let offset = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/hunt_knowledge` +
      `?content_type=eq.${CONTENT_TYPE}` +
      `&effective_date=gte.${year}-01-01&effective_date=lte.${year}-12-31` +
      `&metadata->>station_id=eq.${stationId}` +
      `&select=id,title,content,tags,state_abbr,effective_date,metadata` +
      `&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetchWithRetry(url, { headers: supaHeaders() }, `existing ${stationId}/${year}@${offset}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`existing ${stationId}/${year}: non-array`);
    for (const r of rows) {
      if (!byDate.has(r.effective_date)) byDate.set(r.effective_date, []);
      byDate.get(r.effective_date)!.push(r);
    }
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return byDate;
}

// ─── Write paths ──────────────────────────────────────────────────────────────
async function upsertById(rows: any[]) {
  // Full rows provided, so the on-conflict insert path can never trip NOT NULL.
  await fetchWithRetry(`${SUPABASE_URL}/rest/v1/hunt_knowledge?on_conflict=id`, {
    method: "POST",
    headers: { ...supaHeaders(), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  }, "upsert");
}
async function insertNew(rows: any[]) {
  await fetchWithRetry(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
    method: "POST",
    headers: { ...supaHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  }, "insert");
}

function freshRow(st: StationDef, day: DayPressure) {
  const datePretty = new Date(day.date + "T00:00:00Z").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const narrative = `On ${datePretty}, the NDBC buoy at ${st.name} (Station ${st.id}) off ${st.state} reported pressure only.` + pressureSentence(day);
  return {
    title: `Buoy ${st.name} ${st.state} ${day.date}`,
    content: narrative,
    content_type: CONTENT_TYPE,
    tags: [st.state, "ocean", "buoy", "marine-weather", "pressure"],
    state_abbr: st.state,
    species: null,
    effective_date: day.date,
    metadata: {
      source: "ndbc-historical",
      ingest_v: 2,
      source_event_id: `${st.id}-${day.date}`,
      station_id: st.id,
      station_name: st.name,
      state: st.state,
      lat: st.lat,
      lon: st.lon,
      pressure_mb: day.avg,
      min_pressure_mb: day.min,
      min_pressure_time_utc: day.minTimeUtc,
      pressure_hours: day.hours,
      provenance_url: `https://www.ndbc.noaa.gov/data/historical/stdmet/${st.id}h${day.date.slice(0, 4)}.txt.gz`,
      granularity: "point",
    },
  };
}

// ─── THE RUN ──────────────────────────────────────────────────────────────────
async function runBackfill() {
  bootstrapKeys();
  const endYear = process.env.END_YEAR ? parseInt(process.env.END_YEAR, 10) : new Date().getUTCFullYear() - 1;
  console.log(`\n=== NDBC PRESSURE BACKFILL === stations ${STATION_IDS.join(", ")}`);
  const cp = loadCheckpoint();
  let grandUpdated = 0, grandInserted = 0;
  const failed: string[] = [];

  for (const sid of STATION_IDS) {
    const st = ALL_STATIONS[sid];
    if (!st) { console.error(`unknown station ${sid} — add it to ALL_STATIONS`); continue; }
    const startYear = process.env.START_YEAR ? parseInt(process.env.START_YEAR, 10) : st.startYear;

    for (let year = startYear; year <= endYear; year++) {
      const key = `${sid}/${year}`;
      if (cp.stationYears[key]?.done) continue;
      try {
        // 1. download (404 = buoy offline that year — skip silently, mark done)
        let text: string;
        try {
          const res = await fetchWithRetry(`https://www.ndbc.noaa.gov/data/historical/stdmet/${sid}h${year}.txt.gz`, {}, `ndbc ${key}`, 3);
          text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf-8");
        } catch (err: any) {
          if (err instanceof FatalHttpError) { cp.stationYears[key] = { updated: 0, inserted: 0, done: true }; saveCheckpoint(cp); continue; }
          throw err;
        }
        const days = parsePressure(text);
        if (days.length === 0) { cp.stationYears[key] = { updated: 0, inserted: 0, done: true }; saveCheckpoint(cp); continue; }

        // 2. existing rows
        const existing = await existingRows(sid, year);

        // 3. classify
        const toUpdate: { row: ExistingRow; day: DayPressure }[] = [];
        const toInsert: DayPressure[] = [];
        for (const day of days) {
          const rows = existing.get(day.date);
          if (!rows || rows.length === 0) { toInsert.push(day); continue; }
          for (const r of rows) {
            const m = r.metadata || {};
            if (m.pressure_mb == null || m.min_pressure_mb == null) toUpdate.push({ row: r, day });
          }
        }

        // 4. updates: extend narrative + metadata, re-embed, upsert by id (dupes updated consistently)
        let updated = 0, inserted = 0;
        for (let i = 0; i < toUpdate.length; i += EMBED_BATCH) {
          const batch = toUpdate.slice(i, i + EMBED_BATCH);
          const newRows = batch.map(({ row, day }) => {
            const already = /[Bb]arometric pressure/.test(row.content);
            const content = already ? row.content : row.content + pressureSentence(day);
            return {
              id: row.id,
              title: row.title,
              content,
              content_type: CONTENT_TYPE,
              tags: row.tags,
              state_abbr: row.state_abbr,
              effective_date: row.effective_date,
              metadata: {
                ...row.metadata,
                pressure_mb: row.metadata?.pressure_mb ?? day.avg,
                min_pressure_mb: day.min,
                min_pressure_time_utc: day.minTimeUtc,
                pressure_hours: day.hours,
                pressure_backfill: "pipe4-2026-07",
              },
            };
          });
          const embeddings = await embed(newRows.map((r) => r.content));
          await upsertById(newRows.map((r, j) => ({ ...r, embedding: JSON.stringify(embeddings[j]) })));
          updated += batch.length;
          await sleep(150);
        }

        // 5. fresh inserts for days with pressure but no row at all
        for (let i = 0; i < toInsert.length; i += EMBED_BATCH) {
          const batch = toInsert.slice(i, i + EMBED_BATCH).map((d) => freshRow(st, d));
          const embeddings = await embed(batch.map((r) => r.content));
          await insertNew(batch.map((r, j) => ({ ...r, embedding: JSON.stringify(embeddings[j]) })));
          inserted += batch.length;
          await sleep(150);
        }

        grandUpdated += updated; grandInserted += inserted;
        cp.stationYears[key] = { updated, inserted, done: true };
        saveCheckpoint(cp);
        console.log(`  ${key}: ${days.length} pressure days → ${updated} rows enriched+re-embedded, ${inserted} inserted`);
        await sleep(500); // NDBC courtesy
      } catch (err) {
        failed.push(key);
        console.error(`  ${key} FAILED: ${String(err).slice(0, 200)} — rerun to retry`);
      }
    }
  }
  console.log(`\n=== DONE: ${grandUpdated} enriched, ${grandInserted} inserted ===`);
  if (failed.length) { console.error(`FAILED: ${failed.join(", ")} — rerun the same command.`); process.exitCode = 1; }
}

// ─── Dry run ──────────────────────────────────────────────────────────────────
function runDryRun(files: string[]) {
  console.log("\n=== DRY RUN — parse only, no network, no database, no embeds ===");
  for (const path of files) {
    const raw = path.endsWith(".gz") ? gunzipSync(readFileSync(path)).toString("utf-8") : readFileSync(path, "utf-8");
    const days = parsePressure(raw);
    const withP = days.filter((d) => d.avg !== null);
    console.log(`\n▶ ${basename(path)}: ${days.length} days with pressure data`);
    if (withP.length) {
      const deepest = [...withP].sort((a, b) => (a.min! - b.min!)).slice(0, 3);
      console.log(`  deepest daily minima: ${deepest.map((d) => `${d.date} ${d.min}mb@${d.minTimeUtc}`).join(" | ")}`);
      const katrina = days.filter((d) => d.date >= "2005-08-27" && d.date <= "2005-08-30");
      if (katrina.length) {
        console.log("  ── KATRINA VERIFICATION (scorecard: BAR bottoming 979.3 mb at 42040 on landfall day) ──");
        for (const d of katrina) console.log(`  ${d.date}: avg ${d.avg} mb, min ${d.min} mb at ${d.minTimeUtc} (${d.hours} obs)`);
      }
      const sample = withP[Math.floor(withP.length / 2)];
      console.log(`  sample sentence:${pressureSentence(sample)}`);
    }
  }
}

function status() {
  const cp = loadCheckpoint();
  const keys = Object.keys(cp.stationYears);
  const done = keys.filter((k) => cp.stationYears[k].done);
  const upd = keys.reduce((a, k) => a + cp.stationYears[k].updated, 0);
  const ins = keys.reduce((a, k) => a + cp.stationYears[k].inserted, 0);
  console.log(`${done.length}/${keys.length} station-years done — ${upd} enriched, ${ins} inserted`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--status") return status();
  if (args[0] === "--dry-run") {
    if (args.length < 2) { console.error("--dry-run needs stdmet .txt/.gz paths"); process.exit(1); }
    return runDryRun(args.slice(1));
  }
  return runBackfill();
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
