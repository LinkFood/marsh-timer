/**
 * Backfill NOAA ACIS climate normals and freeze date data for all 50 states.
 * Pulls state-level gridded data (monthly normals) and daily min temps
 * to compute first/last freeze dates per year (2000-2025).
 * Embeds into hunt_knowledge as climate-normal entries.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-noaa-acis.ts
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

const ACIS_BASE = "http://data.rcc-acis.org";

// --- States ---

const STATE_ABBRS = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

const STATE_NAMES: Record<string, string> = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",
  CO:"Colorado",CT:"Connecticut",DE:"Delaware",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",
  MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",MS:"Mississippi",MO:"Missouri",
  MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",
  OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",
  VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming",
};

const YEARS = Array.from({ length: 26 }, (_, i) => 2000 + i); // 2000-2025

// --- ACIS API ---

async function acisRequest(endpoint: string, body: object): Promise<any> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${ACIS_BASE}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) return await res.json();
      if (res.status >= 500 && attempt < 2) {
        console.log(`    ACIS ${res.status}, retry ${attempt + 1}/3...`);
        await new Promise((r) => setTimeout(r, (attempt + 1) * 3000));
        continue;
      }
      throw new Error(`ACIS error: ${res.status} ${await res.text()}`);
    } catch (err: any) {
      if (err.message?.startsWith("ACIS error")) throw err;
      if (attempt < 2) {
        console.log(`    ACIS network error, retry ${attempt + 1}/3: ${err.message}`);
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

/** Fetch monthly avg high/low temps for a state/year via GridData */
async function fetchMonthlyNormals(stateAbbr: string, year: number): Promise<{ month: number; avgHigh: number; avgLow: number }[]> {
  const data = await acisRequest("GridData", {
    state: stateAbbr,
    grid: "21",
    sdate: `${year}-01-01`,
    edate: `${year}-12-31`,
    elems: [
      { name: "maxt", interval: "mly", duration: "mly", reduce: "mean" },
      { name: "mint", interval: "mly", duration: "mly", reduce: "mean" },
    ],
  });

  const results: { month: number; avgHigh: number; avgLow: number }[] = [];
  if (data?.data) {
    for (let i = 0; i < data.data.length; i++) {
      const row = data.data[i];
      // GridData returns [[date, maxt, mint], ...]
      const dateStr = row[0];
      const maxt = parseFloat(row[1]);
      const mint = parseFloat(row[2]);
      if (!isNaN(maxt) && !isNaN(mint)) {
        const month = parseInt(dateStr.split("-")[1], 10);
        results.push({ month, avgHigh: Math.round(maxt * 10) / 10, avgLow: Math.round(mint * 10) / 10 });
      }
    }
  }
  return results;
}

/** Fetch daily min temps for a state over a date range via GridData */
async function fetchDailyMinTemps(stateAbbr: string, sdate: string, edate: string): Promise<{ date: string; minTemp: number }[]> {
  const data = await acisRequest("GridData", {
    state: stateAbbr,
    grid: "21",
    sdate,
    edate,
    elems: [{ name: "mint", interval: "dly", duration: "dly", reduce: "mean" }],
  });

  const results: { date: string; minTemp: number }[] = [];
  if (data?.data) {
    for (const row of data.data) {
      const dateStr = row[0];
      const mint = parseFloat(row[1]);
      if (!isNaN(mint)) {
        results.push({ date: dateStr, minTemp: Math.round(mint * 10) / 10 });
      }
    }
  }
  return results;
}

/** Find first freeze date in fall (first day <= 32°F, Oct-Dec) */
function findFirstFreeze(dailyTemps: { date: string; minTemp: number }[]): string | null {
  for (const day of dailyTemps) {
    if (day.minTemp <= 32) return day.date;
  }
  return null;
}

/** Find last freeze date in spring (last day <= 32°F, Jan-Apr) */
function findLastFreeze(dailyTemps: { date: string; minTemp: number }[]): string | null {
  let lastFreeze: string | null = null;
  for (const day of dailyTemps) {
    if (day.minTemp <= 32) lastFreeze = day.date;
  }
  return lastFreeze;
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

interface ClimateEntry {
  stateAbbr: string;
  year: number;
  firstFreezeDate: string | null;
  lastFreezeDate: string | null;
  monthlyNormals: { month: number; avgHigh: number; avgLow: number }[];
  embedText: string;
}

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function buildEntry(
  stateAbbr: string,
  year: number,
  firstFreezeDate: string | null,
  lastFreezeDate: string | null,
  monthlyNormals: { month: number; avgHigh: number; avgLow: number }[],
): ClimateEntry {
  const normalsStr = monthlyNormals
    .map((m) => `${MONTH_NAMES[m.month - 1]}:${m.avgHigh}/${m.avgLow}`)
    .join(", ");

  const freezeStr = `first_freeze:${firstFreezeDate || "none"} last_freeze:${lastFreezeDate || "none"}`;
  const embedText = `climate-normal | ${stateAbbr} | ${year} | ${freezeStr} | monthly_normals:{${normalsStr}}`;

  return { stateAbbr, year, firstFreezeDate, lastFreezeDate, monthlyNormals, embedText };
}

function entryToRow(entry: ClimateEntry, embedding: number[]) {
  return {
    title: `Climate normals ${entry.stateAbbr} ${entry.year}`,
    content: entry.embedText,
    content_type: "climate-normal",
    tags: [entry.stateAbbr, "climate", "freeze", "normal", "baseline"],
    state_abbr: entry.stateAbbr,
    species: null,
    effective_date: `${entry.year}-01-01`,
    metadata: {
      source: "noaa-acis",
      year: entry.year,
      first_freeze_date: entry.firstFreezeDate,
      last_freeze_date: entry.lastFreezeDate,
      monthly_normals: entry.monthlyNormals,
    },
    embedding: JSON.stringify(embedding),
  };
}

async function main() {
  const START_STATE = process.env.START_STATE || null;

  const totalEntries = STATE_ABBRS.length * YEARS.length;

  console.log("=== Backfill NOAA ACIS Climate Normals ===");
  console.log(`States: ${STATE_ABBRS.length} | Years: ${YEARS.length} (2000-2025) | Total: ${totalEntries}`);
  if (START_STATE) console.log(`Resuming from state: ${START_STATE}`);

  let globalCount = 0;
  let skippingState = !!START_STATE;

  for (const abbr of STATE_ABBRS) {
    if (skippingState) {
      if (abbr === START_STATE) {
        skippingState = false;
      } else {
        console.log(`Skipping ${abbr} (before ${START_STATE})`);
        globalCount += YEARS.length;
        continue;
      }
    }

    console.log(`\n${abbr} (${STATE_NAMES[abbr]}):`);

    let batchTexts: string[] = [];
    let batchEntries: ClimateEntry[] = [];
    let pendingRows: any[] = [];
    let stateCount = 0;

    for (const year of YEARS) {
      // Fetch monthly normals
      let monthlyNormals: { month: number; avgHigh: number; avgLow: number }[] = [];
      try {
        monthlyNormals = await fetchMonthlyNormals(abbr, year);
      } catch (err: any) {
        console.log(`  ${year} monthly normals failed: ${err.message} — skipping`);
      }
      await new Promise((r) => setTimeout(r, 500));

      // Fetch fall daily mins for first freeze (Oct-Dec)
      let firstFreezeDate: string | null = null;
      try {
        const fallTemps = await fetchDailyMinTemps(abbr, `${year}-10-01`, `${year}-12-31`);
        firstFreezeDate = findFirstFreeze(fallTemps);
      } catch (err: any) {
        console.log(`  ${year} fall temps failed: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 500));

      // Fetch spring daily mins for last freeze (Jan-Apr)
      let lastFreezeDate: string | null = null;
      try {
        const springTemps = await fetchDailyMinTemps(abbr, `${year}-01-01`, `${year}-04-30`);
        lastFreezeDate = findLastFreeze(springTemps);
      } catch (err: any) {
        console.log(`  ${year} spring temps failed: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 500));

      const entry = buildEntry(abbr, year, firstFreezeDate, lastFreezeDate, monthlyNormals);
      batchTexts.push(entry.embedText);
      batchEntries.push(entry);

      stateCount++;
      globalCount++;

      // Embed in batches of 20
      if (batchTexts.length === 20 || year === YEARS[YEARS.length - 1]) {
        const embeddings = await batchEmbed(batchTexts);

        for (let j = 0; j < batchEntries.length; j++) {
          pendingRows.push(entryToRow(batchEntries[j], embeddings[j]));
        }

        const batchStart = batchEntries[0].year;
        const batchEnd = batchEntries[batchEntries.length - 1].year;
        console.log(`  ${batchStart}-${batchEnd} (${batchTexts.length} embedded, ${stateCount}/${YEARS.length} state, ${globalCount}/${totalEntries} total)`);

        batchTexts = [];
        batchEntries = [];

        // Insert when we have 20+ pending rows
        if (pendingRows.length >= 20) {
          await insertBatch(pendingRows);
          pendingRows = [];
        }

        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Flush remaining rows for this state
    if (pendingRows.length > 0) {
      await insertBatch(pendingRows);
    }

    console.log(`  ${abbr} done: ${stateCount} entries`);
  }

  console.log(`\n=== Complete: ${globalCount} climate-normal entries embedded ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
