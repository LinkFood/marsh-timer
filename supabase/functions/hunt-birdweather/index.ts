import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// BirdWeather GraphQL API — no auth required for global queries
const GRAPHQL_URL = "https://app.birdweather.com/graphql";

// US bounding box (CONUS + Alaska approximation)
const US_NE = { lat: 49.0, lon: -66.0 };
const US_SW = { lat: 24.0, lon: -125.0 };

// Target species: North American waterfowl + turkey + dove
// IDs from BirdWeather searchSpecies API
const TARGET_SPECIES: { id: string; commonName: string; group: string }[] = [
  // Dabbling ducks
  { id: "130", commonName: "Mallard", group: "duck" },
  { id: "3293", commonName: "American Black Duck", group: "duck" },
  { id: "3294", commonName: "Mottled Duck", group: "duck" },
  { id: "596", commonName: "Wood Duck", group: "duck" },
  { id: "1039", commonName: "Northern Pintail", group: "duck" },
  { id: "275", commonName: "Blue-winged Teal", group: "duck" },
  { id: "528", commonName: "Green-winged Teal", group: "duck" },
  { id: "3060", commonName: "Cinnamon Teal", group: "duck" },
  { id: "896", commonName: "American Wigeon", group: "duck" },
  { id: "137", commonName: "Gadwall", group: "duck" },
  { id: "364", commonName: "Northern Shoveler", group: "duck" },
  // Diving ducks
  { id: "1175", commonName: "Ring-necked Duck", group: "duck" },
  { id: "3298", commonName: "Canvasback", group: "duck" },
  { id: "1362", commonName: "Redhead", group: "duck" },
  { id: "1364", commonName: "Greater Scaup", group: "duck" },
  { id: "3299", commonName: "Lesser Scaup", group: "duck" },
  { id: "1393", commonName: "Bufflehead", group: "duck" },
  { id: "972", commonName: "Common Goldeneye", group: "duck" },
  { id: "885", commonName: "Long-tailed Duck", group: "duck" },
  { id: "150", commonName: "Ruddy Duck", group: "duck" },
  { id: "1954", commonName: "Harlequin Duck", group: "duck" },
  // Sea ducks
  { id: "3048", commonName: "Surf Scoter", group: "duck" },
  { id: "2154", commonName: "Black Scoter", group: "duck" },
  { id: "215", commonName: "Common Eider", group: "duck" },
  { id: "2725", commonName: "King Eider", group: "duck" },
  // Mergansers
  { id: "298", commonName: "Common Merganser", group: "duck" },
  { id: "234", commonName: "Hooded Merganser", group: "duck" },
  { id: "2165", commonName: "Red-breasted Merganser", group: "duck" },
  // Geese
  { id: "100", commonName: "Canada Goose", group: "goose" },
  { id: "1388", commonName: "Cackling Goose", group: "goose" },
  { id: "412", commonName: "Snow Goose", group: "goose" },
  { id: "1273", commonName: "Ross's Goose", group: "goose" },
  { id: "87", commonName: "Greater White-fronted Goose", group: "goose" },
  { id: "554", commonName: "Brant", group: "goose" },
  // Turkey + Dove
  { id: "185", commonName: "Wild Turkey", group: "turkey" },
  { id: "374", commonName: "Mourning Dove", group: "dove" },
];

// Lat bands for geographic spread
function classifyLat(lat: number): string {
  if (lat > 42) return "north";
  if (lat >= 35) return "mid";
  return "south";
}

function activityLevel(count: number): string {
  if (count >= 10000) return "very_high";
  if (count >= 1000) return "high";
  if (count >= 100) return "moderate";
  if (count >= 10) return "low";
  return "minimal";
}

interface DetectionNode {
  station: { coords: { lat: number; lon: number } };
}

async function fetchSpeciesDetections(speciesId: string): Promise<{
  totalCount: number;
  stations: DetectionNode[];
} | null> {
  const query = `{
    detections(
      speciesId: ${speciesId},
      period: {count: 1, unit: "day"},
      ne: {lat: ${US_NE.lat}, lon: ${US_NE.lon}},
      sw: {lat: ${US_SW.lat}, lon: ${US_SW.lon}},
      uniqueStations: true,
      first: 100
    ) {
      totalCount
      edges {
        node {
          station {
            coords { lat lon }
          }
        }
      }
    }
  }`;

  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    // Only retry 5xx
    if (res.status >= 500) {
      console.warn(`  BirdWeather 5xx for species ${speciesId}, retrying once...`);
      await new Promise(r => setTimeout(r, 2000));
      const retry = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!retry.ok) return null;
      const retryData = await retry.json();
      if (retryData.errors) return null;
      const rd = retryData.data.detections;
      return { totalCount: rd.totalCount, stations: rd.edges.map((e: { node: DetectionNode }) => e.node) };
    }
    return null;
  }

  const data = await res.json();
  if (data.errors) {
    console.warn(`  GraphQL errors for species ${speciesId}:`, data.errors[0]?.message);
    return null;
  }

  const detections = data.data.detections;
  return {
    totalCount: detections.totalCount,
    stations: detections.edges.map((e: { node: DetectionNode }) => e.node),
  };
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const today = new Date().toISOString().slice(0, 10);

    console.log(`BirdWeather acoustic detection ingest for ${today}`);
    console.log(`Target species: ${TARGET_SPECIES.length}`);

    const entries: { text: string; meta: Record<string, unknown> }[] = [];
    let errors = 0;

    for (const species of TARGET_SPECIES) {
      try {
        const result = await fetchSpeciesDetections(species.id);

        if (!result || result.totalCount === 0) {
          console.log(`  ${species.commonName}: 0 detections (skipped)`);
          continue;
        }

        const { totalCount, stations } = result;
        const level = activityLevel(totalCount);
        const stationCount = stations.length;

        // Geographic spread
        const north = stations.filter(s => classifyLat(s.station.coords.lat) === "north").length;
        const mid = stations.filter(s => classifyLat(s.station.coords.lat) === "mid").length;
        const south = stations.filter(s => classifyLat(s.station.coords.lat) === "south").length;

        // Average latitude (migration front indicator)
        const avgLat = stations.length > 0
          ? (stations.reduce((sum, s) => sum + s.station.coords.lat, 0) / stations.length).toFixed(1)
          : "N/A";

        const text = `birdweather-acoustic | ${species.commonName} | ${today} | detections:${totalCount} | stations:${stationCount} | activity:${level} | avg_lat:${avgLat} | north:${north} mid:${mid} south:${south} | group:${species.group}`;

        entries.push({
          text,
          meta: {
            title: `birdweather ${species.commonName} ${today}`,
            content: text,
            content_type: "birdweather-acoustic",
            tags: [species.group, species.commonName.toLowerCase(), "birdweather", "acoustic", "detection"],
            species: species.group,
            effective_date: today,
            metadata: {
              source: "birdweather",
              birdweather_species_id: species.id,
              common_name: species.commonName,
              detection_count: totalCount,
              station_count: stationCount,
              activity_level: level,
              avg_latitude: parseFloat(avgLat) || null,
              geographic_spread: { north, mid, south },
            },
          },
        });

        console.log(`  ${species.commonName}: ${totalCount} detections, ${stationCount} stations, activity=${level}`);

        // Rate limit headroom — BirdWeather has no published rate limit but be polite
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.warn(`  ${species.commonName}: ${err}`);
        errors++;
      }
    }

    if (entries.length === 0) {
      const durationMs = Date.now() - startTime;
      console.log("No detections found for any target species");
      await logCronRun({
        functionName: "hunt-birdweather",
        status: "success",
        summary: { date: today, embedded: 0, species_checked: TARGET_SPECIES.length, note: "no detections" },
        durationMs,
      });
      return new Response(JSON.stringify({ date: today, embedded: 0, errors }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Embed and insert in batches of 20
    let totalEmbedded = 0;

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

    const durationMs = Date.now() - startTime;
    console.log(`\nDone: ${totalEmbedded} species embedded, ${errors} errors, ${durationMs}ms`);

    await logCronRun({
      functionName: "hunt-birdweather",
      status: errors > 0 ? "partial" : "success",
      summary: { date: today, embedded: totalEmbedded, species_checked: TARGET_SPECIES.length, errors },
      durationMs,
    });

    return new Response(JSON.stringify({ date: today, embedded: totalEmbedded, errors, durationMs }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-birdweather",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
