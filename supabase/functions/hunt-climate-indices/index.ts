import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// Macro climate oscillation indices — upstream predictors for animal movement
// All from NOAA PSL (psl.noaa.gov) — monthly resolution, freely accessible via HTTPS
const MONTHLY_INDICES = [
  {
    id: "ao",
    name: "Arctic Oscillation",
    url: "https://psl.noaa.gov/data/correlation/ao.data",
    impact: {
      negative: "Cold air outbreak pattern — arctic air pushing south. Strong migration trigger for waterfowl. Negative AO correlates with freeze events forcing birds off staging areas.",
      positive: "Mild arctic pattern — reduced cold intrusions. Migration may stall. Staging areas ice-free.",
      neutral: "Neutral arctic — no strong cold or mild signal.",
    },
  },
  {
    id: "nao",
    name: "North Atlantic Oscillation",
    url: "https://psl.noaa.gov/data/correlation/nao.data",
    impact: {
      negative: "Stormy eastern US — cold, wet. Atlantic flyway migration enhanced. Cold fronts push coastal waterfowl south.",
      positive: "Mild, dry eastern US. Atlantic flyway migration may slow. Coastal staging areas stable.",
      neutral: "Neutral Atlantic — no strong storm signal.",
    },
  },
  {
    id: "pdo",
    name: "Pacific Decadal Oscillation",
    url: "https://psl.noaa.gov/data/correlation/pdo.data",
    impact: {
      negative: "Cool Pacific phase — cooler/wetter Pacific Northwest, warmer Southeast. Pacific flyway waterfowl may stage farther south. Multi-year to decadal cycle affects seasonal routing.",
      positive: "Warm Pacific phase — warmer/drier Pacific Northwest, cooler Southeast. Pacific flyway staging shifts north.",
      neutral: "Neutral Pacific — no strong decadal signal.",
    },
  },
  {
    id: "enso",
    name: "ENSO Nino 3.4",
    url: "https://psl.noaa.gov/data/correlation/nina34.anom.data",
    impact: {
      negative: "La Niña — cooler tropical Pacific. Typically drier South, wetter North. Can amplify cold outbreaks when combined with negative AO. Affects continental storm tracks.",
      positive: "El Niño — warmer tropical Pacific. Wetter South, milder North. Suppresses cold outbreaks. Waterfowl staging may extend later into season.",
      neutral: "ENSO-neutral — no strong tropical Pacific forcing on continental weather.",
    },
  },
  {
    id: "pna",
    name: "Pacific North American Pattern",
    url: "https://psl.noaa.gov/data/correlation/pna.data",
    impact: {
      negative: "Negative PNA — ridge over eastern Pacific, trough over western US. Wet/cool West, dry/mild East. Pacific flyway gets weather.",
      positive: "Positive PNA — ridge over western North America, trough in East. Classic cold outbreak setup for Central/Mississippi flyways.",
      neutral: "Neutral PNA — no strong ridge/trough pattern.",
    },
  },
];

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Parse PSL monthly data format: "YYYY  val1 val2 ... val12"
// Missing values are -99.99 or -999.000 or -9.90
function parseMonthlyPSL(text: string): Array<{ year: number; month: number; value: number }> {
  const entries: Array<{ year: number; month: number; value: number }> = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("http") || trimmed.includes("@")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    const year = parseInt(parts[0]);
    if (isNaN(year) || year < 1900 || year > 2100) continue;

    for (let m = 0; m < Math.min(12, parts.length - 1); m++) {
      const val = parseFloat(parts[m + 1]);
      if (isNaN(val) || val <= -9.0) continue; // -9.90, -99.99, -999 = missing
      entries.push({ year, month: m + 1, value: val });
    }
  }
  return entries;
}

function classifyPhase(value: number): "negative" | "positive" | "neutral" {
  if (value <= -0.5) return "negative";
  if (value >= 0.5) return "positive";
  return "neutral";
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    let totalEmbedded = 0;
    let errors = 0;

    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;

    for (const index of MONTHLY_INDICES) {
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
        const all = parseMonthlyPSL(text);

        if (all.length === 0) {
          console.warn(`  ${index.name}: no data parsed`);
          continue;
        }

        // Get last 12 months of valid data
        const recent = all.slice(-12);
        const latest = all[all.length - 1];
        const values = recent.map(r => r.value);

        const phase = classifyPhase(latest.value);
        const avg6 = values.slice(-6).reduce((a, b) => a + b, 0) / Math.min(6, values.length);
        const avg12 = values.reduce((a, b) => a + b, 0) / values.length;

        // Trend: compare last 3 months vs prior 3
        const last3 = values.slice(-3);
        const prior3 = values.slice(-6, -3);
        let trend = "stable";
        if (last3.length >= 3 && prior3.length >= 3) {
          const avgLast = last3.reduce((a, b) => a + b, 0) / 3;
          const avgPrior = prior3.reduce((a, b) => a + b, 0) / 3;
          const diff = avgLast - avgPrior;
          if (diff < -0.3) trend = "trending negative";
          else if (diff > 0.3) trend = "trending positive";
        }

        const impact = index.impact[phase];
        const dateStr = `${latest.year}-${String(latest.month).padStart(2, "0")}-01`;

        const entryText = [
          `climate-index | ${index.id.toUpperCase()} | ${index.name}`,
          `period:${MONTH_NAMES[latest.month - 1]} ${latest.year} | value:${latest.value.toFixed(2)}`,
          `phase:${phase} | 6mo_avg:${avg6.toFixed(2)} | 12mo_avg:${avg12.toFixed(2)}`,
          `trend:${trend}`,
          `impact: ${impact}`,
          `12mo_history: ${recent.map(r => `${MONTH_NAMES[r.month-1]}:${r.value.toFixed(2)}`).join(", ")}`,
        ].join(" | ");

        const embeddings = await batchEmbed([entryText]);

        const { error: upsertError } = await supabase
          .from("hunt_knowledge")
          .upsert({
            title: `climate-index ${index.id} ${dateStr}`,
            content: entryText,
            content_type: "climate-index",
            tags: [index.id, "climate", "oscillation", "macro-weather", "migration-predictor"],
            species: null,
            state_abbr: null,
            effective_date: dateStr,
            metadata: {
              source: "noaa-psl",
              index_id: index.id,
              index_name: index.name,
              latest_value: latest.value,
              latest_period: `${latest.year}-${String(latest.month).padStart(2, "0")}`,
              phase,
              avg_6mo: avg6,
              avg_12mo: avg12,
              trend,
              recent_12mo: recent.map(r => ({ period: `${r.year}-${String(r.month).padStart(2, "0")}`, value: r.value })),
            },
            embedding: JSON.stringify(embeddings[0]),
          }, { onConflict: "title" });

        if (upsertError) {
          console.error(`  ${index.name} upsert: ${upsertError.message}`);
          errors++;
        } else {
          totalEmbedded++;
          console.log(`  ${index.name}: ${MONTH_NAMES[latest.month-1]} ${latest.year} = ${latest.value.toFixed(2)} (${phase}, ${trend})`);
        }

        await new Promise(r => setTimeout(r, 1000));
      } catch (err) {
        console.error(`  ${index.name} error: ${err}`);
        errors++;
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-climate-indices",
      status: errors > 0 ? "partial" : "success",
      summary: { embedded: totalEmbedded, indices: MONTHLY_INDICES.length, errors },
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
