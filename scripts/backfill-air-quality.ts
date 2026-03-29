/**
 * Backfill air quality (AQI + pollutants) AND pollen data from
 * Open-Meteo Air Quality archive API for all 50 US states (2022-2026).
 * Embeds via Voyage AI, stores in hunt_knowledge.
 *
 * Two content types per state per day:
 *   - air-quality: AQI, PM2.5, PM10, ozone, CO, NO2, SO2
 *   - pollen-data: birch, grass, ragweed, alder, mugwort, olive
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-air-quality.ts
 *
 * Resume support:
 *   START_STATE=TX  — skip states alphabetically before TX
 *
 * Env vars:
 *   VOYAGE_API_KEY  — optional; falls back to hunt-generate-embedding edge fn
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY || null;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const START_STATE = process.env.START_STATE || null;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

// ---------- Constants ----------

const START_DATE = "2022-01-01";
const END_DATE = "2026-03-28";
const CHUNK_DAYS = 90;

const HOURLY_PARAMS = [
  "pm10",
  "pm2_5",
  "carbon_monoxide",
  "nitrogen_dioxide",
  "sulphur_dioxide",
  "ozone",
  "us_aqi",
  "alder_pollen",
  "birch_pollen",
  "grass_pollen",
  "mugwort_pollen",
  "olive_pollen",
  "ragweed_pollen",
].join(",");

// ---------- State data ----------

const STATE_COORDS: Record<string, { lat: number; lng: number; name: string }> = {
  AL: { lat: 32.8, lng: -86.8, name: "Alabama" },
  AK: { lat: 64.2, lng: -152.5, name: "Alaska" },
  AZ: { lat: 34.0, lng: -111.1, name: "Arizona" },
  AR: { lat: 34.8, lng: -92.2, name: "Arkansas" },
  CA: { lat: 36.8, lng: -119.4, name: "California" },
  CO: { lat: 39.1, lng: -105.4, name: "Colorado" },
  CT: { lat: 41.6, lng: -72.7, name: "Connecticut" },
  DE: { lat: 39.0, lng: -75.5, name: "Delaware" },
  FL: { lat: 27.8, lng: -81.8, name: "Florida" },
  GA: { lat: 32.2, lng: -83.4, name: "Georgia" },
  HI: { lat: 19.9, lng: -155.6, name: "Hawaii" },
  ID: { lat: 44.1, lng: -114.7, name: "Idaho" },
  IL: { lat: 40.6, lng: -89.4, name: "Illinois" },
  IN: { lat: 40.3, lng: -86.1, name: "Indiana" },
  IA: { lat: 42.0, lng: -93.2, name: "Iowa" },
  KS: { lat: 38.5, lng: -98.8, name: "Kansas" },
  KY: { lat: 37.7, lng: -84.7, name: "Kentucky" },
  LA: { lat: 30.5, lng: -91.2, name: "Louisiana" },
  ME: { lat: 45.4, lng: -69.2, name: "Maine" },
  MD: { lat: 39.0, lng: -76.6, name: "Maryland" },
  MA: { lat: 42.4, lng: -71.4, name: "Massachusetts" },
  MI: { lat: 44.3, lng: -85.6, name: "Michigan" },
  MN: { lat: 46.4, lng: -94.6, name: "Minnesota" },
  MS: { lat: 32.3, lng: -89.4, name: "Mississippi" },
  MO: { lat: 38.6, lng: -92.2, name: "Missouri" },
  MT: { lat: 46.8, lng: -110.4, name: "Montana" },
  NE: { lat: 41.1, lng: -98.3, name: "Nebraska" },
  NV: { lat: 38.8, lng: -116.4, name: "Nevada" },
  NH: { lat: 43.5, lng: -71.6, name: "New Hampshire" },
  NJ: { lat: 40.1, lng: -74.5, name: "New Jersey" },
  NM: { lat: 34.2, lng: -105.9, name: "New Mexico" },
  NY: { lat: 43.0, lng: -75.0, name: "New York" },
  NC: { lat: 35.8, lng: -79.8, name: "North Carolina" },
  ND: { lat: 47.5, lng: -100.5, name: "North Dakota" },
  OH: { lat: 40.4, lng: -82.9, name: "Ohio" },
  OK: { lat: 35.0, lng: -97.1, name: "Oklahoma" },
  OR: { lat: 43.8, lng: -120.6, name: "Oregon" },
  PA: { lat: 41.2, lng: -77.2, name: "Pennsylvania" },
  RI: { lat: 41.6, lng: -71.5, name: "Rhode Island" },
  SC: { lat: 34.0, lng: -81.0, name: "South Carolina" },
  SD: { lat: 43.9, lng: -99.4, name: "South Dakota" },
  TN: { lat: 35.5, lng: -86.6, name: "Tennessee" },
  TX: { lat: 31.0, lng: -100.0, name: "Texas" },
  UT: { lat: 39.3, lng: -111.1, name: "Utah" },
  VT: { lat: 44.6, lng: -72.6, name: "Vermont" },
  VA: { lat: 37.8, lng: -78.2, name: "Virginia" },
  WA: { lat: 47.8, lng: -120.7, name: "Washington" },
  WV: { lat: 38.6, lng: -80.6, name: "West Virginia" },
  WI: { lat: 43.8, lng: -88.8, name: "Wisconsin" },
  WY: { lat: 43.1, lng: -107.6, name: "Wyoming" },
};

// ---------- Helpers ----------

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateChunks(start: string, end: string, chunkDays: number): { start: string; end: string }[] {
  const chunks: { start: string; end: string }[] = [];
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = addDays(cursor, chunkDays - 1);
    chunks.push({ start: cursor, end: chunkEnd > end ? end : chunkEnd });
    cursor = addDays(chunkEnd, 1);
  }
  return chunks;
}

function aqiSeverity(aqi: number): string {
  if (aqi <= 50) return "Good";
  if (aqi <= 100) return "Moderate";
  if (aqi <= 150) return "Unhealthy for Sensitive Groups";
  if (aqi <= 200) return "Unhealthy";
  if (aqi <= 300) return "Very Unhealthy";
  return "Hazardous";
}

function pollenSeason(month: number): string {
  if (month >= 3 && month <= 5) return "Spring tree pollen season";
  if (month >= 6 && month <= 8) return "Summer grass pollen season";
  if (month >= 9 && month <= 10) return "Fall ragweed season";
  return "Low pollen period";
}

// ---------- Open-Meteo API ----------

async function fetchAirQuality(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<any> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lng.toString(),
    start_date: startDate,
    end_date: endDate,
    hourly: HOURLY_PARAMS,
    timezone: "America/New_York",
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?${params}`,
    );
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 2) {
      const wait = (attempt + 1) * 65000;
      console.log(`    Rate limited, waiting ${Math.round(wait / 1000)}s...`);
      await delay(wait);
      continue;
    }
    if (res.status >= 500 && attempt < 2) {
      console.log(`    Server error ${res.status}, retrying in ${(attempt + 1) * 10}s...`);
      await delay((attempt + 1) * 10000);
      continue;
    }
    throw new Error(`Open-Meteo error: ${res.status} ${await res.text()}`);
  }
  throw new Error("Open-Meteo: exhausted retries");
}

// ---------- Aggregate hourly → daily ----------

interface DailyAirQuality {
  date: string;
  max_aqi: number;
  avg_pm25: number;
  avg_pm10: number;
  avg_ozone: number;
  avg_co: number;
  avg_no2: number;
  avg_so2: number;
}

interface DailyPollen {
  date: string;
  max_birch: number;
  max_grass: number;
  max_ragweed: number;
  max_alder: number;
  max_mugwort: number;
  max_olive: number;
}

function aggregateHourlyToDaily(hourly: any): { airQuality: DailyAirQuality[]; pollen: DailyPollen[] } {
  if (!hourly || !hourly.time || hourly.time.length === 0) {
    return { airQuality: [], pollen: [] };
  }

  // Group by date (hourly.time is ISO timestamps like "2022-01-01T00:00")
  const dayMap = new Map<string, number[]>();
  for (let i = 0; i < hourly.time.length; i++) {
    const date = hourly.time[i].slice(0, 10);
    if (!dayMap.has(date)) dayMap.set(date, []);
    dayMap.get(date)!.push(i);
  }

  const airQuality: DailyAirQuality[] = [];
  const pollen: DailyPollen[] = [];

  for (const [date, indices] of dayMap) {
    // Air quality aggregation
    const aqiVals = indices.map((i) => hourly.us_aqi?.[i]).filter((v: any) => v != null && v > 0);
    const pm25Vals = indices.map((i) => hourly.pm2_5?.[i]).filter((v: any) => v != null);
    const pm10Vals = indices.map((i) => hourly.pm10?.[i]).filter((v: any) => v != null);
    const ozoneVals = indices.map((i) => hourly.ozone?.[i]).filter((v: any) => v != null);
    const coVals = indices.map((i) => hourly.carbon_monoxide?.[i]).filter((v: any) => v != null);
    const no2Vals = indices.map((i) => hourly.nitrogen_dioxide?.[i]).filter((v: any) => v != null);
    const so2Vals = indices.map((i) => hourly.sulphur_dioxide?.[i]).filter((v: any) => v != null);

    if (aqiVals.length > 0) {
      airQuality.push({
        date,
        max_aqi: Math.max(...aqiVals),
        avg_pm25: round1(pm25Vals.reduce((a: number, b: number) => a + b, 0) / (pm25Vals.length || 1)),
        avg_pm10: round1(pm10Vals.reduce((a: number, b: number) => a + b, 0) / (pm10Vals.length || 1)),
        avg_ozone: round1(ozoneVals.reduce((a: number, b: number) => a + b, 0) / (ozoneVals.length || 1)),
        avg_co: round1(coVals.reduce((a: number, b: number) => a + b, 0) / (coVals.length || 1)),
        avg_no2: round1(no2Vals.reduce((a: number, b: number) => a + b, 0) / (no2Vals.length || 1)),
        avg_so2: round1(so2Vals.reduce((a: number, b: number) => a + b, 0) / (so2Vals.length || 1)),
      });
    }

    // Pollen aggregation
    const birchVals = indices.map((i) => hourly.birch_pollen?.[i]).filter((v: any) => v != null);
    const grassVals = indices.map((i) => hourly.grass_pollen?.[i]).filter((v: any) => v != null);
    const ragweedVals = indices.map((i) => hourly.ragweed_pollen?.[i]).filter((v: any) => v != null);
    const alderVals = indices.map((i) => hourly.alder_pollen?.[i]).filter((v: any) => v != null);
    const mugwortVals = indices.map((i) => hourly.mugwort_pollen?.[i]).filter((v: any) => v != null);
    const oliveVals = indices.map((i) => hourly.olive_pollen?.[i]).filter((v: any) => v != null);

    const hasAnyPollen = [birchVals, grassVals, ragweedVals, alderVals, mugwortVals, oliveVals]
      .some((arr) => arr.length > 0);

    if (hasAnyPollen) {
      pollen.push({
        date,
        max_birch: birchVals.length > 0 ? Math.max(...birchVals) : 0,
        max_grass: grassVals.length > 0 ? Math.max(...grassVals) : 0,
        max_ragweed: ragweedVals.length > 0 ? Math.max(...ragweedVals) : 0,
        max_alder: alderVals.length > 0 ? Math.max(...alderVals) : 0,
        max_mugwort: mugwortVals.length > 0 ? Math.max(...mugwortVals) : 0,
        max_olive: oliveVals.length > 0 ? Math.max(...oliveVals) : 0,
      });
    }
  }

  return { airQuality, pollen };
}

// ---------- Build hunt_knowledge entries ----------

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  state_abbr: string;
  effective_date: string;
  metadata: Record<string, unknown>;
}

function buildAirQualityEntry(abbr: string, name: string, day: DailyAirQuality): PreparedEntry {
  const severity = aqiSeverity(day.max_aqi);
  const content =
    `Air quality for ${name} (${abbr}) on ${day.date}: AQI ${day.max_aqi} ` +
    `(PM2.5: ${day.avg_pm25}μg/m³, ozone: ${day.avg_ozone}ppb, CO: ${day.avg_co}, ` +
    `NO2: ${day.avg_no2}, SO2: ${day.avg_so2}). ${severity}`;

  return {
    title: `${abbr} air-quality ${day.date}`,
    content,
    content_type: "air-quality",
    tags: ["air-quality", "aqi", "pollutants", "environmental"],
    state_abbr: abbr,
    effective_date: day.date,
    metadata: {
      source: "open-meteo-air-quality",
      max_aqi: day.max_aqi,
      avg_pm25: day.avg_pm25,
      avg_pm10: day.avg_pm10,
      avg_ozone: day.avg_ozone,
      avg_co: day.avg_co,
      avg_no2: day.avg_no2,
      avg_so2: day.avg_so2,
      severity,
    },
  };
}

function buildPollenEntry(abbr: string, name: string, day: DailyPollen): PreparedEntry {
  const month = parseInt(day.date.split("-")[1], 10);
  const seasonNote = pollenSeason(month);
  const content =
    `Pollen for ${name} (${abbr}) on ${day.date}: birch ${day.max_birch}, ` +
    `grass ${day.max_grass}, ragweed ${day.max_ragweed}, alder ${day.max_alder}, ` +
    `mugwort ${day.max_mugwort}, olive ${day.max_olive} grains/m³. ${seasonNote}`;

  return {
    title: `${abbr} pollen-data ${day.date}`,
    content,
    content_type: "pollen-data",
    tags: ["pollen", "allergens", "biological", "environmental"],
    state_abbr: abbr,
    effective_date: day.date,
    metadata: {
      source: "open-meteo-air-quality",
      max_birch: day.max_birch,
      max_grass: day.max_grass,
      max_ragweed: day.max_ragweed,
      max_alder: day.max_alder,
      max_mugwort: day.max_mugwort,
      max_olive: day.max_olive,
      season: seasonNote,
    },
  };
}

// ---------- Embedding ----------

async function batchEmbed(texts: string[]): Promise<number[][]> {
  if (VOYAGE_KEY) {
    return batchEmbedVoyage(texts);
  }
  return batchEmbedEdgeFn(texts);
}

async function batchEmbedVoyage(texts: string[], retries = 3): Promise<number[][]> {
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
        await delay((attempt + 1) * 30000);
        continue;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        await delay((attempt + 1) * 5000);
        continue;
      }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        await delay((attempt + 1) * 10000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Voyage: exhausted retries");
}

async function batchEmbedEdgeFn(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (const text of texts) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
        method: "POST",
        headers: supaHeaders,
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const data = await res.json();
        embeddings.push(data.embedding);
        break;
      }
      if (res.status >= 500 && attempt < 2) {
        await delay((attempt + 1) * 5000);
        continue;
      }
      throw new Error(`Edge fn embed error: ${res.status} ${await res.text()}`);
    }
    await delay(200);
  }
  return embeddings;
}

// ---------- Supabase upsert ----------

async function upsertBatch(rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
        method: "POST",
        headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(chunk),
      });
      if (res.ok) break;
      if (res.status >= 400 && res.status < 500) {
        const text = await res.text();
        console.error(`  Upsert 4xx (not retrying): ${res.status} ${text}`);
        break;
      }
      if (attempt < 2) {
        console.log(`  Upsert retry ${attempt + 1}/3...`);
        await delay(5000);
        continue;
      }
      const text = await res.text();
      console.error(`  Upsert failed after retries: ${text}`);
    }
  }
}

// ---------- Embed + insert entries ----------

async function processEntries(entries: PreparedEntry[]): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    const texts = batch.map((e) => e.content);

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
      effective_date: e.effective_date,
      metadata: e.metadata,
      embedding: JSON.stringify(embeddings[idx]),
    }));

    await upsertBatch(rows);
    inserted += rows.length;

    await delay(500);
  }

  return inserted;
}

// ---------- Process one state ----------

async function backfillState(abbr: string, info: { lat: number; lng: number; name: string }): Promise<{ aq: number; pollen: number }> {
  const chunks = dateChunks(START_DATE, END_DATE, CHUNK_DAYS);
  let totalAq = 0;
  let totalPollen = 0;

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c];
    console.log(`    ${abbr} chunk ${c + 1}/${chunks.length}: ${chunk.start} to ${chunk.end}`);

    let data: any;
    try {
      data = await fetchAirQuality(info.lat, info.lng, chunk.start, chunk.end);
    } catch (err) {
      console.error(`    ${abbr} API error for ${chunk.start}-${chunk.end}: ${err}`);
      continue;
    }

    const { airQuality, pollen } = aggregateHourlyToDaily(data.hourly);

    // Build entries
    const aqEntries = airQuality.map((day) => buildAirQualityEntry(abbr, info.name, day));
    const pollenEntries = pollen.map((day) => buildPollenEntry(abbr, info.name, day));
    const allEntries = [...aqEntries, ...pollenEntries];

    if (allEntries.length > 0) {
      const inserted = await processEntries(allEntries);
      const aqCount = Math.min(aqEntries.length, inserted);
      const polCount = Math.max(0, inserted - aqEntries.length);
      totalAq += aqCount;
      totalPollen += polCount;
    }

    // 1s delay between API calls
    if (c < chunks.length - 1) {
      await delay(1000);
    }
  }

  return { aq: totalAq, pollen: totalPollen };
}

// ---------- Main ----------

async function main() {
  console.log("=== Backfilling Air Quality + Pollen Data ===");
  console.log(`Date range: ${START_DATE} to ${END_DATE}`);
  console.log(`Embedding: ${VOYAGE_KEY ? "Voyage AI direct" : "Edge function fallback"}`);
  if (START_STATE) console.log(`Resuming from: ${START_STATE}`);

  const states = Object.entries(STATE_COORDS);
  let startFound = !START_STATE;
  let grandTotalAq = 0;
  let grandTotalPollen = 0;

  for (let i = 0; i < states.length; i++) {
    const [abbr, info] = states[i];

    if (!startFound) {
      if (abbr === START_STATE) startFound = true;
      else continue;
    }

    console.log(`\n[${i + 1}/${states.length}] ${info.name} (${abbr})`);

    try {
      const { aq, pollen } = await backfillState(abbr, info);
      grandTotalAq += aq;
      grandTotalPollen += pollen;
      console.log(`  ${abbr}: ${aq} air-quality + ${pollen} pollen entries inserted`);
    } catch (err) {
      console.error(`  FAILED ${abbr}: ${err}`);
    }

    // 1s between states
    if (i < states.length - 1) {
      await delay(1000);
    }
  }

  console.log(`\n=== Done! Total: ${grandTotalAq} air-quality + ${grandTotalPollen} pollen = ${grandTotalAq + grandTotalPollen} entries ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
