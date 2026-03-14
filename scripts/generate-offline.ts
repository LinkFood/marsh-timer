/**
 * Offline embedding generator — calls Voyage AI, saves to JSON files.
 * Does NOT touch Supabase. Zero database IO.
 *
 * Usage:
 *   VOYAGE_API_KEY=... npx tsx scripts/generate-offline.ts --source photoperiod --start-state OH
 *   VOYAGE_API_KEY=... npx tsx scripts/generate-offline.ts --source usda-crops --nass-key KEY
 *
 * If no VOYAGE_API_KEY, uses the hunt-generate-embedding edge function (slower).
 *
 * Output: ~/Desktop/DCD/backfill-staging/{source}/*.json
 */

import * as fs from "fs";
import * as path from "path";

// --- Config ---

const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) {
  if (!SERVICE_KEY) {
    console.error("No VOYAGE_API_KEY and no SUPABASE_SERVICE_ROLE_KEY — need one or the other for embeddings");
    process.exit(1);
  }
  console.log("No VOYAGE_API_KEY — using hunt-generate-embedding edge function (slower)");
}

const STAGING_ROOT = path.join(process.env.HOME || "~", "Desktop", "DCD", "backfill-staging");

// --- CLI args ---

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

const SOURCE = getArg("source");
const START_STATE = getArg("start-state") || process.env.START_STATE || null;
const NASS_API_KEY = getArg("nass-key") || process.env.NASS_API_KEY || null;

if (!SOURCE) {
  console.error("Usage: npx tsx scripts/generate-offline.ts --source <source> [--start-state XX]");
  console.error("Available sources: photoperiod, usda-crops");
  process.exit(1);
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
  // Direct Voyage API (faster, batched)
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

// --- File IO ---

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeStateFile(source: string, stateAbbr: string, rows: any[]): void {
  const dir = path.join(STAGING_ROOT, source);
  ensureDir(dir);
  const filePath = path.join(dir, `${stateAbbr}.json`);
  // Compact format for large datasets — one JSON array, no pretty-print
  fs.writeFileSync(filePath, JSON.stringify(rows));
  console.log(`  Saved ${filePath} (${rows.length} rows, ${(fs.statSync(filePath).size / 1024 / 1024).toFixed(1)}MB)`);
}

// ============================================================
// SOURCE: photoperiod
// ============================================================

const STATE_CENTROIDS: Record<string, { name: string; lat: number }> = {
  AL: { name: "Alabama", lat: 32.807 },
  AK: { name: "Alaska", lat: 63.589 },
  AZ: { name: "Arizona", lat: 34.049 },
  AR: { name: "Arkansas", lat: 34.970 },
  CA: { name: "California", lat: 36.116 },
  CO: { name: "Colorado", lat: 39.060 },
  CT: { name: "Connecticut", lat: 41.598 },
  DE: { name: "Delaware", lat: 39.319 },
  FL: { name: "Florida", lat: 27.766 },
  GA: { name: "Georgia", lat: 33.041 },
  HI: { name: "Hawaii", lat: 21.094 },
  ID: { name: "Idaho", lat: 44.240 },
  IL: { name: "Illinois", lat: 40.349 },
  IN: { name: "Indiana", lat: 39.849 },
  IA: { name: "Iowa", lat: 42.012 },
  KS: { name: "Kansas", lat: 38.527 },
  KY: { name: "Kentucky", lat: 37.668 },
  LA: { name: "Louisiana", lat: 31.170 },
  ME: { name: "Maine", lat: 44.694 },
  MD: { name: "Maryland", lat: 39.064 },
  MA: { name: "Massachusetts", lat: 42.230 },
  MI: { name: "Michigan", lat: 43.327 },
  MN: { name: "Minnesota", lat: 45.694 },
  MS: { name: "Mississippi", lat: 32.742 },
  MO: { name: "Missouri", lat: 38.456 },
  MT: { name: "Montana", lat: 46.922 },
  NE: { name: "Nebraska", lat: 41.125 },
  NV: { name: "Nevada", lat: 38.314 },
  NH: { name: "New Hampshire", lat: 43.452 },
  NJ: { name: "New Jersey", lat: 40.299 },
  NM: { name: "New Mexico", lat: 34.841 },
  NY: { name: "New York", lat: 42.166 },
  NC: { name: "North Carolina", lat: 35.630 },
  ND: { name: "North Dakota", lat: 47.529 },
  OH: { name: "Ohio", lat: 40.389 },
  OK: { name: "Oklahoma", lat: 35.565 },
  OR: { name: "Oregon", lat: 44.572 },
  PA: { name: "Pennsylvania", lat: 40.591 },
  RI: { name: "Rhode Island", lat: 41.681 },
  SC: { name: "South Carolina", lat: 33.857 },
  SD: { name: "South Dakota", lat: 44.300 },
  TN: { name: "Tennessee", lat: 35.748 },
  TX: { name: "Texas", lat: 31.054 },
  UT: { name: "Utah", lat: 40.150 },
  VT: { name: "Vermont", lat: 44.046 },
  VA: { name: "Virginia", lat: 37.769 },
  WA: { name: "Washington", lat: 47.401 },
  WV: { name: "West Virginia", lat: 38.491 },
  WI: { name: "Wisconsin", lat: 44.269 },
  WY: { name: "Wyoming", lat: 42.756 },
};

const STATE_ABBRS = Object.keys(STATE_CENTROIDS).sort();

// --- Solar calculations (identical to backfill-photoperiod.ts) ---

function dayOfYear(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date.getTime() - start.getTime();
  return Math.floor(diff / 86400000);
}

function calcDayLength(lat: number, doy: number): { sunrise: number; sunset: number; dayLength: number } {
  const P = Math.asin(0.39795 * Math.cos(0.2163108 + 2 * Math.atan(0.9671396 * Math.tan(0.00860 * (doy - 186)))));
  const cosArg = (Math.sin(0.8333 * Math.PI / 180) + Math.sin(lat * Math.PI / 180) * Math.sin(P)) /
    (Math.cos(lat * Math.PI / 180) * Math.cos(P));

  if (cosArg > 1) return { sunrise: 12, sunset: 12, dayLength: 0 };
  if (cosArg < -1) return { sunrise: 0, sunset: 24, dayLength: 24 };

  const D = 24 - (24 / Math.PI) * Math.acos(cosArg);
  const sunrise = 12 - D / 2;
  const sunset = 12 + D / 2;
  return { sunrise, sunset, dayLength: D };
}

function calcCivilTwilight(lat: number, doy: number): { start: number; end: number } {
  const P = Math.asin(0.39795 * Math.cos(0.2163108 + 2 * Math.atan(0.9671396 * Math.tan(0.00860 * (doy - 186)))));
  const cosArg = (Math.sin(-6 * Math.PI / 180) + Math.sin(lat * Math.PI / 180) * Math.sin(P)) /
    (Math.cos(lat * Math.PI / 180) * Math.cos(P));

  if (cosArg > 1) return { start: 12, end: 12 };
  if (cosArg < -1) return { start: 0, end: 24 };

  const D = 24 - (24 / Math.PI) * Math.acos(cosArg);
  const start = 12 - D / 2;
  const end = 12 + D / 2;
  return { start, end };
}

function hoursToTime(h: number): string {
  const totalMin = Math.round(h * 60);
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function daysToNearestAstronomicalEvent(date: Date): { event: string; days: number } {
  const year = date.getFullYear();
  const events = [
    { event: "spring_equinox", date: new Date(year, 2, 20) },
    { event: "summer_solstice", date: new Date(year, 5, 21) },
    { event: "fall_equinox", date: new Date(year, 8, 22) },
    { event: "winter_solstice", date: new Date(year, 11, 21) },
    { event: "spring_equinox", date: new Date(year + 1, 2, 20) },
    { event: "winter_solstice", date: new Date(year - 1, 11, 21) },
  ];

  let closest = events[0];
  let minDays = Infinity;
  for (const ev of events) {
    const diff = Math.abs(Math.round((ev.date.getTime() - date.getTime()) / 86400000));
    if (diff < minDays) {
      minDays = diff;
      closest = ev;
    }
  }
  return { event: closest.event, days: minDays };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function generateDates(startDate: string, endDate: string, step: number): Date[] {
  const dates: Date[] = [];
  const current = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T00:00:00Z");
  while (current <= end) {
    dates.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + step);
  }
  return dates;
}

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

function preparePhotoperiodEntry(abbr: string, lat: number, date: Date, prevDayLength: number | null): PreparedEntry {
  const doy = dayOfYear(date);
  const dateStr = formatDate(date);
  const { sunrise, sunset, dayLength: dl } = calcDayLength(lat, doy);
  const twilight = calcCivilTwilight(lat, doy);
  const astro = daysToNearestAstronomicalEvent(date);

  const totalMinutes = Math.round(dl * 60);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  let changeSeconds = 0;
  let changeSign = "+";
  if (prevDayLength !== null) {
    changeSeconds = Math.round((dl - prevDayLength) * 3600);
    changeSign = changeSeconds >= 0 ? "+" : "-";
  }
  const absChange = Math.abs(changeSeconds);
  const changeMins = Math.floor(absChange / 60);
  const changeSecs = absChange % 60;

  const below13h = dl < 13;
  const below11h = dl < 11;
  const above13h = dl >= 13;
  const crossing12h = Math.abs(dl - 12) < 0.25;

  let threshold = "none";
  if (crossing12h) threshold = "crossing_12h";
  else if (below11h) threshold = "below_11h";
  else if (below13h) threshold = "below_13h";
  else if (above13h) threshold = "above_13h";

  const twilightStartStr = hoursToTime(twilight.start);
  const twilightEndStr = hoursToTime(twilight.end);

  const embedText = `photoperiod | ${abbr} | ${dateStr} | daylight:${hours}h${String(mins).padStart(2, "0")}m | change:${changeSign}${changeMins}m${String(changeSecs).padStart(2, "0")}s/day | civil_twilight:${twilightStartStr}-${twilightEndStr} | threshold:${threshold} | equinox_days:${astro.days}`;

  return {
    title: `${abbr} photoperiod ${dateStr}`,
    content: embedText,
    content_type: "photoperiod",
    tags: [abbr, "photoperiod", "migration-trigger", "daylight"],
    state_abbr: abbr,
    species: null,
    effective_date: dateStr,
    metadata: {
      source: "computed",
      day_length_hours: parseFloat(dl.toFixed(4)),
      day_length_minutes: totalMinutes,
      daily_change_seconds: changeSeconds,
      civil_twilight_start: twilightStartStr,
      civil_twilight_end: twilightEndStr,
      below_13h: below13h,
      below_11h: below11h,
      equinox_days: astro.days,
      nearest_event: astro.event,
    },
    embedText,
  };
}

async function generatePhotoperiod(): Promise<void> {
  const allDates = generateDates("2021-01-01", "2026-12-31", 3);
  const totalPerState = allDates.length;

  let skippingState = !!START_STATE;
  let totalGenerated = 0;

  console.log(`States: ${STATE_ABBRS.length} | Dates per state: ${totalPerState} (every 3rd day)`);
  if (START_STATE) console.log(`Resuming from state: ${START_STATE}`);

  for (const abbr of STATE_ABBRS) {
    if (skippingState) {
      if (abbr === START_STATE) {
        skippingState = false;
      } else {
        console.log(`Skipping ${abbr} (before ${START_STATE})`);
        continue;
      }
    }

    // Skip if file already exists (resume support)
    const existingFile = path.join(STAGING_ROOT, "photoperiod", `${abbr}.json`);
    if (fs.existsSync(existingFile)) {
      console.log(`Skipping ${abbr} (${existingFile} already exists)`);
      continue;
    }

    const lat = STATE_CENTROIDS[abbr].lat;
    console.log(`\n${abbr} (${STATE_CENTROIDS[abbr].name}, lat ${lat}):`);

    try {
      const stateRows: any[] = [];
      let batchTexts: string[] = [];
      let batchEntries: PreparedEntry[] = [];
      let stateCount = 0;

      for (let i = 0; i < allDates.length; i++) {
        const date = allDates[i];

        // Compute previous day's length for accurate daily change
        const prevDay = new Date(date);
        prevDay.setUTCDate(prevDay.getUTCDate() - 1);
        const prevDL = calcDayLength(lat, dayOfYear(prevDay)).dayLength;

        const entry = preparePhotoperiodEntry(abbr, lat, date, prevDL);
        batchTexts.push(entry.embedText);
        batchEntries.push(entry);

        // Embed in batches of 20
        if (batchTexts.length === 20 || i === allDates.length - 1) {
          const embeddings = await batchEmbed(batchTexts);

          for (let j = 0; j < batchEntries.length; j++) {
            const e = batchEntries[j];
            stateRows.push({
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
          const batchStart = formatDate(allDates[Math.max(0, i - batchTexts.length + 1)]);
          const batchEnd = formatDate(date);
          console.log(`  ${batchStart} to ${batchEnd} (${batchTexts.length} embedded, ${stateCount}/${totalPerState})`);

          batchTexts = [];
          batchEntries = [];

          // Small pause between Voyage batches
          await new Promise((r) => setTimeout(r, 300));
        }
      }

      // Write state file
      writeStateFile("photoperiod", abbr, stateRows);
      totalGenerated += stateRows.length;
      console.log(`  ${abbr}: ${stateRows.length} entries generated`);

    } catch (err) {
      console.error(`  ${abbr} FAILED (continuing to next state): ${err}`);
    }
  }

  console.log(`\nPhotoperiod complete: ${totalGenerated} entries generated to ${path.join(STAGING_ROOT, "photoperiod")}/`);
}

// ============================================================
// SOURCE: usda-crops
// ============================================================

const CROPS = ["CORN", "RICE", "SOYBEANS", "WHEAT", "SORGHUM", "SUNFLOWER"] as const;
type CropName = typeof CROPS[number];
const CROP_YEARS = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
const NASS_BASE = "https://quickstats.nass.usda.gov/api/api_GET";

interface NassRecord {
  county_name: string;
  county_code: string;
  Value: string;
  commodity_desc: string;
}

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
  const cleaned = value.replace(/,/g, "").trim();
  const parsed = parseInt(cleaned, 10);
  return isNaN(parsed) ? null : parsed;
}

async function fetchCropData(stateAbbr: string, crop: CropName, year: number): Promise<NassRecord[]> {
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
        if (data.data && Array.isArray(data.data)) {
          return data.data;
        }
        return [];
      }
      if (res.status >= 500 && attempt < 2) {
        console.log(`    NASS 5xx for ${crop}/${stateAbbr}/${year}, retry ${attempt + 1}...`);
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
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

async function generateUsdaCrops(): Promise<void> {
  if (!NASS_API_KEY) {
    console.error("NASS API key required: --nass-key KEY or NASS_API_KEY env var");
    console.error("Register at https://quickstats.nass.usda.gov/api");
    process.exit(1);
  }

  let skippingState = !!START_STATE;
  let totalGenerated = 0;

  console.log(`States: ${STATE_ABBRS.length} | Crops: ${CROPS.length} | Years: ${CROP_YEARS.length}`);
  if (START_STATE) console.log(`Resuming from state: ${START_STATE}`);

  for (const stateAbbr of STATE_ABBRS) {
    if (skippingState) {
      if (stateAbbr === START_STATE) {
        skippingState = false;
      } else {
        console.log(`Skipping ${stateAbbr} (before ${START_STATE})`);
        continue;
      }
    }

    // Skip if file already exists (resume support)
    const existingFile = path.join(STAGING_ROOT, "usda-crops", `${stateAbbr}.json`);
    if (fs.existsSync(existingFile)) {
      console.log(`Skipping ${stateAbbr} (${existingFile} already exists)`);
      continue;
    }

    console.log(`\n${stateAbbr}:`);

    try {
      const stateRows: any[] = [];

      for (const year of CROP_YEARS) {
        // Fetch all crops for this state/year
        const cropResults: Record<CropName, NassRecord[]> = {} as any;
        for (const crop of CROPS) {
          cropResults[crop] = await fetchCropData(stateAbbr, crop, year);
          // 500ms delay between NASS API calls
          await new Promise((r) => setTimeout(r, 500));
        }

        // Combine by county
        const countyMap = new Map<string, CountyCropData>();

        for (const crop of CROPS) {
          for (const record of cropResults[crop]) {
            if (!record.county_name || !record.county_code) continue;
            if (record.county_code === "998" || record.county_code === "999") continue;

            const key = record.county_code;
            if (!countyMap.has(key)) {
              countyMap.set(key, {
                countyName: record.county_name,
                countyCode: record.county_code,
                rice: null, corn: null, soybeans: null,
                wheat: null, sorghum: null, sunflower: null,
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

        const counties = Array.from(countyMap.values());
        let batchTexts: string[] = [];
        let batchMeta: { county: CountyCropData; embedText: string }[] = [];
        let yearCount = 0;

        for (let i = 0; i < counties.length; i++) {
          const c = counties[i];

          const parts: string[] = [];
          if (c.rice !== null) parts.push(`rice:${c.rice}ac`);
          if (c.corn !== null) parts.push(`corn:${c.corn}ac`);
          if (c.soybeans !== null) parts.push(`soybeans:${c.soybeans}ac`);
          if (c.wheat !== null) parts.push(`wheat:${c.wheat}ac`);
          if (c.sorghum !== null) parts.push(`sorghum:${c.sorghum}ac`);
          if (c.sunflower !== null) parts.push(`sunflower:${c.sunflower}ac`);

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
              stateRows.push({
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
            batchTexts = [];
            batchMeta = [];

            // Pause between Voyage batches
            await new Promise((r) => setTimeout(r, 300));
          }
        }

        console.log(`  ${year}: ${yearCount} counties embedded`);
      }

      // Write state file
      writeStateFile("usda-crops", stateAbbr, stateRows);
      totalGenerated += stateRows.length;
      console.log(`  ${stateAbbr}: ${stateRows.length} entries generated`);

    } catch (err) {
      console.error(`  ${stateAbbr} FAILED (continuing to next state): ${err}`);
    }
  }

  console.log(`\nUSDA Crops complete: ${totalGenerated} entries generated to ${path.join(STAGING_ROOT, "usda-crops")}/`);
}

// --- Main ---

async function main() {
  console.log(`=== Offline Embedding Generator ===`);
  console.log(`Source: ${SOURCE}`);
  console.log(`Staging: ${STAGING_ROOT}`);
  console.log(`Embedding: ${USE_EDGE_FN ? "edge function (slow)" : "Voyage AI direct"}`);
  console.log();

  switch (SOURCE) {
    case "photoperiod":
      await generatePhotoperiod();
      break;
    case "usda-crops":
      await generateUsdaCrops();
      break;
    default:
      console.error(`Unknown source: ${SOURCE}`);
      console.error("Available sources: photoperiod, usda-crops");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
