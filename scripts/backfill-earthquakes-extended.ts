/**
 * Backfill USGS earthquake data (EXTENDED) into hunt_knowledge
 * Pulls M2.0+ earthquakes in CONUS from 1950-1989 with NARRATIVE format.
 * Fills the gap before the existing 1990-2026 backfill.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-earthquakes-extended.ts
 *
 * Resume support:
 *   START_YEAR=1965 START_MONTH=06  — skip to June 1965
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
const START_MONTH = process.env.START_MONTH
  ? parseInt(process.env.START_MONTH, 10)
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

// ---------- Month generation (1950-01 to 1989-12) ----------

function generateMonths(): string[] {
  const months: string[] = [];
  const start = new Date(1950, 0, 1);
  const end = new Date(1989, 11, 1); // December 1989
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
    magType: string;
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
  const [y, m] = yearMonth.split("-").map(Number);
  const nextMonth = new Date(y, m, 1);
  const endtime = nextMonth.toISOString().split("T")[0];

  const url =
    `${USGS_BASE}?format=geojson&starttime=${starttime}&endtime=${endtime}` +
    `&minmagnitude=2.0&minlatitude=24.5&maxlatitude=50&minlongitude=-125&maxlongitude=-66.5`;

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

// ---------- Magnitude range tag ----------

function magRangeTag(mag: number): string {
  if (mag >= 6) return "major";
  if (mag >= 5) return "strong";
  if (mag >= 4) return "moderate";
  if (mag >= 3) return "light";
  return "minor";
}

// ---------- Narrative generation ----------

function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function buildNarrative(feature: EarthquakeFeature): string {
  const { mag, place, time, type } = feature.properties;
  const [, , depthKm] = feature.geometry.coordinates;
  const magRounded = Math.round(mag * 10) / 10;
  const depthRounded = Math.round(depthKm * 10) / 10;
  const dateStr = formatDate(time);
  const eventType = type || "earthquake";

  if (mag >= 5) {
    return (
      `A powerful magnitude ${magRounded} earthquake struck ${place} on ${dateStr} ` +
      `at a depth of ${depthRounded} km. The event caused significant ground shaking ` +
      `across the surrounding region. This was a major seismic event that historically ` +
      `would have caused widespread structural damage and disruption.`
    );
  }

  return (
    `A magnitude ${magRounded} earthquake struck ${place} on ${dateStr} ` +
    `at a depth of ${depthRounded} km. The event was classified as ${
      eventType === "earthquake" ? "an earthquake" : `a ${eventType}`
    } by the USGS. Earthquakes of this magnitude can be felt over a wide area ` +
    `and may cause minor damage near the epicenter.`
  );
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
  const { mag, place, time, type, felt, magType } = feature.properties;
  const [lng, lat, depthKm] = feature.geometry.coordinates;

  if (!place) return null;

  const stateAbbr = extractStateAbbr(place);
  if (!stateAbbr) return null;

  const eventDate = new Date(time).toISOString().split("T")[0];
  const depthRounded = Math.round(depthKm * 10) / 10;
  const magRounded = Math.round(mag * 10) / 10;

  // Extract short place name for title (before the comma)
  const commaIdx = place.lastIndexOf(",");
  const shortPlace = commaIdx !== -1 ? place.slice(0, commaIdx).trim() : place;
  // Further simplify: remove "X km direction of " prefix
  const ofIdx = shortPlace.lastIndexOf(" of ");
  const locationName = ofIdx !== -1 ? shortPlace.slice(ofIdx + 4) : shortPlace;

  const title = `M${magRounded} Earthquake ${locationName} ${stateAbbr} ${eventDate}`;
  const narrative = buildNarrative(feature);

  return {
    title,
    content: narrative,
    content_type: "earthquake-historical",
    tags: [stateAbbr, "earthquake", "seismic", magRangeTag(mag)],
    state_abbr: stateAbbr,
    species: null,
    effective_date: eventDate,
    metadata: {
      source: "usgs-earthquake-catalog",
      magnitude: magRounded,
      depth_km: depthRounded,
      place,
      lat,
      lng,
      mag_type: magType || null,
      event_type: type,
      ...(felt != null ? { felt_count: felt } : {}),
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
  console.log("=== USGS Earthquake Extended Backfill (1950-1989) ===");
  console.log("Magnitude: M2.0+ | CONUS only\n");
  if (START_YEAR) {
    const monthStr = START_MONTH ? `-${String(START_MONTH).padStart(2, "0")}` : "";
    console.log(`Resuming from: ${START_YEAR}${monthStr}\n`);
  }

  const allMonths = generateMonths();
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const month of allMonths) {
    const [yearStr, monthStr] = month.split("-");
    const year = parseInt(yearStr, 10);
    const mo = parseInt(monthStr, 10);

    // Resume support: skip months before START_YEAR/START_MONTH
    if (START_YEAR) {
      if (year < START_YEAR) continue;
      if (year === START_YEAR && START_MONTH && mo < START_MONTH) continue;
    }

    // Rate limit: 1000ms between monthly USGS queries
    await delay(1000);

    let features: EarthquakeFeature[];
    try {
      features = await fetchEarthquakes(month);
    } catch (err) {
      console.error(`  ${month}: USGS fetch failed: ${err}`);
      continue;
    }

    if (features.length === 0) {
      console.log(`  ${month}: 0 earthquakes`);
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
      console.log(`  ${month}: ${features.length} earthquakes -> 0 in US states (${skipped} non-US skipped)`);
      continue;
    }

    // Embed + insert
    try {
      const inserted = await processEntries(entries);
      totalInserted += inserted;
      console.log(
        `  ${month}: ${features.length} earthquakes -> ${inserted} embedded (${skipped} non-US skipped)`,
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
