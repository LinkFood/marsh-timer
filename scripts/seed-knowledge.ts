/**
 * Seed hunt_knowledge with state facts + regulation links
 * Calls Voyage AI directly in batches of 20 (max before timeout)
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/seed-knowledge.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) {
  // Try to get it from Supabase secrets via the edge function test
  console.log("VOYAGE_API_KEY not provided, will use edge function (slower)");
}

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

async function fetchTable(table: string, select: string): Promise<any[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=${select}`,
    { headers: supaHeaders },
  );
  if (!res.ok) throw new Error(`Failed to fetch ${table}: ${res.status}`);
  return res.json();
}

async function batchEmbed(texts: string[], retries = 3): Promise<number[][]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      if (VOYAGE_KEY) {
        // Direct Voyage API — faster, no edge function overhead
        const res = await fetch("https://api.voyageai.com/v1/embeddings", {
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
        if (res.ok) {
          const data = await res.json();
          return data.data.map((d: { embedding: number[] }) => d.embedding);
        }
        if (res.status === 429 && attempt < retries - 1) {
          const wait = (attempt + 1) * 30000;
          console.log(`    Rate limited, waiting ${wait / 1000}s...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        if (res.status >= 500 && attempt < retries - 1) {
          const wait = (attempt + 1) * 5000;
          console.log(`    Retry ${attempt + 1}/${retries} after ${wait / 1000}s (${res.status})...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
      } else {
        // Fallback: edge function (one at a time)
        const embeddings: number[][] = [];
        for (const text of texts) {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
            method: "POST",
            headers: supaHeaders,
            body: JSON.stringify({ text, input_type: "document" }),
          });
          if (!res.ok) throw new Error(`Edge fn error: ${res.status}`);
          const data = await res.json();
          embeddings.push(data.embedding);
        }
        return embeddings;
      }
    } catch (err) {
      if (attempt < retries - 1) {
        const wait = (attempt + 1) * 10000;
        console.log(`    Error, retrying in ${wait / 1000}s: ${err}`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

async function upsertKnowledgeBatch(entries: {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  embedding: number[];
}[]) {
  const rows = entries.map((e) => ({
    title: e.title,
    content: e.content,
    content_type: e.content_type,
    tags: e.tags,
    species: e.species,
    effective_date: e.effective_date,
    embedding: JSON.stringify(e.embedding),
  }));

  const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
    method: "POST",
    headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`  Batch upsert failed: ${await res.text()}`);
  }
}

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  species: string | null;
  effective_date: string | null;
  richText: string;
}

async function processBatch(batch: PreparedEntry[]): Promise<number> {
  const texts = batch.map((e) => e.richText);
  const embeddings = await batchEmbed(texts);

  const entries = batch.map((e, i) => ({
    title: e.title,
    content: e.content,
    content_type: e.content_type,
    tags: e.tags,
    species: e.species,
    effective_date: e.effective_date,
    embedding: embeddings[i],
  }));

  await upsertKnowledgeBatch(entries);
  return entries.length;
}

async function seedFacts() {
  console.log("Fetching state facts...");
  const facts = await fetchTable("hunt_state_facts", "species_id,state_name,facts");
  console.log(`Found ${facts.length} fact entries`);

  // Flatten into prepared entries
  const prepared: PreparedEntry[] = [];
  for (const row of facts) {
    for (const fact of row.facts as string[]) {
      const title = `${row.species_id} fact: ${row.state_name}`;
      prepared.push({
        title,
        content: fact,
        content_type: "fact",
        tags: [row.species_id, row.state_name.toLowerCase()],
        species: row.species_id,
        effective_date: null,
        richText: `${title} | ${row.species_id} | ${row.state_name} | ${fact}`,
      });
    }
  }

  console.log(`  ${prepared.length} individual facts to embed`);

  // Process in batches of 20
  let count = 0;
  for (let i = 0; i < prepared.length; i += 20) {
    const batch = prepared.slice(i, i + 20);
    try {
      const n = await processBatch(batch);
      count += n;
      console.log(`  ${count}/${prepared.length} facts embedded`);
      // Small pause between batches
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`  Batch ${i}-${i + batch.length} failed: ${err}`);
    }
  }

  console.log(`Seeded ${count} facts`);
  return count;
}

async function seedRegLinks() {
  console.log("Fetching regulation links...");
  const links = await fetchTable("hunt_regulation_links", "species_id,state_abbr,url");
  console.log(`Found ${links.length} regulation links`);

  const prepared: PreparedEntry[] = links.map((row) => {
    const title = `${row.species_id} regulations: ${row.state_abbr}`;
    const content = `Official ${row.species_id} hunting regulations for ${row.state_abbr}: ${row.url}`;
    return {
      title,
      content,
      content_type: "regulation",
      tags: [row.species_id, row.state_abbr.toLowerCase(), "regulation"],
      species: row.species_id,
      effective_date: null,
      richText: `${title} | regulation link | ${row.species_id}, ${row.state_abbr} | ${content}`,
    };
  });

  let count = 0;
  for (let i = 0; i < prepared.length; i += 20) {
    const batch = prepared.slice(i, i + 20);
    try {
      const n = await processBatch(batch);
      count += n;
      console.log(`  ${count}/${prepared.length} links embedded`);
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      console.error(`  Batch ${i}-${i + batch.length} failed: ${err}`);
    }
  }

  console.log(`Seeded ${count} regulation links`);
  return count;
}

async function main() {
  console.log("=== Seeding hunt_knowledge ===");
  console.log(`Mode: ${VOYAGE_KEY ? "Direct Voyage API (batch 20)" : "Edge function (sequential)"}`);
  const factCount = await seedFacts();
  const linkCount = await seedRegLinks();
  console.log(`\nDone! Total: ${factCount} facts + ${linkCount} links = ${factCount + linkCount} entries`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
