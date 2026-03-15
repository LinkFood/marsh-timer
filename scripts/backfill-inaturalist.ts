/**
 * Backfill iNaturalist observation data for deer, turkey, and dove across all 50 states.
 * Source: https://api.inaturalist.org/v1/ (free, no auth, 100 req/min)
 * Embeds monthly observation counts and patterns per state per species.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-inaturalist.ts
 *
 * Resume options:
 *   START_STATE=TX  — skip states before TX alphabetically
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using hunt-generate-embedding edge function (slower)");

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

// iNaturalist taxon IDs
const TAXA = [
  { taxonId: 42223, species: "deer" as const, name: "White-tailed Deer" },
  { taxonId: 906, species: "turkey" as const, name: "Wild Turkey" },
  { taxonId: 3454, species: "dove" as const, name: "Mourning Dove" },
];

// iNaturalist place IDs for US states (verified)
const STATE_PLACES: Record<string, { name: string; placeId: number }> = {
  AL: { name: "Alabama", placeId: 19 },
  AK: { name: "Alaska", placeId: 6 },
  AZ: { name: "Arizona", placeId: 40 },
  AR: { name: "Arkansas", placeId: 36 },
  CA: { name: "California", placeId: 14 },
  CO: { name: "Colorado", placeId: 34 },
  CT: { name: "Connecticut", placeId: 49 },
  DE: { name: "Delaware", placeId: 4 },
  FL: { name: "Florida", placeId: 21 },
  GA: { name: "Georgia", placeId: 23 },
  HI: { name: "Hawaii", placeId: 11 },
  ID: { name: "Idaho", placeId: 22 },
  IL: { name: "Illinois", placeId: 35 },
  IN: { name: "Indiana", placeId: 20 },
  IA: { name: "Iowa", placeId: 24 },
  KS: { name: "Kansas", placeId: 25 },
  KY: { name: "Kentucky", placeId: 26 },
  LA: { name: "Louisiana", placeId: 27 },
  ME: { name: "Maine", placeId: 17 },
  MD: { name: "Maryland", placeId: 39 },
  MA: { name: "Massachusetts", placeId: 2 },
  MI: { name: "Michigan", placeId: 29 },
  MN: { name: "Minnesota", placeId: 38 },
  MS: { name: "Mississippi", placeId: 37 },
  MO: { name: "Missouri", placeId: 28 },
  MT: { name: "Montana", placeId: 16 },
  NE: { name: "Nebraska", placeId: 3 },
  NV: { name: "Nevada", placeId: 50 },
  NH: { name: "New Hampshire", placeId: 41 },
  NJ: { name: "New Jersey", placeId: 51 },
  NM: { name: "New Mexico", placeId: 9 },
  NY: { name: "New York", placeId: 48 },
  NC: { name: "North Carolina", placeId: 30 },
  ND: { name: "North Dakota", placeId: 13 },
  OH: { name: "Ohio", placeId: 31 },
  OK: { name: "Oklahoma", placeId: 12 },
  OR: { name: "Oregon", placeId: 10 },
  PA: { name: "Pennsylvania", placeId: 42 },
  RI: { name: "Rhode Island", placeId: 8 },
  SC: { name: "South Carolina", placeId: 43 },
  SD: { name: "South Dakota", placeId: 44 },
  TN: { name: "Tennessee", placeId: 45 },
  TX: { name: "Texas", placeId: 18 },
  UT: { name: "Utah", placeId: 52 },
  VT: { name: "Vermont", placeId: 47 },
  VA: { name: "Virginia", placeId: 7 },
  WA: { name: "Washington", placeId: 46 },
  WV: { name: "West Virginia", placeId: 33 },
  WI: { name: "Wisconsin", placeId: 32 },
  WY: { name: "Wyoming", placeId: 15 },
};

const STATE_ABBRS = Object.keys(STATE_PLACES).sort();

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

// --- iNaturalist API ---

async function fetchObservationCount(
  taxonId: number,
  placeId: number,
  d1: string,
  d2: string,
): Promise<number> {
  const url = `https://api.inaturalist.org/v1/observations?taxon_id=${taxonId}&place_id=${placeId}&d1=${d1}&d2=${d2}&per_page=0&quality_grade=research`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        return data.total_results || 0;
      }
      if (res.status === 429) {
        console.log(`    Rate limited, waiting 60s...`);
        await new Promise((r) => setTimeout(r, 60000));
        continue;
      }
      if (res.status >= 500 && attempt < 2) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      return 0; // 4xx = no data
    } catch (err) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      console.warn(`    Fetch error: ${err}`);
      return 0;
    }
  }
  return 0;
}

// --- Month generation ---

function generateMonths(startYear: number, endYear: number, endMonth: number): { d1: string; d2: string; label: string }[] {
  const months: { d1: string; d2: string; label: string }[] = [];
  for (let year = startYear; year <= endYear; year++) {
    const maxMonth = year === endYear ? endMonth : 12;
    for (let month = 1; month <= maxMonth; month++) {
      const d1 = `${year}-${String(month).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const d2 = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
      const label = `${year}-${String(month).padStart(2, "0")}`;
      months.push({ d1, d2, label });
    }
  }
  return months;
}

function activityLevel(count: number): string {
  if (count >= 500) return "very_high";
  if (count >= 100) return "high";
  if (count >= 30) return "moderate";
  if (count >= 5) return "low";
  return "minimal";
}

function seasonalContext(species: string, month: number): string {
  if (species === "deer") {
    if (month >= 10 && month <= 12) return "rut/peak hunting season — most active, cameras/observations spike";
    if (month >= 1 && month <= 2) return "late season — bucks recovering, reduced movement";
    if (month >= 5 && month <= 7) return "fawning — does with fawns, velvet antler growth";
    if (month >= 8 && month <= 9) return "pre-rut — bachelor groups breaking, scraping begins";
    return "transition — normal activity patterns";
  }
  if (species === "turkey") {
    if (month >= 3 && month <= 5) return "spring gobbling — peak breeding, toms strutting, most vocal period";
    if (month >= 9 && month <= 11) return "fall flocking — large groups forming, mast crop feeding";
    if (month >= 6 && month <= 8) return "summer brood rearing — hens with poults in open areas";
    return "winter — tight flocks, concentrated near food";
  }
  if (species === "dove") {
    if (month >= 9 && month <= 10) return "early season — peak migration, post-nesting dispersal";
    if (month >= 6 && month <= 8) return "nesting/breeding — multiple clutches, concentrated near water/grain";
    if (month >= 11 && month <= 12) return "late season — southern migration, concentrated in south";
    return "spring — northward movement, early nesting";
  }
  return "";
}

// --- Main ---

async function main() {
  const START_STATE = process.env.START_STATE || null;

  const months = generateMonths(2024, 2026, 3); // 2 years + current
  const totalCombos = STATE_ABBRS.length * TAXA.length * months.length;

  console.log("=== Backfill iNaturalist Observation Data ===");
  console.log(`States: ${STATE_ABBRS.length} | Species: ${TAXA.length} | Months: ${months.length} | Total queries: ${totalCombos}`);
  if (START_STATE) console.log(`Resuming from state: ${START_STATE}`);

  let globalCount = 0;
  let skippingState = !!START_STATE;

  for (const abbr of STATE_ABBRS) {
    if (skippingState) {
      if (abbr === START_STATE) {
        skippingState = false;
      } else {
        console.log(`Skipping ${abbr} (before ${START_STATE})`);
        continue;
      }
    }

    const state = STATE_PLACES[abbr];
    console.log(`\n${abbr} (${state.name}, placeId ${state.placeId}):`);

    try {
      let batchTexts: string[] = [];
      let batchMeta: any[] = [];
      let pendingRows: any[] = [];
      let stateCount = 0;

      for (const taxon of TAXA) {
        console.log(`  ${taxon.name}:`);

        for (const month of months) {
          const count = await fetchObservationCount(taxon.taxonId, state.placeId, month.d1, month.d2);
          const monthNum = parseInt(month.label.split("-")[1]);
          const level = activityLevel(count);
          const context = seasonalContext(taxon.species, monthNum);

          const embedText = `inaturalist-monthly | ${abbr} | ${taxon.species} | ${month.label} | observations:${count} | activity:${level} | context: ${context}`;

          batchTexts.push(embedText);
          batchMeta.push({
            title: `${abbr} ${taxon.species} inat ${month.label}`,
            content: embedText,
            content_type: "inaturalist-monthly",
            tags: [abbr, taxon.species, "inaturalist", "observations", "activity"],
            state_abbr: abbr,
            species: taxon.species,
            effective_date: month.d1,
            metadata: {
              source: "inaturalist",
              taxon_id: taxon.taxonId,
              taxon_name: taxon.name,
              observation_count: count,
              activity_level: level,
              month: month.label,
            },
          });

          // Rate limit: ~60 req/min, we need headroom
          await new Promise((r) => setTimeout(r, 700));

          // Embed in batches of 20
          if (batchTexts.length === 20) {
            const embeddings = await batchEmbed(batchTexts);
            for (let j = 0; j < batchMeta.length; j++) {
              pendingRows.push({
                ...batchMeta[j],
                embedding: JSON.stringify(embeddings[j]),
              });
            }
            stateCount += batchMeta.length;
            globalCount += batchMeta.length;
            console.log(`    ${batchMeta[batchMeta.length - 1].metadata.month} (${batchTexts.length} embedded, ${stateCount} state, ${globalCount} total)`);
            batchTexts = [];
            batchMeta = [];

            if (pendingRows.length >= 50) {
              await insertBatch(pendingRows);
              pendingRows = [];
            }
            await new Promise((r) => setTimeout(r, 300));
          }
        }
      }

      // Flush remaining
      if (batchTexts.length > 0) {
        const embeddings = await batchEmbed(batchTexts);
        for (let j = 0; j < batchMeta.length; j++) {
          pendingRows.push({
            ...batchMeta[j],
            embedding: JSON.stringify(embeddings[j]),
          });
        }
        stateCount += batchMeta.length;
        globalCount += batchMeta.length;
        console.log(`    flush (${batchTexts.length} embedded, ${stateCount} state, ${globalCount} total)`);
      }

      if (pendingRows.length > 0) {
        await insertBatch(pendingRows);
      }

      console.log(`  ${abbr} done: ${stateCount} entries`);

    } catch (stateErr) {
      console.error(`  ${abbr} FAILED (continuing): ${stateErr}`);
    }
  }

  console.log(`\n=== Complete: ${globalCount} iNaturalist entries embedded ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
