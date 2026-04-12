import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// NRCS AWDB REST API base
const AWDB_BASE = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1";

// States with SNOTEL (SNTL) stations — western mountain states + AK
// These are the only states with meaningful SWE data.
const SNOTEL_STATES = [
  "AK", "AZ", "CA", "CO", "ID", "MT", "NV", "NM",
  "OR", "SD", "UT", "WA", "WY",
];

// States with SCAN stations that report soil temperature
// Reduced to key monitored states to stay under 150s edge function limit.
// Full 50-state coverage was causing 180s+ runs.
const SCAN_STATES = [
  "AL", "AR", "CA", "CO", "GA", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "MI", "MN", "MS", "MO", "MT", "NE",
  "NC", "ND", "OH", "OK", "OR", "SD", "TN", "TX", "UT",
  "WA", "WI", "WY",
];

interface StationMeta {
  stationTriplet: string;
  name: string;
  stateCode: string;
  elevation: number;
  latitude: number;
  longitude: number;
  countyName: string;
}

interface DataValue {
  date: string;
  value: number | null;
}

interface StationData {
  stationTriplet: string;
  data: Array<{
    stationElement: { elementCode: string };
    values: DataValue[];
  }>;
}

function sweLevel(inches: number): string {
  if (inches >= 30) return "deep";
  if (inches >= 15) return "heavy";
  if (inches >= 5) return "moderate";
  if (inches >= 1) return "light";
  return "trace";
}

function soilTempCategory(tempF: number): string {
  if (tempF >= 60) return "warm";
  if (tempF >= 50) return "active_growth";
  if (tempF >= 40) return "thawing";
  if (tempF >= 32) return "near_freezing";
  return "frozen";
}

/**
 * Fetch station metadata for a network+state combo.
 * Returns active stations only.
 */
async function fetchStations(state: string, network: string): Promise<StationMeta[]> {
  const url = `${AWDB_BASE}/stations?stationTriplets=*:${state}:${network}&activeOnly=true&returnStationElements=false`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  Stations ${state}:${network} HTTP ${res.status}`);
    return [];
  }
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((s: StationMeta) => ({
    stationTriplet: s.stationTriplet,
    name: s.name,
    stateCode: s.stateCode,
    elevation: s.elevation,
    latitude: s.latitude,
    longitude: s.longitude,
    countyName: s.countyName,
  }));
}

/**
 * Fetch daily data for a batch of station triplets + element.
 * AWDB supports comma-separated triplets — batch up to 50 at a time.
 */
async function fetchData(
  triplets: string[],
  element: string,
  date: string,
): Promise<StationData[]> {
  const url = `${AWDB_BASE}/data?stationTriplets=${triplets.join(",")}&elements=${element}&duration=DAILY&beginDate=${date}&endDate=${date}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`  Data fetch HTTP ${res.status} for ${element}`);
    return [];
  }
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data;
}

/**
 * Process a state's SNOTEL SWE data into embeddable entries.
 */
function buildSweEntries(
  state: string,
  stations: StationMeta[],
  dataResults: StationData[],
  date: string,
): Array<{ text: string; meta: Record<string, unknown> }> {
  // Build a lookup: triplet -> station meta
  const metaMap = new Map(stations.map(s => [s.stationTriplet, s]));

  // Collect readings with values
  const readings: Array<{
    name: string;
    elevation: number;
    swe: number;
  }> = [];

  for (const sd of dataResults) {
    const meta = metaMap.get(sd.stationTriplet);
    if (!meta || !sd.data?.length) continue;
    for (const d of sd.data) {
      if (d.stationElement.elementCode !== "WTEQ") continue;
      for (const v of d.values) {
        if (v.value !== null && v.value !== undefined) {
          readings.push({
            name: meta.name,
            elevation: meta.elevation,
            swe: v.value,
          });
        }
      }
    }
  }

  if (readings.length === 0) return [];

  // Aggregate for the state
  const sweValues = readings.map(r => r.swe);
  const avgSwe = sweValues.reduce((a, b) => a + b, 0) / sweValues.length;
  const maxSwe = Math.max(...sweValues);
  const minSwe = Math.min(...sweValues);
  const stationsWithSnow = readings.filter(r => r.swe > 0).length;

  // Top 3 stations by SWE
  const topStations = [...readings]
    .sort((a, b) => b.swe - a.swe)
    .slice(0, 3)
    .map(r => `${r.name}(${r.swe}in/${Math.round(r.elevation)}ft)`)
    .join(", ");

  const level = sweLevel(avgSwe);
  const text = `snotel-daily | ${state} | ${date} | SWE avg:${avgSwe.toFixed(1)}in max:${maxSwe.toFixed(1)}in min:${minSwe.toFixed(1)}in | stations:${readings.length} with_snow:${stationsWithSnow} | level:${level} | top:${topStations}`;

  return [{
    text,
    meta: {
      title: `${state} SNOTEL SWE ${date}`,
      content: text,
      content_type: "snotel-daily",
      tags: [state, "snotel", "swe", "snow", "water-equivalent", level],
      state_abbr: state,
      effective_date: date,
      metadata: {
        source: "nrcs-snotel",
        element: "WTEQ",
        station_count: readings.length,
        stations_with_snow: stationsWithSnow,
        avg_swe_in: parseFloat(avgSwe.toFixed(1)),
        max_swe_in: parseFloat(maxSwe.toFixed(1)),
        min_swe_in: parseFloat(minSwe.toFixed(1)),
        swe_level: level,
        top_stations: readings.slice(0, 3).map(r => ({
          name: r.name,
          swe_in: r.swe,
          elevation_ft: r.elevation,
        })),
      },
    },
  }];
}

/**
 * Process a state's SCAN soil temperature data into embeddable entries.
 */
function buildSoilTempEntries(
  state: string,
  stations: StationMeta[],
  dataResults: StationData[],
  date: string,
): Array<{ text: string; meta: Record<string, unknown> }> {
  const metaMap = new Map(stations.map(s => [s.stationTriplet, s]));

  const readings: Array<{
    name: string;
    temp: number;
  }> = [];

  for (const sd of dataResults) {
    const meta = metaMap.get(sd.stationTriplet);
    if (!meta || !sd.data?.length) continue;
    for (const d of sd.data) {
      if (d.stationElement.elementCode !== "STO") continue;
      for (const v of d.values) {
        if (v.value !== null && v.value !== undefined) {
          readings.push({ name: meta.name, temp: v.value });
        }
      }
    }
  }

  if (readings.length === 0) return [];

  const temps = readings.map(r => r.temp);
  const avgTemp = temps.reduce((a, b) => a + b, 0) / temps.length;
  const maxTemp = Math.max(...temps);
  const minTemp = Math.min(...temps);
  const category = soilTempCategory(avgTemp);
  const frozenCount = readings.filter(r => r.temp < 32).length;

  const text = `snotel-daily | ${state} | ${date} | soil_temp avg:${avgTemp.toFixed(1)}F max:${maxTemp.toFixed(1)}F min:${minTemp.toFixed(1)}F | stations:${readings.length} frozen:${frozenCount} | category:${category}`;

  return [{
    text,
    meta: {
      title: `${state} SCAN soil temp ${date}`,
      content: text,
      content_type: "snotel-daily",
      tags: [state, "scan", "soil-temperature", "phenology", category],
      state_abbr: state,
      effective_date: date,
      metadata: {
        source: "nrcs-scan",
        element: "STO",
        station_count: readings.length,
        avg_temp_f: parseFloat(avgTemp.toFixed(1)),
        max_temp_f: parseFloat(maxTemp.toFixed(1)),
        min_temp_f: parseFloat(minTemp.toFixed(1)),
        frozen_stations: frozenCount,
        soil_temp_category: category,
      },
    },
  }];
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    // Yesterday's date
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const date = yesterday.toISOString().slice(0, 10);

    console.log(`[hunt-snotel] Fetching SNOTEL/SCAN data for ${date}`);

    const allEntries: Array<{ text: string; meta: Record<string, unknown> }> = [];
    let errors = 0;

    // --- Phase 1: SNOTEL SWE by state ---
    console.log("\n=== Phase 1: SNOTEL SWE ===");
    for (const state of SNOTEL_STATES) {
      // Time guard: leave 40s for embedding + insert
      if (Date.now() - startTime > 90_000) {
        console.warn(`[hunt-snotel] Time guard at ${Math.round((Date.now() - startTime) / 1000)}s, stopping SNOTEL phase`);
        break;
      }
      try {
        const stations = await fetchStations(state, "SNTL");
        if (stations.length === 0) {
          console.log(`  ${state}: no active SNTL stations`);
          continue;
        }

        // Batch triplets in groups of 50 for data fetch
        const triplets = stations.map(s => s.stationTriplet);
        const sweData: StationData[] = [];
        for (let i = 0; i < triplets.length; i += 50) {
          const batch = triplets.slice(i, i + 50);
          const results = await fetchData(batch, "WTEQ", date);
          sweData.push(...results);
        }

        const entries = buildSweEntries(state, stations, sweData, date);
        allEntries.push(...entries);
        console.log(`  ${state}: ${stations.length} stations, ${entries.length} entries`);
      } catch (err) {
        console.warn(`  ${state} SWE error: ${err}`);
        errors++;
      }
    }

    // --- Phase 2: SCAN soil temperature by state (reduced to 30 key states) ---
    console.log("\n=== Phase 2: SCAN Soil Temp ===");
    for (const state of SCAN_STATES) {
      // Time guard: leave 30s for embedding + insert
      if (Date.now() - startTime > 100_000) {
        console.warn(`[hunt-snotel] Time guard at ${Math.round((Date.now() - startTime) / 1000)}s, stopping SCAN phase`);
        break;
      }
      try {
        const stations = await fetchStations(state, "SCAN");
        if (stations.length === 0) continue;

        const triplets = stations.map(s => s.stationTriplet);
        const stoData: StationData[] = [];
        for (let i = 0; i < triplets.length; i += 50) {
          const batch = triplets.slice(i, i + 50);
          const results = await fetchData(batch, "STO", date);
          stoData.push(...results);
        }

        const entries = buildSoilTempEntries(state, stations, stoData, date);
        allEntries.push(...entries);
        if (entries.length > 0) {
          console.log(`  ${state}: ${stations.length} stations, ${entries.length} entries`);
        }
      } catch (err) {
        console.warn(`  ${state} STO error: ${err}`);
        errors++;
      }
    }

    console.log(`\nTotal entries to embed: ${allEntries.length}`);

    if (allEntries.length === 0) {
      const durationMs = Date.now() - startTime;
      await logCronRun({
        functionName: "hunt-snotel",
        status: "success",
        summary: { date, embedded: 0, note: "no data returned from AWDB" },
        durationMs,
      });
      return cronResponse({ date, embedded: 0, errors, durationMs });
    }

    // Embed and insert in batches of 20
    let totalEmbedded = 0;
    for (let i = 0; i < allEntries.length; i += 20) {
      const chunk = allEntries.slice(i, i + 20);

      try {
        // Dedup: skip entries whose titles already exist in the brain
        const titles = chunk.map(e => e.meta?.title).filter(Boolean);
        const { data: existing } = await supabase.from("hunt_knowledge").select("title").in("title", titles);
        const existingTitles = new Set((existing || []).map((r: any) => r.title));
        const newChunk = chunk.filter(e => !existingTitles.has(e.meta?.title));

        if (newChunk.length === 0) continue;

        const texts = newChunk.map(e => e.text);
        const embeddings = await batchEmbed(texts);

        const rows = newChunk.map((e, j) => ({
          ...e.meta,
          embedding: JSON.stringify(embeddings[j]),
        }));

        const { error: insertError } = await supabase
          .from("hunt_knowledge")
          .insert(rows);

        if (insertError) {
          console.error(`  Insert error: ${insertError.message}`);
          errors++;
        } else {
          totalEmbedded += rows.length;
        }
      } catch (err) {
        console.error(`  Embed/insert batch error: ${err}`);
        errors++;
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-snotel",
      status: errors > 0 ? "partial" : "success",
      summary: { date, embedded: totalEmbedded, errors, swe_states: SNOTEL_STATES.length, scan_states: SCAN_STATES.length },
      durationMs,
    });

    return cronResponse({ date, embedded: totalEmbedded, errors, durationMs });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-snotel",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return cronErrorResponse(String(err), 500);
  }
});
