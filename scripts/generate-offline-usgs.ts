/**
 * Offline embedding generator for USGS water gauge data.
 * Calls USGS API + Voyage AI, saves to JSON files. Does NOT touch Supabase DB.
 *
 * Usage:
 *   VOYAGE_API_KEY=... npx tsx scripts/generate-offline-usgs.ts
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/generate-offline-usgs.ts
 *   START_STATE=CA START_MONTH=2023-06 npx tsx scripts/generate-offline-usgs.ts
 *
 * Output: ~/Desktop/DCD/backfill-staging/usgs-water/{STATE}.json
 */

import * as fs from "fs";
import * as path from "path";

// --- Config ---

const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) {
  if (!SERVICE_KEY) {
    console.error("No VOYAGE_API_KEY and no SUPABASE_SERVICE_ROLE_KEY — need one or the other for embeddings");
    process.exit(1);
  }
  console.log("No VOYAGE_API_KEY — using hunt-generate-embedding edge function (slower)");
}

const STAGING_ROOT = path.join(process.env.HOME || "~", "Desktop", "DCD", "backfill-staging");
const SOURCE_DIR = "usgs-water";

const START_STATE = process.env.START_STATE || null;
const START_MONTH = process.env.START_MONTH || null;

// --- States ---

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

// --- Helpers ---

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeStateFile(stateAbbr: string, rows: any[]): void {
  const dir = path.join(STAGING_ROOT, SOURCE_DIR);
  ensureDir(dir);
  const filePath = path.join(dir, `${stateAbbr}.json`);
  fs.writeFileSync(filePath, JSON.stringify(rows));
  console.log(`  Saved ${filePath} (${rows.length} rows, ${(fs.statSync(filePath).size / 1024 / 1024).toFixed(1)}MB)`);
}

// --- Month generation ---

function generateMonths(): string[] {
  const months: string[] = [];
  const start = new Date(2021, 0, 1);
  const end = new Date(2026, 2, 1); // March 2026
  const cur = new Date(start);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    months.push(`${y}-${m}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

function lastDayOfMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(y, m, 0);
  return d.toISOString().split("T")[0];
}

function firstDayOfMonth(yearMonth: string): string {
  return `${yearMonth}-01`;
}

// --- USGS API ---

const USGS_BASE = "https://waterservices.usgs.gov/nwis/dv/";

interface USGSTimeSeries {
  sourceInfo: {
    siteName: string;
    siteCode: { value: string }[];
    geoLocation: {
      geogLocation: { latitude: number; longitude: number };
    };
  };
  values: {
    value: { value: string; dateTime: string; qualifiers: string[] }[];
  }[];
}

interface StationMonthly {
  siteNo: string;
  siteName: string;
  lat: number;
  lng: number;
  values: number[];
}

async function fetchUSGS(stateAbbr: string, yearMonth: string): Promise<StationMonthly[]> {
  const startDT = firstDayOfMonth(yearMonth);
  const endDT = lastDayOfMonth(yearMonth);

  const url =
    `${USGS_BASE}?format=json&stateCd=${stateAbbr}&parameterCd=00065` +
    `&startDT=${startDT}&endDT=${endDT}&siteType=ST&siteStatus=active`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404) return [];
    throw new Error(`USGS ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const timeSeries: USGSTimeSeries[] = json?.value?.timeSeries || [];

  const stationMap = new Map<string, StationMonthly>();

  for (const ts of timeSeries) {
    const siteNo = ts.sourceInfo.siteCode?.[0]?.value;
    if (!siteNo) continue;

    const siteName = ts.sourceInfo.siteName || siteNo;
    const geo = ts.sourceInfo.geoLocation?.geogLocation;
    const lat = geo?.latitude || 0;
    const lng = geo?.longitude || 0;

    if (!stationMap.has(siteNo)) {
      stationMap.set(siteNo, { siteNo, siteName, lat, lng, values: [] });
    }

    const station = stationMap.get(siteNo)!;

    for (const valSet of ts.values || []) {
      for (const v of valSet.value || []) {
        const num = parseFloat(v.value);
        if (!isNaN(num) && num >= 0) {
          station.values.push(num);
        }
      }
    }
  }

  return Array.from(stationMap.values());
}

// --- Compute summaries ---

interface StationSummary {
  siteNo: string;
  siteName: string;
  lat: number;
  lng: number;
  avg: number;
  max: number;
  min: number;
  trend: "rising" | "falling" | "stable";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeSummary(station: StationMonthly): StationSummary | null {
  if (station.values.length === 0) return null;

  const avg = station.values.reduce((a, b) => a + b, 0) / station.values.length;
  const max = Math.max(...station.values);
  const min = Math.min(...station.values);

  const mid = Math.floor(station.values.length / 2);
  if (mid === 0) {
    return { ...station, avg: round2(avg), max: round2(max), min: round2(min), trend: "stable" };
  }

  const firstHalf = station.values.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
  const secondHalf = station.values.slice(mid).reduce((a, b) => a + b, 0) / (station.values.length - mid);

  const diff = secondHalf - firstHalf;
  const threshold = avg * 0.05;

  let trend: "rising" | "falling" | "stable" = "stable";
  if (diff > threshold) trend = "rising";
  else if (diff < -threshold) trend = "falling";

  return { ...station, avg: round2(avg), max: round2(max), min: round2(min), trend };
}

// --- Embedding ---

async function embedViaEdgeFn(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, input_type: "document" }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.embedding;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        await delay((attempt + 1) * 5000);
        continue;
      }
      throw new Error(`Edge fn error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        await delay((attempt + 1) * 10000);
        continue;
      }
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
        headers: {
          Authorization: `Bearer ${VOYAGE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "voyage-3-lite",
          input: texts,
          input_type: "document",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.data.map((d: { embedding: number[] }) => d.embedding);
      }
      if (res.status === 429 && attempt < retries - 1) {
        const wait = (attempt + 1) * 30000;
        console.log(`    Rate limited, waiting ${wait / 1000}s...`);
        await delay(wait);
        continue;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`    Retry ${attempt + 1}/${retries} after ${wait / 1000}s (${res.status})...`);
        await delay(wait);
        continue;
      }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        const wait = (attempt + 1) * 10000;
        console.log(`    Error, retrying in ${wait / 1000}s: ${err}`);
        await delay(wait);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// --- Build entry ---

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  state_abbr: string;
  species: null;
  effective_date: string;
  metadata: Record<string, unknown>;
  embedText: string;
}

function buildEntry(summary: StationSummary, stateAbbr: string, yearMonth: string): PreparedEntry {
  const embedText =
    `usgs-water | ${stateAbbr} | ${summary.siteName} | ${yearMonth}` +
    ` | gauge_avg:${summary.avg}ft max:${summary.max}ft min:${summary.min}ft trend:${summary.trend}`;

  return {
    title: `USGS ${summary.siteName} ${stateAbbr} ${yearMonth}`,
    content: embedText,
    content_type: "usgs-water",
    tags: [stateAbbr, "water", "gauge", "hydrology"],
    state_abbr: stateAbbr,
    species: null,
    effective_date: lastDayOfMonth(yearMonth),
    metadata: {
      source: "usgs-water-services",
      site_no: summary.siteNo,
      site_name: summary.siteName,
      lat: summary.lat,
      lng: summary.lng,
      gauge_avg_ft: summary.avg,
      gauge_max_ft: summary.max,
      gauge_min_ft: summary.min,
      trend: summary.trend,
      month: yearMonth,
    },
    embedText,
  };
}

// --- Main ---

async function main() {
  const allMonths = generateMonths();

  console.log("=== Offline USGS Water Gauge Generator ===");
  console.log(`States: ${STATES.length} | Months: ${allMonths.length} (2021-01 through 2026-03)`);
  console.log(`Staging: ${path.join(STAGING_ROOT, SOURCE_DIR)}`);
  console.log(`Embedding: ${USE_EDGE_FN ? "edge function (slow)" : "Voyage AI direct"}`);
  if (START_STATE) console.log(`Resuming from state: ${START_STATE}`);
  if (START_MONTH) console.log(`Resuming from month: ${START_MONTH}`);
  console.log();

  let totalGenerated = 0;
  let skippingState = START_STATE !== null;

  for (const state of STATES) {
    if (skippingState) {
      if (state === START_STATE) {
        skippingState = false;
      } else {
        console.log(`Skipping ${state} (before ${START_STATE})`);
        continue;
      }
    }

    // Skip if file already exists
    const existingFile = path.join(STAGING_ROOT, SOURCE_DIR, `${state}.json`);
    if (fs.existsSync(existingFile)) {
      console.log(`Skipping ${state} (${existingFile} already exists)`);
      continue;
    }

    console.log(`\n--- ${state} ---`);
    const stateRows: any[] = [];
    let skippingMonth = START_STATE === state && START_MONTH !== null;

    for (const month of allMonths) {
      if (skippingMonth) {
        if (month === START_MONTH) {
          skippingMonth = false;
        } else {
          continue;
        }
      }

      // 200ms delay between USGS API calls
      await delay(200);

      let stations: StationMonthly[];
      try {
        stations = await fetchUSGS(state, month);
      } catch (err) {
        console.error(`  ${state} ${month}: USGS fetch failed: ${err}`);
        continue;
      }

      if (stations.length === 0) continue;

      // Compute summaries
      const summaries: StationSummary[] = [];
      for (const s of stations) {
        const summary = computeSummary(s);
        if (summary) summaries.push(summary);
      }

      if (summaries.length === 0) continue;

      // Build entries
      const entries = summaries.map((s) => buildEntry(s, state, month));

      // Embed in batches of 20
      try {
        for (let i = 0; i < entries.length; i += 20) {
          const batch = entries.slice(i, i + 20);
          const texts = batch.map((e) => e.embedText);

          const embeddings = await batchEmbed(texts);

          for (let j = 0; j < batch.length; j++) {
            const e = batch[j];
            stateRows.push({
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

          // Pause between embed batches
          await delay(300);
        }

        console.log(`  ${month}: ${summaries.length} stations embedded`);
      } catch (err) {
        console.error(`  ${state} ${month}: embed failed (continuing): ${err}`);
      }
    }

    // Write state file
    if (stateRows.length > 0) {
      writeStateFile(state, stateRows);
      totalGenerated += stateRows.length;
      console.log(`  ${state} total: ${stateRows.length} entries`);
    } else {
      console.log(`  ${state}: no data`);
    }
  }

  console.log(`\n=== Done! ${totalGenerated} entries generated to ${path.join(STAGING_ROOT, SOURCE_DIR)}/ ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
