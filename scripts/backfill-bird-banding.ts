/**
 * Backfill USGS Bird Banding Laboratory encounter data into hunt_knowledge
 * Reads local CSV/TSV downloaded from ScienceBase:
 *   https://www.sciencebase.gov/catalog/item/632b2d7bd34e71c6d67bc161
 *
 * Usage:
 *   DATA_PATH=./data/bbl-encounters.csv SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-bird-banding.ts
 *   DELIMITER='\t' DATA_PATH=./data/bbl-encounters.tsv npx tsx scripts/backfill-bird-banding.ts
 *   START_LINE=5000 npx tsx scripts/backfill-bird-banding.ts  # resume from line 5000
 */

import { createReadStream } from "fs";
import { createInterface } from "readline";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY!;
const DATA_PATH = process.env.DATA_PATH || "./data/bbl-encounters.csv";
const DELIMITER = process.env.DELIMITER || ",";
const START_LINE = parseInt(process.env.START_LINE || "0", 10);

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) { console.error("VOYAGE_API_KEY required"); process.exit(1); }

// ---------------------------------------------------------------------------
// US state abbreviations for filtering
// ---------------------------------------------------------------------------

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC",
]);

// ---------------------------------------------------------------------------
// Target species filter — waterfowl + game species
// ---------------------------------------------------------------------------

const TARGET_SPECIES: Record<string, string> = {
  "mallard": "duck",
  "northern pintail": "duck",
  "pintail": "duck",
  "green-winged teal": "duck",
  "blue-winged teal": "duck",
  "cinnamon teal": "duck",
  "american wigeon": "duck",
  "wigeon": "duck",
  "gadwall": "duck",
  "canvasback": "duck",
  "redhead": "duck",
  "greater scaup": "duck",
  "lesser scaup": "duck",
  "scaup": "duck",
  "wood duck": "duck",
  "american black duck": "duck",
  "black duck": "duck",
  "ring-necked duck": "duck",
  "bufflehead": "duck",
  "common goldeneye": "duck",
  "hooded merganser": "duck",
  "common merganser": "duck",
  "red-breasted merganser": "duck",
  "ruddy duck": "duck",
  "northern shoveler": "duck",
  "long-tailed duck": "duck",
  "mottled duck": "duck",
  "canada goose": "goose",
  "cackling goose": "goose",
  "snow goose": "goose",
  "ross's goose": "goose",
  "greater white-fronted goose": "goose",
  "white-fronted goose": "goose",
  "brant": "goose",
  "mourning dove": "dove",
  "white-winged dove": "dove",
  "wild turkey": "turkey",
  "eastern wild turkey": "turkey",
};

// ---------------------------------------------------------------------------
// Haversine distance (km)
// ---------------------------------------------------------------------------

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ---------------------------------------------------------------------------
// Days between two date strings
// ---------------------------------------------------------------------------

function daysBetween(d1: string, d2: string): number | null {
  const t1 = Date.parse(d1);
  const t2 = Date.parse(d2);
  if (isNaN(t1) || isNaN(t2)) return null;
  return Math.round(Math.abs(t2 - t1) / (1000 * 60 * 60 * 24));
}

// ---------------------------------------------------------------------------
// Map species name to our category
// ---------------------------------------------------------------------------

function mapSpecies(speciesName: string): string | null {
  const lower = speciesName.toLowerCase().trim();
  // Direct match
  if (TARGET_SPECIES[lower]) return TARGET_SPECIES[lower];
  // Partial match — check if any target key is contained in the species name
  for (const [key, value] of Object.entries(TARGET_SPECIES)) {
    if (lower.includes(key)) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Check if species is in our target list
// ---------------------------------------------------------------------------

function isTargetSpecies(speciesName: string): boolean {
  return mapSpecies(speciesName) !== null;
}

// ---------------------------------------------------------------------------
// Voyage AI batch embedding (direct, 20 at a time)
// ---------------------------------------------------------------------------

async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += 20) {
    const chunk = texts.slice(i, i + 20);
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VOYAGE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "voyage-3-lite",
        input: chunk,
        input_type: "document",
      }),
    });
    if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const item of data.data) results.push(item.embedding);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Upsert batch into hunt_knowledge via REST API
// ---------------------------------------------------------------------------

async function upsertBatch(
  entries: Array<{ text: string; meta: Record<string, any> }>
): Promise<number> {
  if (entries.length === 0) return 0;

  const texts = entries.map((e) => e.text);
  const embeddings = await embedBatch(texts);
  const rows = entries.map((e, i) => ({
    ...e.meta,
    embedding: JSON.stringify(embeddings[i]),
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      console.error(`  Upsert error: ${res.status} ${await res.text()}`);
    } else {
      upserted += chunk.length;
    }
  }
  return upserted;
}

// ---------------------------------------------------------------------------
// Parse a single CSV/TSV row (handles quoted fields)
// ---------------------------------------------------------------------------

function parseRow(line: string, delimiter: string): string[] {
  if (delimiter === "\t") return line.split("\t");

  // Handle quoted CSV fields
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let totalEmbedded = 0;
  let totalSkipped = 0;
  let totalFiltered = 0;
  let totalErrors = 0;
  let lineNum = 0;

  console.log(`BBL Encounter Backfill`);
  console.log(`  File: ${DATA_PATH}`);
  console.log(`  Delimiter: ${DELIMITER === "\t" ? "TAB" : DELIMITER}`);
  console.log(`  Start line: ${START_LINE}`);
  console.log("---");

  const rl = createInterface({
    input: createReadStream(DATA_PATH),
    crlfDelay: Infinity,
  });

  let headers: string[] = [];
  let headerMap: Record<string, number> = {};

  const batch: Array<{ text: string; meta: Record<string, any> }> = [];

  for await (const line of rl) {
    lineNum++;

    // First line is headers
    if (lineNum === 1) {
      headers = parseRow(line, DELIMITER).map((h) => h.toUpperCase().replace(/"/g, ""));
      headerMap = {};
      headers.forEach((h, i) => { headerMap[h] = i; });

      // Verify required columns exist
      const required = [
        "SPECIES_NAME", "BANDING_DATE", "BANDING_LAT", "BANDING_LON",
        "ENCOUNTER_DATE", "ENCOUNTER_LAT", "ENCOUNTER_LON",
      ];
      const missing = required.filter((r) => headerMap[r] === undefined);
      if (missing.length > 0) {
        // Try alternate column names
        const altNames: Record<string, string[]> = {
          "SPECIES_NAME": ["SPECIES_NAME", "COMMON_NAME", "SPECIES"],
          "BANDING_DATE": ["BANDING_DATE", "B_DATE", "BAND_DATE"],
          "BANDING_LAT": ["BANDING_LAT", "B_LAT", "BAND_LAT"],
          "BANDING_LON": ["BANDING_LON", "B_LON", "BAND_LON", "BANDING_LONG"],
          "ENCOUNTER_DATE": ["ENCOUNTER_DATE", "E_DATE", "ENC_DATE"],
          "ENCOUNTER_LAT": ["ENCOUNTER_LAT", "E_LAT", "ENC_LAT"],
          "ENCOUNTER_LON": ["ENCOUNTER_LON", "E_LON", "ENC_LON", "ENCOUNTER_LONG"],
        };
        for (const [canonical, alts] of Object.entries(altNames)) {
          if (headerMap[canonical] === undefined) {
            for (const alt of alts) {
              if (headerMap[alt] !== undefined) {
                headerMap[canonical] = headerMap[alt];
                break;
              }
            }
          }
        }
        const stillMissing = required.filter((r) => headerMap[r] === undefined);
        if (stillMissing.length > 0) {
          console.error(`Missing required columns: ${stillMissing.join(", ")}`);
          console.error(`Available columns: ${headers.join(", ")}`);
          process.exit(1);
        }
      }

      console.log(`Headers found: ${headers.length} columns`);
      console.log(`Columns: ${headers.join(", ")}`);
      continue;
    }

    // Resume support
    if (lineNum <= START_LINE) continue;

    // Skip empty lines
    if (!line.trim()) continue;

    const fields = parseRow(line, DELIMITER);

    // Helper to get field by column name
    const get = (col: string): string => {
      const idx = headerMap[col];
      return idx !== undefined && idx < fields.length ? fields[idx].replace(/"/g, "").trim() : "";
    };

    const speciesName = get("SPECIES_NAME");
    const bandNum = get("BAND_NUM") || get("BAND_NUMBER") || "";
    const speciesId = get("SPECIES_ID") || get("SPECIES_NUMBER") || "";
    const bandingDate = get("BANDING_DATE");
    const bandingLat = parseFloat(get("BANDING_LAT"));
    const bandingLon = parseFloat(get("BANDING_LON"));
    const bandingState = get("BANDING_STATE") || get("B_STATE") || "";
    const encounterDate = get("ENCOUNTER_DATE");
    const encounterLat = parseFloat(get("ENCOUNTER_LAT"));
    const encounterLon = parseFloat(get("ENCOUNTER_LON"));
    const encounterState = get("ENCOUNTER_STATE") || get("E_STATE") || "";
    const howObtained = get("HOW_OBTAINED") || get("HOW_OBT") || "";

    // --- Filters ---

    // Must be a target species
    if (!isTargetSpecies(speciesName)) {
      totalFiltered++;
      continue;
    }

    // Both states must be US
    const bStateUpper = bandingState.toUpperCase();
    const eStateUpper = encounterState.toUpperCase();
    if (!US_STATES.has(bStateUpper) || !US_STATES.has(eStateUpper)) {
      totalFiltered++;
      continue;
    }

    // Must have valid coordinates
    if (isNaN(bandingLat) || isNaN(bandingLon) || isNaN(encounterLat) || isNaN(encounterLon)) {
      totalSkipped++;
      continue;
    }

    // Must have coordinates (not zero)
    if (bandingLat === 0 && bandingLon === 0) { totalSkipped++; continue; }
    if (encounterLat === 0 && encounterLon === 0) { totalSkipped++; continue; }

    // Calculate distance
    const distanceKm = Math.round(haversineKm(bandingLat, bandingLon, encounterLat, encounterLon));

    // Skip local recaptures (< 10km)
    if (distanceKm < 10) {
      totalFiltered++;
      continue;
    }

    // Calculate days elapsed
    const daysElapsed = daysBetween(bandingDate, encounterDate);

    // Map species
    const mappedSpecies = mapSpecies(speciesName);
    const speciesLower = speciesName.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    // Build embed text
    const daysStr = daysElapsed !== null ? `${daysElapsed} days` : "unknown";
    const embedText = `bird-banding-route | ${speciesName} | ${bStateUpper}→${eStateUpper} | ${bandingDate}→${encounterDate} | ${distanceKm}km in ${daysStr}`;

    // Build title
    const title = `BBL: ${speciesName} ${bStateUpper}→${eStateUpper} (${bandingDate})`;

    batch.push({
      text: embedText,
      meta: {
        title,
        content: embedText,
        content_type: "bird-banding-route",
        state_abbr: eStateUpper,
        species: mappedSpecies,
        effective_date: bandingDate || null,
        tags: [bStateUpper, eStateUpper, "banding", "migration-route", speciesLower],
        metadata: {
          source: "usgs-bird-banding-lab",
          band_num: bandNum,
          species_id: speciesId,
          species_name: speciesName,
          banding_date: bandingDate,
          banding_lat: bandingLat,
          banding_lon: bandingLon,
          banding_state: bStateUpper,
          encounter_date: encounterDate,
          encounter_lat: encounterLat,
          encounter_lon: encounterLon,
          encounter_state: eStateUpper,
          distance_km: distanceKm,
          days_elapsed: daysElapsed,
          how_obtained: howObtained,
        },
      },
    });

    // Embed/upsert in batches of 20
    if (batch.length >= 20) {
      try {
        const n = await upsertBatch(batch.splice(0, 20));
        totalEmbedded += n;
      } catch (err) {
        console.error(`  Embed/upsert error at line ${lineNum}:`, err);
        totalErrors++;
        batch.splice(0, 20); // drop failed batch, keep going
      }
    }

    // Checkpoint every 500
    if (totalEmbedded > 0 && totalEmbedded % 500 < 20) {
      console.log(
        `[checkpoint] line:${lineNum} | embedded:${totalEmbedded} | filtered:${totalFiltered} | skipped:${totalSkipped} | errors:${totalErrors}`
      );
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    try {
      const n = await upsertBatch(batch);
      totalEmbedded += n;
    } catch (err) {
      console.error(`  Final flush error:`, err);
      totalErrors++;
    }
  }

  console.log("\n===== COMPLETE =====");
  console.log(`Total lines read:  ${lineNum}`);
  console.log(`Total embedded:    ${totalEmbedded}`);
  console.log(`Total filtered:    ${totalFiltered} (non-target species, non-US, local recapture)`);
  console.log(`Total skipped:     ${totalSkipped} (missing coords)`);
  console.log(`Total errors:      ${totalErrors}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
