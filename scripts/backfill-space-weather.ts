/**
 * Backfill space weather (solar wind plasma) into hunt_knowledge
 * Grabs 7-day solar wind data from NOAA SWPC, aggregates into daily summaries,
 * embeds via Voyage AI, and upserts into hunt_knowledge.
 *
 * Run on each deployment to accumulate history over time.
 * The existing kp-index backfill covers geomagnetic history separately.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-space-weather.ts
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const SWPC_PLASMA_URL =
  "https://services.swpc.noaa.gov/products/solar-wind/plasma-7-day.json";
const SWPC_KP_URL =
  "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";

// ---------- Types ----------

interface PlasmaReading {
  timestamp: string; // "YYYY-MM-DD HH:MM:SS.sss"
  density: number | null; // particles/cm³
  speed: number | null; // km/s
  temperature: number | null; // Kelvin
}

interface KpReading {
  timestamp: string;
  kp: number;
}

interface DailySummary {
  date: string; // YYYY-MM-DD
  avgSpeed: number;
  maxSpeed: number;
  minSpeed: number;
  avgDensity: number;
  maxDensity: number;
  avgTemp: number;
  maxKp: number;
  readingCount: number;
  stormLevel: string;
  flags: string[];
}

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function classifyStorm(maxSpeed: number, maxKp: number): string {
  if (maxKp >= 7 || maxSpeed >= 800) return "severe-storm";
  if (maxKp >= 5 || maxSpeed >= 600) return "storm";
  if (maxKp >= 4 || maxSpeed >= 500) return "elevated";
  return "quiet";
}

function buildFlags(maxSpeed: number, maxKp: number): string[] {
  const flags: string[] = [];
  if (maxSpeed >= 800) flags.push("solar wind storm (>800 km/s)");
  else if (maxSpeed >= 600) flags.push("elevated solar wind (>600 km/s)");
  if (maxKp >= 5) flags.push("geomagnetic storm (Kp≥5)");
  return flags;
}

// ---------- Fetch SWPC data ----------

async function fetchPlasma(): Promise<PlasmaReading[]> {
  console.log("Fetching 7-day solar wind plasma from SWPC...");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(SWPC_PLASMA_URL);
    if (res.ok) {
      const raw: string[][] = await res.json();
      // First row is header: ["time_tag","density","speed","temperature"]
      const readings: PlasmaReading[] = [];
      for (let i = 1; i < raw.length; i++) {
        const [ts, densityStr, speedStr, tempStr] = raw[i];
        readings.push({
          timestamp: ts,
          density: densityStr ? parseFloat(densityStr) : null,
          speed: speedStr ? parseFloat(speedStr) : null,
          temperature: tempStr ? parseFloat(tempStr) : null,
        });
      }
      console.log(`  Got ${readings.length} plasma readings`);
      return readings;
    }
    if (res.status >= 500 && attempt < 2) {
      console.log(`  SWPC plasma ${res.status}, retrying...`);
      await delay((attempt + 1) * 5000);
      continue;
    }
    throw new Error(`SWPC plasma error: ${res.status} ${await res.text()}`);
  }
  throw new Error("SWPC plasma: exhausted retries");
}

async function fetchKp(): Promise<KpReading[]> {
  console.log("Fetching recent Kp index from SWPC...");
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(SWPC_KP_URL);
    if (res.ok) {
      const raw: string[][] = await res.json();
      // First row is header: ["time_tag","Kp","Kp_fraction",...]
      const readings: KpReading[] = [];
      for (let i = 1; i < raw.length; i++) {
        const ts = raw[i][0];
        const kp = parseFloat(raw[i][1]);
        if (!isNaN(kp)) {
          readings.push({ timestamp: ts, kp });
        }
      }
      console.log(`  Got ${readings.length} Kp readings`);
      return readings;
    }
    if (res.status >= 500 && attempt < 2) {
      console.log(`  SWPC Kp ${res.status}, retrying...`);
      await delay((attempt + 1) * 5000);
      continue;
    }
    throw new Error(`SWPC Kp error: ${res.status} ${await res.text()}`);
  }
  throw new Error("SWPC Kp: exhausted retries");
}

// ---------- Aggregate to daily ----------

function aggregateDaily(
  plasma: PlasmaReading[],
  kpReadings: KpReading[]
): DailySummary[] {
  // Group plasma by date
  const plasmaByDate = new Map<string, PlasmaReading[]>();
  for (const r of plasma) {
    const date = r.timestamp.substring(0, 10); // YYYY-MM-DD
    if (!plasmaByDate.has(date)) plasmaByDate.set(date, []);
    plasmaByDate.get(date)!.push(r);
  }

  // Group Kp by date
  const kpByDate = new Map<string, number[]>();
  for (const r of kpReadings) {
    const date = r.timestamp.substring(0, 10);
    if (!kpByDate.has(date)) kpByDate.set(date, []);
    kpByDate.get(date)!.push(r.kp);
  }

  const summaries: DailySummary[] = [];

  for (const [date, readings] of plasmaByDate) {
    const speeds = readings.map((r) => r.speed).filter((v): v is number => v != null && !isNaN(v));
    const densities = readings.map((r) => r.density).filter((v): v is number => v != null && !isNaN(v));
    const temps = readings.map((r) => r.temperature).filter((v): v is number => v != null && !isNaN(v));

    if (speeds.length === 0) continue; // skip days with no valid speed data

    const avgSpeed = round1(speeds.reduce((a, b) => a + b, 0) / speeds.length);
    const maxSpeed = round1(Math.max(...speeds));
    const minSpeed = round1(Math.min(...speeds));
    const avgDensity = densities.length > 0 ? round1(densities.reduce((a, b) => a + b, 0) / densities.length) : 0;
    const maxDensity = densities.length > 0 ? round1(Math.max(...densities)) : 0;
    const avgTemp = temps.length > 0 ? round1(temps.reduce((a, b) => a + b, 0) / temps.length) : 0;

    const dayKp = kpByDate.get(date) || [];
    const maxKp = dayKp.length > 0 ? Math.max(...dayKp) : 0;

    const stormLevel = classifyStorm(maxSpeed, maxKp);
    const flags = buildFlags(maxSpeed, maxKp);

    summaries.push({
      date,
      avgSpeed,
      maxSpeed,
      minSpeed,
      avgDensity,
      maxDensity,
      avgTemp,
      maxKp,
      readingCount: readings.length,
      stormLevel,
      flags,
    });
  }

  // Sort by date
  summaries.sort((a, b) => a.date.localeCompare(b.date));
  return summaries;
}

// ---------- Dedup check ----------

async function getExistingDates(): Promise<Set<string>> {
  const existing = new Set<string>();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.space-weather&select=title`,
    { headers: supaHeaders }
  );
  if (!res.ok) {
    console.error(`  Dedup check failed: ${res.status}`);
    return existing;
  }
  const rows: { title: string }[] = await res.json();
  for (const row of rows) {
    // title format: "space-weather YYYY-MM-DD"
    const match = row.title.match(/\d{4}-\d{2}-\d{2}/);
    if (match) existing.add(match[0]);
  }
  return existing;
}

// ---------- Embedding ----------

async function batchEmbed(texts: string[], retries = 3): Promise<number[][]> {
  if (!VOYAGE_KEY) throw new Error("VOYAGE_API_KEY required for embedding");
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

// ---------- Build entries ----------

function buildEmbedText(d: DailySummary): string {
  let text = `Space weather ${d.date}: solar wind ${d.avgSpeed} km/s (max: ${d.maxSpeed}), density ${d.avgDensity}/cm³, Kp max ${d.maxKp} (${d.stormLevel}).`;
  if (d.flags.length > 0) {
    text += ` ${d.flags.join(". ")}.`;
  }
  return text;
}

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  species: null;
  state_abbr: null;
  effective_date: string;
  metadata: Record<string, unknown>;
  embedText: string;
}

function buildEntry(d: DailySummary): PreparedEntry {
  const embedText = buildEmbedText(d);
  const tags = ["space-weather", "solar-wind", "noaa-swpc"];
  if (d.stormLevel !== "quiet") tags.push(d.stormLevel);
  if (d.maxKp >= 5) tags.push("geomagnetic-storm");

  return {
    title: `space-weather ${d.date}`,
    content: embedText,
    content_type: "space-weather",
    tags,
    species: null,
    state_abbr: null,
    effective_date: d.date,
    metadata: {
      source: "noaa-swpc",
      avg_speed_kms: d.avgSpeed,
      max_speed_kms: d.maxSpeed,
      min_speed_kms: d.minSpeed,
      avg_density_cm3: d.avgDensity,
      max_density_cm3: d.maxDensity,
      avg_temp_k: d.avgTemp,
      max_kp: d.maxKp,
      storm_level: d.stormLevel,
      flags: d.flags,
      reading_count: d.readingCount,
    },
    embedText,
  };
}

// ---------- Process entries (embed + upsert) ----------

async function processEntries(entries: PreparedEntry[]): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    const texts = batch.map((e) => e.embedText);

    let embeddings: number[][];
    try {
      embeddings = await batchEmbed(texts);
    } catch (err) {
      console.error(`  Embed batch failed, skipping ${batch.length} entries: ${err}`);
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

    await upsertBatch(rows);
    inserted += rows.length;

    for (const e of batch) {
      console.log(`  ${e.effective_date}: inserted`);
    }

    await delay(500);
  }

  return inserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== Space Weather Backfill ===");
  console.log("Source: NOAA SWPC 7-day solar wind plasma + Kp index");

  // Step 1: Fetch data
  const [plasma, kpReadings] = await Promise.all([fetchPlasma(), fetchKp()]);

  // Step 2: Aggregate to daily summaries
  const summaries = aggregateDaily(plasma, kpReadings);
  console.log(`Aggregated to ${summaries.length} daily summaries`);

  if (summaries.length === 0) {
    console.log("No data to process");
    return;
  }

  console.log(`Date range: ${summaries[0].date} to ${summaries[summaries.length - 1].date}`);

  // Step 3: Dedup — skip dates already in hunt_knowledge
  const existingDates = await getExistingDates();
  const newSummaries = summaries.filter((s) => !existingDates.has(s.date));
  console.log(`${existingDates.size} dates already exist, ${newSummaries.length} new to insert`);

  if (newSummaries.length === 0) {
    console.log("All dates already backfilled. Nothing to do.");
    return;
  }

  // Step 4: Build entries
  const entries = newSummaries.map(buildEntry);

  // Step 5: Embed + upsert
  const totalInserted = await processEntries(entries);

  console.log(`\n=== Done! ${totalInserted} space-weather entries inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
