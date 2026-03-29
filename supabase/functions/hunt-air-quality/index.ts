import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_CENTROIDS } from '../_shared/states.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { scanBrainOnWrite } from '../_shared/brainScan.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';

const FUNCTION_NAME = "hunt-air-quality";

const HOURLY_PARAMS = [
  "pm10", "pm2_5", "carbon_monoxide", "nitrogen_dioxide", "sulphur_dioxide",
  "ozone", "us_aqi", "alder_pollen", "birch_pollen", "grass_pollen",
  "mugwort_pollen", "olive_pollen", "ragweed_pollen",
].join(",");

interface HourlyData {
  time: string[];
  pm10?: (number | null)[];
  pm2_5?: (number | null)[];
  carbon_monoxide?: (number | null)[];
  nitrogen_dioxide?: (number | null)[];
  sulphur_dioxide?: (number | null)[];
  ozone?: (number | null)[];
  us_aqi?: (number | null)[];
  alder_pollen?: (number | null)[];
  birch_pollen?: (number | null)[];
  grass_pollen?: (number | null)[];
  mugwort_pollen?: (number | null)[];
  olive_pollen?: (number | null)[];
  ragweed_pollen?: (number | null)[];
}

function avg(arr: (number | null)[] | undefined): number {
  if (!arr) return 0;
  const valid = arr.filter((v): v is number => v !== null && v !== undefined);
  if (valid.length === 0) return 0;
  return Math.round((valid.reduce((a, b) => a + b, 0) / valid.length) * 10) / 10;
}

function max(arr: (number | null)[] | undefined): number {
  if (!arr) return 0;
  const valid = arr.filter((v): v is number => v !== null && v !== undefined);
  if (valid.length === 0) return 0;
  return Math.max(...valid);
}

function aqiSeverity(aqi: number): string {
  if (aqi > 300) return "Hazardous air quality — major health risk for all groups.";
  if (aqi > 200) return "Very unhealthy — health alert, everyone may experience effects.";
  if (aqi > 150) return "Unhealthy — everyone may begin to experience health effects.";
  if (aqi > 100) return "Unhealthy for sensitive groups — elderly, children, and those with respiratory conditions at risk.";
  if (aqi > 50) return "Moderate air quality — acceptable for most.";
  return "Good air quality.";
}

function pollenSeasonNote(
  birch: number, grass: number, ragweed: number,
  alder: number, mugwort: number, olive: number,
): string {
  const notes: string[] = [];
  const total = birch + grass + ragweed + alder + mugwort + olive;

  if (total === 0) return "No significant pollen detected.";

  // Peak detection
  if (ragweed > 50) notes.push("ragweed peak");
  if (grass > 30) notes.push("grass peak");
  if (birch > 50) notes.push("birch peak");
  if (alder > 30) notes.push("alder peak");
  if (mugwort > 20) notes.push("mugwort peak");
  if (olive > 30) notes.push("olive peak");

  // First detection (low but nonzero)
  if (ragweed > 0 && ragweed <= 10) notes.push("ragweed season starting");
  if (grass > 0 && grass <= 5) notes.push("grass season starting");
  if (birch > 0 && birch <= 10) notes.push("birch season starting");

  if (notes.length === 0) return "Moderate pollen levels.";
  return notes.join(", ") + ".";
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const abbrs = Object.keys(STATE_CENTROIDS).sort();
    const today = new Date().toISOString().slice(0, 10);

    let totalAirQuality = 0;
    let totalPollen = 0;
    let errors = 0;

    // Process states in batches of 5
    for (let s = 0; s < abbrs.length; s += 5) {
      const batch = abbrs.slice(s, s + 5);
      const aqTexts: string[] = [];
      const pollenTexts: string[] = [];
      const aqEntries: { abbr: string; stateName: string; maxAqi: number; avgPm25: number; avgOzone: number; avgCo: number; avgNo2: number; avgSo2: number; severity: string }[] = [];
      const pollenEntries: { abbr: string; stateName: string; birch: number; grass: number; ragweed: number; alder: number; mugwort: number; olive: number; seasonNote: string }[] = [];

      for (const abbr of batch) {
        try {
          const { name, lat, lng } = STATE_CENTROIDS[abbr];
          const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&hourly=${HOURLY_PARAMS}&timezone=America/New_York`;

          const res = await fetch(url);

          if (!res.ok) {
            // Only retry 5xx
            if (res.status >= 500) {
              console.warn(`${abbr}: API 5xx (${res.status}), retrying once...`);
              await new Promise(r => setTimeout(r, 1000));
              const retry = await fetch(url);
              if (!retry.ok) {
                console.warn(`${abbr}: retry failed (${retry.status})`);
                errors++;
                continue;
              }
              const retryData = await retry.json();
              processState(abbr, name, retryData.hourly, aqTexts, pollenTexts, aqEntries, pollenEntries, today);
              continue;
            }
            console.warn(`${abbr}: API error ${res.status} (4xx, not retrying)`);
            errors++;
            continue;
          }

          const data = await res.json();
          if (!data.hourly) {
            console.warn(`${abbr}: no hourly data`);
            errors++;
            continue;
          }

          processState(abbr, name, data.hourly, aqTexts, pollenTexts, aqEntries, pollenEntries, today);
        } catch (err) {
          console.warn(`${abbr}: ${err}`);
          errors++;
        }

        // Rate limit between calls
        await new Promise(r => setTimeout(r, 200));
      }

      if (aqTexts.length === 0 && pollenTexts.length === 0) continue;

      // Batch embed all texts together (AQ + pollen), max 20
      const allTexts = [...aqTexts, ...pollenTexts];
      const allEmbeddings = await batchEmbed(allTexts);

      const aqEmbeddings = allEmbeddings.slice(0, aqTexts.length);
      const pollenEmbeddings = allEmbeddings.slice(aqTexts.length);

      // Build air quality rows
      const aqRows = aqEntries.map((entry, i) => ({
        title: `${entry.abbr} air-quality ${today}`,
        content: aqTexts[i],
        content_type: "air-quality",
        tags: [entry.abbr, "air-quality", "aqi", "pollution", "environmental-health"],
        state_abbr: entry.abbr,
        species: null,
        effective_date: today,
        metadata: {
          source: "open-meteo-air-quality",
          max_aqi: entry.maxAqi,
          avg_pm25: entry.avgPm25,
          avg_ozone: entry.avgOzone,
          avg_co: entry.avgCo,
          avg_no2: entry.avgNo2,
          avg_so2: entry.avgSo2,
          severity: entry.severity,
        },
        embedding: JSON.stringify(aqEmbeddings[i]),
      }));

      // Build pollen rows
      const pollenRows = pollenEntries.map((entry, i) => ({
        title: `${entry.abbr} pollen-data ${today}`,
        content: pollenTexts[i],
        content_type: "pollen-data",
        tags: [entry.abbr, "pollen", "allergen", "seasonal", "phenology"],
        state_abbr: entry.abbr,
        species: null,
        effective_date: today,
        metadata: {
          source: "open-meteo-air-quality",
          birch_pollen: entry.birch,
          grass_pollen: entry.grass,
          ragweed_pollen: entry.ragweed,
          alder_pollen: entry.alder,
          mugwort_pollen: entry.mugwort,
          olive_pollen: entry.olive,
          season_note: entry.seasonNote,
        },
        embedding: JSON.stringify(pollenEmbeddings[i]),
      }));

      // Upsert air quality
      if (aqRows.length > 0) {
        const { error: aqErr } = await supabase
          .from("hunt_knowledge")
          .upsert(aqRows, { onConflict: "title" });

        if (aqErr) {
          console.error(`AQ upsert error batch ${batch[0]}: ${aqErr.message}`);
          errors++;
        } else {
          totalAirQuality += aqRows.length;
        }
      }

      // Upsert pollen
      if (pollenRows.length > 0) {
        const { error: pollenErr } = await supabase
          .from("hunt_knowledge")
          .upsert(pollenRows, { onConflict: "title" });

        if (pollenErr) {
          console.error(`Pollen upsert error batch ${batch[0]}: ${pollenErr.message}`);
          errors++;
        } else {
          totalPollen += pollenRows.length;
        }
      }

      // Brain scan on first entry of each batch (best-effort)
      if (aqEmbeddings.length > 0) {
        try {
          await scanBrainOnWrite(aqEmbeddings[0], {
            state_abbr: aqEntries[0].abbr,
            exclude_content_type: "air-quality",
            limit: 5,
          });
        } catch (_) { /* scanning is best-effort */ }
      }
      if (pollenEmbeddings.length > 0) {
        try {
          await scanBrainOnWrite(pollenEmbeddings[0], {
            state_abbr: pollenEntries[0].abbr,
            exclude_content_type: "pollen-data",
            limit: 5,
          });
        } catch (_) { /* scanning is best-effort */ }
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: FUNCTION_NAME,
      status: errors > 0 ? "partial" : "success",
      summary: { air_quality_embedded: totalAirQuality, pollen_embedded: totalPollen, errors },
      durationMs,
    });

    return cronResponse({
      air_quality_embedded: totalAirQuality,
      pollen_embedded: totalPollen,
      errors,
      durationMs,
    });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: FUNCTION_NAME,
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return cronErrorResponse(String(err), 500);
  }
});

function processState(
  abbr: string,
  stateName: string,
  hourly: HourlyData,
  aqTexts: string[],
  pollenTexts: string[],
  aqEntries: typeof aqTexts extends string[] ? { abbr: string; stateName: string; maxAqi: number; avgPm25: number; avgOzone: number; avgCo: number; avgNo2: number; avgSo2: number; severity: string }[] : never,
  pollenEntries: { abbr: string; stateName: string; birch: number; grass: number; ragweed: number; alder: number; mugwort: number; olive: number; seasonNote: string }[],
  today: string,
): void {
  // Aggregate hourly → daily
  const maxAqi = max(hourly.us_aqi);
  const avgPm25 = avg(hourly.pm2_5);
  const avgOzone = avg(hourly.ozone);
  const avgCo = avg(hourly.carbon_monoxide);
  const avgNo2 = avg(hourly.nitrogen_dioxide);
  const avgSo2 = avg(hourly.sulphur_dioxide);
  const severity = aqiSeverity(maxAqi);

  const maxBirch = max(hourly.birch_pollen);
  const maxGrass = max(hourly.grass_pollen);
  const maxRagweed = max(hourly.ragweed_pollen);
  const maxAlder = max(hourly.alder_pollen);
  const maxMugwort = max(hourly.mugwort_pollen);
  const maxOlive = max(hourly.olive_pollen);
  const seasonNote = pollenSeasonNote(maxBirch, maxGrass, maxRagweed, maxAlder, maxMugwort, maxOlive);

  // Air quality embedding text
  aqTexts.push(
    `Air quality for ${stateName} (${abbr}) on ${today}: AQI ${maxAqi} (PM2.5: ${avgPm25}\u03BCg/m\u00B3, ozone: ${avgOzone}ppb, CO: ${avgCo}, NO2: ${avgNo2}, SO2: ${avgSo2}). ${severity}`
  );

  aqEntries.push({ abbr, stateName, maxAqi, avgPm25, avgOzone, avgCo, avgNo2, avgSo2, severity });

  // Pollen embedding text
  pollenTexts.push(
    `Pollen for ${stateName} (${abbr}) on ${today}: birch ${maxBirch}, grass ${maxGrass}, ragweed ${maxRagweed}, alder ${maxAlder}, mugwort ${maxMugwort}, olive ${maxOlive} grains/m\u00B3. ${seasonNote}`
  );

  pollenEntries.push({ abbr, stateName, birch: maxBirch, grass: maxGrass, ragweed: maxRagweed, alder: maxAlder, mugwort: maxMugwort, olive: maxOlive, seasonNote });
}
