/**
 * Backfill FAA Wildlife Strike data from local CSV into hunt_knowledge
 *
 * The FAA Wildlife Strike Database has 300K+ records of bird-aircraft strikes
 * since 1990 — essentially an involuntary 24/7 bird census from 500+ airports.
 *
 * Data source: https://wildlife.faa.gov/download (bulk CSV download)
 *
 * Usage:
 *   # First download CSV from https://wildlife.faa.gov/download and save to data/
 *   mkdir -p data
 *   CSV_PATH=./data/faa-wildlife-strikes.csv SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-faa-wildlife-strikes.ts
 *
 * Resume support:
 *   START_LINE=5000  — skip first N data lines (for resuming after crash)
 */

import { readFileSync } from "fs";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY!;
const CSV_PATH = process.env.CSV_PATH || "./data/faa-wildlife-strikes.csv";
const START_LINE = parseInt(process.env.START_LINE || "0", 10);

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
if (!VOYAGE_KEY) {
  console.error("VOYAGE_API_KEY required");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Valid US states
// ---------------------------------------------------------------------------

const VALID_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

// Species to skip — too vague to be useful
const SKIP_SPECIES = new Set([
  "UNKNOWN BIRD",
  "UNKNOWN BIRD - SMALL",
  "UNKNOWN BIRD - MEDIUM",
  "UNKNOWN BIRD - LARGE",
  "UNKNOWN",
  "",
]);

// ---------------------------------------------------------------------------
// CSV parser — handles quoted fields with commas inside
// ---------------------------------------------------------------------------

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

// ---------------------------------------------------------------------------
// Date parser — MM/DD/YYYY or ISO to YYYY-MM-DD
// ---------------------------------------------------------------------------

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;

  // MM/DD/YYYY
  const slashMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, "0");
    const d = slashMatch[2].padStart(2, "0");
    return `${slashMatch[3]}-${m}-${d}`;
  }

  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.slice(0, 10);
  }

  // Try Date parse as last resort
  const parsed = new Date(dateStr);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Voyage AI batch embedding (20 at a time)
// ---------------------------------------------------------------------------

async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += 20) {
    const chunk = texts.slice(i, i + 20);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
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
        if (res.ok) {
          const data = await res.json();
          for (const item of data.data) results.push(item.embedding);
          break;
        }
        if (res.status === 429 && attempt < 2) {
          console.log(`  Voyage 429, waiting ${(attempt + 1) * 30}s...`);
          await delay((attempt + 1) * 30000);
          continue;
        }
        if (res.status >= 500 && attempt < 2) {
          console.log(`  Voyage ${res.status}, retry ${attempt + 1}/3...`);
          await delay((attempt + 1) * 5000);
          continue;
        }
        throw new Error(`Voyage ${res.status}: ${await res.text()}`);
      } catch (err) {
        if (attempt < 2) {
          console.log(`  Voyage network error, retry ${attempt + 1}/3: ${err}`);
          await delay((attempt + 1) * 10000);
          continue;
        }
        throw err;
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Upsert batch into hunt_knowledge via REST API (50 at a time)
// ---------------------------------------------------------------------------

async function upsertBatch(rows: Record<string, unknown>[]): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
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
        if (res.ok) {
          upserted += chunk.length;
          break;
        }
        if (res.status >= 500 && attempt < 2) {
          console.log(`  Upsert ${res.status}, retry ${attempt + 1}/3...`);
          await delay((attempt + 1) * 5000);
          continue;
        }
        const text = await res.text();
        console.error(`  Upsert error: ${res.status} ${text.slice(0, 300)}`);
        break; // Don't retry 4xx
      } catch (err) {
        if (attempt < 2) {
          await delay((attempt + 1) * 5000);
          continue;
        }
        console.error(`  Upsert fetch failed: ${err}`);
      }
    }
  }
  return upserted;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== FAA Wildlife Strike CSV Backfill ===");
  console.log(`CSV: ${CSV_PATH}`);
  if (START_LINE > 0) console.log(`Resuming from line: ${START_LINE}`);

  // Read CSV
  let csvText: string;
  try {
    csvText = readFileSync(CSV_PATH, "utf-8");
  } catch (err) {
    console.error(`Failed to read CSV: ${err}`);
    console.error("Download from https://wildlife.faa.gov/download and save to data/");
    process.exit(1);
  }

  const lines = csvText.split("\n");
  if (lines.length < 2) {
    console.error("CSV appears empty");
    process.exit(1);
  }

  // Parse header
  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);
  const colIndex: Record<string, number> = {};
  for (let i = 0; i < headers.length; i++) {
    colIndex[headers[i].toUpperCase()] = i;
  }

  // Verify required columns exist
  const requiredCols = ["INCIDENT_DATE", "STATE", "SPECIES"];
  for (const col of requiredCols) {
    if (colIndex[col] === undefined) {
      console.error(`Missing required column: ${col}`);
      console.error(`Found columns: ${headers.join(", ")}`);
      process.exit(1);
    }
  }

  const col = (fields: string[], name: string): string => {
    const idx = colIndex[name];
    return idx !== undefined && idx < fields.length ? fields[idx] : "";
  };

  const totalDataLines = lines.length - 1; // minus header
  console.log(`Total CSV lines: ${totalDataLines}`);
  console.log(`Columns: ${headers.length} (${headers.slice(0, 10).join(", ")}...)`);
  console.log("---");

  let totalProcessed = 0;
  let totalEmbedded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Accumulate entries for batch processing
  let batch: Array<{ embedText: string; row: Record<string, unknown> }> = [];

  for (let lineNum = 1; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    if (!line.trim()) continue;

    // Skip lines before START_LINE
    if (lineNum - 1 < START_LINE) continue;

    const fields = parseCSVLine(line);

    // Extract fields
    const incidentDate = col(fields, "INCIDENT_DATE");
    const state = col(fields, "STATE").toUpperCase().trim();
    const species = col(fields, "SPECIES").trim();
    const numStruckRaw = col(fields, "NUM_STRUCK");
    const damage = col(fields, "DAMAGE").trim() || "None";
    const airportId = col(fields, "AIRPORT_ID").trim();
    const airport = col(fields, "AIRPORT").trim();
    const height = col(fields, "HEIGHT").trim();
    const speed = col(fields, "SPEED").trim();
    const phaseOfFlight = col(fields, "PHASE_OF_FLT").trim();
    const sky = col(fields, "SKY").trim();
    const precip = col(fields, "PRECIP").trim();
    const remarks = col(fields, "REMARKS").trim();
    const time = col(fields, "TIME").trim();

    // Filter: skip rows with no species, no state, or unknown species
    if (!species || SKIP_SPECIES.has(species.toUpperCase())) {
      totalSkipped++;
      continue;
    }
    if (!state || !VALID_STATES.has(state)) {
      totalSkipped++;
      continue;
    }

    // Parse date
    const date = parseDate(incidentDate);
    if (!date) {
      totalSkipped++;
      continue;
    }

    const numStruck = numStruckRaw ? parseInt(numStruckRaw, 10) || null : null;
    const heightFt = height ? parseInt(height, 10) || null : null;
    const speedKts = speed ? parseInt(speed, 10) || null : null;
    const speciesLower = species.toLowerCase().replace(/\s+/g, "-");
    const damageLevel = damage.toLowerCase().replace(/\s+/g, "-");

    // Build embed text
    const embedParts = [
      `wildlife-strike`,
      state,
      date,
      `species:${species}`,
      numStruck ? `struck:${numStruck}` : null,
      `damage:${damage}`,
      airportId ? `airport:${airportId}` : null,
      heightFt ? `height:${heightFt}ft` : null,
      phaseOfFlight ? `phase:${phaseOfFlight}` : null,
      sky ? `sky:${sky}` : null,
      precip ? `precip:${precip}` : null,
    ];
    const embedText = embedParts.filter(Boolean).join(" | ");

    // Build title for upsert dedup
    const title = `Wildlife Strike: ${species} at ${airport || airportId || "unknown"} (${date})`;

    // Build tags
    const tags: string[] = [state, "wildlife-strike", "faa", speciesLower, damageLevel];

    // Build row for hunt_knowledge
    const row: Record<string, unknown> = {
      title,
      content: embedText,
      content_type: "wildlife-strike",
      state_abbr: state,
      species: null,
      effective_date: date,
      tags,
      metadata: {
        source: "faa-wildlife-strike-database",
        airport_id: airportId || null,
        airport_name: airport || null,
        bird_species: species,
        num_struck: numStruck,
        damage: damage,
        height_ft: heightFt,
        speed_kts: speedKts,
        phase_of_flight: phaseOfFlight || null,
        sky_condition: sky || null,
        precipitation: precip || null,
        remarks: remarks || null,
        time: time || null,
      },
    };

    batch.push({ embedText, row });
    totalProcessed++;

    // Process in batches of 20 (embed) then upsert in 50s
    if (batch.length >= 20) {
      try {
        const texts = batch.map((b) => b.embedText);
        const embeddings = await embedBatch(texts);

        const rows = batch.map((b, idx) => ({
          ...b.row,
          embedding: JSON.stringify(embeddings[idx]),
        }));

        const upserted = await upsertBatch(rows);
        totalEmbedded += upserted;
      } catch (err) {
        console.error(`  Batch error at line ${lineNum}: ${err}`);
        totalErrors++;
      }
      batch = [];

      // Rate limit between batches
      await delay(100);
    }

    // Checkpoint every 500 entries
    if (totalProcessed % 500 === 0) {
      console.log(
        `[checkpoint] line:${lineNum} | processed:${totalProcessed} | embedded:${totalEmbedded} | skipped:${totalSkipped} | errors:${totalErrors}`
      );
    }
  }

  // Flush remaining batch
  if (batch.length > 0) {
    try {
      const texts = batch.map((b) => b.embedText);
      const embeddings = await embedBatch(texts);

      const rows = batch.map((b, idx) => ({
        ...b.row,
        embedding: JSON.stringify(embeddings[idx]),
      }));

      const upserted = await upsertBatch(rows);
      totalEmbedded += upserted;
    } catch (err) {
      console.error(`  Final batch error: ${err}`);
      totalErrors++;
    }
  }

  console.log("\n===== COMPLETE =====");
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total embedded:  ${totalEmbedded}`);
  console.log(`Total skipped:   ${totalSkipped}`);
  console.log(`Total errors:    ${totalErrors}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
