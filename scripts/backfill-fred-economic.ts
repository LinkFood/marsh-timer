/**
 * Backfill Federal Reserve FRED economic data into hunt_knowledge
 * Fetches 40 key economic time series covering GDP, unemployment, inflation,
 * interest rates, stock indices, commodities, and financial stress indicators.
 * Builds human-readable narratives with period-over-period change context,
 * embeds via Voyage AI, and inserts into hunt_knowledge.
 *
 * Usage:
 *   FRED_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-fred-economic.ts
 *
 * Resume support:
 *   START_SERIES=5  — skip series before index 5 (0-based into FRED_SERIES array)
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const FRED_KEY = process.env.FRED_API_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
if (!VOYAGE_KEY) {
  console.error("VOYAGE_API_KEY required");
  process.exit(1);
}
if (!FRED_KEY) {
  console.error(
    "FRED_API_KEY required — register free at https://fred.stlouisfed.org/docs/api/api_key.html",
  );
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

// ---------- Series Definitions ----------

interface FredSeries {
  id: string;
  name: string;
  unit: string;
  freq: string;
  category: string;
}

const FRED_SERIES: FredSeries[] = [
  // Tier 1 — Big 5
  { id: "UNRATE", name: "Unemployment Rate", unit: "%", freq: "monthly", category: "labor" },
  { id: "CPIAUCSL", name: "Consumer Price Index", unit: "index", freq: "monthly", category: "inflation" },
  { id: "FEDFUNDS", name: "Federal Funds Rate", unit: "%", freq: "monthly", category: "monetary" },
  { id: "GDP", name: "Gross Domestic Product", unit: "billions $", freq: "quarterly", category: "output" },
  { id: "A191RL1Q225SBEA", name: "Real GDP Growth Rate", unit: "%", freq: "quarterly", category: "output" },
  // Tier 2 — Markets
  { id: "SP500", name: "S&P 500 Index", unit: "index", freq: "daily", category: "markets" },
  { id: "DJIA", name: "Dow Jones Industrial Average", unit: "index", freq: "daily", category: "markets" },
  { id: "NASDAQCOM", name: "NASDAQ Composite", unit: "index", freq: "daily", category: "markets" },
  { id: "VIXCLS", name: "CBOE Volatility Index (VIX)", unit: "index", freq: "daily", category: "fear" },
  { id: "DGS10", name: "10-Year Treasury Yield", unit: "%", freq: "daily", category: "bonds" },
  { id: "DGS2", name: "2-Year Treasury Yield", unit: "%", freq: "daily", category: "bonds" },
  { id: "T10Y2Y", name: "10Y-2Y Treasury Spread", unit: "%", freq: "daily", category: "bonds" },
  { id: "BAMLH0A0HYM2", name: "High Yield Bond Spread", unit: "%", freq: "daily", category: "credit" },
  // Tier 3 — Real Economy
  { id: "PAYEMS", name: "Total Nonfarm Payrolls", unit: "thousands", freq: "monthly", category: "labor" },
  { id: "ICSA", name: "Initial Jobless Claims", unit: "thousands", freq: "weekly", category: "labor" },
  { id: "CCSA", name: "Continued Jobless Claims", unit: "thousands", freq: "weekly", category: "labor" },
  { id: "HOUST", name: "Housing Starts", unit: "thousands", freq: "monthly", category: "housing" },
  { id: "RSAFS", name: "Retail Sales", unit: "millions $", freq: "monthly", category: "consumer" },
  { id: "UMCSENT", name: "Consumer Sentiment", unit: "index", freq: "monthly", category: "consumer" },
  { id: "INDPRO", name: "Industrial Production Index", unit: "index", freq: "monthly", category: "output" },
  // Tier 4 — Money & Inflation
  { id: "M2SL", name: "M2 Money Supply", unit: "billions $", freq: "monthly", category: "monetary" },
  { id: "WALCL", name: "Fed Balance Sheet Total Assets", unit: "millions $", freq: "weekly", category: "monetary" },
  { id: "MORTGAGE30US", name: "30-Year Mortgage Rate", unit: "%", freq: "weekly", category: "housing" },
  { id: "PCEPI", name: "PCE Price Index", unit: "index", freq: "monthly", category: "inflation" },
  { id: "CPILFESL", name: "Core CPI (Less Food & Energy)", unit: "index", freq: "monthly", category: "inflation" },
  { id: "GASREGW", name: "Regular Gas Price", unit: "$/gallon", freq: "weekly", category: "energy" },
  // Tier 5 — Commodities
  { id: "DCOILWTICO", name: "WTI Crude Oil Price", unit: "$/barrel", freq: "daily", category: "energy" },
  { id: "GOLDAMGBD228NLBM", name: "Gold Price", unit: "$/troy oz", freq: "daily", category: "commodities" },
  { id: "DCOILBRENTEU", name: "Brent Crude Oil Price", unit: "$/barrel", freq: "daily", category: "energy" },
  { id: "WPU0121", name: "Wheat PPI", unit: "index", freq: "monthly", category: "agriculture" },
  { id: "WPU0131", name: "Corn PPI", unit: "index", freq: "monthly", category: "agriculture" },
  { id: "APU0000708111", name: "Egg Price (dozen)", unit: "$/dozen", freq: "monthly", category: "food" },
  // Tier 6 — Fear & Stress
  { id: "STLFSI2", name: "St. Louis Financial Stress Index", unit: "index", freq: "weekly", category: "stress" },
  { id: "DRTSCILM", name: "Bank Lending Tightening", unit: "%", freq: "quarterly", category: "credit" },
  { id: "USREC", name: "US Recession Indicator", unit: "0/1", freq: "monthly", category: "cycle" },
  { id: "TEDRATE", name: "TED Spread", unit: "%", freq: "daily", category: "stress" },
  { id: "GEPUCURRENT", name: "Economic Policy Uncertainty", unit: "index", freq: "monthly", category: "uncertainty" },
];

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatNumber(val: number, unit: string): string {
  if (unit === "index" || unit === "0/1") return val.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (unit === "%") return val.toFixed(1) + "%";
  if (unit.startsWith("$")) return unit.replace("$", "$") + val.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (unit === "billions $") return "$" + val.toLocaleString("en-US", { maximumFractionDigits: 1 }) + " billion";
  if (unit === "millions $") return "$" + val.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " million";
  if (unit === "thousands") return val.toLocaleString("en-US", { maximumFractionDigits: 0 }) + " thousand";
  return val.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " " + unit;
}

function formatDateHuman(dateStr: string, freq: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  if (freq === "daily" || freq === "weekly") {
    return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }
  if (freq === "quarterly") {
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    return `Q${q} ${d.getUTCFullYear()}`;
  }
  // monthly
  return `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function changePeriodLabel(freq: string): string {
  if (freq === "daily") return "the previous day";
  if (freq === "weekly") return "the previous week";
  if (freq === "monthly") return "the previous month";
  if (freq === "quarterly") return "the previous quarter";
  return "the prior period";
}

function buildTitle(series: FredSeries, dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  if (series.freq === "daily" || series.freq === "weekly") {
    return `${series.name} ${dateStr}`;
  }
  if (series.freq === "quarterly") {
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    return `${series.name} Q${q} ${d.getUTCFullYear()}`;
  }
  return `${series.name} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// ---------- FRED API ----------

interface FredObservation {
  date: string;
  value: string;
}

// Track request timestamps for rate limiting (120/min)
const requestTimestamps: number[] = [];

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  // Remove timestamps older than 60s
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - 60000) {
    requestTimestamps.shift();
  }
  // If at 115 requests in the last minute, wait
  if (requestTimestamps.length >= 115) {
    const waitUntil = requestTimestamps[0] + 60000;
    const waitMs = waitUntil - now + 500;
    console.log(`  Rate limit approaching, waiting ${(waitMs / 1000).toFixed(1)}s...`);
    await delay(waitMs);
  }
  requestTimestamps.push(Date.now());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);
  return res;
}

async function fetchFredSeries(seriesId: string): Promise<FredObservation[]> {
  const url =
    `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}` +
    `&api_key=${FRED_KEY}&file_type=json&observation_start=1900-01-01&observation_end=2026-12-31`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await rateLimitedFetch(url);
      if (res.ok) {
        const data = await res.json();
        if (!data.observations || !Array.isArray(data.observations)) {
          console.error(`  Unexpected response shape for ${seriesId}`);
          return [];
        }
        return data.observations;
      }
      if (res.status >= 500 && attempt < 2) {
        console.log(`  FRED 5xx error, retry ${attempt + 1}/3...`);
        await delay((attempt + 1) * 5000);
        continue;
      }
      // 4xx — don't retry per rules
      const text = await res.text();
      console.error(`  FRED error ${res.status} for ${seriesId}: ${text}`);
      return [];
    } catch (err) {
      if (attempt < 2) {
        console.log(`  FRED fetch error, retry ${attempt + 1}/3...`);
        await delay((attempt + 1) * 5000);
        continue;
      }
      console.error(`  FRED fetch failed for ${seriesId}: ${err}`);
      return [];
    }
  }
  return [];
}

// ---------- Narrative Builder ----------

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  state_abbr: null;
  effective_date: string;
  metadata: Record<string, unknown>;
  embedText: string;
}

function buildNarrative(
  series: FredSeries,
  dateStr: string,
  value: number,
  prevValue: number | null,
): string {
  const dateHuman = formatDateHuman(dateStr, series.freq);
  const valFormatted = formatNumber(value, series.unit);

  // Special case: recession indicator
  if (series.id === "USREC") {
    const inRecession = value === 1;
    if (inRecession) {
      return `As of ${dateHuman}, the United States was officially in a recession according to NBER dating.`;
    }
    return `As of ${dateHuman}, the US economy was not in a recession according to NBER dating.`;
  }

  let narrative = "";

  if (series.freq === "daily" || series.freq === "weekly") {
    // "On [date], the [name] was at [value]"
    narrative = `On ${dateHuman}, the ${series.name} was at ${valFormatted}`;
  } else if (series.freq === "quarterly") {
    narrative = `In ${dateHuman}, ${series.name} was ${valFormatted}`;
  } else {
    narrative = `In ${dateHuman}, the ${series.name} was ${valFormatted}`;
  }

  // Add change context
  if (prevValue !== null && !isNaN(prevValue)) {
    const prevFormatted = formatNumber(prevValue, series.unit);
    const periodLabel = changePeriodLabel(series.freq);

    if (value > prevValue) {
      const pctChange = ((value - prevValue) / Math.abs(prevValue)) * 100;
      if (Math.abs(prevValue) > 0.001) {
        narrative += `, up from ${prevFormatted} ${periodLabel} — a ${pctChange.toFixed(1)}% increase`;
      } else {
        narrative += `, up from ${prevFormatted} ${periodLabel}`;
      }
    } else if (value < prevValue) {
      const pctChange = ((prevValue - value) / Math.abs(prevValue)) * 100;
      if (Math.abs(prevValue) > 0.001) {
        narrative += `, down from ${prevFormatted} ${periodLabel} — a ${pctChange.toFixed(1)}% decline`;
      } else {
        narrative += `, down from ${prevFormatted} ${periodLabel}`;
      }
    } else {
      narrative += `, unchanged from ${periodLabel}`;
    }
  }

  narrative += ".";
  return narrative;
}

function buildEntries(
  series: FredSeries,
  observations: FredObservation[],
): PreparedEntry[] {
  // Filter out missing values (FRED uses "." for missing)
  const valid = observations.filter(
    (o) => o.value !== "." && o.value.trim() !== "" && !isNaN(parseFloat(o.value)),
  );

  // Sort by date ascending
  valid.sort((a, b) => a.date.localeCompare(b.date));

  const entries: PreparedEntry[] = [];

  for (let i = 0; i < valid.length; i++) {
    const obs = valid[i];
    const value = parseFloat(obs.value);
    const prevValue = i > 0 ? parseFloat(valid[i - 1].value) : null;

    const title = buildTitle(series, obs.date);
    const narrative = buildNarrative(series, obs.date, value, prevValue);

    const tags = [
      series.category,
      series.id.toLowerCase(),
      "economic",
      "financial",
      series.freq,
    ];

    entries.push({
      title,
      content: narrative,
      content_type: "economic-indicator",
      tags,
      state_abbr: null,
      effective_date: obs.date,
      metadata: {
        source: "fred",
        series_id: series.id,
        series_name: series.name,
        value,
        unit: series.unit,
        frequency: series.freq,
        category: series.category,
      },
      embedText: narrative,
    });
  }

  return entries;
}

// ---------- Embedding (same pattern as storm-events) ----------

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
        if (res.status >= 500 && attempt < 2) {
          console.log(`    Insert retry ${attempt + 1}/3...`);
          await delay(5000);
          continue;
        }
        const text = await res.text();
        console.error(`    Insert failed: ${res.status} ${text}`);
        break; // Don't retry 4xx
      } catch (err) {
        if (attempt < 2) {
          await delay(5000);
          continue;
        }
        console.error(`    Insert fetch failed after retries: ${err}`);
      }
    }
  }
}

// ---------- Process entries (embed + insert) ----------

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
      species: null,
      effective_date: e.effective_date,
      metadata: e.metadata,
      embedding: JSON.stringify(embeddings[idx]),
    }));

    await insertBatch(rows);
    inserted += rows.length;

    // Progress indicator every 500 entries
    if (inserted % 500 < 20) {
      process.stdout.write(`    ${inserted} embedded...  \r`);
    }

    // Pause between embed batches
    await delay(300);
  }

  return inserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== FRED Economic Data Backfill ===");
  console.log(`Series: ${FRED_SERIES.length}`);
  if (START_SERIES > 0) {
    console.log(`Resuming from series index ${START_SERIES}`);
  }
  console.log("");

  let totalInserted = 0;

  for (let i = START_SERIES; i < FRED_SERIES.length; i++) {
    const series = FRED_SERIES[i];
    console.log(
      `[${i + 1}/${FRED_SERIES.length}] ${series.id} (${series.name})`,
    );

    // Fetch all observations
    const observations = await fetchFredSeries(series.id);
    if (observations.length === 0) {
      console.log("  No observations returned, skipping");
      continue;
    }

    // Build entries with narratives
    const entries = buildEntries(series, observations);
    if (entries.length === 0) {
      console.log("  No valid observations after filtering, skipping");
      continue;
    }

    // Date range
    const firstDate = entries[0].effective_date;
    const lastDate = entries[entries.length - 1].effective_date;
    console.log(
      `  ${entries.length} observations — ${firstDate} to ${lastDate}`,
    );

    // Embed + insert
    try {
      const inserted = await processEntries(entries);
      totalInserted += inserted;
      console.log(`  ${inserted} embedded and inserted`);
    } catch (err) {
      console.error(`  embed/insert failed (continuing): ${err}`);
    }

    // Brief pause between series (FRED rate limit is generous but be polite)
    await delay(1000);
  }

  console.log(`\n=== Done! Total: ${totalInserted.toLocaleString()} entries inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
