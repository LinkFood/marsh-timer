/**
 * Backfill USGS earthquake data into hunt_knowledge
 * Pulls M2.5+ earthquakes in CONUS from the USGS Earthquake Catalog API,
 * embeds via Voyage AI, and upserts into hunt_knowledge.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-earthquakes.ts
 *
 * Resume support:
 *   START_YEAR=2015  — skip years before 2015
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

const START_YEAR = process.env.START_YEAR
  ? parseInt(process.env.START_YEAR, 10)
  : null;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

// ---------- State name -> abbreviation mapping ----------

const STATE_NAME_TO_ABBR: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA",
  Colorado: "CO", Connecticut: "CT", Delaware: "DE", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK",
  Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI",
  Wyoming: "WY",
};

function extractStateAbbr(place: string): string | null {
  if (!place) return null;
  // USGS format: "15km NE of Ridgecrest, California"
  const lastComma = place.lastIndexOf(",");
  if (lastComma === -1) return null;
  const statePart = place.slice(lastComma + 1).trim();
  return STATE_NAME_TO_ABBR[statePart] || null;
}

// ---------- Month generation ----------

function generateMonths(): string[] {
  const months: string[] = [];
  const start = new Date(1990, 0, 1);
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

function firstDayOfMonth(yearMonth: string): string {
  return `${yearMonth}-01`;
}

function lastDayOfMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const d = new Date(y, m, 0);
  return d.toISOString().split("T")[0];
}

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- USGS Earthquake API ----------

const USGS_BASE = "https://earthquake.usgs.gov/fdsnws/event/1/query";

interface EarthquakeFeature {
  properties: {
    mag: number;
    place: string;
    time: number;
    type: string;
    felt: number | null;
    tsunami: number;
  };
  geometry: {
    coordinates: [number, number, number]; // [lng, lat, depth_km]
  };
}

interface EarthquakeResponse {
  features: EarthquakeFeature[];
}

async function fetchEarthquakes(yearMonth: string): Promise<EarthquakeFeature[]> {
  const starttime = firstDayOfMonth(yearMonth);
  // endtime is exclusive in USGS API, so use first day of next month
  const [y, m] = yearMonth.split("-").map(Number);
  const nextMonth = new Date(y, m, 1); // m is already 1-indexed, so this is first of next month
  const endtime = nextMonth.toISOString().split("T")[0];

  const url =
    `${USGS_BASE}?format=geojson&starttime=${starttime}&endtime=${endtime}` +
    `&minmagnitude=2.5&minlatitude=24&maxlatitude=50&minlongitude=-125&maxlongitude=-66`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 404) return [];
    if (res.status >= 400 && res.status < 500) {
      throw new Error(`USGS 4xx (not retryable): ${res.status}: ${text.slice(0, 200)}`);
    }
    throw new Error(`USGS ${res.status}: ${text.slice(0, 200)}`);
  }

  const json: EarthquakeResponse = await res.json();
  return json.features || [];
}

// ---------- Magnitude bucket for tags ----------

function magBucket(mag: number): string {
  if (mag >= 7) return "magnitude-7+";
  if (mag >= 6) return "magnitude-6";
  if (mag >= 5) return "magnitude-5";
  if (mag >= 4) return "magnitude-4";
  if (mag >= 3) return "magnitude-3";
  return "magnitude-2";
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

function buildEntry(feature: EarthquakeFeature): PreparedEntry | null {
  const { mag, place, time, type, felt, tsunami } = feature.properties;
  const [lng, lat, depthKm] = feature.geometry.coordinates;

  if (!place) return null;

  const stateAbbr = extractStateAbbr(place);
  if (!stateAbbr) return null;

  const eventDate = new Date(time).toISOString().split("T")[0];
  const depthRounded = Math.round(depthKm * 10) / 10;
  const magRounded = Math.round(mag * 10) / 10;

  const title = `M${magRounded} earthquake ${place} ${eventDate}`;
  const content =
    `earthquake-event | ${stateAbbr} | ${eventDate} | mag:${magRounded}` +
    ` | depth:${depthRounded}km | type:${type} | place:${place}`;

  return {
    title,
    content,
    content_type: "earthquake-event",
    tags: [stateAbbr, "earthquake", "seismic", magBucket(mag)],
    state_abbr: stateAbbr,
    species: null,
    effective_date: eventDate,
    metadata: {
      source: "usgs-comcat",
      magnitude: magRounded,
      depth_km: depthRounded,
      lat,
      lng,
      place,
      event_type: type,
      ...(felt != null ? { felt } : {}),
      tsunami: tsunami === 1,
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
      const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
        method: "POST",
        headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(chunk),
      });
      if (res.ok) break;
      if (attempt < 2) {
        console.log(`  Insert retry ${attempt + 1}/3...`);
        await delay(5000);
        continue;
      }
      const text = await res.text();
      console.error(`  Insert failed after retries: ${text}`);
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

    // Pause between embed batches
    await delay(500);
  }

  return inserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== USGS Earthquake Backfill ===");
  console.log("Range: 1990-01 through 2026-03 | M2.5+ | CONUS");
  if (START_YEAR) console.log(`Resuming from year: ${START_YEAR}`);

  const allMonths = generateMonths();
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const month of allMonths) {
    // Resume support: skip months before START_YEAR
    if (START_YEAR) {
      const year = parseInt(month.split("-")[0], 10);
      if (year < START_YEAR) continue;
    }

    // Rate limit: 500ms between monthly queries
    await delay(500);

    let features: EarthquakeFeature[];
    try {
      features = await fetchEarthquakes(month);
    } catch (err) {
      console.error(`  ${month}: USGS fetch failed: ${err}`);
      continue;
    }

    if (features.length === 0) {
      console.log(`  ${month}: 0 events`);
      continue;
    }

    // Build entries, filtering to US states only
    const entries: PreparedEntry[] = [];
    let skipped = 0;
    for (const f of features) {
      const entry = buildEntry(f);
      if (entry) {
        entries.push(entry);
      } else {
        skipped++;
      }
    }

    totalSkipped += skipped;

    if (entries.length === 0) {
      console.log(`  ${month}: ${features.length} events, 0 in US states (${skipped} skipped)`);
      continue;
    }

    // Embed + insert
    try {
      const inserted = await processEntries(entries);
      totalInserted += inserted;
      console.log(
        `  ${month}: ${features.length} events -> ${inserted} embedded (${skipped} non-US skipped)`,
      );
    } catch (err) {
      console.error(`  ${month}: embed/insert failed (continuing): ${err}`);
    }
  }

  console.log(
    `\n=== Done! Total: ${totalInserted} entries inserted, ${totalSkipped} non-US skipped ===`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
