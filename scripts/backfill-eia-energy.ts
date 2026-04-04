/**
 * Backfill EIA Energy Prices into hunt_knowledge
 * Oil, gas, electricity prices and production data since 1986.
 *
 * API: EIA v2 (https://api.eia.gov/v2/)
 * Requires free API key: register at https://www.eia.gov/opendata/register.php
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... EIA_API_KEY=... npx tsx scripts/backfill-eia-energy.ts
 *
 * Resume support:
 *   START_SERIES=3  — skip series with index < 3 (0-indexed)
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const EIA_KEY = process.env.EIA_API_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
if (!VOYAGE_KEY) {
  console.error("VOYAGE_API_KEY required");
  process.exit(1);
}
if (!EIA_KEY) {
  console.error("EIA_API_KEY required — register at https://www.eia.gov/opendata/register.php");
  process.exit(1);
}

const START_SERIES = process.env.START_SERIES
  ? parseInt(process.env.START_SERIES, 10)
  : 0;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- EIA Series Definitions ----------

interface EIASeries {
  id: string;
  name: string;
  unit: string;
  freq: "daily" | "weekly" | "monthly";
  route: string;
  facetKey: string;
  facetValue: string;
  fuelType: string;
}

const EIA_SERIES: EIASeries[] = [
  {
    id: "RWTC",
    name: "WTI Crude Oil Spot Price",
    unit: "$/barrel",
    freq: "daily",
    route: "petroleum/pri/spt/data/",
    facetKey: "series",
    facetValue: "RWTC",
    fuelType: "crude-oil",
  },
  {
    id: "RBRTE",
    name: "Brent Crude Oil Spot Price",
    unit: "$/barrel",
    freq: "daily",
    route: "petroleum/pri/spt/data/",
    facetKey: "series",
    facetValue: "RBRTE",
    fuelType: "crude-oil",
  },
  {
    id: "RNGWHHD",
    name: "Henry Hub Natural Gas Spot Price",
    unit: "$/MMBtu",
    freq: "daily",
    route: "natural-gas/pri/fut/data/",
    facetKey: "series",
    facetValue: "RNGWHHD",
    fuelType: "natural-gas",
  },
  {
    id: "EMM_EPMR_PTE_NUS_DPG",
    name: "US Regular Gasoline Retail Price",
    unit: "$/gallon",
    freq: "weekly",
    route: "petroleum/pri/gnd/data/",
    facetKey: "series",
    facetValue: "EMM_EPMR_PTE_NUS_DPG",
    fuelType: "gasoline",
  },
  {
    id: "EMD_EPD2D_PTE_NUS_DPG",
    name: "US Diesel Retail Price",
    unit: "$/gallon",
    freq: "weekly",
    route: "petroleum/pri/gnd/data/",
    facetKey: "series",
    facetValue: "EMD_EPD2D_PTE_NUS_DPG",
    fuelType: "diesel",
  },
  {
    id: "ELEC_GEN_ALL_US_99_M",
    name: "Total US Electricity Generation",
    unit: "thousand MWh",
    freq: "monthly",
    route: "electricity/electric-power-operational-data/data/",
    facetKey: "sectorid",
    facetValue: "99",
    fuelType: "electricity",
  },
  {
    id: "INTL_57_1_USA_TBPD_M",
    name: "US Crude Oil Production",
    unit: "thousand bbl/day",
    freq: "monthly",
    route: "international/data/",
    facetKey: "productId",
    facetValue: "57",
    fuelType: "crude-oil",
  },
  {
    id: "WCRSTUS1",
    name: "US Crude Oil Stocks (excl SPR)",
    unit: "thousand barrels",
    freq: "weekly",
    route: "petroleum/stoc/wstk/data/",
    facetKey: "series",
    facetValue: "WCRSTUS1",
    fuelType: "crude-oil",
  },
  {
    id: "WCSSTUS1",
    name: "Strategic Petroleum Reserve",
    unit: "thousand barrels",
    freq: "weekly",
    route: "petroleum/stoc/wstk/data/",
    facetKey: "series",
    facetValue: "WCSSTUS1",
    fuelType: "crude-oil",
  },
  {
    id: "TETCBUS_M",
    name: "Total US Energy Consumption",
    unit: "trillion BTU",
    freq: "monthly",
    route: "total-energy/data/",
    facetKey: "msn",
    facetValue: "TETCBUS",
    fuelType: "total-energy",
  },
];

// ---------- Narrative generation ----------

function buildNarrative(
  seriesName: string,
  value: number,
  unit: string,
  dateStr: string,
  fuelType: string,
): string {
  const d = new Date(dateStr);
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  let dateDisplay: string;
  if (dateStr.length === 7) {
    // Monthly: "2020-04"
    dateDisplay = `${monthNames[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  } else {
    // Daily/weekly: "2020-04-20"
    dateDisplay = `${monthNames[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }

  const valueStr = formatValue(value, unit);

  return `On ${dateDisplay}, ${seriesName} stood at ${valueStr}. ${getContextSentence(value, unit, fuelType, d)}`;
}

function formatValue(value: number, unit: string): string {
  if (unit.startsWith("$")) {
    return `$${value.toFixed(2)} ${unit.replace("$", "").replace("/", "per ")}`.trim();
  }
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)} million ${unit}`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} thousand ${unit}`;
  return `${value.toFixed(2)} ${unit}`;
}

function getContextSentence(value: number, unit: string, fuelType: string, date: Date): string {
  const year = date.getUTCFullYear();

  // Notable price context based on known historical events
  if (fuelType === "crude-oil" && unit === "$/barrel") {
    if (value < 0) return "Oil prices turned negative as storage capacity reached its limits amid collapsing demand.";
    if (value > 130) return "Oil prices surged past $130 per barrel amid tight global supply and strong demand.";
    if (value < 20 && year >= 2020) return "Oil prices collapsed as the COVID-19 pandemic crushed global demand.";
    if (value < 15) return "Oil prices fell to multi-year lows reflecting a severe global supply glut.";
    if (value > 100) return "Triple-digit oil prices reflected tight global supply conditions and geopolitical risk premiums.";
  }
  if (fuelType === "gasoline" && value > 4) {
    return "Gasoline prices exceeded $4 per gallon, straining household budgets and influencing consumer behavior.";
  }
  if (fuelType === "gasoline" && value < 2) {
    return "Low gasoline prices provided relief to consumers amid weak oil markets.";
  }
  if (fuelType === "natural-gas" && value > 8) {
    return "Natural gas prices spiked, driven by supply constraints or extreme weather-driven demand.";
  }
  if (fuelType === "natural-gas" && value < 2) {
    return "Natural gas prices remained subdued amid abundant supply from shale production.";
  }

  // Generic context
  const contexts: Record<string, string> = {
    "crude-oil": "Energy markets reflected the ongoing balance between global supply and demand fundamentals.",
    "natural-gas": "Natural gas prices reflected the intersection of production levels, storage inventories, and weather-driven demand.",
    "gasoline": "Retail fuel prices tracked underlying crude oil costs and refining margins.",
    "diesel": "Diesel prices reflected commercial transportation demand and refining economics.",
    "electricity": "Power generation levels reflected seasonal demand patterns and the evolving generation mix.",
    "total-energy": "Total energy consumption reflected economic activity, weather patterns, and structural efficiency trends.",
  };

  return contexts[fuelType] || "Energy markets continued to respond to supply, demand, and policy dynamics.";
}

// ---------- Fetch EIA data ----------

interface EIADataPoint {
  period: string;
  value: number | string | null;
}

async function fetchSeriesData(
  series: EIASeries,
  offset: number = 0,
): Promise<EIADataPoint[]> {
  const freqMap: Record<string, string> = {
    daily: "daily",
    weekly: "weekly",
    monthly: "monthly",
  };

  const params = new URLSearchParams({
    api_key: EIA_KEY!,
    frequency: freqMap[series.freq],
    "data[0]": "value",
    [`facets[${series.facetKey}][]`]: series.facetValue,
    start: "1986-01-01",
    end: "2026-03-31",
    "sort[0][column]": "period",
    "sort[0][direction]": "asc",
    length: "5000",
    offset: String(offset),
  });

  // Special handling for electricity generation — needs additional facets
  if (series.id === "ELEC_GEN_ALL_US_99_M") {
    params.set("facets[fueltypeid][]", "ALL");
    params.set("facets[location][]", "US");
    params.delete(`facets[${series.facetKey}][]`);
    params.set("facets[sectorid][]", "99");
  }

  // Special handling for international data
  if (series.id === "INTL_57_1_USA_TBPD_M") {
    params.delete(`facets[${series.facetKey}][]`);
    params.set("facets[productId][]", "57");
    params.set("facets[activityId][]", "1");
    params.set("facets[countryRegionId][]", "USA");
    params.set("facets[unit][]", "TBPD");
  }

  // Special handling for total energy
  if (series.id === "TETCBUS_M") {
    params.delete(`facets[${series.facetKey}][]`);
    params.set("facets[msn][]", "TETCBUS");
  }

  const url = `https://api.eia.gov/v2/${series.route}?${params.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`EIA API error: ${res.status} ${text}`);
  }

  const json = await res.json();
  const data = json.response?.data;
  if (!Array.isArray(data)) {
    return [];
  }

  return data
    .filter((d: any) => d.value !== null && d.value !== undefined && d.value !== "")
    .map((d: any) => ({
      period: d.period,
      value: typeof d.value === "string" ? parseFloat(d.value) : d.value,
    }))
    .filter((d: EIADataPoint) => !isNaN(d.value as number));
}

async function fetchAllSeriesData(series: EIASeries): Promise<EIADataPoint[]> {
  const allData: EIADataPoint[] = [];
  let offset = 0;

  while (true) {
    console.log(`    Fetching offset ${offset}...`);
    const batch = await fetchSeriesData(series, offset);
    if (batch.length === 0) break;

    allData.push(...batch);
    if (batch.length < 5000) break;

    offset += 5000;
    // EIA rate limit: 120 req/min
    await delay(600);
  }

  return allData;
}

// ---------- Build entry ----------

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
  series: EIASeries,
  point: EIADataPoint,
): PreparedEntry | null {
  const value = point.value as number;
  if (isNaN(value)) return null;

  // Normalize date — monthly data comes as "2020-04", daily as "2020-04-20"
  let effectiveDate: string;
  if (point.period.length === 7) {
    // Monthly: use last day of month
    const [y, m] = point.period.split("-").map(Number);
    const d = new Date(y, m, 0);
    effectiveDate = `${y}-${String(m).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } else {
    effectiveDate = point.period;
  }

  // Validate date
  const d = new Date(effectiveDate);
  if (isNaN(d.getTime())) return null;

  const narrative = buildNarrative(series.name, value, series.unit, point.period, series.fuelType);
  const valueStr = formatValue(value, series.unit);

  const title = `${series.name} ${point.period}: ${valueStr}`;

  const parts = [
    "energy-price",
    "US",
    effectiveDate,
    `series:${series.name}`,
    `value:${value}`,
    `unit:${series.unit}`,
    `narrative:${narrative}`,
  ];
  const content = parts.join(" | ");

  const tags = ["energy", series.fuelType, "price", series.freq];

  return {
    title,
    content,
    content_type: "energy-price",
    tags,
    state_abbr: "US",
    species: null,
    effective_date: effectiveDate,
    metadata: {
      source: "eia",
      series_id: series.id,
      series_name: series.name,
      value,
      unit: series.unit,
      frequency: series.freq,
      fuel_type: series.fuelType,
    },
    embedText: content,
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
          console.error(`  Insert 4xx (not retrying): ${res.status} ${text}`);
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

    await insertBatch(rows);
    inserted += rows.length;

    await delay(500);
  }

  return inserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== EIA Energy Price Backfill ===");
  console.log("Source: US Energy Information Administration v2 API");
  console.log(`Series: ${EIA_SERIES.length} total`);
  if (START_SERIES > 0) console.log(`Resuming from series index: ${START_SERIES}`);

  let totalInserted = 0;

  for (let i = 0; i < EIA_SERIES.length; i++) {
    if (i < START_SERIES) {
      console.log(`  Skipping series ${i}: ${EIA_SERIES[i].name} (before START_SERIES=${START_SERIES})`);
      continue;
    }

    const series = EIA_SERIES[i];
    console.log(`\n--- [${i}/${EIA_SERIES.length - 1}] ${series.name} (${series.freq}) ---`);

    let dataPoints: EIADataPoint[];
    try {
      dataPoints = await fetchAllSeriesData(series);
    } catch (err) {
      console.error(`  Fetch failed for ${series.name}: ${err}`);
      continue;
    }

    console.log(`  ${dataPoints.length} data points fetched`);
    if (dataPoints.length === 0) continue;

    const entries: PreparedEntry[] = [];
    for (const point of dataPoints) {
      const entry = buildEntry(series, point);
      if (entry) entries.push(entry);
    }

    console.log(`  ${entries.length} entries to embed`);
    if (entries.length === 0) continue;

    try {
      const inserted = await processEntries(entries);
      totalInserted += inserted;
      console.log(`  ${series.name}: ${inserted}/${entries.length} entries embedded and inserted`);
    } catch (err) {
      console.error(`  ${series.name}: embed/insert failed (continuing): ${err}`);
    }

    // Rate limit between series
    await delay(2000);
  }

  console.log(`\n=== Done! Total: ${totalInserted} entries inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
