/**
 * One-shot script: Find climate-index entries in hunt_knowledge with bird/hunting language,
 * rewrite them to neutral environmental language, re-embed via Voyage AI, update DB.
 *
 * Usage:
 *   VOYAGE_API_KEY=... npx tsx scripts/reembed-climate.ts
 *   # or with .env.local:
 *   VOYAGE_API_KEY=$(grep VOYAGE_API_KEY .env.local | cut -d= -f2) npx tsx scripts/reembed-climate.ts
 */

const SUPABASE_URL = "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ2aHlvdHZrbGZvd2tsemphaGRkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MjE1NDA2MSwiZXhwIjoyMDg3NzMwMDYxfQ.qZPUwzzgF1wWtP8Ka-uCyb3Rwr9p22LGA0pEp7ciISg";
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!VOYAGE_KEY) {
  console.error("VOYAGE_API_KEY required. Set it in env or pass via CLI.");
  process.exit(1);
}

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

// --- Bird language detection ---

const BIRD_TERMS = /waterfowl|migration|flyway|staging|duck|bird|hunting|geese|goose|avian|shorebird|raptor|wader/i;

function hasBirdLanguage(content: string): boolean {
  return BIRD_TERMS.test(content);
}

// --- Rewriting ---

// Exact phrase replacements (order matters — longer/more specific first)
const PHRASE_REPLACEMENTS: [RegExp, string][] = [
  // Flyway → geographic region
  [/Atlantic\s+flyway/gi, "Atlantic seaboard"],
  [/Pacific\s+flyway/gi, "Pacific coast"],
  [/Central\s+flyway/gi, "Central plains"],
  [/Mississippi\s+flyway/gi, "Mississippi valley"],

  // Specific phrases from the plan
  [/Strong\s+migration\s+trigger\s+for\s+waterfowl/gi,
    "Strong atmospheric disruption — cold air intrusions affect biological systems, agriculture, and water resources"],
  [/Atlantic\s+flyway\s+migration\s+enhanced/gi,
    "Enhanced meridional flow affects precipitation and temperature patterns along the Atlantic seaboard"],
  [/waterfowl\s+may\s+stage\s+farther\s+south/gi,
    "Ecological timing shifts — growing seasons and biological activity patterns affected"],
  [/forcing\s+birds?\s+off\s+staging\s+areas?/gi,
    "forcing biological and agricultural disruption"],

  // General bird/migration phrases
  [/strong\s+migration\s+trigger/gi, "strong atmospheric disruption"],
  [/migration\s+trigger/gi, "atmospheric disruption"],
  [/migration\s+may\s+stall/gi, "ecological activity may slow"],
  [/migration\s+enhanced/gi, "atmospheric dynamics enhanced"],
  [/migration\s+suppressed/gi, "ecological activity suppressed"],
  [/migration\s+activity/gi, "ecological activity"],
  [/migration\s+patterns?/gi, "ecological patterns"],
  [/migration\s+intensity/gi, "ecological intensity"],
  [/migration\s+movement/gi, "ecological movement"],
  [/migration\s+push/gi, "atmospheric push"],
  [/migration\s+pressure/gi, "atmospheric pressure differential"],
  [/migration\s+window/gi, "ecological window"],
  [/migration\s+front/gi, "weather front"],
  [/migration\s+corridor/gi, "atmospheric corridor"],
  [/migration\s+route/gi, "weather corridor"],
  [/migration/gi, "ecological activity"],

  // Flyway catch-all (after specific flyway replacements above)
  [/flyway\s+signal/gi, "atmospheric signal"],
  [/flyway/gi, "corridor"],

  // Staging
  [/staging\s+areas?/gi, "ecological zones"],
  [/staging\s+shifts?/gi, "ecological timing shifts"],
  [/staging\s+grounds?/gi, "ecological zones"],
  [/staging/gi, "ecological positioning"],

  // Waterfowl / birds / duck / hunting
  [/waterfowl\s+movement/gi, "biological system response"],
  [/waterfowl\s+activity/gi, "biological activity"],
  [/waterfowl/gi, "biological systems"],
  [/shorebirds?/gi, "coastal ecosystems"],
  [/raptors?/gi, "apex predators"],
  [/waders?/gi, "wetland species"],
  [/avian\s+species/gi, "biological systems"],
  [/avian/gi, "biological"],
  [/birds?\s+species/gi, "biological systems"],
  [/birds?/gi, "biological systems"],
  [/duck\s+season/gi, "environmental season"],
  [/ducks?/gi, "biological systems"],
  [/geese/gi, "biological systems"],
  [/goose/gi, "biological systems"],
  [/hunting\s+season/gi, "environmental season"],
  [/hunting\s+pressure/gi, "human activity pressure"],
  [/hunting\s+conditions?/gi, "environmental conditions"],
  [/hunting/gi, "environmental activity"],
];

function rewriteContent(content: string): string {
  let result = content;
  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// --- Voyage AI embedding ---

async function embedText(text: string): Promise<number[]> {
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "voyage-3-lite",
      input: [text],
      input_type: "document",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Voyage API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

async function batchEmbedTexts(texts: string[]): Promise<number[][]> {
  const response = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "voyage-3-lite",
      input: texts,
      input_type: "document",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Voyage API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  return data.data.map((d: any) => d.embedding);
}

// --- Supabase REST API ---

interface KnowledgeEntry {
  id: string;
  content: string;
}

async function fetchClimateIndexEntries(): Promise<KnowledgeEntry[]> {
  const entries: KnowledgeEntry[] = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.climate-index&select=id,content&order=created_at.asc&offset=${offset}&limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase query failed ${res.status}: ${body}`);
    }

    const batch: KnowledgeEntry[] = await res.json();
    entries.push(...batch);

    if (batch.length < limit) break;
    offset += limit;
  }

  return entries;
}

async function updateEntry(id: string, content: string, embedding: number[]): Promise<void> {
  const url = `${SUPABASE_URL}/rest/v1/hunt_knowledge?id=eq.${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: supaHeaders,
    body: JSON.stringify({ content, embedding: JSON.stringify(embedding) }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Update failed for ${id}: ${res.status} ${body}`);
  }
}

// --- Main ---

async function main() {
  console.log("Fetching climate-index entries from hunt_knowledge...");
  const allEntries = await fetchClimateIndexEntries();
  console.log(`Found ${allEntries.length} climate-index entries total.`);

  // Filter to entries with bird language
  const dirty = allEntries.filter((e) => hasBirdLanguage(e.content));
  console.log(`${dirty.length} entries contain bird/hunting language. ${allEntries.length - dirty.length} are clean.`);

  if (dirty.length === 0) {
    console.log("Nothing to rewrite. Done.");
    return;
  }

  // Process in batches of 10
  const BATCH_SIZE = 10;
  let rewritten = 0;
  let embedded = 0;
  let errors = 0;

  for (let i = 0; i < dirty.length; i += BATCH_SIZE) {
    const batch = dirty.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(dirty.length / BATCH_SIZE);
    console.log(`\nBatch ${batchNum}/${totalBatches} (entries ${i + 1}-${i + batch.length})`);

    // Rewrite content
    const rewrittenTexts = batch.map((e) => ({
      id: e.id,
      original: e.content,
      rewritten: rewriteContent(e.content),
    }));

    // Log a sample from each batch
    const sample = rewrittenTexts[0];
    if (sample.original !== sample.rewritten) {
      console.log(`  Sample rewrite:`);
      console.log(`    BEFORE: ${sample.original.substring(0, 120)}...`);
      console.log(`    AFTER:  ${sample.rewritten.substring(0, 120)}...`);
    }

    // Batch embed the rewritten texts
    try {
      const textsToEmbed = rewrittenTexts.map((t) => t.rewritten);
      const embeddings = await batchEmbedTexts(textsToEmbed);
      embedded += embeddings.length;

      // Update each entry in the database
      for (let j = 0; j < rewrittenTexts.length; j++) {
        try {
          await updateEntry(rewrittenTexts[j].id, rewrittenTexts[j].rewritten, embeddings[j]);
          rewritten++;
        } catch (err: any) {
          console.error(`  ERROR updating ${rewrittenTexts[j].id}: ${err.message}`);
          errors++;
        }
      }

      console.log(`  Updated ${batch.length} entries.`);
    } catch (err: any) {
      console.error(`  BATCH EMBED ERROR: ${err.message}`);
      errors += batch.length;
    }

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < dirty.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Total climate-index entries: ${allEntries.length}`);
  console.log(`Entries with bird language: ${dirty.length}`);
  console.log(`Successfully rewritten + re-embedded: ${rewritten}`);
  console.log(`Errors: ${errors}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
