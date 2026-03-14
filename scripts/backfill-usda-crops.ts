/**
 * Backfill USDA NASS crop acreage data by county into hunt_knowledge.
 * Fetches county-level harvested acreage for hunting-relevant crops (corn, rice,
 * soybeans, wheat, sorghum, sunflower) and embeds one row per county per year.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... NASS_API_KEY=... npx tsx scripts/backfill-usda-crops.ts
 *
 * Optional:
 *   VOYAGE_API_KEY=...   — direct Voyage embedding (faster). Falls back to edge function.
 *   START_STATE=TX        — resume from a specific state alphabetically
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const NASS_API_KEY = process.env.NASS_API_KEY;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!NASS_API_KEY) { console.error("NASS_API_KEY required (register at quickstats.nass.usda.gov/api)"); process.exit(1); }

const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using hunt-generate-embedding edge function (slower)");

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

// --- Constants ---

const CROPS = ["CORN", "RICE", "SOYBEANS", "WHEAT", "SORGHUM", "SUNFLOWER"] as const;
type CropName = typeof CROPS[number];

const YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];

const STATE_ABBRS = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const NASS_BASE = "https://quickstats.nass.usda.gov/api/api_GET";

// --- NASS API ---

interface NassRecord {
  county_name: string;
  county_code: string;
  Value: string;
  commodity_desc: string;
}

async function fetchCropData(
  stateAbbr: string,
  crop: CropName,
  year: number,
): Promise<NassRecord[]> {
  const params = new URLSearchParams({
    key: NASS_API_KEY!,
    commodity_desc: crop,
    statisticcat_desc: "AREA HARVESTED",
    agg_level_desc: "COUNTY",
    state_alpha: stateAbbr,
    year: String(year),
    format: "JSON",
  });

  const url = `${NASS_BASE}?${params.toString()}`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        // NASS returns { data: [...] } on success
        if (data.data && Array.isArray(data.data)) {
          return data.data;
        }
        // Some responses have an error field for "no data"
        return [];
      }
      if (res.status >= 500 && attempt < 2) {
        console.log(`    NASS 5xx for ${crop}/${stateAbbr}/${year}, retry ${attempt + 1}...`);
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      // 4xx = no data or bad request, don't retry
      if (res.status >= 400 && res.status < 500) {
        return [];
      }
      throw new Error(`NASS error: ${res.status}`);
    } catch (err) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      console.error(`    NASS fetch failed for ${crop}/${stateAbbr}/${year}: ${err}`);
      return [];
    }
  }
  return [];
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
        console.log(`    Rate limited, waiting ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`    Retry ${attempt + 1}/${retries} after ${wait / 1000}s (${res.status})...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        const wait = (attempt + 1) * 10000;
        console.log(`    Error, retrying in ${wait / 1000}s: ${err}`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// --- Insert ---

async function insertBatch(rows: any[]): Promise<void> {
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
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      const text = await res.text();
      console.error(`  Insert failed after retries: ${text}`);
    }
  }
}

// --- Main ---

interface CountyCropData {
  countyName: string;
  countyCode: string;
  rice: number | null;
  corn: number | null;
  soybeans: number | null;
  wheat: number | null;
  sorghum: number | null;
  sunflower: number | null;
}

function parseAcres(value: string): number | null {
  // NASS uses "(D)" for withheld, "(Z)" for less than half, commas in numbers
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? null : parsed;
}

async function main() {
  const START_STATE = process.env.START_STATE || null;

  console.log("=== Backfill USDA NASS Crop Data ===");
  console.log(`States: ${STATE_ABBRS.length} | Crops: ${CROPS.length} | Years: ${YEARS.length}`);
  if (START_STATE) console.log(`Resuming from state: ${START_STATE}`);

  let globalCount = 0;
  let skippingState = !!START_STATE;

  for (const stateAbbr of STATE_ABBRS) {
    if (skippingState) {
      if (stateAbbr === START_STATE) {
        skippingState = false;
      } else {
        console.log(`Skipping ${stateAbbr} (before ${START_STATE})`);
        continue;
      }
    }

    console.log(`\n${stateAbbr}:`);

    try {
      for (const year of YEARS) {
        // Fetch all crops for this state/year
        const cropResults: Record<CropName, NassRecord[]> = {} as any;
        for (const crop of CROPS) {
          cropResults[crop] = await fetchCropData(stateAbbr, crop, year);
          // 500ms delay between NASS API calls
          await new Promise((r) => setTimeout(r, 500));
        }

        // Combine by county — build a map of county_code -> CountyCropData
        const countyMap = new Map<string, CountyCropData>();

        for (const crop of CROPS) {
          for (const record of cropResults[crop]) {
            if (!record.county_name || !record.county_code) continue;
            // Skip "OTHER (COMBINED) COUNTIES" aggregates
            if (record.county_code === "998" || record.county_code === "999") continue;

            const key = record.county_code;
            if (!countyMap.has(key)) {
              countyMap.set(key, {
                countyName: record.county_name,
                countyCode: record.county_code,
                rice: null,
                corn: null,
                soybeans: null,
                wheat: null,
                sorghum: null,
                sunflower: null,
              });
            }

            const county = countyMap.get(key)!;
            const acres = parseAcres(record.Value);

            switch (crop) {
              case "CORN": county.corn = acres; break;
              case "RICE": county.rice = acres; break;
              case "SOYBEANS": county.soybeans = acres; break;
              case "WHEAT": county.wheat = acres; break;
              case "SORGHUM": county.sorghum = acres; break;
              case "SUNFLOWER": county.sunflower = acres; break;
            }
          }
        }

        if (countyMap.size === 0) {
          console.log(`  ${year}: no crop data found`);
          continue;
        }

        // Build entries for embedding
        const counties = Array.from(countyMap.values());
        let batchTexts: string[] = [];
        let batchMeta: { county: CountyCropData; embedText: string }[] = [];
        let pendingRows: any[] = [];
        let yearCount = 0;

        for (let i = 0; i < counties.length; i++) {
          const c = counties[i];

          // Build embed text with available crops
          const parts: string[] = [];
          if (c.rice !== null) parts.push(`rice:${c.rice}ac`);
          if (c.corn !== null) parts.push(`corn:${c.corn}ac`);
          if (c.soybeans !== null) parts.push(`soybeans:${c.soybeans}ac`);
          if (c.wheat !== null) parts.push(`wheat:${c.wheat}ac`);
          if (c.sorghum !== null) parts.push(`sorghum:${c.sorghum}ac`);
          if (c.sunflower !== null) parts.push(`sunflower:${c.sunflower}ac`);

          // Skip counties with zero crops reported
          if (parts.length === 0) continue;

          const embedText = `crop-data | ${stateAbbr} | ${c.countyName} | ${year} | ${parts.join(" ")}`;

          batchTexts.push(embedText);
          batchMeta.push({ county: c, embedText });

          // Embed in batches of 20
          if (batchTexts.length === 20 || i === counties.length - 1) {
            if (batchTexts.length === 0) continue;

            const embeddings = await batchEmbed(batchTexts);

            for (let j = 0; j < batchMeta.length; j++) {
              const m = batchMeta[j];
              pendingRows.push({
                title: `Crops ${m.county.countyName} ${stateAbbr} ${year}`,
                content: m.embedText,
                content_type: "crop-data",
                tags: [stateAbbr, "crop", "food", "agriculture", m.county.countyName.toLowerCase()],
                state_abbr: stateAbbr,
                species: null,
                effective_date: `${year}-10-01`,
                metadata: {
                  source: "usda-nass",
                  year,
                  county: m.county.countyName,
                  county_code: m.county.countyCode,
                  rice_acres: m.county.rice,
                  corn_acres: m.county.corn,
                  soybean_acres: m.county.soybeans,
                  wheat_acres: m.county.wheat,
                  sorghum_acres: m.county.sorghum,
                  sunflower_acres: m.county.sunflower,
                },
                embedding: JSON.stringify(embeddings[j]),
              });
            }

            yearCount += batchMeta.length;
            globalCount += batchMeta.length;
            batchTexts = [];
            batchMeta = [];

            // Insert when we have 20+ pending
            if (pendingRows.length >= 20) {
              await insertBatch(pendingRows);
              pendingRows = [];
            }

            // Pause between Voyage batches
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        // Flush remaining rows for this year
        if (pendingRows.length > 0) {
          await insertBatch(pendingRows);
        }

        console.log(`  ${year}: ${yearCount} counties embedded (${globalCount} total)`);
      }
    } catch (stateErr) {
      console.error(`  ${stateAbbr} FAILED (continuing to next state): ${stateErr}`);
    }
  }

  console.log(`\n=== Complete: ${globalCount} crop entries embedded ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
