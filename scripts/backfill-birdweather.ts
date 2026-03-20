/**
 * Backfill BirdWeather acoustic detection data into hunt_knowledge
 * Daily detection counts per species, going back as far as the API allows
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-birdweather.ts
 *   START_DATE=2025-01-01 npx tsx scripts/backfill-birdweather.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY!;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) { console.error("VOYAGE_API_KEY required"); process.exit(1); }

const START_DATE = process.env.START_DATE || "2024-01-01";

// Target species for BirdWeather queries
const SPECIES = [
  "Mallard", "Northern Pintail", "Green-winged Teal", "Wood Duck",
  "Canvasback", "American Wigeon", "Northern Shoveler", "Gadwall",
  "Blue-winged Teal", "Redhead", "Ring-necked Duck", "Lesser Scaup",
  "Greater Scaup", "Bufflehead", "Common Goldeneye", "Hooded Merganser",
  "Common Merganser", "Red-breasted Merganser", "Ruddy Duck",
  "Canada Goose", "Snow Goose", "Greater White-fronted Goose",
  "Cackling Goose", "Ross's Goose", "Brant",
  "Wild Turkey", "Mourning Dove",
];

const GRAPHQL_URL = "https://app.birdweather.com/graphql";

async function embed(texts: string[]): Promise<number[][]> {
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

async function fetchDetections(speciesName: string, date: string): Promise<number> {
  const query = `{
    species(name: "${speciesName}") {
      detections(date: "${date}", country: "US") {
        totalCount
      }
    }
  }`;

  try {
    const res = await fetch(GRAPHQL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return data?.data?.species?.detections?.totalCount || 0;
  } catch {
    return 0;
  }
}

async function main() {
  let totalEmbedded = 0;
  const start = new Date(START_DATE);
  const end = new Date();
  end.setDate(end.getDate() - 1); // yesterday

  // Iterate day by day
  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split("T")[0];
    console.log(`\n${dateStr}:`);

    const entries: Array<{ text: string; meta: Record<string, any> }> = [];

    for (const species of SPECIES) {
      const count = await fetchDetections(species, dateStr);
      if (count === 0) continue;

      const category = speciesCategory(species);
      const text = [
        `birdweather-acoustic | ${category} | ${species}`,
        `date:${dateStr} | detections:${count}`,
        `source:BirdWeather (5000+ acoustic microphones)`,
      ].join(" | ");

      entries.push({
        text,
        meta: {
          title: `birdweather ${species.toLowerCase().replace(/\s+/g, "-")} ${dateStr}`,
          content: text,
          content_type: "birdweather-daily",
          tags: [category, species.toLowerCase(), "birdweather", "acoustic"],
          species: category,
          effective_date: dateStr,
          metadata: {
            source: "birdweather",
            species_name: species,
            detection_count: count,
          },
        },
      });

      // Rate limit
      await new Promise(r => setTimeout(r, 500));
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
