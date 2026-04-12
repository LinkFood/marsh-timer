import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_CENTROIDS } from '../_shared/states.ts';
import { batchEmbed } from '../_shared/embedding.ts';
// Pattern linking done by hunt-pattern-link-worker cron
import { logCronRun } from '../_shared/cronLog.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';

const FUNCTION_NAME = "hunt-soil-monitor";
const CONTENT_TYPE = "soil-conditions";

const STATE_ABBRS = Object.keys(STATE_CENTROIDS);

interface HourlyData {
  time: string[];
  soil_temperature_0cm?: (number | null)[];
  soil_temperature_6cm?: (number | null)[];
  soil_temperature_18cm?: (number | null)[];
  soil_temperature_54cm?: (number | null)[];
  soil_moisture_0_to_1cm?: (number | null)[];
  soil_moisture_1_to_3cm?: (number | null)[];
  soil_moisture_3_to_9cm?: (number | null)[];
  soil_moisture_9_to_27cm?: (number | null)[];
  soil_moisture_27_to_81cm?: (number | null)[];
}

interface OpenMeteoResponse {
  hourly?: HourlyData;
}

function avg(values: (number | null)[] | undefined): number | null {
  if (!values) return null;
  const nums = values.filter((v): v is number => v !== null);
  if (nums.length === 0) return null;
  return parseFloat((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
}

function detectFreezeThaw(surfaceTemps: (number | null)[] | undefined): string {
  if (!surfaceTemps) return "unknown";
  const valid = surfaceTemps.filter((v): v is number => v !== null);
  if (valid.length < 2) return "unknown";

  const hasAbove = valid.some(t => t > 32);
  const hasBelow = valid.some(t => t < 32);

  if (hasAbove && hasBelow) return "freeze-thaw transition";
  if (!hasAbove && hasBelow) return "frozen";
  if (hasAbove && !hasBelow) return "thawed";
  return "at-32F";
}

/**
 * Filter hourly arrays to only include values for a specific date (YYYY-MM-DD).
 * Open-Meteo returns 7 days of hourly data by default.
 */
function filterDay(hourly: HourlyData, targetDate: string): HourlyData {
  const indices: number[] = [];
  for (let i = 0; i < hourly.time.length; i++) {
    if (hourly.time[i].startsWith(targetDate)) {
      indices.push(i);
    }
  }

  const pick = (arr?: (number | null)[]): (number | null)[] | undefined => {
    if (!arr) return undefined;
    return indices.map(i => arr[i]);
  };

  return {
    time: indices.map(i => hourly.time[i]),
    soil_temperature_0cm: pick(hourly.soil_temperature_0cm),
    soil_temperature_6cm: pick(hourly.soil_temperature_6cm),
    soil_temperature_18cm: pick(hourly.soil_temperature_18cm),
    soil_temperature_54cm: pick(hourly.soil_temperature_54cm),
    soil_moisture_0_to_1cm: pick(hourly.soil_moisture_0_to_1cm),
    soil_moisture_1_to_3cm: pick(hourly.soil_moisture_1_to_3cm),
    soil_moisture_3_to_9cm: pick(hourly.soil_moisture_3_to_9cm),
    soil_moisture_9_to_27cm: pick(hourly.soil_moisture_9_to_27cm),
    soil_moisture_27_to_81cm: pick(hourly.soil_moisture_27_to_81cm),
  };
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    // Target today (Open-Meteo forecast starts at today, not yesterday)
    const dateStr = new Date().toISOString().slice(0, 10);

    console.log(`[${FUNCTION_NAME}] Fetching soil data for ${dateStr}`);

    const allEntries: Array<{ text: string; meta: Record<string, unknown>; abbr: string }> = [];
    let errors = 0;
    let skipped = 0;

    // Process states in batches of 5 to avoid rate limiting
    for (let s = 0; s < STATE_ABBRS.length; s += 5) {
      const stateChunk = STATE_ABBRS.slice(s, s + 5);

      const fetches = stateChunk.map(async (abbr) => {
        const { name, lat, lng } = STATE_CENTROIDS[abbr];
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=soil_temperature_0cm,soil_temperature_6cm,soil_temperature_18cm,soil_temperature_54cm,soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm,soil_moisture_9_to_27cm,soil_moisture_27_to_81cm&temperature_unit=fahrenheit&timezone=America/New_York`;

        try {
          const res = await fetch(url);

          if (!res.ok) {
            if (res.status >= 500) {
              console.warn(`  ${abbr}: server error ${res.status}`);
              errors++;
            } else {
              // 4xx — never retry
              console.warn(`  ${abbr}: client error ${res.status}, skipping`);
              skipped++;
            }
            return;
          }

          const data: OpenMeteoResponse = await res.json();
          if (!data.hourly || !data.hourly.time || data.hourly.time.length === 0) {
            skipped++;
            return;
          }

          // Filter to just yesterday's hours
          const day = filterDay(data.hourly, dateStr);
          if (day.time.length === 0) {
            skipped++;
            return;
          }

          const surfaceTemp = avg(day.soil_temperature_0cm);
          const temp6cm = avg(day.soil_temperature_6cm);
          const temp18cm = avg(day.soil_temperature_18cm);
          const temp54cm = avg(day.soil_temperature_54cm);
          const moisture0_1 = avg(day.soil_moisture_0_to_1cm);
          const moisture1_3 = avg(day.soil_moisture_1_to_3cm);
          const moisture3_9 = avg(day.soil_moisture_3_to_9cm);
          const moisture9_27 = avg(day.soil_moisture_9_to_27cm);
          const moisture27_81 = avg(day.soil_moisture_27_to_81cm);
          const freezeThaw = detectFreezeThaw(day.soil_temperature_0cm);

          const text = `Soil conditions for ${name} (${abbr}) on ${dateStr}: surface temp ${surfaceTemp ?? "N/A"}°F (6cm: ${temp6cm ?? "N/A"}°F, 18cm: ${temp18cm ?? "N/A"}°F), moisture 0-1cm: ${moisture0_1 ?? "N/A"}, 1-3cm: ${moisture1_3 ?? "N/A"}, 3-9cm: ${moisture3_9 ?? "N/A"}. Freeze/thaw: ${freezeThaw}`;

          allEntries.push({
            text,
            abbr,
            meta: {
              title: `${abbr} soil-conditions ${dateStr}`,
              content: text,
              content_type: CONTENT_TYPE,
              tags: [abbr, "soil", "soil-temperature", "soil-moisture", "freeze-thaw", freezeThaw],
              state_abbr: abbr,
              effective_date: dateStr,
              metadata: {
                source: FUNCTION_NAME,
                surface_temp_f: surfaceTemp,
                temp_6cm_f: temp6cm,
                temp_18cm_f: temp18cm,
                temp_54cm_f: temp54cm,
                moisture_0_1cm: moisture0_1,
                moisture_1_3cm: moisture1_3,
                moisture_3_9cm: moisture3_9,
                moisture_9_27cm: moisture9_27,
                moisture_27_81cm: moisture27_81,
                freeze_thaw_status: freezeThaw,
                lat,
                lng,
              },
            },
          });
        } catch (err) {
          console.warn(`  ${abbr}: ${err}`);
          errors++;
        }
      });

      await Promise.all(fetches);

      // Rate limit between batches
      if (s + 5 < STATE_ABBRS.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    console.log(`[${FUNCTION_NAME}] ${allEntries.length} entries to embed, ${skipped} skipped, ${errors} errors`);

    if (allEntries.length === 0) {
      const durationMs = Date.now() - startTime;
      await logCronRun({
        functionName: FUNCTION_NAME,
        status: errors > 0 ? "partial" : "success",
        summary: { date: dateStr, embedded: 0, skipped, errors },
        durationMs,
      });
      return cronResponse({ date: dateStr, embedded: 0, skipped, errors, durationMs });
    }

    // Embed and upsert in batches of 20 (Voyage limit)
    let totalEmbedded = 0;
    for (let i = 0; i < allEntries.length; i += 20) {
      const chunk = allEntries.slice(i, i + 20);
      const texts = chunk.map(e => e.text);

      try {
        const embeddings = await batchEmbed(texts);

        const rows = chunk.map((e, j) => ({
          ...e.meta,
          embedding: embeddings[j],
        }));

        const { data: inserted, error: insertError } = await supabase
          .from("hunt_knowledge")
          .insert(rows)
          .select('id');

        if (insertError) {
          console.error(`  Insert error: ${insertError.message}`);
          errors++;
        } else {
          totalEmbedded += rows.length;
          // Pattern linking done by hunt-pattern-link-worker cron
        }
      } catch (err) {
        console.error(`  Embed/upsert batch error: ${err}`);
        errors++;
      }
    }

    const durationMs = Date.now() - startTime;
    const status = errors > 0 ? (totalEmbedded > 0 ? "partial" : "error") : "success";

    await logCronRun({
      functionName: FUNCTION_NAME,
      status,
      summary: { date: dateStr, embedded: totalEmbedded, skipped, errors, total_states: STATE_ABBRS.length },
      durationMs,
    });

    return cronResponse({ date: dateStr, embedded: totalEmbedded, skipped, errors, durationMs });

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
