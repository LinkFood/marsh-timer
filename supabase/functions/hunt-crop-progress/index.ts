import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

const NASS_API_URL = "https://quickstats.nass.usda.gov/api/api_GET";
const NASS_API_KEY = "25B05F81-1582-3D5D-A4F1-D13D00FCE7D1";

// Crops that create flooded fields supporting wetland ecosystems
const CROPS = ["RICE", "CORN", "SOYBEANS", "WINTER WHEAT"];

// Progress stages relevant to field conditions (planted=worked, emerged=flooded/growing, harvested=stubble/flood)
const PROGRESS_UNITS = ["PCT PLANTED", "PCT EMERGED", "PCT HARVESTED"];

// Mississippi valley + Central region states where crop fields overlap wetland ecosystems
const MONITORED_STATES = [
  "AR", "LA", "TX", "MO", "MS", "CA", "IL", "IN", "IA", "KS",
  "KY", "MN", "NE", "ND", "OH", "OK", "SD", "TN", "WI",
];

function buildNassUrl(params: Record<string, string>): string {
  const url = new URL(NASS_API_URL);
  url.searchParams.set("key", NASS_API_KEY);
  url.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

interface NassRecord {
  commodity_desc: string;
  unit_desc: string;
  state_alpha: string;
  state_name: string;
  week_ending: string;
  reference_period_desc: string;
  Value: string;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    // Season gate: NASS only publishes crop progress Apr-Nov
    const currentMonth = new Date().getUTCMonth() + 1; // 1-indexed
    if (currentMonth < 4 || currentMonth > 11) {
      console.log(`[hunt-crop-progress] Off-season (month ${currentMonth}), skipping. NASS publishes Apr-Nov.`);
      await logCronRun({
        functionName: 'hunt-crop-progress',
        status: 'success',
        summary: { skipped: true, reason: 'off_season', month: currentMonth },
        durationMs: Date.now() - startTime,
      });
      return successResponse(req, { skipped: true, reason: 'off_season', month: currentMonth });
    }

    // Determine year — use current year
    const currentYear = new Date().getUTCFullYear();

    console.log(`Fetching NASS crop progress for ${currentYear}`);

    let totalEmbedded = 0;
    let totalFetched = 0;
    let errors = 0;

    for (const crop of CROPS) {
      for (const unit of PROGRESS_UNITS) {
        try {
          const url = buildNassUrl({
            commodity_desc: crop,
            statisticcat_desc: "PROGRESS",
            unit_desc: unit,
            agg_level_desc: "STATE",
            year: String(currentYear),
          });

          console.log(`  Fetching ${crop} ${unit}...`);
          const res = await fetch(url);

          if (!res.ok) {
            // Only retry 5xx — 4xx are permanent
            if (res.status >= 500) {
              console.warn(`  ${crop} ${unit}: ${res.status} (server error, skipping)`);
            } else {
              console.warn(`  ${crop} ${unit}: ${res.status} (client error, skipping)`);
            }
            errors++;
            continue;
          }

          const json = await res.json();
          const records: NassRecord[] = json.data || [];

          // Filter to monitored states only
          const filtered = records.filter((r) =>
            MONITORED_STATES.includes(r.state_alpha) && r.Value && r.Value !== "(D)" && r.Value !== "(NA)"
          );

          if (filtered.length === 0) {
            console.log(`  ${crop} ${unit}: no monitored state data`);
            continue;
          }

          totalFetched += filtered.length;

          // Build entries for embedding
          const entries: { text: string; meta: Record<string, unknown> }[] = [];

          for (const r of filtered) {
            const pct = r.Value.trim();
            const cropLower = crop.toLowerCase().replace(" ", "-");
            const unitShort = unit.replace("PCT ", "").toLowerCase();
            const weekEnding = r.week_ending; // e.g. "2025-06-15"

            const text = `crop-progress-weekly | ${r.state_alpha} | ${cropLower} | ${unitShort}:${pct}% | week_ending:${weekEnding} | ${r.reference_period_desc}`;

            entries.push({
              text,
              meta: {
                title: `${r.state_alpha} ${cropLower} ${unitShort} ${weekEnding}`,
                content: text,
                content_type: "crop-progress-weekly",
                tags: [r.state_alpha, cropLower, "crop-progress", unitShort, "nass"],
                state_abbr: r.state_alpha,
                species: null,
                effective_date: weekEnding,
                metadata: {
                  source: "usda-nass",
                  commodity: crop,
                  progress_measure: unit,
                  percent_value: parseFloat(pct) || 0,
                  week_ending: weekEnding,
                  reference_period: r.reference_period_desc,
                  state_name: r.state_name,
                  year: currentYear,
                },
              },
            });
          }

          // Embed and upsert in batches of 20
          for (let i = 0; i < entries.length; i += 20) {
            const chunk = entries.slice(i, i + 20);
            const texts = chunk.map((e) => e.text);
            const embeddings = await batchEmbed(texts);

            const rows = chunk.map((e, j) => ({
              ...e.meta,
              embedding: embeddings[j],
            }));

            const { error: upsertError } = await supabase
              .from("hunt_knowledge")
              .insert(rows);

            if (upsertError) {
              console.error(`  Upsert error: ${upsertError.message}`);
              errors++;
            } else {
              totalEmbedded += rows.length;
            }
          }

          console.log(`  ${crop} ${unit}: ${filtered.length} state records -> ${entries.length} embedded`);

          // Small delay between API calls to be polite
          await new Promise((r) => setTimeout(r, 500));
        } catch (err) {
          console.error(`  ${crop} ${unit} error: ${err}`);
          errors++;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    const status = errors > 0 ? (totalEmbedded > 0 ? "partial" : "error") : "success";

    await logCronRun({
      functionName: "hunt-crop-progress",
      status,
      summary: { year: currentYear, fetched: totalFetched, embedded: totalEmbedded, errors },
      durationMs,
    });

    return successResponse(req, {
      year: currentYear,
      fetched: totalFetched,
      embedded: totalEmbedded,
      errors,
      durationMs,
    });
  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-crop-progress",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return errorResponse(req, String(err), 500);
  }
});
