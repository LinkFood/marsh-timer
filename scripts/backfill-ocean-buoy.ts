/**
 * Backfill historical NDBC ocean buoy data into hunt_knowledge
 * Downloads annual gzipped stdmet files, aggregates to daily summaries, embeds via Voyage AI.
 *
 * 27 stations across Gulf, Great Lakes, and Atlantic — 5 years (2021-2025)
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-ocean-buoy.ts
 *
 * Optional env:
 *   START_STATION=42001   — resume from this station
 *   START_YEAR=2023       — resume from this year (within START_STATION)
 */

import { gunzipSync } from "node:zlib";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const START_STATION = process.env.START_STATION || null;
const START_YEAR = process.env.START_YEAR ? parseInt(process.env.START_YEAR, 10) : null;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using hunt-generate-embedding edge function (slower)");

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

const YEARS = [2021, 2022, 2023, 2024, 2025];

interface StationDef {
  id: string;
  state: string;
  region: string;
}

const STATIONS: StationDef[] = [
  // Gulf
  { id: "42001", state: "LA", region: "Gulf" },
  { id: "42002", state: "LA", region: "Gulf" },
  { id: "42003", state: "LA", region: "Gulf" },
  { id: "42019", state: "TX", region: "Gulf" },
  { id: "42020", state: "TX", region: "Gulf" },
  { id: "42035", state: "TX", region: "Gulf" },
  { id: "42036", state: "FL", region: "Gulf" },
  { id: "42039", state: "FL", region: "Gulf" },
  { id: "42040", state: "MS", region: "Gulf" },
  // Great Lakes
  { id: "45001", state: "MI", region: "Great Lakes" },
  { id: "45002", state: "MI", region: "Great Lakes" },
  { id: "45003", state: "WI", region: "Great Lakes" },
  { id: "45004", state: "WI", region: "Great Lakes" },
  { id: "45005", state: "OH", region: "Great Lakes" },
  { id: "45006", state: "IL", region: "Great Lakes" },
  { id: "45007", state: "MI", region: "Great Lakes" },
  { id: "45008", state: "MI", region: "Great Lakes" },
  { id: "45012", state: "OH", region: "Great Lakes" },
  // Atlantic
  { id: "41001", state: "NC", region: "Atlantic" },
  { id: "41002", state: "NC", region: "Atlantic" },
  { id: "41004", state: "SC", region: "Atlantic" },
  { id: "41008", state: "GA", region: "Atlantic" },
  { id: "41009", state: "NC", region: "Atlantic" },
  { id: "44009", state: "DE", region: "Atlantic" },
  { id: "44013", state: "MA", region: "Atlantic" },
  { id: "44025", state: "NJ", region: "Atlantic" },
];

// --- Unit conversions ---

function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32;
}

function metersToFeet(m: number): number {
  return m * 3.28084;
}

function msToMph(ms: number): number {
  return ms * 2.237;
}

// --- Delay helper ---

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// --- NDBC data fetching ---

async function fetchStationYear(stationId: string, year: number): Promise<Buffer | null> {
  const url = `https://www.ndbc.noaa.gov/data/historical/stdmet/${stationId}h${year}.txt.gz`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (res.ok) {
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
      }
      if (res.status >= 500 && attempt < 2) {
        await delay((attempt + 1) * 5000);
        continue;
      }
      console.log(`    NDBC ${res.status} for ${stationId}h${year} — skipping`);
      return null;
    } catch (err) {
      if (attempt < 2) {
        await delay((attempt + 1) * 5000);
        continue;
      }
      console.log(`    Network error for ${stationId}h${year} — skipping`);
      return null;
    }
  }
  return null;
}

// --- NDBC text parsing ---

interface Observation {
  date: string; // YYYY-MM-DD
  wtmp: number | null; // Celsius
  wvht: number | null; // meters
  pres: number | null; // mb
  wspd: number | null; // m/s
}

function isMissing(val: string): boolean {
  return val === "MM" || val === "999" || val === "999.0" || val === "99.0" || val === "99.00";
}

function parseFloat_or_null(val: string): number | null {
  if (isMissing(val)) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function parseNdbcText(text: string): Observation[] {
  const lines = text.split("\n");
  if (lines.length < 3) return [];

  // First line is column headers, second line is units — skip both
  const headerLine = lines[0].trim();
  const cols = headerLine.replace(/^#/, "").trim().split(/\s+/);

  // Build column index map
  const colIdx: Record<string, number> = {};
  for (let i = 0; i < cols.length; i++) {
    colIdx[cols[i]] = i;
  }

  // Need at least year, month, day columns
  const yrKey = colIdx["YY"] !== undefined ? "YY" : "#YY";
  if (colIdx[yrKey] === undefined && colIdx["YYYY"] === undefined) return [];

  const yearIdx = colIdx[yrKey] ?? colIdx["YYYY"];
  const monthIdx = colIdx["MM"];
  const dayIdx = colIdx["DD"];
  const wtmpIdx = colIdx["WTMP"];
  const wvhtIdx = colIdx["WVHT"];
  const presIdx = colIdx["PRES"];
  const wspdIdx = colIdx["WSPD"];

  const observations: Observation[] = [];

  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;

    let year = parts[yearIdx];
    // Handle 2-digit year
    if (year.length === 2) year = `20${year}`;

    const month = parts[monthIdx];
    const day = parts[dayIdx];
    const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

    observations.push({
      date,
      wtmp: wtmpIdx !== undefined ? parseFloat_or_null(parts[wtmpIdx]) : null,
      wvht: wvhtIdx !== undefined ? parseFloat_or_null(parts[wvhtIdx]) : null,
      pres: presIdx !== undefined ? parseFloat_or_null(parts[presIdx]) : null,
      wspd: wspdIdx !== undefined ? parseFloat_or_null(parts[wspdIdx]) : null,
    });
  }

  return observations;
}

// --- Daily aggregation ---

interface DailySummary {
  date: string;
  avgSst: number | null; // Fahrenheit
  maxWvht: number | null; // feet
  avgPres: number | null; // mb
  avgWspd: number | null; // mph
}

function aggregateDaily(observations: Observation[]): DailySummary[] {
  const dayMap = new Map<string, Observation[]>();

  for (const obs of observations) {
    if (!dayMap.has(obs.date)) dayMap.set(obs.date, []);
    dayMap.get(obs.date)!.push(obs);
  }

  const summaries: DailySummary[] = [];

  for (const [date, obs] of dayMap) {
    const wtmps = obs.map((o) => o.wtmp).filter((v): v is number => v !== null);
    const wvhts = obs.map((o) => o.wvht).filter((v): v is number => v !== null);
    const press = obs.map((o) => o.pres).filter((v): v is number => v !== null);
    const wspds = obs.map((o) => o.wspd).filter((v): v is number => v !== null);

    // Skip days with no useful data at all
    if (wtmps.length === 0 && wvhts.length === 0 && press.length === 0 && wspds.length === 0) continue;

    summaries.push({
      date,
      avgSst: wtmps.length > 0 ? Math.round(celsiusToFahrenheit(wtmps.reduce((a, b) => a + b, 0) / wtmps.length) * 10) / 10 : null,
      maxWvht: wvhts.length > 0 ? Math.round(metersToFeet(Math.max(...wvhts)) * 10) / 10 : null,
      avgPres: press.length > 0 ? Math.round((press.reduce((a, b) => a + b, 0) / press.length) * 10) / 10 : null,
      avgWspd: wspds.length > 0 ? Math.round(msToMph(wspds.reduce((a, b) => a + b, 0) / wspds.length) * 10) / 10 : null,
    });
  }

  return summaries.sort((a, b) => a.date.localeCompare(b.date));
}

// --- Embedding text ---

function buildEmbedText(station: StationDef, day: DailySummary): string {
  const parts: string[] = [];
  parts.push(`Ocean buoy ${station.id} (${station.region}) on ${day.date}:`);
  if (day.avgSst !== null) parts.push(`SST ${day.avgSst}°F,`);
  if (day.maxWvht !== null) parts.push(`wave height ${day.maxWvht}ft,`);
  if (day.avgPres !== null) parts.push(`pressure ${day.avgPres}mb,`);
  if (day.avgWspd !== null) parts.push(`wind ${day.avgWspd}mph.`);

  // Flags
  const flags: string[] = [];
  if (day.maxWvht !== null && day.maxWvht > 10) flags.push("storm conditions");
  if (day.avgPres !== null && day.avgPres < 1000) flags.push("low pressure");
  if (flags.length > 0) parts.push(flags.join(", "));

  return parts.join(" ");
}

// --- Embedding ---

async function embedViaEdgeFn(text: string): Promise<number[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, input_type: "document" }),
      });
      if (res.ok) { const data = await res.json(); return data.embedding; }
      if (res.status >= 500 && attempt < 2) { await delay((attempt + 1) * 5000); continue; }
      throw new Error(`Edge fn error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < 2) { await delay((attempt + 1) * 10000); continue; }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

async function batchEmbed(texts: string[]): Promise<number[][]> {
  if (USE_EDGE_FN) {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await embedViaEdgeFn(text));
      await delay(100);
    }
    return results;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "voyage-3-lite", input: texts, input_type: "document" }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.data.map((d: { embedding: number[] }) => d.embedding);
      }
      if (res.status === 429 && attempt < 2) { await delay((attempt + 1) * 30000); continue; }
      if (res.status >= 500 && attempt < 2) { await delay((attempt + 1) * 5000); continue; }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < 2) { await delay((attempt + 1) * 10000); continue; }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// --- Supabase insert ---

async function insertBatch(rows: Record<string, any>[]) {
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
        method: "POST",
        headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(chunk),
      });
      if (res.ok) break;
      if (res.status >= 500 && attempt < 2) {
        console.log(`    Insert retry ${attempt + 1}/3...`);
        await delay(5000);
        continue;
      }
      const text = await res.text();
      console.error(`    Insert batch failed: ${text}`);
      break;
    }
  }
}

// --- Process entries: embed + insert ---

async function processEntries(entries: { embedText: string; row: Record<string, any> }[]) {
  const readyRows: Record<string, any>[] = [];

  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    const texts = batch.map((e) => e.embedText);
    const embeddings = await batchEmbed(texts);

    for (let j = 0; j < batch.length; j++) {
      readyRows.push({
        ...batch[j].row,
        embedding: JSON.stringify(embeddings[j]),
      });
    }

    if (readyRows.length >= 50 || i + 20 >= entries.length) {
      while (readyRows.length > 0) {
        const insertChunk = readyRows.splice(0, 50);
        await insertBatch(insertChunk);
      }
    }

    if (i + 20 < entries.length) await delay(300);
  }
}

// --- Main ---

async function main() {
  console.log("=== Backfill Ocean Buoy Data -> hunt_knowledge ===");
  console.log(`${STATIONS.length} stations, ${YEARS.length} years (${YEARS[0]}-${YEARS[YEARS.length - 1]})`);

  let startStationIdx = 0;
  if (START_STATION) {
    startStationIdx = STATIONS.findIndex((s) => s.id === START_STATION);
    if (startStationIdx === -1) {
      console.error(`Station ${START_STATION} not found`);
      process.exit(1);
    }
    console.log(`Resuming from station ${START_STATION}`);
  }

  let totalDays = 0;

  for (let si = startStationIdx; si < STATIONS.length; si++) {
    const station = STATIONS[si];
    console.log(`\n[${si + 1}/${STATIONS.length}] Station ${station.id} (${station.state}, ${station.region})`);

    for (const year of YEARS) {
      // Skip years before START_YEAR for the resume station
      if (si === startStationIdx && START_YEAR && year < START_YEAR) continue;

      // Download gzipped file
      const gzBuf = await fetchStationYear(station.id, year);
      if (!gzBuf) {
        console.log(`  ${station.id} ${year}: no data (404 or error)`);
        await delay(1000);
        continue;
      }

      // Decompress
      let text: string;
      try {
        text = gunzipSync(gzBuf).toString("utf-8");
      } catch {
        console.log(`  ${station.id} ${year}: gzip decompress failed — skipping`);
        await delay(1000);
        continue;
      }

      // Parse
      const observations = parseNdbcText(text);
      if (observations.length === 0) {
        console.log(`  ${station.id} ${year}: no parseable observations`);
        await delay(1000);
        continue;
      }

      // Aggregate to daily
      const dailySummaries = aggregateDaily(observations);

      // Build entries
      const entries: { embedText: string; row: Record<string, any> }[] = [];
      for (const day of dailySummaries) {
        const embedText = buildEmbedText(station, day);
        entries.push({
          embedText,
          row: {
            title: `buoy-${station.id} ${day.date}`,
            content: embedText,
            content_type: "ocean-buoy",
            tags: [station.state, station.region.toLowerCase().replace(" ", "-"), "ocean", "buoy", "sst"],
            state_abbr: station.state,
            species: null,
            effective_date: day.date,
            metadata: {
              source: "ndbc",
              station_id: station.id,
              region: station.region,
              avg_sst_f: day.avgSst,
              max_wave_height_ft: day.maxWvht,
              avg_pressure_mb: day.avgPres,
              avg_wind_mph: day.avgWspd,
              storm_conditions: day.maxWvht !== null && day.maxWvht > 10,
              low_pressure: day.avgPres !== null && day.avgPres < 1000,
            },
          },
        });
      }

      if (entries.length === 0) {
        await delay(1000);
        continue;
      }

      // Embed and insert
      try {
        await processEntries(entries);
        totalDays += entries.length;
        console.log(`  ${station.id} ${year}: ${entries.length} days inserted`);
      } catch (err) {
        console.error(`  ${station.id} ${year}: embed/insert failed — ${err}`);
      }

      // 1s delay between downloads
      await delay(1000);
    }
  }

  console.log(`\n=== Complete! ${totalDays} ocean buoy daily entries embedded ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
