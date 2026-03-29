/**
 * Backfill river discharge data from Open-Meteo Flood API archive
 * 50 states, 2021-01-01 to 2026-03-28, embeds via Voyage AI → hunt_knowledge
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-river-discharge.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY || null;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

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

const GLOBAL_START = "2021-01-01";
const GLOBAL_END = "2026-03-28";
const CHUNK_DAYS = 365;

const START_STATE = process.env.START_STATE || null;

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

function dateChunks(start: string, end: string): Array<[string, string]> {
  const chunks: Array<[string, string]> = [];
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = addDays(cursor, CHUNK_DAYS - 1);
    chunks.push([cursor, chunkEnd < end ? chunkEnd : end]);
    cursor = addDays(chunkEnd, 1);
  }
  return chunks;
}

function floodStatus(discharge: number, median: number): string {
  if (median <= 0) return "normal flow";
  const ratio = discharge / median;
  if (ratio > 2) return "flood conditions";
  if (ratio >= 1.5) return "elevated flow";
  if (ratio < 0.5) return "drought conditions";
  if (ratio <= 0.7) return "low flow";
  return "normal flow";
}

async function fetchFloodData(
  lat: number,
  lng: number,
  startDate: string,
  endDate: string,
): Promise<any> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lng.toString(),
    start_date: startDate,
    end_date: endDate,
    daily: "river_discharge,river_discharge_mean,river_discharge_median,river_discharge_max,river_discharge_min",
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://flood-api.open-meteo.com/v1/flood?${params}`);
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < 2) {
      const wait = (attempt + 1) * 65000;
      console.log(`    Rate limited, waiting ${Math.round(wait / 1000)}s...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (res.status >= 400 && res.status < 500) {
      throw new Error(`Flood API ${res.status}: ${await res.text()}`);
    }
    if (attempt < 2) {
      const wait = (attempt + 1) * 5000;
      console.log(`    ${res.status} error, retrying in ${Math.round(wait / 1000)}s...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`Flood API error: ${res.status} ${await res.text()}`);
  }
  throw new Error("Flood API: exhausted retries");
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  if (!VOYAGE_API_KEY) return texts.map(() => []);

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "voyage-3-lite",
      input: texts,
      input_type: "document",
    }),
  });

  if (!res.ok) {
    throw new Error(`Voyage API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.data.map((d: any) => d.embedding);
}

async function backfillState(stateAbbr: string, lat: number, lng: number): Promise<number> {
  const stateName = STATE_NAMES[stateAbbr];
  console.log(`  Fetching ${stateAbbr} (${lat}, ${lng})...`);

  const chunks = dateChunks(GLOBAL_START, GLOBAL_END);
  let totalInserted = 0;

  for (const [chunkStart, chunkEnd] of chunks) {
    let data: any;
    try {
      data = await fetchFloodData(lat, lng, chunkStart, chunkEnd);
    } catch (err) {
      console.error(`    ${stateAbbr} chunk ${chunkStart}-${chunkEnd} fetch failed: ${err}`);
      continue;
    }

    const daily = data?.daily;
    if (!daily || !daily.time || !Array.isArray(daily.time) || daily.time.length === 0) {
      console.log(`    ${stateAbbr} chunk ${chunkStart}-${chunkEnd}: no data, skipping`);
      continue;
    }

    // Build rows with embedding text
    const pendingRows: Array<{ row: any; text: string }> = [];

    for (let i = 0; i < daily.time.length; i++) {
      const date = daily.time[i];
      const discharge = daily.river_discharge?.[i];
      const mean = daily.river_discharge_mean?.[i];
      const median = daily.river_discharge_median?.[i];
      const max = daily.river_discharge_max?.[i];
      const min = daily.river_discharge_min?.[i];

      // Skip days with no discharge data
      if (discharge == null && mean == null && median == null) continue;

      const status = (discharge != null && median != null && median > 0)
        ? floodStatus(discharge, median)
        : "unknown";

      const text = `River discharge for ${stateName} (${stateAbbr}) on ${date}: current ${discharge ?? "N/A"} m³/s (mean: ${mean ?? "N/A"}, median: ${median ?? "N/A"}, max: ${max ?? "N/A"}, min: ${min ?? "N/A"}). ${status}`;

      pendingRows.push({
        text,
        row: {
          title: `${stateAbbr} river-discharge ${date}`,
          content: text,
          content_type: "river-discharge",
          tags: ["river-discharge", stateAbbr.toLowerCase(), status.replace(" ", "-")],
          metadata: {
            state: stateAbbr,
            date,
            discharge,
            mean,
            median,
            max,
            min,
            flood_status: status,
            source: "open-meteo-flood",
          },
          state_abbr: stateAbbr,
          effective_date: date,
        },
      });
    }

    if (pendingRows.length === 0) {
      console.log(`    ${stateAbbr} chunk ${chunkStart}-${chunkEnd}: all null, skipping`);
      continue;
    }

    // Embed and insert in batches of 20
    for (let b = 0; b < pendingRows.length; b += 20) {
      const batch = pendingRows.slice(b, b + 20);
      const texts = batch.map((p) => p.text);

      let embeddings: number[][] = [];
      if (VOYAGE_API_KEY) {
        try {
          embeddings = await embedBatch(texts);
        } catch (err) {
          console.error(`    ${stateAbbr} embed batch failed: ${err}`);
          embeddings = [];
        }
      }

      const rows = batch.map((p, idx) => ({
        ...p.row,
        embedding: embeddings[idx] || null,
      }));

      const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(rows),
      });

      if (!res.ok) {
        console.error(`    ${stateAbbr} insert failed (batch ${b}): ${await res.text()}`);
      } else {
        totalInserted += rows.length;
      }
    }

    // 1s delay between API calls
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`  ${stateAbbr}: ${totalInserted} days inserted`);
  return totalInserted;
}

async function main() {
  console.log("=== Backfilling River Discharge ===");
  console.log(`Date range: ${GLOBAL_START} to ${GLOBAL_END}`);
  console.log(`Voyage AI: ${VOYAGE_API_KEY ? "enabled" : "DISABLED (no VOYAGE_API_KEY)"}`);

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
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  console.log(`\nDone! Total: ${total} river discharge rows embedded into hunt_knowledge`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
