/**
 * Backfill NOAA Storm Events data into hunt_knowledge
 * Downloads gzipped CSV files from NCEI for each year (1990-2025),
 * filters to hunting-relevant event types, embeds via Voyage AI,
 * and upserts into hunt_knowledge.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-storm-events.ts
 *
 * Resume support:
 *   START_YEAR=2005  — skip years before 2005
 */

import { gunzipSync } from "node:zlib";

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

const NCEI_BASE = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/";

const HUNTING_EVENT_TYPES = new Set([
  "Tornado",
  "Hail",
  "Thunderstorm Wind",
  "Flash Flood",
  "Flood",
  "Winter Storm",
  "Blizzard",
  "Heavy Snow",
  "Ice Storm",
  "Cold/Wind Chill",
  "Extreme Cold/Wind Chill",
  "Heat",
  "Excessive Heat",
  "Drought",
  "Hurricane",
  "Hurricane (Typhoon)",
  "Tropical Storm",
  "Wildfire",
]);

const STATE_NAME_TO_ABBR: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR",
  CALIFORNIA: "CA", COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE",
  FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID",
  ILLINOIS: "IL", INDIANA: "IN", IOWA: "IA", KANSAS: "KS",
  KENTUCKY: "KY", LOUISIANA: "LA", MAINE: "ME", MARYLAND: "MD",
  MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN", MISSISSIPPI: "MS",
  MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM",
  "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND",
  OHIO: "OH", OKLAHOMA: "OK", OREGON: "OR", PENNSYLVANIA: "PA",
  "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD",
  TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT",
  VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV",
  WISCONSIN: "WI", WYOMING: "WY",
  "PUERTO RICO": "PR", "VIRGIN ISLANDS": "VI", GUAM: "GU",
  "AMERICAN SAMOA": "AS",
};

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseDamage(val: string | undefined): string | null {
  if (!val || val.trim() === "") return null;
  const cleaned = val.trim().toUpperCase();
  // NCEI uses suffixes: K=thousands, M=millions, B=billions
  const match = cleaned.match(/^([\d.]+)([KMB])?$/);
  if (!match) return cleaned;
  const num = parseFloat(match[1]);
  const suffix = match[2];
  if (suffix === "K") return `${num}K`;
  if (suffix === "M") return `${num}M`;
  if (suffix === "B") return `${num}B`;
  return `${num}`;
}

function parseDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  // Format: "22-MAY-11 17:45:00" or "1/1/2011 00:00" or various others
  // Try ISO-like parse first
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split("T")[0];
  }
  // Try DD-MON-YY format
  const match = dateStr.match(/(\d{1,2})-([A-Z]{3})-(\d{2,4})\s/i);
  if (match) {
    const day = match[1].padStart(2, "0");
    const months: Record<string, string> = {
      JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
      JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
    };
    const mon = months[match[2].toUpperCase()] || "01";
    let yr = parseInt(match[3], 10);
    if (yr < 100) yr += yr < 50 ? 2000 : 1900;
    return `${yr}-${mon}-${day}`;
  }
  return null;
}

// ---------- CSV Parsing ----------

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

interface StormEvent {
  beginDate: string;
  state: string;
  stateAbbr: string;
  eventType: string;
  czName: string;
  magnitude: string | null;
  injuries: number;
  deaths: number;
  propertyDamage: string | null;
  cropDamage: string | null;
  lat: number | null;
  lng: number | null;
  episodeNarrative: string;
  eventNarrative: string;
}

function parseCSV(csvText: string): StormEvent[] {
  const lines = csvText.split("\n");
  if (lines.length < 2) return [];

  // Find header indices
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine).map((h) => h.trim().toUpperCase());

  const idx = (name: string) => headers.indexOf(name);
  const iBeginDate = idx("BEGIN_DATE_TIME");
  const iState = idx("STATE");
  const iEventType = idx("EVENT_TYPE");
  const iCzName = idx("CZ_NAME");
  const iMagnitude = idx("MAGNITUDE");
  const iTorFScale = idx("TOR_F_SCALE");
  const iInjuries = idx("INJURIES_DIRECT");
  const iDeaths = idx("DEATHS_DIRECT");
  const iDamageProp = idx("DAMAGE_PROPERTY");
  const iDamageCrop = idx("DAMAGE_CROPS");
  const iBeginLat = idx("BEGIN_LAT");
  const iBeginLon = idx("BEGIN_LON");
  const iEpisodeNarr = idx("EPISODE_NARRATIVE");
  const iEventNarr = idx("EVENT_NARRATIVE");

  if (iBeginDate === -1 || iState === -1 || iEventType === -1) {
    console.warn("  CSV missing required columns, skipping");
    return [];
  }

  const events: StormEvent[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    const eventType = fields[iEventType]?.trim() || "";

    if (!HUNTING_EVENT_TYPES.has(eventType)) continue;

    const stateName = (fields[iState]?.trim() || "").toUpperCase();
    const stateAbbr = STATE_NAME_TO_ABBR[stateName];
    if (!stateAbbr) continue; // Skip territories we don't track

    const beginDate = parseDate(fields[iBeginDate]);
    if (!beginDate) continue;

    // Magnitude: use TOR_F_SCALE for tornadoes, MAGNITUDE for others
    let magnitude: string | null = null;
    if (eventType === "Tornado" && iTorFScale !== -1) {
      magnitude = fields[iTorFScale]?.trim() || null;
    } else if (iMagnitude !== -1) {
      const mag = fields[iMagnitude]?.trim();
      if (mag && mag !== "0" && mag !== "") magnitude = mag;
    }

    const injuries =
      iInjuries !== -1 ? parseInt(fields[iInjuries] || "0", 10) || 0 : 0;
    const deaths =
      iDeaths !== -1 ? parseInt(fields[iDeaths] || "0", 10) || 0 : 0;

    const propertyDamage =
      iDamageProp !== -1 ? parseDamage(fields[iDamageProp]) : null;
    const cropDamage =
      iDamageCrop !== -1 ? parseDamage(fields[iDamageCrop]) : null;

    const lat =
      iBeginLat !== -1 ? parseFloat(fields[iBeginLat] || "") || null : null;
    const lng =
      iBeginLon !== -1 ? parseFloat(fields[iBeginLon] || "") || null : null;

    const episodeNarrative =
      iEpisodeNarr !== -1 ? (fields[iEpisodeNarr]?.trim() || "") : "";
    const eventNarrative =
      iEventNarr !== -1 ? (fields[iEventNarr]?.trim() || "") : "";

    events.push({
      beginDate,
      state: stateName,
      stateAbbr,
      eventType,
      czName: fields[iCzName]?.trim() || "",
      magnitude,
      injuries,
      deaths,
      propertyDamage,
      cropDamage,
      lat,
      lng,
      episodeNarrative,
      eventNarrative,
    });
  }

  return events;
}

// ---------- Directory Listing ----------

async function findFileForYear(year: number): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const res = await fetch(NCEI_BASE, { signal: controller.signal });
  clearTimeout(timeout);

  if (!res.ok) {
    throw new Error(`Failed to fetch directory listing: ${res.status}`);
  }

  const html = await res.text();

  // Look for StormEvents_details files matching the year
  const pattern = new RegExp(
    `StormEvents_details-ftp_v1\\.0_d${year}_c\\d+\\.csv\\.gz`,
    "g",
  );
  const matches = html.match(pattern);

  if (!matches || matches.length === 0) return null;

  // Take the latest version (highest c-date)
  matches.sort();
  return matches[matches.length - 1];
}

// ---------- Download and decompress ----------

async function downloadAndDecompress(filename: string): Promise<string> {
  const url = `${NCEI_BASE}${filename}`;
  console.log(`  Downloading ${filename}...`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout

  const res = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);

  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const decompressed = gunzipSync(buffer);
  return decompressed.toString("utf-8");
}

// ---------- Build hunt_knowledge entries ----------

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

function buildEntry(event: StormEvent): PreparedEntry {
  const magStr = event.magnitude ? ` ${event.magnitude}` : "";
  const title = `${event.eventType}${magStr} ${event.czName} ${event.stateAbbr} ${event.beginDate}`;

  // Build narrative (truncate to 500 chars)
  let narrative = event.eventNarrative || event.episodeNarrative || "";
  if (narrative.length > 500) narrative = narrative.slice(0, 500);

  const parts = [
    `storm-event`,
    event.stateAbbr,
    event.beginDate,
    `type:${event.eventType}`,
  ];
  if (event.magnitude) parts.push(`magnitude:${event.magnitude}`);
  if (event.injuries > 0) parts.push(`injuries:${event.injuries}`);
  if (event.deaths > 0) parts.push(`deaths:${event.deaths}`);
  if (event.propertyDamage) parts.push(`property_damage:${event.propertyDamage}`);
  if (event.cropDamage) parts.push(`crop_damage:${event.cropDamage}`);
  if (narrative) parts.push(`narrative:${narrative}`);

  const content = parts.join(" | ");

  // Tags
  const tags: string[] = [event.stateAbbr, event.eventType.toLowerCase().replace(/\s+/g, "-"), "severe-weather"];
  if (event.magnitude) tags.push(event.magnitude.toLowerCase());

  return {
    title,
    content,
    content_type: "storm-event",
    tags,
    state_abbr: event.stateAbbr,
    species: null,
    effective_date: event.beginDate,
    metadata: {
      source: "ncei-storm-events",
      event_type: event.eventType,
      magnitude: event.magnitude,
      injuries: event.injuries,
      deaths: event.deaths,
      property_damage: event.propertyDamage,
      crop_damage: event.cropDamage,
      lat: event.lat,
      lng: event.lng,
      county: event.czName,
    },
    embedText: content,
  };
}

// ---------- Embedding (same pattern as usgs-water) ----------

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
  const startYear = START_YEAR || 1990;
  const endYear = 2025;

  console.log("=== NOAA Storm Events Backfill ===");
  console.log(`Years: ${startYear} to ${endYear}`);

  // Fetch directory listing once
  console.log("Fetching NCEI directory listing...");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const dirRes = await fetch(NCEI_BASE, { signal: controller.signal });
  clearTimeout(timeout);

  if (!dirRes.ok) {
    throw new Error(`Failed to fetch directory listing: ${dirRes.status}`);
  }

  const dirHtml = await dirRes.text();

  let totalInserted = 0;

  for (let year = startYear; year <= endYear; year++) {
    console.log(`\n--- ${year} ---`);

    // Find the details file for this year
    const pattern = new RegExp(
      `StormEvents_details-ftp_v1\\.0_d${year}_c\\d+\\.csv\\.gz`,
      "g",
    );
    const matches = dirHtml.match(pattern);

    if (!matches || matches.length === 0) {
      console.log(`  No file found for ${year}, skipping`);
      continue;
    }

    // Take the latest version
    matches.sort();
    const filename = matches[matches.length - 1];

    // Download and decompress
    let csvText: string;
    try {
      csvText = await downloadAndDecompress(filename);
    } catch (err) {
      console.error(`  Download failed for ${year}: ${err}`);
      continue;
    }

    // Parse and filter
    const events = parseCSV(csvText);
    console.log(`  ${events.length} hunting-relevant events found`);

    if (events.length === 0) continue;

    // Build entries
    const entries = events.map(buildEntry);

    // Embed + insert
    try {
      const inserted = await processEntries(entries);
      totalInserted += inserted;
      console.log(`  ${year}: ${inserted} entries embedded and inserted`);
    } catch (err) {
      console.error(`  ${year}: embed/insert failed (continuing): ${err}`);
    }

    // Rate limit between year downloads
    await delay(1000);
  }

  console.log(`\n=== Done! Total: ${totalInserted} entries inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
