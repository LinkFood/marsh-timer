/**
 * Backfill NOAA tide predictions into hunt_knowledge
 * Fetches hi/lo tide predictions per station, aggregates into weekly patterns, embeds via Voyage AI.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-noaa-tides.ts
 *
 * Optional env:
 *   START_STATION=9414290   — resume from this station ID
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const START_STATION = process.env.START_STATION || null;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using hunt-generate-embedding edge function (slower)");

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

const NOAA_META_URL = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=waterlevels";
const NOAA_DATA_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";
const STATION_CACHE_PATH = path.join(__dirname, ".noaa-stations-cache.json");

const COASTAL_STATES = new Set([
  // Atlantic
  "ME", "NH", "MA", "RI", "CT", "NY", "NJ", "DE", "MD", "VA", "NC", "SC", "GA", "FL",
  // Gulf
  "AL", "MS", "LA", "TX",
  // Pacific
  "CA", "OR", "WA", "AK",
]);

// Generate month ranges from 2021-01 through 2026-03
function generateMonths(): { beginDate: string; endDate: string; label: string }[] {
  const months: { beginDate: string; endDate: string; label: string }[] = [];
  for (let year = 2021; year <= 2026; year++) {
    const maxMonth = year === 2026 ? 3 : 12;
    for (let month = 1; month <= maxMonth; month++) {
      const mm = String(month).padStart(2, "0");
      const beginDate = `${year}${mm}01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}${mm}${String(lastDay).padStart(2, "0")}`;
      months.push({ beginDate, endDate, label: `${year}-${mm}` });
    }
  }
  return months;
}

interface Station {
  id: string;
  name: string;
  state: string;
  lat: number;
  lng: number;
}

interface TidePrediction {
  t: string; // "2021-01-01 03:24"
  v: string; // "5.123"
  type: string; // "H" or "L"
}

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchStations(): Promise<Station[]> {
  // Check cache first
  if (fs.existsSync(STATION_CACHE_PATH)) {
    console.log("Using cached station list");
    return JSON.parse(fs.readFileSync(STATION_CACHE_PATH, "utf-8"));
  }

  console.log("Fetching NOAA station metadata...");
  const res = await fetch(NOAA_META_URL);
  if (!res.ok) throw new Error(`Station metadata fetch failed: ${res.status}`);
  const data = await res.json();

  const stations: Station[] = [];
  for (const s of data.stations || []) {
    const stateAbbr = (s.state || "").toUpperCase().trim();
    if (!COASTAL_STATES.has(stateAbbr)) continue;
    stations.push({
      id: String(s.id),
      name: s.name || `Station ${s.id}`,
      state: stateAbbr,
      lat: parseFloat(s.lat) || 0,
      lng: parseFloat(s.lng) || 0,
    });
  }

  // Cache locally
  fs.writeFileSync(STATION_CACHE_PATH, JSON.stringify(stations, null, 2));
  console.log(`Cached ${stations.length} coastal stations`);
  return stations;
}

async function fetchTidePredictions(stationId: string, beginDate: string, endDate: string): Promise<TidePrediction[]> {
  const params = new URLSearchParams({
    station: stationId,
    product: "predictions",
    begin_date: beginDate,
    end_date: endDate,
    datum: "MLLW",
    units: "english",
    time_zone: "lst_ldt",
    interval: "hilo",
    format: "json",
    application: "DuckCountdown",
  });

  const res = await fetch(`${NOAA_DATA_URL}?${params}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`NOAA API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  if (data.error) {
    throw new Error(`NOAA error: ${data.error.message || JSON.stringify(data.error)}`);
  }

  return data.predictions || [];
}

interface WeekAggregate {
  weekStart: string;
  lowTides: TidePrediction[];
  highTides: TidePrediction[];
}

function aggregateByWeek(predictions: TidePrediction[]): WeekAggregate[] {
  const weekMap = new Map<string, WeekAggregate>();

  for (const p of predictions) {
    const dateStr = p.t.split(" ")[0]; // "2021-01-01"
    const date = new Date(dateStr);
    // Get Monday of that week
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const monday = new Date(date);
    monday.setDate(date.getDate() + diff);
    const weekStart = monday.toISOString().split("T")[0];

    if (!weekMap.has(weekStart)) {
      weekMap.set(weekStart, { weekStart, lowTides: [], highTides: [] });
    }
    const week = weekMap.get(weekStart)!;
    if (p.type === "L") week.lowTides.push(p);
    else if (p.type === "H") week.highTides.push(p);
  }

  return Array.from(weekMap.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function classifyPattern(avgRange: number, lowCount: number): string {
  // Spring tides = larger range, neap = smaller
  if (avgRange > 6) return "spring";
  if (avgRange < 2) return "neap";
  return "mixed";
}

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  state_abbr: string;
  species: null;
  effective_date: string;
  metadata: Record<string, any>;
  embedText: string;
}

function buildWeekEntries(station: Station, weeks: WeekAggregate[]): PreparedEntry[] {
  const entries: PreparedEntry[] = [];

  for (const week of weeks) {
    if (week.lowTides.length === 0 && week.highTides.length === 0) continue;

    // Count days with data in this week
    const daysWithLows = new Set(week.lowTides.map((t) => t.t.split(" ")[0])).size;
    const avgLowsPerDay = daysWithLows > 0 ? (week.lowTides.length / daysWithLows).toFixed(1) : "0";

    // Find lowest low and best morning low (before 10am)
    const morningLows = week.lowTides.filter((t) => {
      const hour = parseInt(t.t.split(" ")[1].split(":")[0], 10);
      return hour >= 4 && hour <= 10;
    });

    let bestMorningLow = "none";
    if (morningLows.length > 0) {
      // Most common morning low hour
      const hourCounts = new Map<number, number>();
      for (const ml of morningLows) {
        const h = parseInt(ml.t.split(" ")[1].split(":")[0], 10);
        hourCounts.set(h, (hourCounts.get(h) || 0) + 1);
      }
      let maxCount = 0;
      let bestHour = 6;
      for (const [h, c] of hourCounts) {
        if (c > maxCount) { maxCount = c; bestHour = h; }
      }
      bestMorningLow = `${String(bestHour).padStart(2, "0")}:00`;
    }

    // Tidal range
    const lowValues = week.lowTides.map((t) => parseFloat(t.v));
    const highValues = week.highTides.map((t) => parseFloat(t.v));
    let avgRange = 0;
    if (lowValues.length > 0 && highValues.length > 0) {
      const avgLow = lowValues.reduce((a, b) => a + b, 0) / lowValues.length;
      const avgHigh = highValues.reduce((a, b) => a + b, 0) / highValues.length;
      avgRange = Math.round((avgHigh - avgLow) * 10) / 10;
    }

    const pattern = classifyPattern(avgRange, week.lowTides.length);

    const embedText = `noaa-tide | ${station.state} | ${station.name} | week of ${week.weekStart} | low_tides_per_day:${avgLowsPerDay} | best_morning_low:${bestMorningLow} | tidal_range:${avgRange}ft | pattern:${pattern}`;

    entries.push({
      title: `Tides ${station.name} ${station.state} week ${week.weekStart}`,
      content: embedText,
      content_type: "noaa-tide",
      tags: [station.state, "tide", "coastal", "water-level"],
      state_abbr: station.state,
      species: null,
      effective_date: week.weekStart,
      metadata: {
        source: "noaa-coops",
        station_id: station.id,
        station_name: station.name,
        lat: station.lat,
        lng: station.lng,
        avg_tidal_range_ft: avgRange,
        best_morning_low_time: bestMorningLow,
        week_start: week.weekStart,
      },
      embedText,
    });
  }

  return entries;
}

async function embedViaEdgeFn(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, input_type: "document" }),
      });
      if (res.ok) { const data = await res.json(); return data.embedding; }
      if (res.status >= 500 && attempt < retries - 1) { await delay((attempt + 1) * 5000); continue; }
      throw new Error(`Edge fn error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) { await delay((attempt + 1) * 10000); continue; }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

async function batchEmbed(texts: string[], retries = 3): Promise<number[][]> {
  if (USE_EDGE_FN) {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await embedViaEdgeFn(text, retries));
      await delay(100);
    }
    return results;
  }
  for (let attempt = 0; attempt < retries; attempt++) {
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
      if (res.status === 429 && attempt < retries - 1) { await delay((attempt + 1) * 30000); continue; }
      if (res.status >= 500 && attempt < retries - 1) { await delay((attempt + 1) * 5000); continue; }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) { await delay((attempt + 1) * 10000); continue; }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

async function insertBatch(rows: Record<string, any>[]) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
    method: "POST",
    headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`  Insert batch failed: ${await res.text()}`);
  }
}

async function processEntries(entries: PreparedEntry[]) {
  // Embed in batches of 20, insert in batches of 50
  const readyRows: Record<string, any>[] = [];

  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    const texts = batch.map((e) => e.embedText);
    const embeddings = await batchEmbed(texts);

    for (let j = 0; j < batch.length; j++) {
      const e = batch[j];
      readyRows.push({
        title: e.title,
        content: e.content,
        content_type: e.content_type,
        tags: e.tags,
        state_abbr: e.state_abbr,
        species: e.species,
        effective_date: e.effective_date,
        metadata: e.metadata,
        embedding: JSON.stringify(embeddings[j]),
      });
    }

    // Insert when we hit 50 rows or at the end
    if (readyRows.length >= 50 || i + 20 >= entries.length) {
      while (readyRows.length > 0) {
        const insertBatchRows = readyRows.splice(0, 50);
        await insertBatch(insertBatchRows);
      }
    }

    // Small pause between embedding batches
    if (i + 20 < entries.length) await delay(300);
  }
}

async function main() {
  console.log("=== NOAA Tide Backfill -> hunt_knowledge ===");

  const stations = await fetchStations();
  console.log(`${stations.length} coastal stations in ${COASTAL_STATES.size} states`);

  const months = generateMonths();
  console.log(`${months.length} months to process (2021-01 through 2026-03)`);

  // Find start index if resuming
  let startIdx = 0;
  if (START_STATION) {
    startIdx = stations.findIndex((s) => s.id === START_STATION);
    if (startIdx === -1) {
      console.error(`Station ${START_STATION} not found in filtered list`);
      process.exit(1);
    }
    console.log(`Resuming from station ${START_STATION} (index ${startIdx})`);
  }

  let totalEntries = 0;

  for (let si = startIdx; si < stations.length; si++) {
    const station = stations[si];
    console.log(`\n[${si + 1}/${stations.length}] ${station.name} (${station.id}) ${station.state}`);

    const allPredictions: TidePrediction[] = [];

    for (const month of months) {
      try {
        const preds = await fetchTidePredictions(station.id, month.beginDate, month.endDate);
        allPredictions.push(...preds);
        process.stdout.write(`.`);
      } catch (err: any) {
        console.log(`\n  Skipping ${month.label}: ${err.message.slice(0, 100)}`);
      }
      await delay(500); // Rate limit NOAA API
    }
    console.log(` ${allPredictions.length} predictions`);

    if (allPredictions.length === 0) {
      console.log("  No data, skipping");
      continue;
    }

    const weeks = aggregateByWeek(allPredictions);
    const entries = buildWeekEntries(station, weeks);
    console.log(`  ${weeks.length} weeks -> ${entries.length} entries to embed`);

    if (entries.length === 0) continue;

    try {
      await processEntries(entries);
      totalEntries += entries.length;
      console.log(`  Done. Running total: ${totalEntries} entries`);
    } catch (err) {
      console.error(`  Embed/insert failed (continuing to next station): ${err}`);
    }
  }

  console.log(`\n=== Complete! ${totalEntries} tide entries embedded ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
