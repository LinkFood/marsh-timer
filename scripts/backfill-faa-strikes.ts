/**
 * Backfill FAA Wildlife Strike data into hunt_knowledge
 * Pulls bird strike incidents from the FAA Wildlife Strike Database,
 * embeds via Voyage AI, and upserts into hunt_knowledge.
 *
 * Data source: FAA Wildlife Strike Database
 *   Primary: POST https://wildlife.faa.gov/api/search (JSON, paginated)
 *   Fallback: If the API doesn't cooperate, see notes at bottom of file.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-faa-strikes.ts
 *
 * Resume support:
 *   START_OFFSET=5000  — skip first N records (for resuming after crash)
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

const START_OFFSET = process.env.START_OFFSET
  ? parseInt(process.env.START_OFFSET, 10)
  : 0;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const FAA_API_URL = "https://wildlife.faa.gov/api/search";
const PAGE_SIZE = 500;

// Map of airport state codes (FAA uses state abbreviations directly in most cases)
const VALID_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
]);

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- FAA API ----------

interface FAAStrike {
  incidentDate: string;
  state: string;
  airportId: string;
  airport: string;
  species: string;
  speciesGroup: string;
  phaseOfFlight: string;
  heightAgl: number | null;
  damage: string;
  aircraftType: string;
  numStruck: number | null;
  remarks: string;
  operator: string;
  engineType: string;
  effectOnFlight: string;
  indicatedDamage: string;
}

interface FAASearchResponse {
  totalResults: number;
  results: FAAStrike[];
}

async function fetchFAAPage(
  offset: number,
  retries = 3,
): Promise<FAASearchResponse | null> {
  const body = {
    includeAirCarrier: true,
    includeGeneralAviation: true,
    speciesGroup: "Birds",
    offset: offset,
    limit: PAGE_SIZE,
  };

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const res = await fetch(FAA_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        return data as FAASearchResponse;
      }

      // Never retry 4xx
      if (res.status >= 400 && res.status < 500) {
        const text = await res.text();
        console.error(`FAA API ${res.status} (not retryable): ${text.slice(0, 300)}`);
        return null;
      }

      // Retry 5xx
      if (res.status >= 500 && attempt < retries - 1) {
        console.log(`  FAA API ${res.status}, retry ${attempt + 1}/${retries}...`);
        await delay((attempt + 1) * 5000);
        continue;
      }

      const text = await res.text();
      console.error(`FAA API error ${res.status}: ${text.slice(0, 300)}`);
      return null;
    } catch (err) {
      if (attempt < retries - 1) {
        console.log(`  FAA API network error, retry ${attempt + 1}/${retries}: ${err}`);
        await delay((attempt + 1) * 10000);
        continue;
      }
      console.error(`FAA API fetch failed after retries: ${err}`);
      return null;
    }
  }
  return null;
}

// ---------- Alternative: Try different API shapes ----------

async function probeAPI(): Promise<"paginated" | "flat" | "failed"> {
  // Try the search endpoint with a small limit
  console.log("Probing FAA API...");

  // Attempt 1: POST with offset/limit
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(FAA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        includeAirCarrier: true,
        includeGeneralAviation: true,
        speciesGroup: "Birds",
        offset: 0,
        limit: 5,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      console.log(`  API probe success. Response keys: ${Object.keys(data).join(", ")}`);
      console.log(`  Sample: ${JSON.stringify(data).slice(0, 500)}`);

      if (data.totalResults !== undefined && Array.isArray(data.results)) {
        console.log(`  Total results available: ${data.totalResults}`);
        return "paginated";
      }
      if (Array.isArray(data)) {
        console.log(`  Flat array response, length: ${data.length}`);
        return "flat";
      }
      // Unknown shape — log it and try to work with it
      console.log(`  Unknown response shape, will attempt to parse`);
      return "paginated"; // optimistic
    }

    console.log(`  API returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  } catch (err) {
    console.log(`  API probe failed: ${err}`);
  }

  // Attempt 2: Try GET with query params
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch(`${FAA_API_URL}?speciesGroup=Birds&limit=5`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      console.log(`  GET probe success. Keys: ${Object.keys(data).join(", ")}`);
      return "flat";
    }
    console.log(`  GET probe returned ${res.status}`);
  } catch (err) {
    console.log(`  GET probe failed: ${err}`);
  }

  return "failed";
}

// ---------- Normalize strike data ----------
// The API field names may vary — handle common shapes

function normalizeStrike(raw: Record<string, unknown>): FAAStrike | null {
  // Try various field name patterns the FAA API might use
  const incidentDate =
    (raw.INCIDENT_DATE as string) ||
    (raw.incidentDate as string) ||
    (raw.incident_date as string) ||
    (raw.INCIDENTDATE as string) ||
    "";
  if (!incidentDate) return null;

  const state =
    (raw.STATE as string) ||
    (raw.state as string) ||
    (raw.AIRPORT_STATE as string) ||
    (raw.airportState as string) ||
    "";

  const airportId =
    (raw.AIRPORT_ID as string) ||
    (raw.airportId as string) ||
    (raw.airport_id as string) ||
    (raw.APTS as string) ||
    "";

  const airport =
    (raw.AIRPORT as string) ||
    (raw.airport as string) ||
    (raw.airportName as string) ||
    airportId;

  const species =
    (raw.SPECIES as string) ||
    (raw.species as string) ||
    (raw.speciesName as string) ||
    (raw.SPECIES_NAME as string) ||
    "Unknown";

  const speciesGroup =
    (raw.SPECIES_GROUP as string) ||
    (raw.speciesGroup as string) ||
    (raw.species_group as string) ||
    "Birds";

  const phaseOfFlight =
    (raw.PHASE_OF_FLIGHT as string) ||
    (raw.phaseOfFlight as string) ||
    (raw.phase_of_flight as string) ||
    "";

  const heightRaw =
    raw.HEIGHT as number | string | null ??
    raw.heightAgl as number | string | null ??
    raw.height_agl as number | string | null ??
    raw.AGL as number | string | null ??
    null;
  const heightAgl = heightRaw !== null && heightRaw !== "" ? Number(heightRaw) || null : null;

  const damage =
    (raw.DAMAGE as string) ||
    (raw.damage as string) ||
    (raw.indicatedDamage as string) ||
    (raw.INDICATED_DAMAGE as string) ||
    "None";

  const aircraftType =
    (raw.AC_CLASS as string) ||
    (raw.aircraftType as string) ||
    (raw.aircraft_type as string) ||
    (raw.AIRCRAFT as string) ||
    "";

  const numStruckRaw =
    raw.NUM_STRUCK as number | string | null ??
    raw.numStruck as number | string | null ??
    null;
  const numStruck = numStruckRaw !== null ? Number(numStruckRaw) || null : null;

  const remarks =
    (raw.REMARKS as string) ||
    (raw.remarks as string) ||
    "";

  const operator =
    (raw.OPERATOR as string) ||
    (raw.operator as string) ||
    "";

  const engineType =
    (raw.ENG_TYPE as string) ||
    (raw.engineType as string) ||
    "";

  const effectOnFlight =
    (raw.EFFECT as string) ||
    (raw.effectOnFlight as string) ||
    (raw.effect_on_flight as string) ||
    "";

  const indicatedDamage =
    (raw.INDICATED_DAMAGE as string) ||
    (raw.indicatedDamage as string) ||
    damage;

  return {
    incidentDate,
    state,
    airportId,
    airport,
    species,
    speciesGroup,
    phaseOfFlight,
    heightAgl,
    damage,
    aircraftType,
    numStruck,
    remarks,
    operator,
    engineType,
    effectOnFlight,
    indicatedDamage,
  };
}

// ---------- Parse date ----------

function parseIncidentDate(dateStr: string): string | null {
  if (!dateStr) return null;
  // Try direct ISO parse
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split("T")[0];
  }
  // Try MM/DD/YYYY
  const slashMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, "0");
    const day = slashMatch[2].padStart(2, "0");
    return `${slashMatch[3]}-${m}-${day}`;
  }
  return null;
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

function buildEntry(strike: FAAStrike): PreparedEntry | null {
  const date = parseIncidentDate(strike.incidentDate);
  if (!date) return null;

  const stateAbbr = strike.state?.toUpperCase().trim() || "";
  if (!VALID_STATES.has(stateAbbr)) return null;

  const speciesClean = (strike.species || "Unknown").trim();
  const airportClean = (strike.airportId || strike.airport || "").trim();
  const phaseClean = (strike.phaseOfFlight || "").trim();
  const heightStr = strike.heightAgl ? `${strike.heightAgl}ft` : "";
  const damageClean = (strike.damage || "None").trim();

  const title = `Bird strike ${speciesClean} ${airportClean} ${date}`;

  const contentParts = [
    "faa-wildlife-strike",
    stateAbbr,
    date,
    `species:${speciesClean}`,
  ];
  if (airportClean) contentParts.push(`airport:${airportClean}`);
  if (phaseClean) contentParts.push(`phase:${phaseClean}`);
  if (heightStr) contentParts.push(`height:${heightStr}`);
  contentParts.push(`damage:${damageClean}`);
  if (strike.remarks) {
    const remarksTrunc = strike.remarks.slice(0, 300);
    contentParts.push(`remarks:${remarksTrunc}`);
  }

  const content = contentParts.join(" | ");

  // Tags
  const tags: string[] = [stateAbbr, "wildlife-strike", "bird"];
  const speciesLower = speciesClean.toLowerCase();
  if (speciesLower && speciesLower !== "unknown") {
    tags.push(speciesLower.replace(/\s+/g, "-"));
  }

  return {
    title,
    content,
    content_type: "faa-wildlife-strike",
    tags,
    state_abbr: stateAbbr,
    species: null,
    effective_date: date,
    metadata: {
      source: "faa-wildlife-strike-db",
      species_name: speciesClean,
      airport: airportClean,
      flight_phase: phaseClean || null,
      height_ft: strike.heightAgl,
      damage_level: damageClean,
      aircraft_type: strike.aircraftType || null,
      num_struck: strike.numStruck,
      operator: strike.operator || null,
      effect_on_flight: strike.effectOnFlight || null,
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
  console.log("=== FAA Wildlife Strike Backfill ===");

  // Probe the API to figure out the response shape
  const apiShape = await probeAPI();

  if (apiShape === "failed") {
    console.error("\nFAA API is not accessible.");
    console.error("Fallback options:");
    console.error("  1. Download CSV from https://wildlife.faa.gov/ (requires browser)");
    console.error("  2. Download Access DB from https://wildlife.faa.gov/downloads/wildlife.accdb");
    console.error("  3. Try again later — the API may be temporarily down");
    console.error("  4. Use a CSV mirror if available");
    console.error("\nIf you have a CSV file, convert this script to read from local file.");
    process.exit(1);
  }

  console.log(`\nAPI shape: ${apiShape}`);
  if (START_OFFSET > 0) console.log(`Resuming from offset: ${START_OFFSET}`);

  let totalInserted = 0;
  let offset = START_OFFSET;
  let totalAvailable = Infinity; // Will be set from first response

  while (offset < totalAvailable) {
    console.log(`\n--- Fetching offset ${offset} (page size ${PAGE_SIZE}) ---`);

    const response = await fetchFAAPage(offset);
    if (!response) {
      console.error(`  Failed to fetch at offset ${offset}, stopping.`);
      break;
    }

    // Set total from first response
    if (totalAvailable === Infinity && response.totalResults !== undefined) {
      totalAvailable = response.totalResults;
      console.log(`Total records available: ${totalAvailable}`);
    }

    const results = Array.isArray(response.results)
      ? response.results
      : Array.isArray(response)
        ? (response as unknown as Record<string, unknown>[])
        : [];

    if (results.length === 0) {
      console.log("  No more results, done.");
      break;
    }

    console.log(`  Got ${results.length} raw records`);

    // Normalize and filter
    const strikes: FAAStrike[] = [];
    for (const raw of results) {
      const normalized = normalizeStrike(raw as Record<string, unknown>);
      if (normalized) strikes.push(normalized);
    }

    // Build entries
    const entries: PreparedEntry[] = [];
    for (const strike of strikes) {
      const entry = buildEntry(strike);
      if (entry) entries.push(entry);
    }

    console.log(`  ${strikes.length} normalized -> ${entries.length} valid entries (with US state + date)`);

    if (entries.length > 0) {
      try {
        const inserted = await processEntries(entries);
        totalInserted += inserted;
        console.log(`  Embedded and inserted: ${inserted} (running total: ${totalInserted})`);
      } catch (err) {
        console.error(`  Process failed at offset ${offset} (continuing): ${err}`);
      }
    }

    offset += results.length;

    // If we got fewer results than page size, we're done
    if (results.length < PAGE_SIZE) {
      console.log("  Received fewer results than page size, done.");
      break;
    }

    // Rate limit between pages
    await delay(2000);
  }

  console.log(`\n=== Done! Total: ${totalInserted} entries inserted ===`);
  console.log(`Final offset: ${offset}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

/*
 * FALLBACK NOTES:
 *
 * If the FAA API at wildlife.faa.gov/api/search doesn't work:
 *
 * Option 1: CSV Download (Manual)
 *   - Go to https://wildlife.faa.gov/
 *   - Use the search form to download CSV
 *   - Save as scripts/faa-strikes.csv
 *   - Modify this script to read from local CSV instead of API
 *
 * Option 2: Access Database
 *   - Download https://wildlife.faa.gov/downloads/wildlife.accdb
 *   - Convert to CSV using mdbtools: mdb-export wildlife.accdb STRIKE_REPORTS > strikes.csv
 *   - Modify this script to read from local CSV
 *
 * Option 3: NTSB Mirror
 *   - FAA strike data is sometimes mirrored by NTSB
 *   - Check https://www.ntsb.gov for wildlife strike datasets
 *
 * To convert to local CSV mode, replace the fetchFAAPage/main loop with:
 *   const csvText = readFileSync("scripts/faa-strikes.csv", "utf-8");
 *   // Parse CSV, normalize, embed, insert
 */
