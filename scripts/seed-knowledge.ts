/**
 * Seed hunt_knowledge with state facts + regulation links
 * Embeds each via hunt-generate-embedding edge function
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/seed-knowledge.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

async function fetchTable(table: string, select: string): Promise<any[]> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?select=${select}`,
    { headers },
  );
  if (!res.ok) throw new Error(`Failed to fetch ${table}: ${res.status}`);
  return res.json();
}

async function generateEmbedding(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, input_type: "document" }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.embedding;
    }
    if (res.status >= 500 && attempt < retries - 1) {
      const wait = (attempt + 1) * 5000;
      console.log(`    Retry ${attempt + 1}/${retries} after ${wait / 1000}s (${res.status})...`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const err = await res.text();
    throw new Error(`Embedding failed: ${res.status} ${err}`);
  }
  throw new Error("Embedding failed: exhausted retries");
}

async function upsertKnowledge(entry: {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  embedding: number[];
}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      title: entry.title,
      content: entry.content,
      content_type: entry.content_type,
      tags: entry.tags,
      embedding: JSON.stringify(entry.embedding),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`Upsert failed for "${entry.title}": ${err}`);
  }
}

async function seedFacts() {
  console.log("Fetching state facts...");
  const facts = await fetchTable("hunt_state_facts", "species_id,state_name,facts");
  console.log(`Found ${facts.length} fact entries`);

  let count = 0;
  for (const row of facts) {
    const factArray = row.facts as string[];
    for (const fact of factArray) {
      const title = `${row.species_id} fact: ${row.state_name}`;
      const richText = `${title} | ${row.species_id} | ${row.state_name} | ${fact}`;

      try {
        const embedding = await generateEmbedding(richText);
        await upsertKnowledge({
          title,
          content: fact,
          content_type: "fact",
          tags: [row.species_id, row.state_name.toLowerCase()],
          embedding,
        });
        count++;
        if (count % 20 === 0) {
          console.log(`  Embedded ${count} facts...`);
          await new Promise((r) => setTimeout(r, 1000));
        }
      } catch (err) {
        console.error(`  Error embedding fact for ${row.state_name}: ${err}`);
      }
    }
  }
  console.log(`Seeded ${count} facts`);
  return count;
}

async function seedRegLinks() {
  console.log("Fetching regulation links...");
  const links = await fetchTable(
    "hunt_regulation_links",
    "species_id,state_abbr,url",
  );
  console.log(`Found ${links.length} regulation links`);

  let count = 0;
  for (const row of links) {
    const title = `${row.species_id} regulations: ${row.state_abbr}`;
    const content = `Official ${row.species_id} hunting regulations for ${row.state_abbr}: ${row.url}`;
    const richText = `${title} | regulation link | ${row.species_id}, ${row.state_abbr} | ${content}`;

    try {
      const embedding = await generateEmbedding(richText);
      await upsertKnowledge({
        title,
        content,
        content_type: "regulation",
        tags: [row.species_id, row.state_abbr.toLowerCase(), "regulation"],
        embedding,
      });
      count++;
      if (count % 20 === 0) {
        console.log(`  Embedded ${count} links...`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (err) {
      console.error(`  Error embedding link for ${row.state_abbr}: ${err}`);
    }
  }
  console.log(`Seeded ${count} regulation links`);
  return count;
}

async function main() {
  console.log("=== Seeding hunt_knowledge ===");
  const factCount = await seedFacts();
  const linkCount = await seedRegLinks();
  console.log(`\nDone! Total: ${factCount} facts + ${linkCount} links = ${factCount + linkCount} entries`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
