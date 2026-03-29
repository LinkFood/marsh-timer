/**
 * Backfill soil moisture + soil temperature data into hunt_knowledge
 * Fetches 5 years (2021-01-01 to 2026-03-28) from Open-Meteo archive API
 * for all 50 US states, embeds via Voyage AI, stores in hunt_knowledge.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-soil-conditions.ts
 *
 * Optional env:
 *   VOYAGE_API_KEY        — direct Voyage embedding (faster). Falls back to edge function.
 *   START_STATE=TX        — resume from this state
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using hunt-generate-embedding edge function (slower)");

const START_STATE = process.env.START_STATE || null;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const START_DATE = "2021-01-01";
const END_DATE = "2026-03-28";

// State centroids for weather lookups (lat, lng)
const STATE_COORDS: Record<string, [number, number]> = {
  AL:[32.8,-86.8],AK:[64.2,-152.5],AZ:[34.0,-111.1],AR:[34.8,-92.2],CA:[36.8,-119.4],
  CO:[39.1,-105.4],CT:[41.6,-72.7],DE:[39.0,-75.5],FL:[27.8,-81.8],GA:[32.2,-83.4],
  HI:[19.9,-155.6],ID:[44.1,-114.7],IL:[40.6,-89.4],IN:[40.3,-86.1],IA:[42.0,-93.2],
  KS:[38.5,-98.8],KY:[37.7,-84.7],LA:[30.5,-91.2],ME:[45.4,-69.2],MD:[39.0,-76.6],
  MA:[42.4,-71.4],MI:[44.3,-85.6],MN:[46.4,-94.6],MS:[32.3,-89.4],MO:[38.6,-92.2],
  MT:[46.8,-110.4],NE:[41.1,-98.3],NV:[38.8,-116.4],NH:[43.5,-71.6],NJ:[40.1,-74.5],
  NM:[34.2,-105.9],NY:[43.0,-75.0],NC:[35.8,-79.8],ND:[47.5,-100.5],OH:[40.4,-82.9],
  OK:[35.0,-97.1],OR:[43.8,-120.6],PA:[41.2,-77.2],RI:[41.6,-71.5],SC:[34.0,-81.0],
  SD:[43.9,-99.4],TN:[35.5,-86.6],TX:[31.0,-100.0],UT:[39.3,-111.1],VT:[44.6,-72.6],
  VA:[37.8,-78.2],WA:[47.8,-120.7],WV:[38.6,-80.6],WI:[43.8,-88.8],WY:[43.1,-107.6],
};

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

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ---------- Open-Meteo Fetch ----------

async function fetchSoilData(lat: number, lng: number): Promise<any> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lng.toString(),
    start_date: START_DATE,
    end_date: END_DATE,
    daily: [
      "soil_temperature_0cm_mean",
      "soil_temperature_6cm_mean",
      "soil_temperature_18cm_mean",
      "soil_temperature_54cm_mean",
      "soil_moisture_0_to_7cm_mean",
      "soil_moisture_7_to_28cm_mean",
      "soil_moisture_28_to_100cm_mean",
    ].join(","),
    temperature_unit: "fahrenheit",
    timezone: "America/New_York",
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`);
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 2) {
      const wait = (attempt + 1) * 65000;
      console.log(`    Rate limited, waiting ${Math.round(wait / 1000)}s...`);
      await delay(wait);
      continue;
    }
    if (res.status >= 500 && attempt < 2) {
      console.log(`    Server error ${res.status}, retry ${attempt + 1}/3...`);
      await delay((attempt + 1) * 5000);
      continue;
    }
    throw new Error(`Open-Meteo error: ${res.status} ${await res.text()}`);
  }
  throw new Error("Open-Meteo: exhausted retries");
}

// ---------- Freeze/thaw ----------

function freezeThawStatus(surfaceTemp: number | null, prevSurfaceTemp: number | null): string {
  if (surfaceTemp == null) return "unknown";
  if (prevSurfaceTemp != null) {
    const crossedFreeze =
      (prevSurfaceTemp <= 32 && surfaceTemp > 32) ||
      (prevSurfaceTemp > 32 && surfaceTemp <= 32);
    if (crossedFreeze) return "freeze-thaw transition";
  }
  return surfaceTemp <= 32 ? "frozen" : "thawed";
}

// ---------- Embedding ----------

async function embedViaEdgeFn(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, input_type: "document" }),
      });
      if (res.ok) { const data = await res.json(); return data.embedding; }
      if (res.status >= 500 && attempt < retries - 1) { await delay((attempt + 1) * 5000); continue; }
      throw new Error(`Edge fn error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) { await delay((attempt + 1) * 10000); continue; }
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
      await delay(100);
    }
    return results;
  }
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "voyage-3-lite", input: texts, input_type: "document" }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.data.map((d: { embedding: number[] }) => d.embedding);
      }
      if (res.status === 429 && attempt < retries - 1) { await delay((attempt + 1) * 30000); continue; }
      if (res.status >= 500 && attempt < retries - 1) { await delay((attempt + 1) * 5000); continue; }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) { await delay((attempt + 1) * 10000); continue; }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// ---------- Supabase insert ----------

async function insertBatch(rows: Record<string, any>[]) {
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
        method: "POST",
        headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(chunk),
      });
      if (res.ok) break;
      if (res.status >= 400 && res.status < 500) {
        const text = await res.text();
        console.error(`  Insert 4xx (not retrying): ${res.status} ${text}`);
        break;
      }
      if (attempt < 2) {
        console.log(`  Insert retry ${attempt + 1}/3...`);
        await delay(5000);
        continue;
      }
      const text = await res.text();
      console.error(`  Insert batch failed after retries: ${text}`);
    }
  }
}

// ---------- Build entries ----------

interface DayEntry {
  date: string;
  surfaceTemp: number | null;
  temp6cm: number | null;
  temp18cm: number | null;
  temp54cm: number | null;
  moisture0_7: number | null;
  moisture7_28: number | null;
  moisture28_100: number | null;
  freezeThaw: string;
}

function buildEmbedText(stateAbbr: string, entry: DayEntry): string {
  const name = STATE_NAMES[stateAbbr];
  const st = entry.surfaceTemp != null ? `${round1(entry.surfaceTemp)}` : "N/A";
  const t6 = entry.temp6cm != null ? `${round1(entry.temp6cm)}` : "N/A";
  const t18 = entry.temp18cm != null ? `${round1(entry.temp18cm)}` : "N/A";
  const t54 = entry.temp54cm != null ? `${round1(entry.temp54cm)}` : "N/A";
  const m07 = entry.moisture0_7 != null ? `${round1(entry.moisture0_7)}` : "N/A";
  const m728 = entry.moisture7_28 != null ? `${round1(entry.moisture7_28)}` : "N/A";
  const m28100 = entry.moisture28_100 != null ? `${round1(entry.moisture28_100)}` : "N/A";

  return `Soil conditions for ${name} (${stateAbbr}) on ${entry.date}: surface temp ${st}\u00B0F (6cm: ${t6}\u00B0F, 18cm: ${t18}\u00B0F, 54cm: ${t54}\u00B0F), moisture 0-7cm: ${m07}, 7-28cm: ${m728}, 28-100cm: ${m28100}. Freeze/thaw: ${entry.freezeThaw}`;
}

// ---------- Process one state ----------

async function backfillState(stateAbbr: string, lat: number, lng: number): Promise<number> {
  console.log(`  Fetching ${stateAbbr} (${lat}, ${lng})...`);
  const data = await fetchSoilData(lat, lng);

  const daily = data.daily;
  if (!daily || !daily.time) {
    console.error(`  No daily data for ${stateAbbr}`);
    return 0;
  }

  // Build day entries with freeze/thaw
  const days: DayEntry[] = [];
  for (let i = 0; i < daily.time.length; i++) {
    const surfaceTemp = daily.soil_temperature_0cm_mean?.[i] ?? null;
    const prevSurfaceTemp = i > 0 ? (daily.soil_temperature_0cm_mean?.[i - 1] ?? null) : null;

    days.push({
      date: daily.time[i],
      surfaceTemp,
      temp6cm: daily.soil_temperature_6cm_mean?.[i] ?? null,
      temp18cm: daily.soil_temperature_18cm_mean?.[i] ?? null,
      temp54cm: daily.soil_temperature_54cm_mean?.[i] ?? null,
      moisture0_7: daily.soil_moisture_0_to_7cm_mean?.[i] ?? null,
      moisture7_28: daily.soil_moisture_7_to_28cm_mean?.[i] ?? null,
      moisture28_100: daily.soil_moisture_28_to_100cm_mean?.[i] ?? null,
      freezeThaw: freezeThawStatus(surfaceTemp, prevSurfaceTemp),
    });
  }

  // Process ~30 days at a time to keep embedding batches manageable
  let totalInserted = 0;
  const CHUNK_SIZE = 30;

  for (let i = 0; i < days.length; i += CHUNK_SIZE) {
    const chunk = days.slice(i, i + CHUNK_SIZE);
    const embedTexts = chunk.map((d) => buildEmbedText(stateAbbr, d));

    // Embed in batches of 20
    const allEmbeddings: number[][] = [];
    for (let j = 0; j < embedTexts.length; j += 20) {
      const batch = embedTexts.slice(j, j + 20);
      try {
        const embeddings = await batchEmbed(batch);
        allEmbeddings.push(...embeddings);
      } catch (err) {
        console.error(`    Embed batch failed for ${stateAbbr} chunk ${i}+${j}, skipping: ${err}`);
        // Fill with empty to skip these entries
        for (let k = 0; k < batch.length; k++) allEmbeddings.push([]);
      }
      if (j + 20 < embedTexts.length) await delay(500);
    }

    // Build rows for insert
    const rows: Record<string, any>[] = [];
    for (let j = 0; j < chunk.length; j++) {
      if (allEmbeddings[j].length === 0) continue; // skipped due to embed failure
      const d = chunk[j];
      const text = embedTexts[j];
      rows.push({
        title: `${stateAbbr} soil-conditions ${d.date}`,
        content: text,
        content_type: "soil-conditions",
        tags: ["soil", "moisture", "temperature", "freeze-thaw", stateAbbr.toLowerCase()],
        embedding: JSON.stringify(allEmbeddings[j]),
        metadata: {
          source: "open-meteo-archive",
          surface_temp_f: d.surfaceTemp,
          temp_6cm_f: d.temp6cm,
          temp_18cm_f: d.temp18cm,
          temp_54cm_f: d.temp54cm,
          moisture_0_7cm: d.moisture0_7,
          moisture_7_28cm: d.moisture7_28,
          moisture_28_100cm: d.moisture28_100,
          freeze_thaw: d.freezeThaw,
        },
        state_abbr: stateAbbr,
        effective_date: d.date,
      });
    }

    if (rows.length > 0) {
      await insertBatch(rows);
      totalInserted += rows.length;
    }

    // 1s delay between API calls to avoid rate limiting
    await delay(1000);
  }

  console.log(`  ${stateAbbr}: ${totalInserted} days inserted`);
  return totalInserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== Backfilling Soil Conditions ===");
  console.log(`Date range: ${START_DATE} to ${END_DATE}`);
  if (START_STATE) console.log(`Resuming from: ${START_STATE}`);

  let total = 0;
  const states = Object.entries(STATE_COORDS);
  let startFound = !START_STATE;

  for (let i = 0; i < states.length; i++) {
    const [abbr, [lat, lng]] = states[i];
    if (!startFound) {
      if (abbr === START_STATE) startFound = true;
      else continue;
    }
    try {
      const count = await backfillState(abbr, lat, lng);
      total += count;
    } catch (err) {
      console.error(`  FAILED ${abbr}: ${err}`);
    }
    // 1s between states
    if (i < states.length - 1) {
      await delay(1000);
    }
  }

  console.log(`\nDone! Total: ${total} soil-conditions entries`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
