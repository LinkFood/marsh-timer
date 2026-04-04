/**
 * Backfill NOAA CO-OPS verified daily mean water levels + residuals
 * into hunt_knowledge.
 *
 * Pulls from the NOAA Tides & Currents API (no auth needed).
 * Max 31 days per request, ~1 req/s rate limit.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-noaa-coops-water.ts
 *
 * Resume support:
 *   START_STATION=8518750  — skip stations before this ID
 *   START_YEAR=2005        — skip years before this (within current station)
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
if (!VOYAGE_KEY) {
  console.error("VOYAGE_API_KEY required");
  process.exit(1);
}

const START_STATION = process.env.START_STATION || null;
const START_YEAR = process.env.START_YEAR
  ? parseInt(process.env.START_YEAR, 10)
  : null;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const COOPS_BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

// ---------- Station List ----------

interface Station {
  id: string;
  name: string;
  state: string;
  startYear: number;
}

const STATIONS: Station[] = [
  { id: "8518750", name: "The Battery", state: "NY", startYear: 1856 },
  { id: "9414290", name: "San Francisco", state: "CA", startYear: 1854 },
  { id: "8723214", name: "Virginia Key", state: "FL", startYear: 1931 },
  { id: "8665530", name: "Charleston", state: "SC", startYear: 1901 },
  { id: "8658120", name: "Wilmington", state: "NC", startYear: 1935 },
  { id: "8452660", name: "Newport", state: "RI", startYear: 1930 },
  { id: "8443970", name: "Boston", state: "MA", startYear: 1921 },
  { id: "8724580", name: "Key West", state: "FL", startYear: 1913 },
  { id: "8545240", name: "Philadelphia", state: "PA", startYear: 1900 },
  { id: "8638610", name: "Sewells Point", state: "VA", startYear: 1927 },
  { id: "8726520", name: "St. Petersburg", state: "FL", startYear: 1947 },
  { id: "8720218", name: "Mayport", state: "FL", startYear: 1928 },
  { id: "8651370", name: "Duck", state: "NC", startYear: 1978 },
  { id: "8729840", name: "Pensacola", state: "FL", startYear: 1923 },
  { id: "8747437", name: "Bay Waveland", state: "MS", startYear: 1978 },
  { id: "8770570", name: "Sabine Pass", state: "TX", startYear: 1958 },
  { id: "8771450", name: "Galveston", state: "TX", startYear: 1904 },
  { id: "8775870", name: "Corpus Christi", state: "TX", startYear: 1983 },
  { id: "9410230", name: "La Jolla", state: "CA", startYear: 1924 },
  { id: "9410660", name: "Los Angeles", state: "CA", startYear: 1923 },
  { id: "9414523", name: "Redwood City", state: "CA", startYear: 1974 },
  { id: "9447130", name: "Seattle", state: "WA", startYear: 1898 },
  { id: "9449880", name: "Friday Harbor", state: "WA", startYear: 1934 },
  { id: "9451600", name: "Juneau", state: "AK", startYear: 1936 },
  { id: "9452210", name: "Juneau", state: "AK", startYear: 1919 },
  { id: "1611400", name: "Nawiliwili", state: "HI", startYear: 1954 },
  { id: "1612340", name: "Honolulu", state: "HI", startYear: 1905 },
  { id: "8410140", name: "Eastport", state: "ME", startYear: 1929 },
  { id: "8413320", name: "Bar Harbor", state: "ME", startYear: 1947 },
  { id: "8418150", name: "Portland", state: "ME", startYear: 1910 },
  { id: "8461490", name: "New London", state: "CT", startYear: 1938 },
  { id: "8467150", name: "Bridgeport", state: "CT", startYear: 1964 },
  { id: "8510560", name: "Montauk", state: "NY", startYear: 1947 },
  { id: "8531680", name: "Sandy Hook", state: "NJ", startYear: 1932 },
  { id: "8534720", name: "Atlantic City", state: "NJ", startYear: 1911 },
  { id: "8557380", name: "Lewes", state: "DE", startYear: 1919 },
  { id: "8570283", name: "Ocean City", state: "MD", startYear: 1975 },
  { id: "8574680", name: "Baltimore", state: "MD", startYear: 1902 },
  { id: "8575512", name: "Annapolis", state: "MD", startYear: 1928 },
  { id: "8594900", name: "Washington DC", state: "DC", startYear: 1931 },
  { id: "8632200", name: "Kiptopeke", state: "VA", startYear: 1951 },
  { id: "8735180", name: "Dauphin Island", state: "AL", startYear: 1966 },
  { id: "8761724", name: "Grand Isle", state: "LA", startYear: 1947 },
  { id: "8764227", name: "LAWMA", state: "LA", startYear: 1982 },
  { id: "9432780", name: "Westport", state: "WA", startYear: 1971 },
  { id: "9440910", name: "Toke Point", state: "WA", startYear: 1972 },
  { id: "9461380", name: "Adak Island", state: "AK", startYear: 1943 },
  { id: "9462620", name: "Unalaska", state: "AK", startYear: 1957 },
  { id: "8467726", name: "Stamford", state: "CT", startYear: 1977 },
  { id: "8638863", name: "Chesapeake Bay Bridge", state: "VA", startYear: 1975 },
];

// State names for narrative text
const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "District of Columbia",
  FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada",
  NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatDateYYYYMMDD(year: number, month: number, day: number): string {
  return `${year}${pad2(month)}${pad2(day)}`;
}

function formatDateISO(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function formatDateNarrative(dateStr: string): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${months[m - 1]} ${d}, ${y}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// ---------- CO-OPS API ----------

interface DailyMeanEntry {
  t: string; // "YYYY-MM-DD"
  v: string; // value in feet
  f?: string; // flags (not present in aggregated daily means)
}

interface PredictionEntry {
  t: string; // "YYYY-MM-DD HH:MM"
  v: string; // value in feet
}

async function fetchDailyMean(
  stationId: string,
  beginDate: string,
  endDate: string,
): Promise<DailyMeanEntry[]> {
  // daily_mean only works for Great Lakes — use hourly_height for all stations
  // then aggregate to daily mean ourselves
  const url = `${COOPS_BASE}?begin_date=${beginDate}&end_date=${endDate}&station=${stationId}&product=hourly_height&datum=STND&units=english&time_zone=gmt&format=json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) return [];
      throw new Error(`CO-OPS hourly_height ${res.status}`);
    }

    const data = await res.json();
    if (data.error) return [];
    if (!data.data || !Array.isArray(data.data)) return [];

    // Aggregate hourly readings to daily means
    const dayTotals = new Map<string, { sum: number; count: number }>();
    for (const reading of data.data) {
      const day = (reading.t as string).substring(0, 10); // "YYYY-MM-DD"
      const val = parseFloat(reading.v);
      if (isNaN(val)) continue;
      const existing = dayTotals.get(day);
      if (existing) {
        existing.sum += val;
        existing.count += 1;
      } else {
        dayTotals.set(day, { sum: val, count: 1 });
      }
    }

    // Convert to DailyMeanEntry format
    const result: DailyMeanEntry[] = [];
    for (const [day, { sum, count }] of dayTotals) {
      result.push({
        t: day,
        v: (sum / count).toFixed(3),
      });
    }
    return result.sort((a, b) => a.t.localeCompare(b.t));
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") throw new Error("CO-OPS hourly_height timeout");
    throw err;
  }
}

async function fetchPredictions(
  stationId: string,
  beginDate: string,
  endDate: string,
): Promise<Map<string, number>> {
  // Get daily predictions (not hi/lo) — use interval=1 for hourly, then average per day
  // Actually, use product=predictions with interval=1 (hourly), then compute daily mean
  const url = `${COOPS_BASE}?begin_date=${beginDate}&end_date=${endDate}&station=${stationId}&product=predictions&datum=STND&units=english&time_zone=gmt&interval=h&format=json`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      if (res.status >= 400 && res.status < 500) return new Map();
      throw new Error(`CO-OPS predictions ${res.status}`);
    }

    const data = await res.json();
    if (data.error) return new Map();
    if (!data.predictions || !Array.isArray(data.predictions)) return new Map();

    // Average predictions per day
    const dayTotals = new Map<string, { sum: number; count: number }>();
    for (const p of data.predictions as PredictionEntry[]) {
      const day = p.t.substring(0, 10); // "YYYY-MM-DD"
      const val = parseFloat(p.v);
      if (isNaN(val)) continue;
      const existing = dayTotals.get(day);
      if (existing) {
        existing.sum += val;
        existing.count += 1;
      } else {
        dayTotals.set(day, { sum: val, count: 1 });
      }
    }

    const result = new Map<string, number>();
    for (const [day, { sum, count }] of dayTotals) {
      result.set(day, Math.round((sum / count) * 100) / 100);
    }
    return result;
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") return new Map(); // Predictions not critical
    return new Map(); // Don't fail the whole month if predictions unavailable
  }
}

// ---------- Narrative Builder ----------

function buildNarrative(
  station: Station,
  dateStr: string,
  dailyMean: number,
  predicted: number | null,
  residual: number | null,
): string {
  const datePretty = formatDateNarrative(dateStr);
  const stateName = STATE_NAMES[station.state] || station.state;

  let text = `On ${datePretty}, the tide gauge at ${station.name} in ${stateName} recorded a daily mean water level of ${dailyMean.toFixed(2)} feet (STND datum).`;

  if (predicted !== null && residual !== null) {
    const absResidual = Math.abs(residual);
    const sign = residual >= 0 ? "+" : "-";
    text += ` The predicted astronomical tide was ${predicted.toFixed(2)} feet, leaving a residual of ${sign}${absResidual.toFixed(2)} feet`;

    if (absResidual >= 3.0) {
      text += ` — indicating extreme storm surge or catastrophic weather event driving water levels far ${residual > 0 ? "above" : "below"} normal.`;
    } else if (absResidual >= 1.5) {
      text += ` — indicating significant storm surge or strong weather forcing water levels well ${residual > 0 ? "above" : "below"} normal.`;
    } else if (absResidual >= 0.5) {
      text += ` — indicating moderate storm surge or weather effects pushing water levels ${residual > 0 ? "above" : "below"} normal.`;
    } else if (absResidual >= 0.15) {
      text += ` — indicating mild storm surge or onshore winds pushing water levels slightly ${residual > 0 ? "above" : "below"} normal.`;
    } else {
      text += ` — very close to predicted levels, indicating calm conditions.`;
    }
  }

  return text;
}

// ---------- Build hunt_knowledge entry ----------

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
  station: Station,
  dateStr: string,
  dailyMean: number,
  predicted: number | null,
  residual: number | null,
): PreparedEntry {
  const title = `Tide ${station.name} ${station.state} ${dateStr}`;
  const narrative = buildNarrative(station, dateStr, dailyMean, predicted, residual);

  const tags: string[] = [station.state, "tide", "water-level", "coastal"];
  // Station-specific tag
  const stationTag = station.name.toLowerCase().replace(/\s+/g, "-");
  tags.push(stationTag);

  // Tag extreme residuals
  if (residual !== null && Math.abs(residual) >= 1.5) {
    tags.push("storm-surge");
  }

  return {
    title,
    content: narrative,
    content_type: "tide-gauge",
    tags,
    state_abbr: station.state,
    species: null,
    effective_date: dateStr,
    metadata: {
      source: "noaa-coops",
      station_id: station.id,
      station_name: station.name,
      state: station.state,
      daily_mean_ft: dailyMean,
      predicted_ft: predicted,
      residual_ft: residual,
      datum: "STND",
    },
    embedText: narrative,
  };
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

// ---------- Supabase upsert ----------

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
        if (res.status >= 400 && res.status < 500) {
          const text = await res.text();
          console.error(`  Insert 4xx (not retrying): ${text}`);
          break;
        }
        if (attempt < 2) {
          console.log(`  Insert retry ${attempt + 1}/3...`);
          await delay(5000);
          continue;
        }
        const text = await res.text();
        console.error(`  Insert failed after retries: ${text}`);
      } catch (err) {
        if (attempt < 2) {
          await delay(5000);
          continue;
        }
        console.error(`  Insert fetch failed after retries: ${err}`);
      }
    }
  }
}

// ---------- Process entries (embed + insert) ----------

async function processEntries(entries: PreparedEntry[]): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    const texts = batch.map((e) => e.embedText);

    let embeddings: number[][];
    try {
      embeddings = await batchEmbed(texts);
    } catch (err) {
      console.error(
        `    Embed batch failed, skipping ${batch.length} entries: ${err}`,
      );
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

    await insertBatch(rows);
    inserted += rows.length;

    // Pause between embed batches
    await delay(500);
  }

  return inserted;
}

// ---------- Process one month ----------

async function processMonth(
  station: Station,
  year: number,
  month: number,
  hasPredictions: boolean,
): Promise<PreparedEntry[]> {
  const days = daysInMonth(year, month);
  const beginDate = formatDateYYYYMMDD(year, month, 1);
  const endDate = formatDateYYYYMMDD(year, month, days);

  // Fetch daily mean observed levels
  const dailyData = await fetchDailyMean(station.id, beginDate, endDate);
  await delay(1000); // 1s rate limit

  // Fetch predictions if available for this station
  let predictions = new Map<string, number>();
  if (hasPredictions && dailyData.length > 0) {
    predictions = await fetchPredictions(station.id, beginDate, endDate);
    await delay(1000); // 1s rate limit
  }

  const entries: PreparedEntry[] = [];

  for (const day of dailyData) {
    const val = parseFloat(day.v);
    if (isNaN(val)) continue;

    // Normalize date format — CO-OPS returns "YYYY-MM-DD"
    const dateStr = day.t.trim();
    if (!dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

    const predicted = predictions.get(dateStr) ?? null;
    const residual =
      predicted !== null ? Math.round((val - predicted) * 100) / 100 : null;

    entries.push(buildEntry(station, dateStr, val, predicted, residual));
  }

  return entries;
}

// ---------- Check if predictions available ----------

async function checkPredictionsAvailable(stationId: string): Promise<boolean> {
  // Probe with a recent month to see if predictions exist
  const url = `${COOPS_BASE}?begin_date=20240101&end_date=20240131&station=${stationId}&product=predictions&datum=STND&units=english&time_zone=gmt&interval=h&format=json`;

  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const data = await res.json();
    if (data.error) return false;
    return !!(data.predictions && data.predictions.length > 0);
  } catch {
    return false;
  }
}

// ---------- Main ----------

async function main() {
  console.log("=== NOAA CO-OPS Water Level Backfill ===");
  console.log(`Stations: ${STATIONS.length} | Going back to earliest available data`);

  let totalInserted = 0;
  let skipStation = !!START_STATION;

  for (const station of STATIONS) {
    // Resume: skip stations until we find the start station
    if (skipStation) {
      if (station.id === START_STATION) {
        skipStation = false;
      } else {
        continue;
      }
    }

    console.log(`\n--- ${station.id} (${station.name}, ${station.state}) ---`);

    // Check if predictions are available for this station
    const hasPredictions = await checkPredictionsAvailable(station.id);
    await delay(1000);
    console.log(`  Predictions available: ${hasPredictions}`);

    const startYear =
      START_STATION === station.id && START_YEAR
        ? START_YEAR
        : station.startYear;
    const endYear = 2025;
    let stationTotal = 0;

    for (let year = startYear; year <= endYear; year++) {
      const yearEntries: PreparedEntry[] = [];

      for (let month = 1; month <= 12; month++) {
        // Don't request future months
        if (year === 2025 && month > 12) break;

        try {
          const entries = await processMonth(station, year, month, hasPredictions);
          yearEntries.push(...entries);
        } catch (err) {
          console.error(`    ${year}-${pad2(month)} fetch failed: ${err}`);
          await delay(2000);
        }
      }

      if (yearEntries.length > 0) {
        try {
          const inserted = await processEntries(yearEntries);
          stationTotal += inserted;
          console.log(`  ${year}: ${yearEntries.length} days -> ${inserted} embedded`);
        } catch (err) {
          console.error(`  ${year}: embed/insert failed: ${err}`);
        }
      } else {
        console.log(`  ${year}: no data`);
      }
    }

    // Clear START_YEAR after first station so subsequent stations start from their own startYear
    totalInserted += stationTotal;
    console.log(`  ${station.name} total: ${stationTotal.toLocaleString()} entries`);
  }

  console.log(`\n=== Done! Total: ${totalInserted.toLocaleString()} entries inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
