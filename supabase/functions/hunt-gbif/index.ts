import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// GBIF taxon keys for target species
const TAXA = [
  { taxonKey: 9761484, species: "duck", scientific: "Anas platyrhynchos", common: "Mallard" },
  { taxonKey: 2498112, species: "duck", scientific: "Anas acuta", common: "Northern Pintail" },
  { taxonKey: 8214667, species: "duck", scientific: "Anas crecca", common: "Green-winged Teal" },
  { taxonKey: 2498387, species: "duck", scientific: "Aix sponsa", common: "Wood Duck" },
  { taxonKey: 2498256, species: "duck", scientific: "Aythya valisineria", common: "Canvasback" },
  { taxonKey: 5232437, species: "goose", scientific: "Branta canadensis", common: "Canada Goose" },
  { taxonKey: 2498167, species: "goose", scientific: "Anser caerulescens", common: "Snow Goose" },
  { taxonKey: 2440965, species: "deer", scientific: "Odocoileus virginianus", common: "White-tailed Deer" },
  { taxonKey: 9606290, species: "turkey", scientific: "Meleagris gallopavo", common: "Wild Turkey" },
  { taxonKey: 2495347, species: "dove", scientific: "Zenaida macroura", common: "Mourning Dove" },
];

// US state name to abbreviation
const STATE_ABBRS: Record<string, string> = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
  "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
  "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA",
  "Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD",
  "Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO",
  "Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ",
  "New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH",
  "Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC",
  "South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT",
  "Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY",
};

const GBIF_BASE = "https://api.gbif.org/v1/occurrence/search";

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    // Get yesterday's date for daily ingest
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const dateStr = yesterday.toISOString().split("T")[0];

    console.log(`GBIF daily ingest for ${dateStr}`);

    let totalEmbedded = 0;
    let errors = 0;

    for (const taxon of TAXA) {
      try {
        // Fetch recent US occurrences for this species on the target date
        const url = `${GBIF_BASE}?taxonKey=${taxon.taxonKey}&country=US&eventDate=${dateStr}&hasCoordinate=true&hasGeospatialIssue=false&limit=300`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
          if (res.status >= 500) {
            console.warn(`  GBIF ${res.status} for ${taxon.common}`);
            errors++;
          }
          continue;
        }

        const data = await res.json();
        const results = data.results || [];
        const totalCount = data.count || 0;

        if (results.length === 0) {
          console.log(`  ${taxon.common}: 0 occurrences`);
          continue;
        }

        // Group by state for state-level summaries
        const byState = new Map<string, { count: number; coords: Array<[number, number]> }>();

        for (const occ of results) {
          const stateName = occ.stateProvince;
          const abbr = stateName ? STATE_ABBRS[stateName] : null;
          if (!abbr) continue;

          if (!byState.has(abbr)) byState.set(abbr, { count: 0, coords: [] });
          const entry = byState.get(abbr)!;
          entry.count++;
          if (occ.decimalLatitude && occ.decimalLongitude) {
            entry.coords.push([occ.decimalLatitude, occ.decimalLongitude]);
          }
        }

        const entries: { text: string; meta: Record<string, unknown> }[] = [];

        for (const [abbr, stateData] of byState) {
          // Calculate centroid of observations
          const avgLat = stateData.coords.length > 0
            ? stateData.coords.reduce((s, c) => s + c[0], 0) / stateData.coords.length
            : 0;
          const avgLng = stateData.coords.length > 0
            ? stateData.coords.reduce((s, c) => s + c[1], 0) / stateData.coords.length
            : 0;

          const text = [
            `gbif-daily | ${taxon.species} | ${taxon.common} (${taxon.scientific})`,
            `state:${abbr} | date:${dateStr}`,
            `observations:${stateData.count} | total_us:${totalCount}`,
            `centroid:${avgLat.toFixed(3)},${avgLng.toFixed(3)}`,
            `source:GBIF (aggregates eBird, iNaturalist, museums, government surveys)`,
          ].join(" | ");

          entries.push({
            text,
            meta: {
              title: `gbif ${taxon.species} ${abbr} ${dateStr}`,
              content: text,
              content_type: "gbif-daily",
              tags: [abbr, taxon.species, taxon.common.toLowerCase(), "gbif", "biodiversity"],
              species: taxon.species,
              state_abbr: abbr,
              effective_date: dateStr,
              metadata: {
                source: "gbif",
                taxon_key: taxon.taxonKey,
                species_scientific: taxon.scientific,
                species_common: taxon.common,
                observation_count: stateData.count,
                total_us_count: totalCount,
                centroid_lat: avgLat,
                centroid_lng: avgLng,
              },
            },
          });
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

        console.log(`  ${taxon.common}: ${entries.length} state records (${totalCount} total US)`);

        // 2s between species to be respectful
        await new Promise(r => setTimeout(r, 2000));

      } catch (err) {
        console.error(`  ${taxon.common} error: ${err}`);
        errors++;
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-gbif",
      status: errors > 0 ? "partial" : "success",
      summary: { date: dateStr, embedded: totalEmbedded, species_count: TAXA.length, errors },
      durationMs,
    });

    return successResponse({ date: dateStr, embedded: totalEmbedded, errors, durationMs });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-gbif",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return errorResponse(String(err), 500);
  }
});
