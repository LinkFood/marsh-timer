import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { scanBrainOnWrite } from '../_shared/brainScan.ts';
import { logCronRun } from '../_shared/cronLog.ts';

const TAXA = [
  { taxonId: 42223, species: "deer", name: "White-tailed Deer" },
  { taxonId: 906, species: "turkey", name: "Wild Turkey" },
  { taxonId: 3454, species: "dove", name: "Mourning Dove" },
];

const STATE_PLACES: Record<string, { name: string; placeId: number }> = {
  AL: { name: "Alabama", placeId: 19 }, AK: { name: "Alaska", placeId: 6 },
  AZ: { name: "Arizona", placeId: 40 }, AR: { name: "Arkansas", placeId: 36 },
  CA: { name: "California", placeId: 14 }, CO: { name: "Colorado", placeId: 34 },
  CT: { name: "Connecticut", placeId: 49 }, DE: { name: "Delaware", placeId: 4 },
  FL: { name: "Florida", placeId: 21 }, GA: { name: "Georgia", placeId: 23 },
  HI: { name: "Hawaii", placeId: 11 }, ID: { name: "Idaho", placeId: 22 },
  IL: { name: "Illinois", placeId: 35 }, IN: { name: "Indiana", placeId: 20 },
  IA: { name: "Iowa", placeId: 24 }, KS: { name: "Kansas", placeId: 25 },
  KY: { name: "Kentucky", placeId: 26 }, LA: { name: "Louisiana", placeId: 27 },
  ME: { name: "Maine", placeId: 17 }, MD: { name: "Maryland", placeId: 39 },
  MA: { name: "Massachusetts", placeId: 2 }, MI: { name: "Michigan", placeId: 29 },
  MN: { name: "Minnesota", placeId: 38 }, MS: { name: "Mississippi", placeId: 37 },
  MO: { name: "Missouri", placeId: 28 }, MT: { name: "Montana", placeId: 16 },
  NE: { name: "Nebraska", placeId: 3 }, NV: { name: "Nevada", placeId: 50 },
  NH: { name: "New Hampshire", placeId: 41 }, NJ: { name: "New Jersey", placeId: 51 },
  NM: { name: "New Mexico", placeId: 9 }, NY: { name: "New York", placeId: 48 },
  NC: { name: "North Carolina", placeId: 30 }, ND: { name: "North Dakota", placeId: 13 },
  OH: { name: "Ohio", placeId: 31 }, OK: { name: "Oklahoma", placeId: 12 },
  OR: { name: "Oregon", placeId: 10 }, PA: { name: "Pennsylvania", placeId: 42 },
  RI: { name: "Rhode Island", placeId: 8 }, SC: { name: "South Carolina", placeId: 43 },
  SD: { name: "South Dakota", placeId: 44 }, TN: { name: "Tennessee", placeId: 45 },
  TX: { name: "Texas", placeId: 18 }, UT: { name: "Utah", placeId: 52 },
  VT: { name: "Vermont", placeId: 47 }, VA: { name: "Virginia", placeId: 7 },
  WA: { name: "Washington", placeId: 46 }, WV: { name: "West Virginia", placeId: 33 },
  WI: { name: "Wisconsin", placeId: 32 }, WY: { name: "Wyoming", placeId: 15 },
};

function activityLevel(count: number): string {
  if (count >= 500) return "very_high";
  if (count >= 100) return "high";
  if (count >= 30) return "moderate";
  if (count >= 5) return "low";
  return "minimal";
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    // Get yesterday's date range
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const d1 = yesterday.toISOString().slice(0, 10);
    const d2 = d1;

    console.log(`Fetching iNaturalist observations for ${d1}`);

    const abbrs = Object.keys(STATE_PLACES).sort();
    let totalEmbedded = 0;
    let errors = 0;

    const HARD_TIMEOUT_MS = 120_000; // Stop processing at 120s to leave room for logging

    for (const taxon of TAXA) {
      if (Date.now() - startTime > HARD_TIMEOUT_MS) {
        console.log(`[hunt-inaturalist] Hit ${HARD_TIMEOUT_MS}ms timeout, stopping early`);
        break;
      }
      console.log(`\n${taxon.name}:`);
      const entries: { text: string; meta: Record<string, unknown> }[] = [];

      for (const abbr of abbrs) {
        if (Date.now() - startTime > HARD_TIMEOUT_MS) break;
        try {
          const url = `https://api.inaturalist.org/v1/observations?taxon_id=${taxon.taxonId}&place_id=${STATE_PLACES[abbr].placeId}&d1=${d1}&d2=${d2}&per_page=0&quality_grade=research`;
          const res = await fetch(url);
          if (!res.ok) {
            if (res.status === 429) {
              console.log(`  Rate limited, waiting 60s...`);
              await new Promise(r => setTimeout(r, 60000));
            }
            continue;
          }
          const data = await res.json();
          const count = data.total_results || 0;

          // Only embed if there are observations (skip zeros to save embedding budget)
          if (count > 0) {
            const level = activityLevel(count);
            const text = `inaturalist-daily | ${abbr} | ${taxon.species} | ${d1} | observations:${count} | activity:${level}`;
            entries.push({
              text,
              meta: {
                title: `${abbr} ${taxon.species} inat ${d1}`,
                content: text,
                content_type: "inaturalist-daily",
                tags: [abbr, taxon.species, "inaturalist", "observations"],
                state_abbr: abbr,
                species: taxon.species,
                effective_date: d1,
                metadata: {
                  source: "inaturalist",
                  taxon_id: taxon.taxonId,
                  observation_count: count,
                  activity_level: level,
                },
              },
            });
          }

          // Rate limit headroom
          await new Promise(r => setTimeout(r, 400));
        } catch (err) {
          console.warn(`  ${abbr}: ${err}`);
          errors++;
        }
      }

      // Embed and insert in batches of 20
      for (let i = 0; i < entries.length; i += 20) {
        const chunk = entries.slice(i, i + 20);
        const texts = chunk.map(e => e.text);
        const embeddings = await batchEmbed(texts);

        const rows = chunk.map((e, j) => ({
          ...e.meta,
          embedding: JSON.stringify(embeddings[j]),
        }));

        const { error: upsertError } = await supabase
          .from("hunt_knowledge")
          .upsert(rows, { onConflict: "title" });

        if (upsertError) {
          console.error(`  Upsert error: ${upsertError.message}`);
          errors++;
        } else {
          totalEmbedded += rows.length;
        }
      }

      console.log(`  ${taxon.name}: ${entries.length} states with observations`);
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-inaturalist",
      status: errors > 0 ? "partial" : "success",
      summary: { date: d1, embedded: totalEmbedded, errors },
      durationMs,
    });

    return cronResponse({ date: d1, embedded: totalEmbedded, errors, durationMs });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-inaturalist",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return cronErrorResponse(String(err), 500);
  }
});
