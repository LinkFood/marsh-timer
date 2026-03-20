import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// BirdWeather GraphQL API — no auth required for global queries
const GRAPHQL_URL = "https://app.birdweather.com/graphql";

// US bounding box (CONUS)
const US_BOUNDS = 'ne: {lat: 49.0, lon: -66.0}, sw: {lat: 24.0, lon: -125.0}';

// Target species: North American waterfowl + turkey + dove
// IDs from BirdWeather searchSpecies API
const TARGET_SPECIES: { id: string; alias: string; commonName: string; group: string }[] = [
  // Dabbling ducks
  { id: "130", alias: "mallard", commonName: "Mallard", group: "duck" },
  { id: "3293", alias: "blackDuck", commonName: "American Black Duck", group: "duck" },
  { id: "3294", alias: "mottledDuck", commonName: "Mottled Duck", group: "duck" },
  { id: "596", alias: "woodDuck", commonName: "Wood Duck", group: "duck" },
  { id: "1039", alias: "pintail", commonName: "Northern Pintail", group: "duck" },
  { id: "275", alias: "bwTeal", commonName: "Blue-winged Teal", group: "duck" },
  { id: "528", alias: "gwTeal", commonName: "Green-winged Teal", group: "duck" },
  { id: "3060", alias: "cinTeal", commonName: "Cinnamon Teal", group: "duck" },
  { id: "896", alias: "wigeon", commonName: "American Wigeon", group: "duck" },
  { id: "137", alias: "gadwall", commonName: "Gadwall", group: "duck" },
  { id: "364", alias: "shoveler", commonName: "Northern Shoveler", group: "duck" },
  // Diving ducks
  { id: "1175", alias: "ringneck", commonName: "Ring-necked Duck", group: "duck" },
  { id: "3298", alias: "canvasback", commonName: "Canvasback", group: "duck" },
  { id: "1362", alias: "redhead", commonName: "Redhead", group: "duck" },
  { id: "1364", alias: "greaterScaup", commonName: "Greater Scaup", group: "duck" },
  { id: "3299", alias: "lesserScaup", commonName: "Lesser Scaup", group: "duck" },
  { id: "1393", alias: "bufflehead", commonName: "Bufflehead", group: "duck" },
  { id: "972", alias: "goldeneye", commonName: "Common Goldeneye", group: "duck" },
  { id: "885", alias: "longtail", commonName: "Long-tailed Duck", group: "duck" },
  { id: "150", alias: "ruddy", commonName: "Ruddy Duck", group: "duck" },
  { id: "1954", alias: "harlequin", commonName: "Harlequin Duck", group: "duck" },
  // Sea ducks
  { id: "3048", alias: "surfScoter", commonName: "Surf Scoter", group: "duck" },
  { id: "2154", alias: "blackScoter", commonName: "Black Scoter", group: "duck" },
  { id: "215", alias: "commonEider", commonName: "Common Eider", group: "duck" },
  { id: "2725", alias: "kingEider", commonName: "King Eider", group: "duck" },
  // Mergansers
  { id: "298", alias: "commonMerganser", commonName: "Common Merganser", group: "duck" },
  { id: "234", alias: "hoodedMerganser", commonName: "Hooded Merganser", group: "duck" },
  { id: "2165", alias: "rbMerganser", commonName: "Red-breasted Merganser", group: "duck" },
  // Geese
  { id: "100", alias: "canadaGoose", commonName: "Canada Goose", group: "goose" },
  { id: "1388", alias: "cacklingGoose", commonName: "Cackling Goose", group: "goose" },
  { id: "412", alias: "snowGoose", commonName: "Snow Goose", group: "goose" },
  { id: "1273", alias: "rossGoose", commonName: "Ross's Goose", group: "goose" },
  { id: "87", alias: "gwfGoose", commonName: "Greater White-fronted Goose", group: "goose" },
  { id: "554", alias: "brant", commonName: "Brant", group: "goose" },
  // Turkey + Dove
  { id: "185", alias: "turkey", commonName: "Wild Turkey", group: "turkey" },
  { id: "374", alias: "dove", commonName: "Mourning Dove", group: "dove" },
];

function activityLevel(count: number): string {
  if (count >= 10000) return "very_high";
  if (count >= 1000) return "high";
  if (count >= 100) return "moderate";
  if (count >= 10) return "low";
  return "minimal";
}

function classifyLat(lat: number): string {
  if (lat > 42) return "north";
  if (lat >= 35) return "mid";
  return "south";
}

// deno-lint-ignore no-explicit-any
async function graphqlQuery(query: string): Promise<any> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    if (res.status >= 500) {
      // Retry once for 5xx
      console.warn(`  BirdWeather ${res.status}, retrying once...`);
      await new Promise(r => setTimeout(r, 2000));
      const retry = await fetch(GRAPHQL_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      if (!retry.ok) throw new Error(`BirdWeather ${retry.status} on retry`);
      return (await retry.json()).data;
    }
    throw new Error(`BirdWeather ${res.status}`);
  }

  const data = await res.json();
  if (data.errors) {
    throw new Error(`GraphQL: ${data.errors[0]?.message || "unknown error"}`);
  }
  return data.data;
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

    // STEP 1: Batch query all species counts in ONE GraphQL request
    const countParts = TARGET_SPECIES.map(s =>
      `${s.alias}: detections(speciesId: ${s.id}, period: {count: 1, unit: "day"}, ${US_BOUNDS}, first: 0) { totalCount }`
    );
    const countQuery = `{ ${countParts.join(" ")} }`;

    console.log("Fetching detection counts for all species...");
    const countData = await graphqlQuery(countQuery);

    // Build map of alias -> totalCount, filter to species with detections
    const activeSpecies: typeof TARGET_SPECIES[0][] = [];
    const countsMap: Record<string, number> = {};

    for (const species of TARGET_SPECIES) {
      const count = countData[species.alias]?.totalCount || 0;
      if (count > 0) {
        activeSpecies.push(species);
        countsMap[species.alias] = count;
        console.log(`  ${species.commonName}: ${count.toLocaleString()} detections`);
      }
    }

    console.log(`${activeSpecies.length} species with detections`);

    if (activeSpecies.length === 0) {
      const durationMs = Date.now() - startTime;
      console.log("No detections found for any target species");
      await logCronRun({
        functionName: "hunt-birdweather",
        status: "success",
        summary: { date: today, embedded: 0, species_checked: TARGET_SPECIES.length, note: "no detections" },
        durationMs,
      });
      return new Response(JSON.stringify({ date: today, embedded: 0, errors: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // STEP 2: Fetch geographic spread for active species (batch in groups of 12 to keep query size reasonable)
    interface StationCoords { station: { coords: { lat: number; lon: number } } }
    const geoMap: Record<string, StationCoords[]> = {};
    let errors = 0;

    for (let i = 0; i < activeSpecies.length; i += 12) {
      const batch = activeSpecies.slice(i, i + 12);
      const geoParts = batch.map(s =>
        `${s.alias}: detections(speciesId: ${s.id}, period: {count: 1, unit: "day"}, ${US_BOUNDS}, uniqueStations: true, first: 100) { edges { node { station { coords { lat lon } } } } }`
      );
      const geoQuery = `{ ${geoParts.join(" ")} }`;

      try {
        console.log(`Fetching geographic spread batch ${Math.floor(i / 12) + 1}...`);
        const geoData = await graphqlQuery(geoQuery);

        for (const s of batch) {
          const edges = geoData[s.alias]?.edges || [];
          // Filter out stations with null coords
          geoMap[s.alias] = edges
            .map((e: { node: StationCoords }) => e.node)
            .filter((n: StationCoords) => n.station?.coords?.lat != null && n.station?.coords?.lon != null);
        }
      } catch (err) {
        console.warn(`  Geo batch error: ${err}`);
        errors++;
        // Still embed with count-only data
        for (const s of batch) {
          geoMap[s.alias] = [];
        }
      }

      // Small delay between geo batches
      if (i + 12 < activeSpecies.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // STEP 3: Build embedding entries
    const entries: { text: string; meta: Record<string, unknown> }[] = [];

    for (const species of activeSpecies) {
      const totalCount = countsMap[species.alias];
      const stations = geoMap[species.alias] || [];
      const level = activityLevel(totalCount);
      const stationCount = stations.length;

      // Geographic spread
      const north = stations.filter(s => classifyLat(s.station.coords.lat) === "north").length;
      const mid = stations.filter(s => classifyLat(s.station.coords.lat) === "mid").length;
      const south = stations.filter(s => classifyLat(s.station.coords.lat) === "south").length;

      // Average latitude (migration front indicator)
      const avgLat = stationCount > 0
        ? (stations.reduce((sum, s) => sum + s.station.coords.lat, 0) / stationCount).toFixed(1)
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
    }

    // STEP 4: Embed and upsert in batches of 20
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
