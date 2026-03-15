/**
 * Backfill US Drought Monitor data for all 50 states (3 years of weekly data).
 * Source: https://usdmdataservices.unl.edu/api/ (free, no auth, no rate limit)
 * Embeds drought severity percentages (D0-D4) per state per week.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-drought-monitor.ts
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

// State FIPS codes for the API
const STATE_FIPS: Record<string, { name: string; fips: string }> = {
  AL: { name: "Alabama", fips: "01" },
  AK: { name: "Alaska", fips: "02" },
  AZ: { name: "Arizona", fips: "04" },
  AR: { name: "Arkansas", fips: "05" },
  CA: { name: "California", fips: "06" },
  CO: { name: "Colorado", fips: "08" },
  CT: { name: "Connecticut", fips: "09" },
  DE: { name: "Delaware", fips: "10" },
  FL: { name: "Florida", fips: "12" },
  GA: { name: "Georgia", fips: "13" },
  HI: { name: "Hawaii", fips: "15" },
  ID: { name: "Idaho", fips: "16" },
  IL: { name: "Illinois", fips: "17" },
  IN: { name: "Indiana", fips: "18" },
  IA: { name: "Iowa", fips: "19" },
  KS: { name: "Kansas", fips: "20" },
  KY: { name: "Kentucky", fips: "21" },
  LA: { name: "Louisiana", fips: "22" },
  ME: { name: "Maine", fips: "23" },
  MD: { name: "Maryland", fips: "24" },
  MA: { name: "Massachusetts", fips: "25" },
  MI: { name: "Michigan", fips: "26" },
  MN: { name: "Minnesota", fips: "27" },
  MS: { name: "Mississippi", fips: "28" },
  MO: { name: "Missouri", fips: "29" },
  MT: { name: "Montana", fips: "30" },
  NE: { name: "Nebraska", fips: "31" },
  NV: { name: "Nevada", fips: "32" },
  NH: { name: "New Hampshire", fips: "33" },
  NJ: { name: "New Jersey", fips: "34" },
  NM: { name: "New Mexico", fips: "35" },
  NY: { name: "New York", fips: "36" },
  NC: { name: "North Carolina", fips: "37" },
  ND: { name: "North Dakota", fips: "38" },
  OH: { name: "Ohio", fips: "39" },
  OK: { name: "Oklahoma", fips: "40" },
  OR: { name: "Oregon", fips: "41" },
  PA: { name: "Pennsylvania", fips: "42" },
  RI: { name: "Rhode Island", fips: "44" },
  SC: { name: "South Carolina", fips: "45" },
  SD: { name: "South Dakota", fips: "46" },
  TN: { name: "Tennessee", fips: "47" },
  TX: { name: "Texas", fips: "48" },
  UT: { name: "Utah", fips: "49" },
  VT: { name: "Vermont", fips: "50" },
  VA: { name: "Virginia", fips: "51" },
  WA: { name: "Washington", fips: "53" },
  WV: { name: "West Virginia", fips: "54" },
  WI: { name: "Wisconsin", fips: "55" },
  WY: { name: "Wyoming", fips: "56" },
};

const STATE_ABBRS = Object.keys(STATE_FIPS).sort();

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

// --- Drought severity classification ---

function classifyDrought(d0: number, d1: number, d2: number, d3: number, d4: number): string {
  if (d4 > 10) return "exceptional_drought";
  if (d3 > 20) return "extreme_drought";
  if (d2 > 30) return "severe_drought";
  if (d1 > 40) return "moderate_drought";
  if (d0 > 50) return "abnormally_dry";
  return "normal";
}

function droughtImpact(none: number, d0: number, d2: number, d3: number, d4: number): string {
  const severeTotal = d2 + d3 + d4;
  if (severeTotal > 50) return "critical — over half of state in severe+ drought, water sources depleted, wildlife concentrated at remaining water";
  if (severeTotal > 25) return "significant — quarter+ of state in severe drought, reduced wetland habitat, altered migration staging";
  if (d0 > 60) return "moderate — majority of state abnormally dry, shallow water areas drying, game movement shifting to water sources";
  if (none > 80) return "minimal — adequate moisture, normal habitat conditions";
  return "mixed — patchy drought conditions, localized impacts on habitat";
}

// --- API fetch ---

interface DroughtWeek {
  mapDate: string;
  stateAbbreviation: string;
  none: number;
  d0: number;
  d1: number;
  d2: number;
  d3: number;
  d4: number;
}

async function fetchDroughtData(fips: string, startDate: string, endDate: string): Promise<DroughtWeek[]> {
  const url = `https://usdmdataservices.unl.edu/api/StateStatistics/GetDroughtSeverityStatisticsByAreaPercent?aoi=${fips}&startdate=${startDate}&enddate=${endDate}&statisticsType=1`;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        return data as DroughtWeek[];
      }
      if (res.status >= 500 && attempt < 2) {
        console.log(`    API retry ${attempt + 1}/3 (${res.status})...`);
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      throw new Error(`USDM API error: ${res.status}`);
    } catch (err) {
      if (attempt < 2) {
        console.log(`    Fetch error, retry ${attempt + 1}/3: ${err}`);
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// --- Prepare entries ---

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  state_abbr: string;
  species: null;
  effective_date: string;
  metadata: Record<string, any>;
  embedText: string;
}

function prepareEntry(abbr: string, week: DroughtWeek, prevWeek: DroughtWeek | null): PreparedEntry {
  const dateStr = week.mapDate.slice(0, 10);
  const classification = classifyDrought(week.d0, week.d1, week.d2, week.d3, week.d4);
  const impact = droughtImpact(week.none, week.d0, week.d2, week.d3, week.d4);

  // Week-over-week change
  let changeStr = "first_week";
  if (prevWeek) {
    const d0Change = (week.d0 - prevWeek.d0).toFixed(1);
    const d2Change = (week.d2 - prevWeek.d2).toFixed(1);
    const noneChange = (week.none - prevWeek.none).toFixed(1);
    changeStr = `none_change:${noneChange}%|d0_change:${d0Change}%|severe_change:${d2Change}%`;
  }

  const embedText = `drought-weekly | ${abbr} | ${dateStr} | none:${week.none.toFixed(1)}% | D0:${week.d0.toFixed(1)}% | D1:${week.d1.toFixed(1)}% | D2:${week.d2.toFixed(1)}% | D3:${week.d3.toFixed(1)}% | D4:${week.d4.toFixed(1)}% | class:${classification} | ${changeStr} | impact: ${impact}`;

  return {
    title: `${abbr} drought ${dateStr}`,
    content: embedText,
    content_type: "drought-weekly",
    tags: [abbr, "drought", "water", "habitat", "migration-trigger"],
    state_abbr: abbr,
    species: null,
    effective_date: dateStr,
    metadata: {
      source: "usdm",
      none_pct: week.none,
      d0_pct: week.d0,
      d1_pct: week.d1,
      d2_pct: week.d2,
      d3_pct: week.d3,
      d4_pct: week.d4,
      classification,
      week_change: prevWeek ? {
        none: parseFloat((week.none - prevWeek.none).toFixed(1)),
        d0: parseFloat((week.d0 - prevWeek.d0).toFixed(1)),
        d1: parseFloat((week.d1 - prevWeek.d1).toFixed(1)),
        d2: parseFloat((week.d2 - prevWeek.d2).toFixed(1)),
        d3: parseFloat((week.d3 - prevWeek.d3).toFixed(1)),
        d4: parseFloat((week.d4 - prevWeek.d4).toFixed(1)),
      } : null,
    },
    embedText,
  };
}

// --- Main ---

async function main() {
  const START_STATE = process.env.START_STATE || null;

  // 3 years of weekly data
  const startDate = "1/1/2023";
  const endDate = "3/14/2026";

  console.log("=== Backfill US Drought Monitor Embeddings ===");
  console.log(`States: ${STATE_ABBRS.length} | Period: ${startDate} to ${endDate}`);
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

    const state = STATE_FIPS[abbr];
    console.log(`\n${abbr} (${state.name}, FIPS ${state.fips}):`);

    try {
      const weeks = await fetchDroughtData(state.fips, startDate, endDate);
      if (!weeks || weeks.length === 0) {
        console.log(`  No data returned, skipping`);
        continue;
      }

      // Sort by date ascending
      weeks.sort((a, b) => a.mapDate.localeCompare(b.mapDate));

      console.log(`  Fetched ${weeks.length} weeks`);

      let batchTexts: string[] = [];
      let batchEntries: PreparedEntry[] = [];
      let pendingRows: any[] = [];
      let stateCount = 0;

      for (let i = 0; i < weeks.length; i++) {
        const prevWeek = i > 0 ? weeks[i - 1] : null;
        const entry = prepareEntry(abbr, weeks[i], prevWeek);
        batchTexts.push(entry.embedText);
        batchEntries.push(entry);

        // Embed in batches of 20
        if (batchTexts.length === 20 || i === weeks.length - 1) {
          const embeddings = await batchEmbed(batchTexts);

          for (let j = 0; j < batchEntries.length; j++) {
            const e = batchEntries[j];
            pendingRows.push({
              title: e.title,
              content: e.content,
              content_type: e.content_type,
              tags: e.tags,
              state_abbr: e.state_abbr,
              species: e.species,
              effective_date: e.effective_date,
              metadata: e.metadata,
              embedding: JSON.stringify(embeddings[j]),
            });
          }

          stateCount += batchEntries.length;
          globalCount += batchEntries.length;

          const batchStart = batchEntries[0].effective_date;
          const batchEnd = batchEntries[batchEntries.length - 1].effective_date;
          console.log(`  ${batchStart} to ${batchEnd} (${batchTexts.length} embedded, ${stateCount}/${weeks.length} state, ${globalCount} total)`);

          batchTexts = [];
          batchEntries = [];

          // Insert in batches of 50
          if (pendingRows.length >= 50) {
            await insertBatch(pendingRows);
            pendingRows = [];
          }

          await new Promise((r) => setTimeout(r, 300));
        }
      }

      // Flush remaining
      if (pendingRows.length > 0) {
        await insertBatch(pendingRows);
      }

      console.log(`  ${abbr} done: ${stateCount} entries`);

      // Small delay between states to be polite
      await new Promise((r) => setTimeout(r, 500));

    } catch (stateErr) {
      console.error(`  ${abbr} FAILED (continuing to next state): ${stateErr}`);
    }
  }

  console.log(`\n=== Complete: ${globalCount} drought entries embedded ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
