/**
 * Backfill NDBC Deep Ocean Buoy History into hunt_knowledge
 * Extends from 27 stations / 5 years to 50 stations / 50+ years
 * using NDBC historical standard meteorological archives.
 *
 * Target: ~2.2M entries
 *
 * Data source: https://www.ndbc.noaa.gov/data/historical/stdmet/{STATION}h{YEAR}.txt.gz
 * No auth required. 500ms between requests to be respectful.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-ndbc-deep.ts
 *
 * Resume support:
 *   START_STATION=42001  — resume from this station ID
 *   START_YEAR=1990      — resume from this year (within START_STATION)
 */

import { gunzipSync } from "node:zlib";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const START_STATION = process.env.START_STATION || null;
const START_YEAR = process.env.START_YEAR ? parseInt(process.env.START_YEAR, 10) : null;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) { console.error("VOYAGE_API_KEY required"); process.exit(1); }

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

// ---------- Station Definitions ----------

interface StationDef {
  id: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
  startYear: number;
}

const STATIONS: StationDef[] = [
  // Atlantic
  { id: "41001", name: "Hatteras", state: "NC", lat: 34.7, lon: -72.7, startYear: 1976 },
  { id: "41002", name: "South Hatteras", state: "NC", lat: 32.3, lon: -75.2, startYear: 1975 },
  { id: "41004", name: "Edisto", state: "SC", lat: 32.5, lon: -79.1, startYear: 1978 },
  { id: "41008", name: "Grays Reef", state: "GA", lat: 31.4, lon: -80.9, startYear: 1988 },
  { id: "41009", name: "Canaveral", state: "FL", lat: 28.5, lon: -80.2, startYear: 1988 },
  { id: "44004", name: "Hotel", state: "MA", lat: 38.5, lon: -70.7, startYear: 1978 },
  { id: "44005", name: "Gulf of Maine", state: "ME", lat: 43.2, lon: -69.2, startYear: 1978 },
  { id: "44007", name: "Portland", state: "ME", lat: 43.5, lon: -70.1, startYear: 1982 },
  { id: "44008", name: "Nantucket", state: "MA", lat: 40.5, lon: -69.4, startYear: 1982 },
  { id: "44009", name: "Delaware Bay", state: "DE", lat: 38.5, lon: -75.0, startYear: 1984 },
  { id: "44013", name: "Boston", state: "MA", lat: 42.3, lon: -70.7, startYear: 1984 },
  { id: "44014", name: "Virginia Beach", state: "VA", lat: 36.6, lon: -74.8, startYear: 1990 },
  { id: "44017", name: "Montauk", state: "NY", lat: 40.7, lon: -72.0, startYear: 1996 },
  { id: "44025", name: "Long Island", state: "NY", lat: 40.3, lon: -73.2, startYear: 1991 },
  // Gulf of Mexico
  { id: "42001", name: "Mid Gulf", state: "LA", lat: 25.9, lon: -89.7, startYear: 1975 },
  { id: "42002", name: "West Gulf", state: "TX", lat: 26.0, lon: -93.6, startYear: 1973 },
  { id: "42003", name: "East Gulf", state: "FL", lat: 26.0, lon: -85.9, startYear: 1976 },
  { id: "42019", name: "Freeport", state: "TX", lat: 29.0, lon: -95.4, startYear: 1990 },
  { id: "42020", name: "Corpus Christi", state: "TX", lat: 26.9, lon: -96.7, startYear: 1990 },
  { id: "42035", name: "Galveston", state: "TX", lat: 29.2, lon: -94.4, startYear: 1993 },
  { id: "42036", name: "West Tampa", state: "FL", lat: 28.5, lon: -84.5, startYear: 1994 },
  { id: "42039", name: "Pensacola", state: "FL", lat: 28.8, lon: -86.0, startYear: 1995 },
  { id: "42040", name: "Luke Island", state: "MS", lat: 29.2, lon: -88.2, startYear: 2004 },
  // Pacific
  { id: "46001", name: "Gulf of Alaska", state: "AK", lat: 56.3, lon: -148.2, startYear: 1972 },
  { id: "46002", name: "Oregon", state: "OR", lat: 42.6, lon: -130.5, startYear: 1975 },
  { id: "46005", name: "Washington", state: "WA", lat: 46.1, lon: -131.0, startYear: 1976 },
  { id: "46006", name: "Mendocino", state: "CA", lat: 40.8, lon: -137.4, startYear: 1977 },
  { id: "46011", name: "Santa Maria", state: "CA", lat: 34.9, lon: -121.0, startYear: 1980 },
  { id: "46012", name: "Half Moon Bay", state: "CA", lat: 37.4, lon: -122.7, startYear: 1981 },
  { id: "46013", name: "Bodega Bay", state: "CA", lat: 38.2, lon: -123.3, startYear: 1981 },
  { id: "46014", name: "Point Arena", state: "CA", lat: 39.2, lon: -123.9, startYear: 1981 },
  { id: "46022", name: "Eel River", state: "CA", lat: 40.7, lon: -124.5, startYear: 1982 },
  { id: "46025", name: "Santa Monica", state: "CA", lat: 33.7, lon: -119.1, startYear: 1982 },
  { id: "46026", name: "San Francisco", state: "CA", lat: 37.8, lon: -122.8, startYear: 1982 },
  { id: "46027", name: "Crescent City", state: "CA", lat: 41.9, lon: -124.4, startYear: 1983 },
  { id: "46028", name: "Cape San Martin", state: "CA", lat: 35.7, lon: -121.9, startYear: 1983 },
  { id: "46029", name: "Columbia River", state: "OR", lat: 46.1, lon: -124.5, startYear: 1984 },
  { id: "46041", name: "Cape Elizabeth", state: "WA", lat: 47.3, lon: -124.7, startYear: 1987 },
  { id: "46042", name: "Monterey", state: "CA", lat: 36.8, lon: -122.4, startYear: 1987 },
  { id: "46047", name: "Tanner Bank", state: "CA", lat: 32.4, lon: -119.5, startYear: 1991 },
  { id: "46050", name: "Stonewall Bank", state: "OR", lat: 44.6, lon: -124.5, startYear: 1991 },
  { id: "46053", name: "Santa Barbara", state: "CA", lat: 34.2, lon: -119.8, startYear: 1982 },
  { id: "46054", name: "Santa Barbara W", state: "CA", lat: 34.3, lon: -120.5, startYear: 1993 },
  { id: "46059", name: "Harvest", state: "CA", lat: 38.0, lon: -130.0, startYear: 2005 },
  { id: "46069", name: "South Santa Rosa", state: "CA", lat: 33.7, lon: -120.2, startYear: 1993 },
  { id: "46072", name: "Central Aleutians", state: "AK", lat: 51.7, lon: -172.1, startYear: 2004 },
  { id: "46078", name: "Alaska", state: "AK", lat: 55.5, lon: -153.0, startYear: 2005 },
  // Hawaii
  { id: "51001", name: "NW Hawaii", state: "HI", lat: 23.4, lon: -162.1, startYear: 1981 },
  { id: "51002", name: "SW Hawaii", state: "HI", lat: 17.1, lon: -157.8, startYear: 1984 },
  { id: "51003", name: "SE Hawaii", state: "HI", lat: 19.2, lon: -160.6, startYear: 1984 },
];

// ---------- State full names for narratives ----------

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// ---------- Wind direction labels ----------

const WIND_DIR_LABELS: Record<string, string> = {
  N: "the north", NNE: "the north-northeast", NE: "the northeast", ENE: "the east-northeast",
  E: "the east", ESE: "the east-southeast", SE: "the southeast", SSE: "the south-southeast",
  S: "the south", SSW: "the south-southwest", SW: "the southwest", WSW: "the west-southwest",
  W: "the west", WNW: "the west-northwest", NW: "the northwest", NNW: "the north-northwest",
};

function degreesToCardinal(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const idx = Math.round(deg / 22.5) % 16;
  return dirs[idx];
}

// ---------- Unit conversions ----------

function celsiusToFahrenheit(c: number): number {
  return c * 9 / 5 + 32;
}

function metersToFeet(m: number): number {
  return m * 3.28084;
}

function msToKnots(ms: number): number {
  return ms * 1.94384;
}

// ---------- Helpers ----------

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isMissing(val: string): boolean {
  const n = parseFloat(val);
  if (isNaN(n)) return val === "MM";
  return n === 99.0 || n === 999.0 || n === 9999.0 || n === 99.00 || n === 999 || n === 9999;
}

function parseNum(val: string): number | null {
  if (isMissing(val)) return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

// ---------- Month names for narrative ----------

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatNarrativeDate(dateStr: string): string {
  const [yr, mo, dy] = dateStr.split("-").map(Number);
  const monthName = MONTH_NAMES[mo - 1];
  const day = dy;
  return `${monthName} ${day}, ${yr}`;
}

// ---------- NDBC Fetch ----------

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
      return null;
    } catch (err) {
      if (attempt < 2) {
        await delay((attempt + 1) * 5000);
        continue;
      }
      return null;
    }
  }
  return null;
}

// ---------- NDBC Parsing ----------

interface HourlyObs {
  date: string;    // YYYY-MM-DD
  wdir: number | null;  // degrees
  wspd: number | null;  // m/s
  gst: number | null;   // m/s
  wvht: number | null;  // meters
  dpd: number | null;   // seconds (dominant wave period)
  apd: number | null;   // seconds (average wave period)
  mwd: number | null;   // degrees (mean wave direction)
  pres: number | null;  // hPa/mb
  atmp: number | null;  // Celsius
  wtmp: number | null;  // Celsius
  dewp: number | null;  // Celsius
}

function parseNdbcText(text: string): HourlyObs[] {
  const lines = text.split("\n");
  if (lines.length < 3) return [];

  // First line = headers, second line = units. Both start with # sometimes.
  const headerLine = lines[0].replace(/^#\s*/, "").trim();
  const cols = headerLine.split(/\s+/);

  const colIdx: Record<string, number> = {};
  for (let i = 0; i < cols.length; i++) {
    colIdx[cols[i]] = i;
  }

  // Year column can be YY, #YY, or YYYY
  const yearKey = colIdx["YYYY"] !== undefined ? "YYYY" : colIdx["#YY"] !== undefined ? "#YY" : "YY";
  if (colIdx[yearKey] === undefined) return [];

  const yearIdx = colIdx[yearKey];
  const mmIdx = colIdx["MM"];
  const ddIdx = colIdx["DD"];
  if (mmIdx === undefined || ddIdx === undefined) return [];

  const wdirIdx = colIdx["WDIR"];
  const wspdIdx = colIdx["WSPD"];
  const gstIdx = colIdx["GST"];
  const wvhtIdx = colIdx["WVHT"];
  const dpdIdx = colIdx["DPD"];
  const apdIdx = colIdx["APD"];
  const mwdIdx = colIdx["MWD"];
  const presIdx = colIdx["PRES"];
  const atmpIdx = colIdx["ATMP"];
  const wtmpIdx = colIdx["WTMP"];
  const dewpIdx = colIdx["DEWP"];

  const observations: HourlyObs[] = [];

  // Start at line 2 (skip header + units)
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;

    let year = parts[yearIdx];
    if (year.length === 2) {
      const yr = parseInt(year, 10);
      year = yr < 50 ? `20${year}` : `19${year}`;
    }

    const month = parts[mmIdx].padStart(2, "0");
    const day = parts[ddIdx].padStart(2, "0");
    const date = `${year}-${month}-${day}`;

    observations.push({
      date,
      wdir: wdirIdx !== undefined ? parseNum(parts[wdirIdx]) : null,
      wspd: wspdIdx !== undefined ? parseNum(parts[wspdIdx]) : null,
      gst: gstIdx !== undefined ? parseNum(parts[gstIdx]) : null,
      wvht: wvhtIdx !== undefined ? parseNum(parts[wvhtIdx]) : null,
      dpd: dpdIdx !== undefined ? parseNum(parts[dpdIdx]) : null,
      apd: apdIdx !== undefined ? parseNum(parts[apdIdx]) : null,
      mwd: mwdIdx !== undefined ? parseNum(parts[mwdIdx]) : null,
      pres: presIdx !== undefined ? parseNum(parts[presIdx]) : null,
      atmp: atmpIdx !== undefined ? parseNum(parts[atmpIdx]) : null,
      wtmp: wtmpIdx !== undefined ? parseNum(parts[wtmpIdx]) : null,
      dewp: dewpIdx !== undefined ? parseNum(parts[dewpIdx]) : null,
    });
  }

  return observations;
}

// ---------- Daily Aggregation ----------

interface DailySummary {
  date: string;
  avgWindKts: number | null;
  maxGustKts: number | null;
  avgWaveHtFt: number | null;
  maxWaveHtFt: number | null;
  avgWaterTempF: number | null;
  avgPressureMb: number | null;
  avgWindDir: number | null;  // degrees
  avgDominantPeriod: number | null; // seconds
}

function avg(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function circularMean(degrees: number[]): number {
  let sinSum = 0, cosSum = 0;
  for (const d of degrees) {
    const rad = d * Math.PI / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  let mean = Math.atan2(sinSum / degrees.length, cosSum / degrees.length) * 180 / Math.PI;
  if (mean < 0) mean += 360;
  return Math.round(mean);
}

function aggregateDaily(observations: HourlyObs[]): DailySummary[] {
  const dayMap = new Map<string, HourlyObs[]>();
  for (const obs of observations) {
    if (!dayMap.has(obs.date)) dayMap.set(obs.date, []);
    dayMap.get(obs.date)!.push(obs);
  }

  const summaries: DailySummary[] = [];

  for (const [date, obs] of dayMap) {
    const wspds = obs.map(o => o.wspd).filter((v): v is number => v !== null);
    const gusts = obs.map(o => o.gst).filter((v): v is number => v !== null);
    const wvhts = obs.map(o => o.wvht).filter((v): v is number => v !== null);
    const wtmps = obs.map(o => o.wtmp).filter((v): v is number => v !== null);
    const press = obs.map(o => o.pres).filter((v): v is number => v !== null);
    const wdirs = obs.map(o => o.wdir).filter((v): v is number => v !== null);
    const dpds = obs.map(o => o.dpd).filter((v): v is number => v !== null);

    // Skip days with no useful data
    if (wspds.length === 0 && wvhts.length === 0 && wtmps.length === 0 && press.length === 0) continue;

    summaries.push({
      date,
      avgWindKts: wspds.length > 0 ? Math.round(msToKnots(avg(wspds)) * 10) / 10 : null,
      maxGustKts: gusts.length > 0 ? Math.round(msToKnots(Math.max(...gusts)) * 10) / 10 : null,
      avgWaveHtFt: wvhts.length > 0 ? Math.round(metersToFeet(avg(wvhts)) * 10) / 10 : null,
      maxWaveHtFt: wvhts.length > 0 ? Math.round(metersToFeet(Math.max(...wvhts)) * 10) / 10 : null,
      avgWaterTempF: wtmps.length > 0 ? Math.round(celsiusToFahrenheit(avg(wtmps)) * 10) / 10 : null,
      avgPressureMb: press.length > 0 ? Math.round(avg(press) * 10) / 10 : null,
      avgWindDir: wdirs.length > 0 ? circularMean(wdirs) : null,
      avgDominantPeriod: dpds.length > 0 ? Math.round(avg(dpds) * 10) / 10 : null,
    });
  }

  return summaries.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- Narrative Builder ----------

function buildNarrative(station: StationDef, day: DailySummary): string {
  const datePretty = formatNarrativeDate(day.date);
  const stateName = STATE_NAMES[station.state] || station.state;

  const parts: string[] = [];
  parts.push(`On ${datePretty}, the NDBC buoy at ${station.name} (Station ${station.id}) off the coast of ${stateName}`);

  // Wind
  if (day.avgWindKts !== null) {
    let windPart = ` recorded average winds of ${day.avgWindKts} knots`;
    if (day.avgWindDir !== null) {
      const cardinal = degreesToCardinal(day.avgWindDir);
      const dirLabel = WIND_DIR_LABELS[cardinal] || cardinal;
      windPart += ` from ${dirLabel}`;
    }
    if (day.maxGustKts !== null) {
      windPart += ` with gusts to ${day.maxGustKts} knots`;
    }
    parts.push(windPart + ".");
  }

  // Waves
  if (day.avgWaveHtFt !== null) {
    let wavePart = ` Seas were running ${day.avgWaveHtFt} feet`;
    if (day.avgDominantPeriod !== null) {
      wavePart += ` with a ${day.avgDominantPeriod}-second period`;
    }
    parts.push(wavePart + ".");
  }

  // Water temp and pressure
  const conditions: string[] = [];
  if (day.avgWaterTempF !== null) {
    conditions.push(`Water temperature was ${day.avgWaterTempF}\u00B0F`);
  }
  if (day.avgPressureMb !== null) {
    conditions.push(`barometric pressure was ${day.avgPressureMb} millibars`);
  }
  if (conditions.length > 0) {
    let condStr = " " + conditions.join(" and ");
    // Add pressure interpretation
    if (day.avgPressureMb !== null) {
      if (day.avgPressureMb < 1000) {
        condStr += ", indicating an approaching low pressure system";
      } else if (day.avgPressureMb > 1025) {
        condStr += ", indicating a strong high pressure system";
      }
    }
    parts.push(condStr + ".");
  }

  return parts.join("");
}

// ---------- Embedding ----------

async function batchEmbed(texts: string[], retries = 3): Promise<number[][]> {
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
        console.log(`    Voyage 429, backing off ${(attempt + 1) * 30}s...`);
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
  throw new Error("Exhausted retries");
}

// ---------- Supabase Insert ----------

async function insertBatch(rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
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
        console.error(`    Insert failed: ${text}`);
        break;
      } catch (err) {
        if (attempt < 2) {
          await delay(5000);
          continue;
        }
        console.error(`    Insert fetch failed: ${err}`);
      }
    }
  }
}

// ---------- Process Entries (embed + insert) ----------

async function processEntries(entries: { embedText: string; row: Record<string, unknown> }[]): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    const texts = batch.map(e => e.embedText);

    let embeddings: number[][];
    try {
      embeddings = await batchEmbed(texts);
    } catch (err) {
      console.error(`    Embed batch failed, skipping ${batch.length} entries: ${err}`);
      continue;
    }

    const rows = batch.map((e, idx) => ({
      ...e.row,
      embedding: JSON.stringify(embeddings[idx]),
    }));

    await insertBatch(rows);
    inserted += rows.length;

    // Pause between embed batches
    if (i + 20 < entries.length) await delay(300);
  }

  return inserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== NDBC Deep Buoy History Backfill ===");
  console.log(`Stations: ${STATIONS.length}`);

  let startStationIdx = 0;
  if (START_STATION) {
    startStationIdx = STATIONS.findIndex(s => s.id === START_STATION);
    if (startStationIdx === -1) {
      console.error(`Station ${START_STATION} not found in list`);
      process.exit(1);
    }
    console.log(`Resuming from station ${START_STATION}`);
  }

  let grandTotal = 0;

  for (let si = startStationIdx; si < STATIONS.length; si++) {
    const station = STATIONS[si];
    const endYear = 2025;
    let stationTotal = 0;

    console.log(`\n--- ${station.id} (${station.name}, ${station.state}) ---`);

    for (let year = station.startYear; year <= endYear; year++) {
      // Resume: skip years before START_YEAR for the resume station
      if (si === startStationIdx && START_YEAR && year < START_YEAR) continue;

      // Download
      const gzBuf = await fetchStationYear(station.id, year);
      if (!gzBuf) {
        // Silent skip — many years will 404 for stations that were offline
        await delay(500);
        continue;
      }

      // Decompress
      let text: string;
      try {
        text = gunzipSync(gzBuf).toString("utf-8");
      } catch {
        console.log(`  ${year}: gzip failed — skipping`);
        await delay(500);
        continue;
      }

      // Parse hourly observations
      const observations = parseNdbcText(text);
      if (observations.length === 0) {
        await delay(500);
        continue;
      }

      // Aggregate to daily
      const dailySummaries = aggregateDaily(observations);
      if (dailySummaries.length === 0) {
        await delay(500);
        continue;
      }

      // Build entries
      const entries: { embedText: string; row: Record<string, unknown> }[] = [];

      for (const day of dailySummaries) {
        const narrative = buildNarrative(station, day);
        const title = `Buoy ${station.name} ${station.state} ${day.date}`;

        entries.push({
          embedText: narrative,
          row: {
            title,
            content: narrative,
            content_type: "ocean-buoy-historical",
            tags: [station.state, "ocean", "buoy", "marine-weather", "waves"],
            state_abbr: station.state,
            species: null,
            effective_date: day.date,
            metadata: {
              source: "ndbc-historical",
              station_id: station.id,
              station_name: station.name,
              state: station.state,
              lat: station.lat,
              lon: station.lon,
              avg_wind_kts: day.avgWindKts,
              max_gust_kts: day.maxGustKts,
              avg_wave_ht_ft: day.avgWaveHtFt,
              max_wave_ht_ft: day.maxWaveHtFt,
              water_temp_f: day.avgWaterTempF,
              pressure_mb: day.avgPressureMb,
              wind_dir: day.avgWindDir,
            },
          },
        });
      }

      // Embed + insert
      try {
        const inserted = await processEntries(entries);
        stationTotal += inserted;
        console.log(`  ${year}: ${dailySummaries.length} days -> ${inserted} embedded`);
      } catch (err) {
        console.error(`  ${year}: embed/insert failed — ${err}`);
      }

      // 500ms between NDBC downloads
      await delay(500);
    }

    grandTotal += stationTotal;
    console.log(`  ${station.id} total: ${stationTotal.toLocaleString()} entries`);
  }

  console.log(`\n=== Done! Total: ${grandTotal.toLocaleString()} entries inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
