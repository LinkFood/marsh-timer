/**
 * Backfill FAA Wildlife Strike data via Socrata API into hunt_knowledge
 *
 * The FAA Wildlife Strike Database has 300K+ records of bird-aircraft strikes
 * since 1990 — essentially an involuntary 24/7 bird census from 500+ airports.
 *
 * Data source: https://datahub.transportation.gov/resource/jhay-dgxy.json (Socrata SODA API)
 * No CSV download needed — queries the API directly with pagination.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-faa-wildlife-strikes.ts
 *
 * Resume support:
 *   START_OFFSET=5000  — skip first N records (for resuming after crash)
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY!;
const START_OFFSET = parseInt(process.env.START_OFFSET || "0", 10);
const PAGE_SIZE = 1000; // Socrata max per request

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
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;
  // Socrata often returns ISO 8601: 2024-01-15T00:00:00.000
  const isoMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  // MM/DD/YYYY
  const slashMatch = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slashMatch) {
    const m = slashMatch[1].padStart(2, "0");
    const d = slashMatch[2].padStart(2, "0");
    return `${slashMatch[3]}-${m}-${d}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Socrata API fetch
// ---------------------------------------------------------------------------

const SOCRATA_BASE = "https://datahub.transportation.gov/resource/jhay-dgxy.json";

interface SocrataRecord {
  incident_date?: string;
  state?: string;
  species?: string;
  num_struck?: string;
  damage?: string;
  airport_id?: string;
  airport?: string;
  height?: string;
  speed?: string;
  phase_of_flt?: string;
  sky?: string;
  precip?: string;
  remarks?: string;
  time?: string;
  operator?: string;
  atype?: string;
  [key: string]: string | undefined;
}

async function fetchPage(offset: number): Promise<SocrataRecord[]> {
  const url = `${SOCRATA_BASE}?$limit=${PAGE_SIZE}&$offset=${offset}&$order=incident_date ASC`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });
      if (res.ok) {
        return await res.json();
      }
      if (res.status === 429 && attempt < 2) {
        console.log(`  Socrata 429, waiting ${(attempt + 1) * 30}s...`);
        await delay((attempt + 1) * 30000);
        continue;
      }
      if (res.status >= 500 && attempt < 2) {
        console.log(`  Socrata ${res.status}, retry ${attempt + 1}/3...`);
        await delay((attempt + 1) * 5000);
        continue;
      }
      throw new Error(`Socrata ${res.status}: ${await res.text()}`);
    } catch (err) {
      if (attempt < 2) {
        console.log(`  Socrata network error, retry ${attempt + 1}/3: ${err}`);
        await delay((attempt + 1) * 10000);
        continue;
      }
      throw err;
    }
  }
  return [];
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
  console.log("=== FAA Wildlife Strike API Backfill ===");
  console.log(`Source: Socrata SODA API (datahub.transportation.gov)`);
  console.log(`Page size: ${PAGE_SIZE}`);
  if (START_OFFSET > 0) console.log(`Resuming from offset: ${START_OFFSET}`);
  console.log("---");

  let offset = START_OFFSET;
  let totalProcessed = 0;
  let totalEmbedded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let emptyPages = 0;

  while (true) {
    console.log(`\nFetching page at offset ${offset}...`);
    let records: SocrataRecord[];
    try {
      records = await fetchPage(offset);
    } catch (err) {
      console.error(`Fatal fetch error at offset ${offset}: ${err}`);
      totalErrors++;
      break;
    }

    if (records.length === 0) {
      emptyPages++;
      if (emptyPages >= 3) {
        console.log("3 consecutive empty pages — reached end of dataset");
        break;
      }
      offset += PAGE_SIZE;
      continue;
    }
    emptyPages = 0;

    console.log(`  Got ${records.length} records`);

    // Accumulate entries for batch processing
    let batch: Array<{ embedText: string; row: Record<string, unknown> }> = [];

    for (const rec of records) {
      const state = (rec.state || "").toUpperCase().trim();
      const species = (rec.species || "").trim();
      const incidentDate = rec.incident_date || "";

      // Filter
      if (!species || SKIP_SPECIES.has(species.toUpperCase())) {
        totalSkipped++;
        continue;
      }
      if (!state || !VALID_STATES.has(state)) {
        totalSkipped++;
        continue;
      }

      const date = parseDate(incidentDate);
      if (!date) {
        totalSkipped++;
        continue;
      }

      const damage = (rec.damage || "None").trim();
      const airportId = (rec.airport_id || "").trim();
      const airport = (rec.airport || "").trim();
      const height = rec.height ? parseInt(rec.height, 10) || null : null;
      const speed = rec.speed ? parseInt(rec.speed, 10) || null : null;
      const numStruck = rec.num_struck ? parseInt(rec.num_struck, 10) || null : null;
      const phaseOfFlight = (rec.phase_of_flt || "").trim();
      const sky = (rec.sky || "").trim();
      const precip = (rec.precip || "").trim();
      const remarks = (rec.remarks || "").trim();
      const time = (rec.time || "").trim();
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
        height ? `height:${height}ft` : null,
        phaseOfFlight ? `phase:${phaseOfFlight}` : null,
        sky ? `sky:${sky}` : null,
        precip ? `precip:${precip}` : null,
      ];
      const embedText = embedParts.filter(Boolean).join(" | ");

      const title = `Wildlife Strike: ${species} at ${airport || airportId || "unknown"} (${date})`;
      const tags: string[] = [state, "wildlife-strike", "faa", speciesLower, damageLevel];

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
          height_ft: height,
          speed_kts: speed,
          phase_of_flight: phaseOfFlight || null,
          sky_condition: sky || null,
          precipitation: precip || null,
          remarks: remarks || null,
          time: time || null,
        },
      };

      batch.push({ embedText, row });
      totalProcessed++;

      // Process in batches of 20
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
          console.error(`  Batch error at offset ${offset}: ${err}`);
          totalErrors++;
        }
        batch = [];
        await delay(100);
      }

      // Checkpoint every 500 entries
      if (totalProcessed % 500 === 0) {
        console.log(
          `[checkpoint] offset:${offset} | processed:${totalProcessed} | embedded:${totalEmbedded} | skipped:${totalSkipped} | errors:${totalErrors}`
        );
      }
    }

    // Flush remaining batch for this page
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
        console.error(`  Flush error at offset ${offset}: ${err}`);
        totalErrors++;
      }
    }

    offset += PAGE_SIZE;

    // Brief pause between pages to be polite to Socrata
    await delay(500);
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
