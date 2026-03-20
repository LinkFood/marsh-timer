import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// Climate oscillation indices — macro-scale predictors for animal movement
// AO: Arctic Oscillation — negative = cold air outbreaks pushing south (3-7 day lead)
// NAO: North Atlantic Oscillation — negative = cold/stormy eastern US (3-7 day lead)
const INDICES = [
  {
    id: "ao",
    name: "Arctic Oscillation",
    url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.ao.index.b500101.current.ascii",
    impact: {
      negative: "Cold air outbreak likely — arctic air pushing south. Strong migration trigger for waterfowl. Negative AO correlates with freeze events that force birds off staging areas.",
      positive: "Mild arctic pattern — reduced cold air intrusions. Migration may stall or slow. Staging areas remain ice-free.",
      neutral: "Neutral arctic pattern — no strong signal for cold outbreak or mild spell.",
    },
  },
  {
    id: "nao",
    name: "North Atlantic Oscillation",
    url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.nao.index.b500101.current.ascii",
    impact: {
      negative: "Stormy eastern US — cold, wet pattern. Atlantic flyway migration enhanced. Nor'easters and cold fronts push coastal waterfowl south.",
      positive: "Mild, dry eastern US — reduced storm activity. Atlantic flyway migration may slow. Coastal staging areas stable.",
      neutral: "Neutral Atlantic pattern — no strong storm or mild signal for eastern flyways.",
    },
  },
];

function parseIndex(text: string, daysBack: number): Array<{ date: string; value: number }> {
  const lines = text.trim().split("\n");
  const entries: Array<{ date: string; value: number }> = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [y, m, d, val] = parts;
    const year = parseInt(y);
    const month = parseInt(m);
    const day = parseInt(d);
    const value = parseFloat(val);
    if (isNaN(value) || isNaN(year)) continue;

    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    entries.push({ date: dateStr, value });
  }

  // Return last N days
  return entries.slice(-daysBack);
}

function classifyPhase(value: number): "negative" | "positive" | "neutral" {
  if (value <= -0.5) return "negative";
  if (value >= 0.5) return "positive";
  return "neutral";
}

function trendDirection(recent: number[]): string {
  if (recent.length < 3) return "insufficient data";
  const first = recent.slice(0, Math.floor(recent.length / 2));
  const second = recent.slice(Math.floor(recent.length / 2));
  const avgFirst = first.reduce((a, b) => a + b, 0) / first.length;
  const avgSecond = second.reduce((a, b) => a + b, 0) / second.length;
  const diff = avgSecond - avgFirst;
  if (diff < -0.3) return "trending negative (cold outbreak risk increasing)";
  if (diff > 0.3) return "trending positive (mild pattern building)";
  return "stable";
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    let totalEmbedded = 0;
    let errors = 0;

    for (const index of INDICES) {
      try {
        console.log(`Fetching ${index.name}...`);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(index.url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
          console.warn(`  ${index.name}: HTTP ${res.status}`);
          errors++;
          continue;
        }

        const text = await res.text();
        const recent = parseIndex(text, 14); // Last 14 days

        if (recent.length === 0) {
          console.warn(`  ${index.name}: no recent data`);
          continue;
        }

        const latest = recent[recent.length - 1];
        const values = recent.map(r => r.value);
        const avg7 = values.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, values.length);
        const avg14 = values.reduce((a, b) => a + b, 0) / values.length;
        const phase = classifyPhase(latest.value);
        const trend = trendDirection(values);
        const impact = index.impact[phase];

        // Single daily embedding with full context
        const entryText = [
          `climate-index | ${index.id.toUpperCase()} | ${index.name}`,
          `date:${latest.date} | value:${latest.value.toFixed(3)}`,
          `phase:${phase} | 7d_avg:${avg7.toFixed(3)} | 14d_avg:${avg14.toFixed(3)}`,
          `trend:${trend}`,
          `impact: ${impact}`,
          `recent_14d: ${values.map(v => v.toFixed(2)).join(",")}`,
        ].join(" | ");

        const embeddings = await batchEmbed([entryText]);

        const { error: upsertError } = await supabase
          .from("hunt_knowledge")
          .upsert({
            title: `climate-index ${index.id} ${latest.date}`,
            content: entryText,
            content_type: "climate-index",
            tags: [index.id, "climate", "oscillation", "macro-weather", "migration-predictor"],
            species: null,
            state_abbr: null,
            effective_date: latest.date,
            metadata: {
              source: "noaa-cpc",
              index_id: index.id,
              index_name: index.name,
              latest_value: latest.value,
              phase,
              avg_7d: avg7,
              avg_14d: avg14,
              trend,
              recent_values: values,
            },
            embedding: JSON.stringify(embeddings[0]),
          }, { onConflict: "title" });

        if (upsertError) {
          console.error(`  ${index.name} upsert error: ${upsertError.message}`);
          errors++;
        } else {
          totalEmbedded++;
          console.log(`  ${index.name}: ${latest.date} = ${latest.value.toFixed(3)} (${phase}, ${trend})`);
        }

      } catch (err) {
        console.error(`  ${index.name} error: ${err}`);
        errors++;
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-climate-indices",
      status: errors > 0 ? "partial" : "success",
      summary: { embedded: totalEmbedded, indices: INDICES.length, errors },
      durationMs,
    });

    return successResponse(req, { embedded: totalEmbedded, errors, durationMs });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-climate-indices",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return errorResponse(req, String(err), 500);
  }
});
