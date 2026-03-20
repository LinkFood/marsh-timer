/**
 * Backfill BirdWeather acoustic detection data into hunt_knowledge
 * Daily detection counts per species via GraphQL counts API
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-birdweather.ts
 *   START_DATE=2025-01-01 npx tsx scripts/backfill-birdweather.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using hunt-generate-embedding edge function (slower)");

const START_DATE = process.env.START_DATE || "2024-01-01";

// Species with BirdWeather IDs (looked up via searchSpecies GraphQL)
const SPECIES: Array<{ name: string; id: string }> = [
  { name: "Mallard", id: "130" },
  { name: "Northern Pintail", id: "1039" },
  { name: "Green-winged Teal", id: "528" },
  { name: "Wood Duck", id: "596" },
  { name: "Canvasback", id: "3298" },
  { name: "American Wigeon", id: "896" },
  { name: "Northern Shoveler", id: "364" },
  { name: "Gadwall", id: "137" },
  { name: "Blue-winged Teal", id: "275" },
  { name: "Redhead", id: "1362" },
  { name: "Ring-necked Duck", id: "1175" },
  { name: "Lesser Scaup", id: "3299" },
  { name: "Greater Scaup", id: "1364" },
  { name: "Bufflehead", id: "1393" },
  { name: "Common Goldeneye", id: "972" },
  { name: "Hooded Merganser", id: "234" },
  { name: "Common Merganser", id: "298" },
  { name: "Red-breasted Merganser", id: "2165" },
  { name: "Ruddy Duck", id: "150" },
  { name: "Canada Goose", id: "100" },
  { name: "Snow Goose", id: "412" },
  { name: "Greater White-fronted Goose", id: "87" },
  { name: "Cackling Goose", id: "1388" },
  { name: "Ross's Goose", id: "1273" },
  { name: "Brant", id: "554" },
  { name: "Wild Turkey", id: "185" },
  { name: "Mourning Dove", id: "374" },
];

const GRAPHQL_URL = "https://app.birdweather.com/graphql";

// US bounding box for filtering
const US_NE = { lat: 49.0, lon: -66.0 };
const US_SW = { lat: 24.5, lon: -125.0 };

async function embedViaEdgeFn(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, input_type: "document" }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.embedding;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      throw new Error(`Edge fn error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      throw err;
    }
  }
  throw new Error("embedViaEdgeFn: exhausted retries");
}

async function embed(texts: string[]): Promise<number[][]> {
  if (USE_EDGE_FN) {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await embedViaEdgeFn(text));
      await new Promise((r) => setTimeout(r, 100));
    }
    return results;
  }
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += 20) {
    const chunk = texts.slice(i, i + 20);
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "voyage-3-lite", input: chunk, input_type: "document" }),
    });
    if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const item of data.data) results.push(item.embedding);
  }
  return results;
}

async function upsertBatch(entries: Array<{ text: string; meta: Record<string, any> }>) {
  if (entries.length === 0) return 0;
  const texts = entries.map(e => e.text);
  const embeddings = await embed(texts);
  const rows = entries.map((e, i) => ({ ...e.meta, embedding: JSON.stringify(embeddings[i]) }));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY,
      "Content-Type": "application/json", Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) { console.error(`  Upsert error: ${res.status}`); return 0; }
  return rows.length;
}

function speciesCategory(name: string): string {
  if (name.includes("Goose") || name.includes("Brant")) return "goose";
  if (name.includes("Turkey")) return "turkey";
  if (name.includes("Dove")) return "dove";
  return "duck";
}

async function fetchDetections(speciesId: string, date: string): Promise<{ detections: number; stations: number }> {
  const query = `{
    counts(
      period: { from: "${date}", to: "${date}" }
      speciesId: "${speciesId}"
      ne: { lat: ${US_NE.lat}, lon: ${US_NE.lon} }
      sw: { lat: ${US_SW.lat}, lon: ${US_SW.lon} }
    ) {
      detections
      stations
    }
  }`;

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return { detections: 0, stations: 0 };
    const data = await res.json();
    if (data.errors) return { detections: 0, stations: 0 };
    return {
      detections: data?.data?.counts?.detections || 0,
      stations: data?.data?.counts?.stations || 0,
    };
  } catch {
    return { detections: 0, stations: 0 };
  }
}

async function main() {
  let totalEmbedded = 0;
  const start = new Date(START_DATE);
  const end = new Date();
  end.setDate(end.getDate() - 1); // yesterday

  const totalDays = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  console.log(`BirdWeather backfill: ${START_DATE} -> ${end.toISOString().split("T")[0]} (${totalDays} days, ${SPECIES.length} species)`);

  const current = new Date(start);
  let dayNum = 0;
  while (current <= end) {
    dayNum++;
    const dateStr = current.toISOString().split("T")[0];
    console.log(`\n[${dayNum}/${totalDays}] ${dateStr}:`);

    const entries: Array<{ text: string; meta: Record<string, any> }> = [];

    for (const sp of SPECIES) {
      const { detections, stations } = await fetchDetections(sp.id, dateStr);
      if (detections === 0) continue;

      const category = speciesCategory(sp.name);
      const text = [
        `birdweather-acoustic | ${category} | ${sp.name}`,
        `date:${dateStr} | detections:${detections} | stations:${stations}`,
        `source:BirdWeather (acoustic microphone network)`,
      ].join(" | ");

      entries.push({
        text,
        meta: {
          title: `birdweather ${sp.name.toLowerCase().replace(/\s+/g, "-")} ${dateStr}`,
          content: text,
          content_type: "birdweather-daily",
          tags: [category, sp.name.toLowerCase(), "birdweather", "acoustic"],
          species: category,
          effective_date: dateStr,
          metadata: {
            source: "birdweather",
            species_name: sp.name,
            species_id: sp.id,
            detection_count: detections,
            station_count: stations,
          },
        },
      });

      // Rate limit BirdWeather API
      await new Promise(r => setTimeout(r, 300));
    }

    // Embed and upsert
    for (let i = 0; i < entries.length; i += 20) {
      const chunk = entries.slice(i, i + 20);
      const n = await upsertBatch(chunk);
      totalEmbedded += n;
    }

    console.log(`  ${entries.length} species detected, ${totalEmbedded} total embedded`);
    current.setDate(current.getDate() + 1);
  }

  console.log(`\nDone. Total embedded: ${totalEmbedded}`);
}

main().catch(console.error);
