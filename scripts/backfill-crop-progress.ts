/**
 * Backfill USDA NASS weekly crop progress data for hunting-relevant crops.
 * Tracks planting, harvest, and condition progress by state — key signal for
 * dove (food availability), deer/turkey (habitat changes).
 *
 * Source: https://quickstats.nass.usda.gov/api/ (key required)
 * Updates: Weekly during growing season (Apr-Nov)
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... NASS_API_KEY=25B05F81-1582-3D5D-A4F1-D13D00FCE7D1 npx tsx scripts/backfill-crop-progress.ts
 *
 * Resume:
 *   START_STATE=TX  — skip states before TX alphabetically
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const NASS_API_KEY = process.env.NASS_API_KEY;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!NASS_API_KEY) { console.error("NASS_API_KEY required"); process.exit(1); }

const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using edge function (slower)");

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const NASS_BASE = "https://quickstats.nass.usda.gov/api/api_GET";

// Hunting-relevant crops: sunflower/wheat/milo = dove food; corn/soybeans = cover/food for deer/turkey
const CROPS = ["CORN", "SOYBEANS", "WHEAT", "SORGHUM", "SUNFLOWER"] as const;
const YEARS = [2023, 2024, 2025];

// States that have significant USDA crop progress reporting (not all 50 report)
const CROP_STATES = [
  "AL","AR","CA","CO","GA","IA","ID","IL","IN","KS",
  "KY","LA","MI","MN","MO","MS","MT","NC","ND","NE",
  "NY","OH","OK","OR","PA","SC","SD","TN","TX","VA",
  "WA","WI","WY",
];

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
        body: JSON.stringify({ model: "voyage-3-lite", input: texts, input_type: "document" }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.data.map((d: { embedding: number[] }) => d.embedding);
      }
      if (res.status === 429 && attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 30000));
        continue;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
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
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      console.error(`  Insert failed: ${await res.text()}`);
    }
  }
}

// --- NASS API ---

interface NassRecord {
  week_ending: string;
  unit_desc: string;
  Value: string;
  commodity_desc: string;
  state_alpha: string;
}

async function fetchCropProgress(stateAbbr: string, crop: string, year: number): Promise<NassRecord[]> {
  const params = new URLSearchParams({
    key: NASS_API_KEY!,
    commodity_desc: crop,
    statisticcat_desc: "PROGRESS",
    agg_level_desc: "STATE",
    state_alpha: stateAbbr,
    year: String(year),
    format: "JSON",
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${NASS_BASE}?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data.data && Array.isArray(data.data)) return data.data;
        return [];
      }
      if (res.status >= 500 && attempt < 2) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      return [];
    } catch (err) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      return [];
    }
  }
  return [];
}

// Group records by week_ending to get a full picture per week
function groupByWeek(records: NassRecord[]): Map<string, NassRecord[]> {
  const map = new Map<string, NassRecord[]>();
  for (const r of records) {
    if (!r.week_ending || r.Value === "(D)" || r.Value === "(NA)") continue;
    const group = map.get(r.week_ending) || [];
    group.push(r);
    map.set(r.week_ending, group);
  }
  return map;
}

function cropHuntingImpact(crop: string): string {
  switch (crop) {
    case "SUNFLOWER": return "dove primary food — harvest timing determines field shooting";
    case "WHEAT": return "dove/deer food — stubble fields attract feeding, cover crop for deer";
    case "SORGHUM": return "dove primary food — standing/harvested milo fields key dove areas";
    case "CORN": return "deer/turkey food and cover — standing corn = security cover, harvested = open feeding";
    case "SOYBEANS": return "deer food — high protein browse, harvest timing affects movement patterns";
    default: return "habitat/food availability signal";
  }
}

// --- Main ---

async function main() {
  const START_STATE = process.env.START_STATE || null;

  console.log("=== Backfill USDA Crop Progress ===");
  console.log(`States: ${CROP_STATES.length} | Crops: ${CROPS.length} | Years: ${YEARS.join(",")}`);
  if (START_STATE) console.log(`Resuming from: ${START_STATE}`);

  let globalCount = 0;
  let skippingState = !!START_STATE;

  for (const abbr of CROP_STATES) {
    if (skippingState) {
      if (abbr === START_STATE) skippingState = false;
      else { console.log(`Skipping ${abbr}`); continue; }
    }

    console.log(`\n${abbr}:`);

    try {
      let batchTexts: string[] = [];
      let batchMeta: any[] = [];
      let pendingRows: any[] = [];
      let stateCount = 0;

      for (const crop of CROPS) {
        for (const year of YEARS) {
          const records = await fetchCropProgress(abbr, crop, year);
          if (records.length === 0) continue;

          const weekGroups = groupByWeek(records);
          const impact = cropHuntingImpact(crop);

          for (const [weekEnding, weekRecords] of weekGroups) {
            // Build a summary of all progress metrics for this week
            const metrics = weekRecords.map(r => `${r.unit_desc.replace("PCT ", "")}:${r.Value}%`).join(" | ");

            const embedText = `crop-progress | ${abbr} | ${crop.toLowerCase()} | ${weekEnding} | ${metrics} | impact: ${impact}`;

            batchTexts.push(embedText);
            batchMeta.push({
              title: `${abbr} ${crop.toLowerCase()} progress ${weekEnding}`,
              content: embedText,
              content_type: "crop-progress",
              tags: [abbr, "crop-progress", crop.toLowerCase(), "food-availability", "habitat"],
              state_abbr: abbr,
              species: null,
              effective_date: weekEnding,
              metadata: {
                source: "usda-nass",
                crop: crop.toLowerCase(),
                year,
                metrics: Object.fromEntries(weekRecords.map(r => [r.unit_desc.toLowerCase(), parseInt(r.Value) || 0])),
              },
            });

            if (batchTexts.length === 20) {
              const embeddings = await batchEmbed(batchTexts);
              for (let j = 0; j < batchMeta.length; j++) {
                pendingRows.push({ ...batchMeta[j], embedding: JSON.stringify(embeddings[j]) });
              }
              stateCount += batchMeta.length;
              globalCount += batchMeta.length;
              console.log(`  ${crop} ${year} (${stateCount} state, ${globalCount} total)`);
              batchTexts = [];
              batchMeta = [];

              if (pendingRows.length >= 50) {
                await insertBatch(pendingRows);
                pendingRows = [];
              }
              await new Promise((r) => setTimeout(r, 300));
            }
          }

          // NASS rate limit: be polite
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // Flush remaining
      if (batchTexts.length > 0) {
        const embeddings = await batchEmbed(batchTexts);
        for (let j = 0; j < batchMeta.length; j++) {
          pendingRows.push({ ...batchMeta[j], embedding: JSON.stringify(embeddings[j]) });
        }
        stateCount += batchMeta.length;
        globalCount += batchMeta.length;
      }
      if (pendingRows.length > 0) {
        await insertBatch(pendingRows);
      }

      console.log(`  ${abbr} done: ${stateCount} entries`);
    } catch (err) {
      console.error(`  ${abbr} FAILED: ${err}`);
    }
  }

  console.log(`\n=== Complete: ${globalCount} crop progress entries ===`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
