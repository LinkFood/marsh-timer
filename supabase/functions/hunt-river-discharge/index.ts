import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_CENTROIDS } from '../_shared/states.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { scanBrainOnWrite } from '../_shared/brainScan.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';

const FUNCTION_NAME = "hunt-river-discharge";
const CONTENT_TYPE = "river-discharge";
const STATE_BATCH_SIZE = 5;

interface DailyDischarge {
  time: string[];
  river_discharge?: (number | null)[];
  river_discharge_mean?: (number | null)[];
  river_discharge_median?: (number | null)[];
  river_discharge_max?: (number | null)[];
  river_discharge_min?: (number | null)[];
}

interface FloodApiResponse {
  daily?: DailyDischarge;
  error?: boolean;
  reason?: string;
}

function classifyFloodStatus(current: number, median: number): string {
  if (median <= 0) return "insufficient data";
  const ratio = current / median;
  if (ratio > 2) return "flood conditions";
  if (ratio < 0.5) return "drought conditions";
  if (ratio > 1.5) return "elevated flow";
  if (ratio < 0.7) return "low flow";
  return "normal flow";
}

serve(async (req) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const abbrs = Object.keys(STATE_CENTROIDS).sort();

    let totalEmbedded = 0;
    let errors = 0;
    let skipped = 0;

    for (let s = 0; s < abbrs.length; s += STATE_BATCH_SIZE) {
      const stateChunk = abbrs.slice(s, s + STATE_BATCH_SIZE);
      const entries: {
        abbr: string;
        text: string;
        metadata: Record<string, unknown>;
        date: string;
      }[] = [];

      for (const abbr of stateChunk) {
        try {
          const { name, lat, lng } = STATE_CENTROIDS[abbr];
          const url = `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lng}&daily=river_discharge,river_discharge_mean,river_discharge_median,river_discharge_max,river_discharge_min&forecast_days=7`;

          const res = await fetch(url);

          if (!res.ok) {
            if (res.status >= 500) {
              console.warn(`${abbr}: API 5xx error ${res.status}, will skip`);
              errors++;
            } else {
              console.warn(`${abbr}: API ${res.status}, skipping`);
              skipped++;
            }
            continue;
          }

          const data: FloodApiResponse = await res.json();

          if (!data.daily || !data.daily.time || data.daily.time.length === 0) {
            console.warn(`${abbr}: no daily data returned, skipping`);
            skipped++;
            continue;
          }

          const daily = data.daily;

          // Use today (first entry) as the current reading
          for (let d = 0; d < daily.time.length; d++) {
            const date = daily.time[d];
            const discharge = daily.river_discharge?.[d];
            const mean = daily.river_discharge_mean?.[d];
            const median = daily.river_discharge_median?.[d];
            const max = daily.river_discharge_max?.[d];
            const min = daily.river_discharge_min?.[d];

            // Skip if no discharge data
            if (discharge == null) continue;

            const floodStatus = (median != null && median > 0)
              ? classifyFloodStatus(discharge, median)
              : "insufficient baseline data";

            const text = `River discharge for ${name} (${abbr}) on ${date}: current ${discharge.toFixed(1)} m\u00b3/s (mean: ${mean != null ? mean.toFixed(1) : "N/A"}, median: ${median != null ? median.toFixed(1) : "N/A"}, max: ${max != null ? max.toFixed(1) : "N/A"}, min: ${min != null ? min.toFixed(1) : "N/A"}). ${floodStatus}`;

            entries.push({
              abbr,
              text,
              date,
              metadata: {
                source: "open-meteo-flood",
                latitude: lat,
                longitude: lng,
                discharge_m3s: discharge,
                mean_m3s: mean,
                median_m3s: median,
                max_m3s: max,
                min_m3s: min,
                flood_status: floodStatus,
                forecast_day: d,
              },
            });
          }
        } catch (err) {
          console.warn(`${abbr}: ${err}`);
          errors++;
        }

        // Small delay between API calls
        await new Promise(r => setTimeout(r, 200));
      }

      if (entries.length === 0) continue;

      // Batch embed (batchEmbed handles chunking at 20 internally)
      const texts = entries.map(e => e.text);
      const embeddings = await batchEmbed(texts);

      // Build rows
      const rows = entries.map((entry, i) => ({
        title: `${entry.abbr} river discharge ${entry.date}${entry.metadata.forecast_day !== 0 ? ` +${entry.metadata.forecast_day}d` : ""}`,
        content: entry.text,
        content_type: CONTENT_TYPE,
        tags: [entry.abbr, "river-discharge", "water", "hydrology", "flood-risk"],
        state_abbr: entry.abbr,
        species: null,
        effective_date: entry.date,
        metadata: entry.metadata,
        embedding: JSON.stringify(embeddings[i]),
      }));

      // Upsert
      const { error: upsertError } = await supabase
        .from("hunt_knowledge")
        .upsert(rows, { onConflict: "title" });

      if (upsertError) {
        console.error(`Upsert error for batch starting ${stateChunk[0]}: ${upsertError.message}`);
        errors++;
      } else {
        totalEmbedded += rows.length;
      }

      // Brain scan on first entry of each batch (best-effort)
      if (embeddings.length > 0) {
        try {
          await scanBrainOnWrite(embeddings[0], {
            state_abbr: entries[0].abbr,
            exclude_content_type: CONTENT_TYPE,
            limit: 5,
          });
        } catch (_) { /* scanning is best-effort */ }
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: FUNCTION_NAME,
      status: errors > 0 ? "partial" : "success",
      summary: { states_embedded: totalEmbedded, errors, skipped },
      durationMs,
    });

    return cronResponse({ embedded: totalEmbedded, errors, skipped, durationMs });

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
