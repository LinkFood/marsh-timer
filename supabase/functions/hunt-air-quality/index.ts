import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_CENTROIDS } from '../_shared/states.ts';
import { batchEmbed } from '../_shared/embedding.ts';
// Pattern linking done by hunt-pattern-link-worker cron
import { logCronRun } from '../_shared/cronLog.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';

const FUNCTION_NAME = "hunt-air-quality";

const HOURLY_PARAMS = [
  "pm10", "pm2_5", "carbon_monoxide", "nitrogen_dioxide", "sulphur_dioxide",
  "ozone", "us_aqi",
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

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const abbrs = Object.keys(STATE_CENTROIDS).sort();
    const today = new Date().toISOString().slice(0, 10);

    // Idempotency on the natural key (state, day): the old whole-run "any row
    // exists today" check let racing invocations write every state twice (the
    // backfill era left exactly-2x dupes on ~45% of state-days) and made
    // partial-run reruns skip the missing states. Now each state is checked
    // individually and re-checked per batch right before insert.
    const { data: existingRows, error: existingErr } = await supabase
      .from("hunt_knowledge")
      .select("state_abbr")
      .eq("content_type", "air-quality")
      .eq("effective_date", today)
      .limit(200);
    if (existingErr) throw new Error(`existing-state check failed: ${existingErr.message}`);
    const alreadyDone = new Set((existingRows ?? []).map((r: { state_abbr: string | null }) => r.state_abbr).filter(Boolean));

    if (abbrs.every((a) => alreadyDone.has(a))) {
      const durationMs = Date.now() - startTime;
      await logCronRun({
        functionName: FUNCTION_NAME,
        status: "success",
        summary: { already_exists: true, effective_date: today, states_present: alreadyDone.size },
        durationMs,
      });
      return cronResponse({ already_exists: true, effective_date: today, durationMs });
    }

    let totalAirQuality = 0;
    let errors = 0;

    // Process states in batches of 10 — AQ only (no pollen, saves 50% of embeds)
    for (let s = 0; s < abbrs.length; s += 10) {
      const batch = abbrs.slice(s, s + 10).filter((a) => !alreadyDone.has(a));
      if (batch.length === 0) continue;
      const aqTexts: string[] = [];
      const aqEntries: { abbr: string; stateName: string; maxAqi: number; avgPm25: number; avgOzone: number; avgCo: number; avgNo2: number; avgSo2: number; severity: string }[] = [];

      for (const abbr of batch) {
        try {
          const { name, lat, lng } = STATE_CENTROIDS[abbr];
          const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lng}&hourly=${HOURLY_PARAMS}&timezone=America/New_York`;

          const res = await fetch(url);

          if (!res.ok) {
            if (res.status >= 500) {
              errors++;
            } else {
              console.warn(`${abbr}: API error ${res.status}`);
              errors++;
            }
            continue;
          }

          const data = await res.json();
          if (!data.hourly) { errors++; continue; }

          const hourly = data.hourly as HourlyData;
          const maxAqi = max(hourly.us_aqi);
          const avgPm25 = avg(hourly.pm2_5);
          const avgOzone = avg(hourly.ozone);
          const avgCo = avg(hourly.carbon_monoxide);
          const avgNo2 = avg(hourly.nitrogen_dioxide);
          const avgSo2 = avg(hourly.sulphur_dioxide);
          const severity = aqiSeverity(maxAqi);

          aqTexts.push(`Air quality for ${name} (${abbr}) on ${today}: AQI ${maxAqi} (PM2.5: ${avgPm25}\u03BCg/m\u00B3, ozone: ${avgOzone}ppb, CO: ${avgCo}, NO2: ${avgNo2}, SO2: ${avgSo2}). ${severity}`);
          aqEntries.push({ abbr, stateName: name, maxAqi, avgPm25, avgOzone, avgCo, avgNo2, avgSo2, severity });
        } catch (err) {
          console.warn(`${abbr}: ${err}`);
          errors++;
        }

        await new Promise(r => setTimeout(r, 100));
      }

      if (aqTexts.length === 0) continue;

      const embeddings = await batchEmbed(aqTexts);

      const rows = aqEntries.map((entry, i) => ({
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
        embedding: embeddings[i],
      }));

      // Last-second natural-key re-check: a racing invocation may have landed
      // these state-days after the run-level check — that race was the dupe
      // source. hunt_knowledge has no unique constraint to lean on, so the
      // key (content_type, state_abbr, effective_date) is enforced here.
      const { data: raced, error: racedErr } = await supabase
        .from("hunt_knowledge")
        .select("state_abbr")
        .eq("content_type", "air-quality")
        .eq("effective_date", today)
        .in("state_abbr", aqEntries.map((e) => e.abbr));
      if (racedErr) {
        console.error(`Race re-check failed batch ${batch[0]}: ${racedErr.message}`);
        errors++;
        continue;
      }
      const racedSet = new Set((raced ?? []).map((r: { state_abbr: string | null }) => r.state_abbr));
      const rowsToInsert = rows.filter((r) => !racedSet.has(r.state_abbr));
      if (rowsToInsert.length === 0) continue;

      const { data: inserted, error: insertErr } = await supabase
        .from("hunt_knowledge")
        .insert(rowsToInsert)
        .select('id');
      if (insertErr) {
        console.error(`Insert error batch ${batch[0]}: ${insertErr.message}`);
        errors++;
      } else {
        totalAirQuality += rowsToInsert.length;
        // Pattern linking done by hunt-pattern-link-worker cron
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: FUNCTION_NAME,
      status: errors > 0 ? "partial" : "success",
      summary: { air_quality_embedded: totalAirQuality, errors },
      durationMs,
    });

    return cronResponse({
      air_quality_embedded: totalAirQuality,
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
