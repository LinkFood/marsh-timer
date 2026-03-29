/**
 * Backfill 5 additional Open-Meteo data types into hunt_knowledge
 * Fetches 5 years (2021-01-01 to 2026-03-28) from Open-Meteo archive API
 * for all 50 US states, embeds via Voyage AI, stores in hunt_knowledge.
 *
 * Content types: evapotranspiration, cloud-visibility, humidity-profile,
 *                solar-radiation, pressure-tendency
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-open-meteo-expansion.ts
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

async function fetchExpansionData(lat: number, lng: number): Promise<any> {
  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lng.toString(),
    start_date: START_DATE,
    end_date: END_DATE,
    daily: [
      "et0_fao_evapotranspiration",
      "cloud_cover_mean",
      "visibility_mean",
      "dew_point_2m_mean",
      "shortwave_radiation_sum",
      "sunrise",
      "sunset",
    ].join(","),
    hourly: "pressure_msl",
    temperature_unit: "fahrenheit",
    timezone: "America/New_York",
  });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
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
    } catch (err) {
      if (attempt < 2) {
        console.log(`    Fetch failed (${(err as Error).message}), retry ${attempt + 1}/3 in ${(attempt + 1) * 10}s...`);
        await delay((attempt + 1) * 10000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Open-Meteo: exhausted retries");
}

// ---------- Pressure tendency ----------

function calcMaxPressureChange3hr(hourlyPressure: (number | null)[], dayIndex: number): number | null {
  // Each day has 24 hourly readings, starting at dayIndex * 24
  const startHour = dayIndex * 24;
  let maxChange: number | null = null;

  for (let h = 0; h <= 21; h++) {
    const p0 = hourlyPressure[startHour + h];
    const p3 = hourlyPressure[startHour + h + 3];
    if (p0 != null && p3 != null) {
      const change = Math.abs(p3 - p0);
      if (maxChange == null || change > maxChange) {
        maxChange = change;
      }
    }
  }

  return maxChange;
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

interface DayData {
  date: string;
  et0: number | null;
  cloudCover: number | null;
  visibility: number | null;
  dewPoint: number | null;
  shortwaveRadiation: number | null;
  sunrise: string | null;
  sunset: string | null;
  maxPressureChange3hr: number | null;
}

function buildEntries(stateAbbr: string, day: DayData, recentET: number[]): { title: string; content: string; content_type: string; tags: string[]; metadata: Record<string, any> }[] {
  const name = STATE_NAMES[stateAbbr];
  const entries: { title: string; content: string; content_type: string; tags: string[]; metadata: Record<string, any> }[] = [];

  // 1. Evapotranspiration
  if (day.et0 != null) {
    const cum7 = recentET.reduce((a, b) => a + b, 0) + day.et0;
    let droughtNote = "";
    if (cum7 > 35) droughtNote = " 7-day cumulative ET > 35mm — drought forming.";
    entries.push({
      title: `${stateAbbr} evapotranspiration ${day.date}`,
      content: `Evapotranspiration for ${name} (${stateAbbr}) on ${day.date}: ET0 ${round1(day.et0)}mm.${droughtNote}`,
      content_type: "evapotranspiration",
      tags: ["evapotranspiration", "drought", "moisture", stateAbbr.toLowerCase()],
      metadata: { source: "open-meteo-archive", et0_mm: day.et0, cumulative_7day_et_mm: round1(cum7) },
    });
  }

  // 2. Cloud-Visibility
  if (day.cloudCover != null || day.visibility != null) {
    const cc = day.cloudCover != null ? `cloud cover ${round1(day.cloudCover)}%` : "cloud cover N/A";
    const vis = day.visibility != null ? `visibility ${round1(day.visibility)}km` : "visibility N/A";
    let note = "";
    if (day.visibility != null && day.visibility < 1.6) note = " Fog conditions.";
    else if (day.cloudCover != null && day.cloudCover > 90) note = " Overcast.";
    entries.push({
      title: `${stateAbbr} cloud-visibility ${day.date}`,
      content: `Cloud cover and visibility for ${name} (${stateAbbr}) on ${day.date}: ${cc}, ${vis}.${note}`,
      content_type: "cloud-visibility",
      tags: ["cloud-cover", "visibility", "fog", stateAbbr.toLowerCase()],
      metadata: { source: "open-meteo-archive", cloud_cover_pct: day.cloudCover, visibility_km: day.visibility },
    });
  }

  // 3. Humidity-Profile
  if (day.dewPoint != null) {
    let note = "";
    if (day.dewPoint > 65) note = " High moisture — potential migration suppression.";
    entries.push({
      title: `${stateAbbr} humidity-profile ${day.date}`,
      content: `Humidity for ${name} (${stateAbbr}) on ${day.date}: dew point ${round1(day.dewPoint)}\u00B0F.${note}`,
      content_type: "humidity-profile",
      tags: ["humidity", "dew-point", "moisture", stateAbbr.toLowerCase()],
      metadata: { source: "open-meteo-archive", dew_point_f: day.dewPoint },
    });
  }

  // 4. Solar-Radiation
  if (day.shortwaveRadiation != null) {
    const sunriseStr = day.sunrise ? day.sunrise.split("T")[1] || day.sunrise : "N/A";
    const sunsetStr = day.sunset ? day.sunset.split("T")[1] || day.sunset : "N/A";
    entries.push({
      title: `${stateAbbr} solar-radiation ${day.date}`,
      content: `Solar radiation for ${name} (${stateAbbr}) on ${day.date}: shortwave ${round1(day.shortwaveRadiation)} MJ/m\u00B2. Daylight: sunrise ${sunriseStr} to sunset ${sunsetStr}.`,
      content_type: "solar-radiation",
      tags: ["solar", "radiation", "daylight", stateAbbr.toLowerCase()],
      metadata: { source: "open-meteo-archive", shortwave_radiation_mj: day.shortwaveRadiation, sunrise: day.sunrise, sunset: day.sunset },
    });
  }

  // 5. Pressure-Tendency
  if (day.maxPressureChange3hr != null) {
    let note = "";
    if (day.maxPressureChange3hr > 6) note = " Bomb cyclone territory.";
    else if (day.maxPressureChange3hr > 3) note = " Rapid deepening.";
    entries.push({
      title: `${stateAbbr} pressure-tendency ${day.date}`,
      content: `Pressure tendency for ${name} (${stateAbbr}) on ${day.date}: max 3hr change ${round1(day.maxPressureChange3hr)}hPa.${note}`,
      content_type: "pressure-tendency",
      tags: ["pressure", "barometric", "tendency", stateAbbr.toLowerCase()],
      metadata: { source: "open-meteo-archive", max_3hr_pressure_change_hpa: day.maxPressureChange3hr },
    });
  }

  return entries;
}

// ---------- Process one state ----------

async function backfillState(stateAbbr: string, lat: number, lng: number): Promise<number> {
  console.log(`  Fetching ${stateAbbr} (${lat}, ${lng})...`);
  const data = await fetchExpansionData(lat, lng);

  const daily = data.daily;
  const hourly = data.hourly;
  if (!daily || !daily.time) {
    console.error(`  No daily data for ${stateAbbr}`);
    return 0;
  }

  const hourlyPressure: (number | null)[] = hourly?.pressure_msl || [];

  // Build day data
  const days: DayData[] = [];
  for (let i = 0; i < daily.time.length; i++) {
    days.push({
      date: daily.time[i],
      et0: daily.et0_fao_evapotranspiration?.[i] ?? null,
      cloudCover: daily.cloud_cover_mean?.[i] ?? null,
      visibility: daily.visibility_mean?.[i] ?? null,
      dewPoint: daily.dew_point_2m_mean?.[i] ?? null,
      shortwaveRadiation: daily.shortwave_radiation_sum?.[i] ?? null,
      sunrise: daily.sunrise?.[i] ?? null,
      sunset: daily.sunset?.[i] ?? null,
      maxPressureChange3hr: calcMaxPressureChange3hr(hourlyPressure, i),
    });
  }

  // Process in chunks — 4 days per chunk = 20 entries max per embed batch
  let totalInserted = 0;
  const CHUNK_SIZE = 4;

  for (let i = 0; i < days.length; i += CHUNK_SIZE) {
    const chunk = days.slice(i, i + CHUNK_SIZE);

    // Build all entries for this chunk
    const allEntries: { title: string; content: string; content_type: string; tags: string[]; metadata: Record<string, any>; date: string }[] = [];
    for (const day of chunk) {
      // Gather recent 6 days of ET for 7-day cumulative check
      const dayIdx = days.indexOf(day);
      const recentET: number[] = [];
      for (let r = Math.max(0, dayIdx - 6); r < dayIdx; r++) {
        if (days[r].et0 != null) recentET.push(days[r].et0!);
      }

      const entries = buildEntries(stateAbbr, day, recentET);
      for (const e of entries) {
        allEntries.push({ ...e, date: day.date });
      }
    }

    if (allEntries.length === 0) continue;

    // Embed in batches of 20
    const embedTexts = allEntries.map((e) => e.content);
    const allEmbeddings: number[][] = [];
    for (let j = 0; j < embedTexts.length; j += 20) {
      const batch = embedTexts.slice(j, j + 20);
      try {
        const embeddings = await batchEmbed(batch);
        allEmbeddings.push(...embeddings);
      } catch (err) {
        console.error(`    Embed batch failed for ${stateAbbr} chunk ${i}+${j}, skipping: ${err}`);
        for (let k = 0; k < batch.length; k++) allEmbeddings.push([]);
      }
      if (j + 20 < embedTexts.length) await delay(500);
    }

    // Build rows for insert
    const rows: Record<string, any>[] = [];
    for (let j = 0; j < allEntries.length; j++) {
      if (allEmbeddings[j].length === 0) continue;
      const e = allEntries[j];
      rows.push({
        title: e.title,
        content: e.content,
        content_type: e.content_type,
        tags: e.tags,
        embedding: JSON.stringify(allEmbeddings[j]),
        metadata: e.metadata,
        state_abbr: stateAbbr,
        effective_date: e.date,
      });
    }

    if (rows.length > 0) {
      await insertBatch(rows);
      totalInserted += rows.length;
    }

    // 500ms between embed batches within a state
    await delay(500);
  }

  const numDays = days.length;
  console.log(`  ${stateAbbr}: ${totalInserted} entries inserted (5 types x ${numDays} days)`);
  return totalInserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== Backfilling Open-Meteo Expansion (5 types) ===");
  console.log(`Content types: evapotranspiration, cloud-visibility, humidity-profile, solar-radiation, pressure-tendency`);
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
    // 3s between states to avoid Open-Meteo rate limiting
    if (i < states.length - 1) {
      await delay(3000);
    }
  }

  console.log(`\nDone! Total: ${total} entries across 5 content types`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
