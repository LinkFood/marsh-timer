import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// Movebank study IDs for target species — public/CC-BY studies with GPS data
// Discovery: https://www.movebank.org/ → search by species
const STUDIES: Array<{
  studyId: number;
  species: string;
  speciesScientific: string;
  studyName: string;
}> = [
  // Waterfowl
  { studyId: 9493874, species: "duck", speciesScientific: "Anas platyrhynchos", studyName: "Breeding mallards GPS Netherlands" },
  { studyId: 1879094, species: "duck", speciesScientific: "Anas platyrhynchos", studyName: "USGS mallard GPS North America" },
  { studyId: 2803634, species: "goose", speciesScientific: "Branta canadensis", studyName: "Canada Goose GPS eastern US" },
  { studyId: 10449318, species: "goose", speciesScientific: "Anser caerulescens", studyName: "Snow Goose GPS Arctic-Gulf" },
  { studyId: 9562067, species: "duck", speciesScientific: "Anas acuta", studyName: "Northern Pintail GPS Pacific flyway" },
  // Deer
  { studyId: 1891272, species: "deer", speciesScientific: "Odocoileus virginianus", studyName: "White-tailed deer GPS movement" },
  // Turkey
  { studyId: 1456480, species: "turkey", speciesScientific: "Meleagris gallopavo", studyName: "Wild Turkey GPS southeastern US" },
];

const MOVEBANK_BASE = "https://www.movebank.org/movebank/service/public/json";

// Map coordinates to US state abbreviation (rough centroid-based)
function coordsToState(lat: number, lng: number): string | null {
  // Simplified — map to nearest state centroid
  const states: Array<[string, number, number]> = [
    ["AL",32.8,-86.8],["AK",64.2,-153.5],["AZ",34.3,-111.7],["AR",34.8,-92.2],
    ["CA",37.2,-119.5],["CO",39.0,-105.5],["CT",41.6,-72.7],["DE",39.0,-75.5],
    ["FL",28.6,-82.4],["GA",32.7,-83.5],["HI",20.5,-157.4],["ID",44.4,-114.6],
    ["IL",40.0,-89.2],["IN",39.9,-86.3],["IA",42.0,-93.5],["KS",38.5,-98.3],
    ["KY",37.8,-85.7],["LA",31.1,-92.0],["ME",45.4,-69.2],["MD",39.0,-76.8],
    ["MA",42.2,-71.8],["MI",43.3,-84.5],["MN",46.3,-94.3],["MS",32.7,-89.7],
    ["MO",38.4,-92.5],["MT",47.0,-109.6],["NE",41.5,-99.8],["NV",39.5,-116.9],
    ["NH",43.7,-71.6],["NJ",40.1,-74.7],["NM",34.5,-106.0],["NY",42.9,-75.5],
    ["NC",35.6,-79.8],["ND",47.4,-100.5],["OH",40.4,-82.8],["OK",35.6,-97.5],
    ["OR",44.0,-120.5],["PA",40.9,-77.8],["RI",41.7,-71.5],["SC",33.9,-80.9],
    ["SD",44.4,-100.2],["TN",35.9,-86.4],["TX",31.5,-99.3],["UT",39.3,-111.7],
    ["VT",44.1,-72.6],["VA",37.5,-78.9],["WA",47.4,-120.7],["WV",38.6,-80.6],
    ["WI",44.6,-89.8],["WY",43.0,-107.6],
  ];
  // Only match if within continental US bounds
  if (lat < 24 || lat > 50 || lng < -130 || lng > -65) return null;
  let closest = "";
  let minDist = Infinity;
  for (const [abbr, slat, slng] of states) {
    const d = Math.sqrt((lat - slat) ** 2 + (lng - slng) ** 2);
    if (d < minDist) { minDist = d; closest = abbr; }
  }
  return minDist < 5 ? closest : null; // 5 degrees tolerance
}

function formatDate(ts: number): string {
  return new Date(ts).toISOString().split("T")[0];
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    // Get last 30 days of GPS data (daily reduction to keep volume manageable)
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
    const tsStart = thirtyDaysAgo.getTime();
    const tsEnd = now.getTime();

    let totalEmbedded = 0;
    let totalStudies = 0;
    let errors = 0;

    for (const study of STUDIES) {
      console.log(`\nFetching: ${study.studyName} (${study.studyId})`);

      try {
        // Fetch GPS events with daily reduction profile
        const url = `${MOVEBANK_BASE}?study_id=${study.studyId}&sensor_type=gps&max_events_per_individual=30`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (!res.ok) {
          console.warn(`  Study ${study.studyId} returned ${res.status}`);
          errors++;
          continue;
        }

        const data = await res.json();
        if (!Array.isArray(data?.individuals)) {
          console.warn(`  Study ${study.studyId}: unexpected response shape`);
          errors++;
          continue;
        }

        const entries: { text: string; meta: Record<string, unknown> }[] = [];

        for (const individual of data.individuals) {
          const animalId = individual.individual_local_identifier || "unknown";
          const locations = individual.locations || [];

          if (locations.length === 0) continue;

          // Group locations by date for daily summaries
          const byDate = new Map<string, Array<{ lat: number; lng: number; ts: number }>>();
          for (const loc of locations) {
            if (!loc.location_lat || !loc.location_long) continue;
            const date = formatDate(loc.timestamp);
            if (!byDate.has(date)) byDate.set(date, []);
            byDate.get(date)!.push({
              lat: loc.location_lat,
              lng: loc.location_long,
              ts: loc.timestamp,
            });
          }

          // Create one embedding per animal per date
          for (const [date, points] of byDate) {
            const avgLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
            const avgLng = points.reduce((s, p) => s + p.lng, 0) / points.length;
            const stateAbbr = coordsToState(avgLat, avgLng);

            // Calculate daily movement distance (rough, in degrees)
            let totalDist = 0;
            for (let i = 1; i < points.length; i++) {
              totalDist += Math.sqrt(
                (points[i].lat - points[i - 1].lat) ** 2 +
                (points[i].lng - points[i - 1].lng) ** 2
              );
            }
            const distKm = Math.round(totalDist * 111); // rough degrees to km

            const text = [
              `movebank-gps | ${study.species} | ${study.speciesScientific}`,
              `animal:${animalId} | date:${date}`,
              `lat:${avgLat.toFixed(4)} lng:${avgLng.toFixed(4)}`,
              stateAbbr ? `state:${stateAbbr}` : `region:international`,
              `fixes:${points.length} | daily_movement:${distKm}km`,
              `study:${study.studyName}`,
            ].join(" | ");

            entries.push({
              text,
              meta: {
                title: `movebank ${study.species} ${animalId} ${date}`,
                content: text,
                content_type: "movebank-gps",
                tags: [study.species, "movebank", "gps-tracking", "satellite", stateAbbr || "international"],
                species: study.species,
                state_abbr: stateAbbr,
                effective_date: date,
                metadata: {
                  source: "movebank",
                  study_id: study.studyId,
                  study_name: study.studyName,
                  species_scientific: study.speciesScientific,
                  animal_id: animalId,
                  avg_lat: avgLat,
                  avg_lng: avgLng,
                  fix_count: points.length,
                  daily_movement_km: distKm,
                },
              },
            });
          }
        }

        console.log(`  ${study.studyName}: ${entries.length} daily records from ${data.individuals.length} individuals`);

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
            .insert(rows);

          if (upsertError) {
            console.error(`  Upsert error: ${upsertError.message}`);
            errors++;
          } else {
            totalEmbedded += rows.length;
          }

          // Respect Movebank rate limits
          await new Promise(r => setTimeout(r, 1000));
        }

        totalStudies++;

        // 5s between studies for rate limiting
        await new Promise(r => setTimeout(r, 5000));

      } catch (err) {
        console.error(`  Study ${study.studyId} error: ${err}`);
        errors++;
      }
    }

    const durationMs = Date.now() - startTime;
    await logCronRun({
      functionName: "hunt-movebank",
      status: errors > 0 ? "partial" : "success",
      summary: { studies_processed: totalStudies, embedded: totalEmbedded, errors },
      durationMs,
    });

    return successResponse(req, {
      studies_processed: totalStudies,
      embedded: totalEmbedded,
      errors,
      durationMs,
    });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-movebank",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return errorResponse(req, String(err), 500);
  }
});
