/**
 * Backfill USGS water gauge data into hunt_knowledge
 * Pulls daily values for all 50 states, computes monthly summaries per station,
 * embeds via Voyage AI, and inserts into hunt_knowledge.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-usgs-water.ts
 *
 * Resume support:
 *   START_STATE=AR  — skip states alphabetically before AR
 *   START_MONTH=2023-06  — skip months before 2023-06 (within the start state)
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using hunt-generate-embedding edge function (slower)");

const START_STATE = process.env.START_STATE || null;
const START_MONTH = process.env.START_MONTH || null;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

// ---------- Month generation ----------

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
  const d = new Date(y, m, 0); // day 0 of next month = last day of this month
  return d.toISOString().split("T")[0];
}

function firstDayOfMonth(yearMonth: string): string {
  return `${yearMonth}-01`;
}

// ---------- USGS API ----------

const USGS_BASE = "https://waterservices.usgs.gov/nwis/dv/";

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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

async function fetchUSGS(
  stateAbbr: string,
  yearMonth: string,
): Promise<StationMonthly[]> {
  const startDT = firstDayOfMonth(yearMonth);
  const endDT = lastDayOfMonth(yearMonth);

  const url =
    `${USGS_BASE}?format=json&stateCd=${stateAbbr}&parameterCd=00065` +
    `&startDT=${startDT}&endDT=${endDT}&siteType=ST&siteStatus=active`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    // USGS returns 404 when no data found for the query — not a real error
    if (res.status === 404) return [];
    throw new Error(`USGS ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json();
  const timeSeries: USGSTimeSeries[] = json?.value?.timeSeries || [];

  // Group by station
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

// ---------- Compute summaries ----------

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

function computeSummary(station: StationMonthly): StationSummary | null {
  if (station.values.length === 0) return null;

  const avg = station.values.reduce((a, b) => a + b, 0) / station.values.length;
  const max = Math.max(...station.values);
  const min = Math.min(...station.values);

  // Trend: compare first half avg to second half avg
  const mid = Math.floor(station.values.length / 2);
  if (mid === 0) {
    return {
      ...station,
      avg: round2(avg),
      max: round2(max),
      min: round2(min),
      trend: "stable",
    };
  }

  const firstHalf =
    station.values.slice(0, mid).reduce((a, b) => a + b, 0) / mid;
  const secondHalf =
    station.values.slice(mid).reduce((a, b) => a + b, 0) /
    (station.values.length - mid);

  const diff = secondHalf - firstHalf;
  const threshold = avg * 0.05; // 5% change = meaningful

  let trend: "rising" | "falling" | "stable" = "stable";
  if (diff > threshold) trend = "rising";
  else if (diff < -threshold) trend = "falling";

  return {
    ...station,
    avg: round2(avg),
    max: round2(max),
    min: round2(min),
    trend,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------- Embedding ----------

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

// ---------- Supabase insert ----------

async function insertBatch(rows: Record<string, unknown>[]) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
    method: "POST",
    headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`  Insert failed: ${await res.text()}`);
  }
}

// ---------- Build entries ----------

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

function buildEntry(
  summary: StationSummary,
  stateAbbr: string,
  yearMonth: string,
): PreparedEntry {
  const embedText =
    `usgs-water | ${stateAbbr} | ${summary.siteName} | ${yearMonth}` +
    ` | gauge_avg:${summary.avg}ft max:${summary.max}ft min:${summary.min}ft trend:${summary.trend}` +
    ` | site:${summary.siteNo} | lat:${summary.lat} lng:${summary.lng}`;

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

// ---------- Process a batch of entries (embed + insert) ----------

async function processEntries(entries: PreparedEntry[]): Promise<number> {
  let inserted = 0;

  // Embed in batches of 20
  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    const texts = batch.map((e) => e.embedText);

    let embeddings: number[][];
    try {
      embeddings = await batchEmbed(texts);
    } catch (err) {
      console.error(`    Embed batch failed, skipping ${batch.length} entries: ${err}`);
      continue;
    }

    const rows = batch.map((e, idx) => ({
      title: e.title,
      content: e.content,
      content_type: e.content_type,
      tags: e.tags,
      state_abbr: e.state_abbr,
      species: e.species,
      effective_date: e.effective_date,
      metadata: e.metadata,
      embedding: JSON.stringify(embeddings[idx]),
    }));

    // Insert in batches of 50
    for (let j = 0; j < rows.length; j += 50) {
      const insertBatchRows = rows.slice(j, j + 50);
      await insertBatch(insertBatchRows);
      inserted += insertBatchRows.length;
    }

    // Pause between embed batches
    await delay(500);
  }

  return inserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== USGS Water Gauge Backfill ===");
  console.log(`States: 50 | Months: 2021-01 through 2026-03`);
  if (START_STATE) console.log(`Resuming from state: ${START_STATE}`);
  if (START_MONTH) console.log(`Resuming from month: ${START_MONTH}`);

  const allMonths = generateMonths();
  let totalInserted = 0;
  let skippingState = START_STATE !== null;

  for (const state of STATES) {
    // Skip states until we reach START_STATE
    if (skippingState) {
      if (state === START_STATE) {
        skippingState = false;
      } else {
        continue;
      }
    }

    console.log(`\n--- ${state} ---`);
    let stateInserted = 0;
    let skippingMonth = START_STATE === state && START_MONTH !== null;

    for (const month of allMonths) {
      // Skip months until START_MONTH (only for the start state)
      if (skippingMonth) {
        if (month === START_MONTH) {
          skippingMonth = false;
        } else {
          continue;
        }
      }

      // Rate limit: ~200ms between USGS requests (5 req/s)
      await delay(200);

      let stations: StationMonthly[];
      try {
        stations = await fetchUSGS(state, month);
      } catch (err) {
        console.error(`  ${state} ${month}: USGS fetch failed: ${err}`);
        continue;
      }

      if (stations.length === 0) {
        continue;
      }

      // Compute summaries
      const summaries: StationSummary[] = [];
      for (const s of stations) {
        const summary = computeSummary(s);
        if (summary) summaries.push(summary);
      }

      if (summaries.length === 0) {
        continue;
      }

      // Build entries
      const entries = summaries.map((s) => buildEntry(s, state, month));

      // Embed + insert
      try {
        const inserted = await processEntries(entries);
        stateInserted += inserted;
        console.log(`  ${month}: ${summaries.length} stations -> ${inserted} embedded`);
      } catch (err) {
        console.error(`  ${month}: embed/insert failed (continuing): ${err}`);
      }
    }

    totalInserted += stateInserted;
    console.log(`  ${state} total: ${stateInserted} entries`);
  }

  console.log(`\n=== Done! Total: ${totalInserted} entries inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
