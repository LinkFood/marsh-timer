/**
 * Backfill GBIF biodiversity observation counts per species per state per month.
 * Establishes seasonal baselines: "what's normal for mallards in Arkansas in November?"
 * Source: https://api.gbif.org/v1/occurrence/search (free, no auth)
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-gbif.ts
 *
 * Resume options:
 *   START_SPECIES=2498112  — resume from a specific taxon key
 *   START_YEAR=2020        — resume from a specific year (within current species)
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const START_SPECIES = process.env.START_SPECIES ? parseInt(process.env.START_SPECIES, 10) : null;
const START_YEAR = process.env.START_YEAR ? parseInt(process.env.START_YEAR, 10) : null;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using hunt-generate-embedding edge function (slower)");

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const GBIF_BASE = "https://api.gbif.org/v1/occurrence/search";
const RATE_LIMIT_MS = 500;

// --- Target species ---

interface SpeciesDef {
  taxonKey: number;
  species: string;
  common: string;
}

const SPECIES: SpeciesDef[] = [
  { taxonKey: 9761484, species: "duck", common: "Mallard" },
  { taxonKey: 2498112, species: "duck", common: "Northern Pintail" },
  { taxonKey: 8214667, species: "duck", common: "Green-winged Teal" },
  { taxonKey: 2498387, species: "duck", common: "Wood Duck" },
  { taxonKey: 2498256, species: "duck", common: "Canvasback" },
  { taxonKey: 5232437, species: "goose", common: "Canada Goose" },
  { taxonKey: 2498167, species: "goose", common: "Snow Goose" },
  { taxonKey: 2440965, species: "deer", common: "White-tailed Deer" },
  { taxonKey: 9606290, species: "turkey", common: "Wild Turkey" },
  { taxonKey: 2495347, species: "dove", common: "Mourning Dove" },
];

// Top 20 states for hunting/wildlife observations
const STATES: Record<string, string> = {
  AL: "Alabama", AR: "Arkansas", CA: "California", CO: "Colorado",
  FL: "Florida", GA: "Georgia", IL: "Illinois", IN: "Indiana",
  IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana",
  MD: "Maryland", MI: "Michigan", MN: "Minnesota", MS: "Mississippi",
  MO: "Missouri", MT: "Montana", NE: "Nebraska", NC: "North Carolina",
  ND: "North Dakota", NY: "New York", OH: "Ohio", OK: "Oklahoma",
  OR: "Oregon", PA: "Pennsylvania", SC: "South Carolina", SD: "South Dakota",
  TN: "Tennessee", TX: "Texas", VA: "Virginia", WA: "Washington",
  WI: "Wisconsin",
};

const STATE_ABBRS = Object.keys(STATES).sort();

// --- Months to backfill: 2015-01 through 2026-02 ---

function generateMonths(): { year: number; month: number }[] {
  const months: { year: number; month: number }[] = [];
  for (let y = 2015; y <= 2026; y++) {
    const endMonth = y === 2026 ? 2 : 12;
    for (let m = 1; m <= endMonth; m++) {
      months.push({ year: y, month: m });
    }
  }
  return months;
}

// --- GBIF API fetch ---

async function fetchGbifCount(
  taxonKey: number,
  year: number,
  month: number,
  stateProvince?: string,
): Promise<number> {
  const params = new URLSearchParams({
    taxonKey: taxonKey.toString(),
    country: "US",
    year: year.toString(),
    month: month.toString(),
    hasCoordinate: "true",
    limit: "0",
  });
  if (stateProvince) {
    params.set("stateProvince", stateProvince);
  }

  await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${GBIF_BASE}?${params}`);
      if (res.ok) {
        const data = await res.json();
        return data.count ?? 0;
      }
      if (res.status >= 500 && attempt < 2) {
        const wait = (attempt + 1) * 5000;
        console.log(`    GBIF ${res.status}, retrying in ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (res.status === 429 && attempt < 2) {
        const wait = (attempt + 1) * 30000;
        console.log(`    GBIF rate limited, waiting ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error(`GBIF error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < 2) {
        const wait = (attempt + 1) * 5000;
        console.log(`    Fetch error, retry ${attempt + 1}/3: ${err}`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// --- Embedding ---

async function embedViaEdgeFn(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, input_type: "document" }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.embedding;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      throw new Error(`Edge fn error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 10000));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

async function batchEmbed(texts: string[], retries = 3): Promise<number[][]> {
  if (USE_EDGE_FN) {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await embedViaEdgeFn(text, retries));
      await new Promise((r) => setTimeout(r, 100));
    }
    return results;
  }
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
        const wait = (attempt + 1) * 30000;
        console.log(`    Voyage rate limited, waiting ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`    Voyage retry ${attempt + 1}/${retries} after ${wait / 1000}s (${res.status})...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        const wait = (attempt + 1) * 10000;
        console.log(`    Voyage error, retrying in ${wait / 1000}s: ${err}`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// --- Insert to hunt_knowledge ---

async function insertBatch(rows: any[]): Promise<void> {
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
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        const text = await res.text();
        console.error(`  Insert failed after retries: ${text}`);
      } catch (err) {
        if (attempt < 2) {
          const wait = (attempt + 1) * 10000;
          console.log(`  Insert fetch error, retry ${attempt + 1}/3 in ${wait / 1000}s: ${err}`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        console.error(`  Insert fetch failed after retries: ${err}`);
      }
    }
  }
}

// --- Main ---

async function main() {
  console.log("=== Backfill GBIF Biodiversity Observations ===");
  console.log(`Species: ${SPECIES.length} | States: ${STATE_ABBRS.length} | Months: 2015-01 to 2026-02`);
  if (START_SPECIES) console.log(`Resuming from species taxonKey: ${START_SPECIES}`);
  if (START_YEAR) console.log(`Resuming from year: ${START_YEAR}`);

  const allMonths = generateMonths();
  let globalCount = 0;
  let errors = 0;
  const startTime = Date.now();
  let speciesFound = !START_SPECIES;
  let applyStartYear = !!START_YEAR; // only apply START_YEAR to the first resumed species

  for (const sp of SPECIES) {
    if (!speciesFound) {
      if (sp.taxonKey === START_SPECIES) speciesFound = true;
      else {
        console.log(`Skipping ${sp.common} (before START_SPECIES)`);
        continue;
      }
    }

    console.log(`\n=== ${sp.common} (${sp.species}, taxonKey ${sp.taxonKey}) ===`);

    let yearFound = !applyStartYear;
    let batchTexts: string[] = [];
    let batchRows: any[] = [];
    let pendingRows: any[] = [];
    let speciesCount = 0;

    for (const { year, month } of allMonths) {
      if (!yearFound) {
        if (year === START_YEAR) yearFound = true;
        else continue;
      }

      const monthStr = `${year}-${String(month).padStart(2, "0")}`;

      // Query each state
      let stateResults: { abbr: string; count: number }[] = [];

      for (const abbr of STATE_ABBRS) {
        try {
          const count = await fetchGbifCount(sp.taxonKey, year, month, STATES[abbr]);
          if (count > 0) {
            stateResults.push({ abbr, count });
          }
        } catch (err) {
          errors++;
          console.error(`    Error ${sp.common} ${abbr} ${monthStr}: ${err}`);
        }
      }

      // Build entries for states with observations
      for (const { abbr, count } of stateResults) {
        const title = `gbif ${sp.common} ${abbr} ${monthStr}`;
        const embedText = `gbif-monthly | ${sp.species} | ${sp.common} | ${abbr} | ${monthStr} | observations:${count}`;

        batchTexts.push(embedText);
        batchRows.push({
          title,
          content: embedText,
          content_type: "gbif-monthly",
          tags: [abbr, sp.species, sp.common.toLowerCase(), "gbif", "biodiversity", "seasonal-baseline"],
          state_abbr: abbr,
          species: sp.species,
          effective_date: `${year}-${String(month).padStart(2, "0")}-01`,
          metadata: {
            source: "gbif",
            taxon_key: sp.taxonKey,
            common_name: sp.common,
            observation_count: count,
            year,
            month,
          },
        });

        // Embed in batches of 20
        if (batchTexts.length === 20) {
          try {
            const embeddings = await batchEmbed(batchTexts);
            for (let j = 0; j < batchRows.length; j++) {
              pendingRows.push({
                ...batchRows[j],
                embedding: JSON.stringify(embeddings[j]),
              });
            }
            speciesCount += batchRows.length;
            globalCount += batchRows.length;
          } catch (err) {
            errors++;
            console.error(`  Embed batch failed: ${err}`);
          }
          batchTexts = [];
          batchRows = [];

          // Insert when we have 50+ pending
          if (pendingRows.length >= 50) {
            await insertBatch(pendingRows);
            pendingRows = [];
          }
        }
      }

      // Progress
      const statesWithData = stateResults.length;
      const totalObs = stateResults.reduce((sum, r) => sum + r.count, 0);
      if (statesWithData > 0) {
        console.log(`  ${sp.common} ${monthStr}: ${statesWithData} states, ${totalObs.toLocaleString()} total obs (${globalCount} embedded)`);
      } else {
        console.log(`  ${sp.common} ${monthStr}: no observations`);
      }

      // Reset START_YEAR after first species uses it
      // (only skip years within the species we're resuming from)
    }

    // Flush remaining batch
    if (batchTexts.length > 0) {
      try {
        const embeddings = await batchEmbed(batchTexts);
        for (let j = 0; j < batchRows.length; j++) {
          pendingRows.push({
            ...batchRows[j],
            embedding: JSON.stringify(embeddings[j]),
          });
        }
        speciesCount += batchRows.length;
        globalCount += batchRows.length;
      } catch (err) {
        errors++;
        console.error(`  Embed flush failed: ${err}`);
      }
    }

    if (pendingRows.length > 0) {
      await insertBatch(pendingRows);
      pendingRows = [];
    }

    console.log(`  ${sp.common} complete: ${speciesCount} entries`);

    // Clear START_YEAR after first species so subsequent species start from the beginning
    if (applyStartYear) {
      applyStartYear = false;
      console.log(`  (START_YEAR cleared — subsequent species start from 2015)`);
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000 / 60);
  console.log(`\n=== Complete: ${globalCount} GBIF entries embedded | ${errors} errors | ${elapsed} min ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
