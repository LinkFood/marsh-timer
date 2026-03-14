/**
 * Backfill species + effective_date on existing hunt_knowledge rows
 * Processes ~65K rows in batches of 5000
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-knowledge-columns.ts
 */

const SUPABASE_URL = "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

const BATCH_SIZE = 5000;

const SPECIES_KEYWORDS = ["duck", "goose", "deer", "turkey", "dove"] as const;

interface KnowledgeRow {
  id: string;
  content_type: string;
  title: string | null;
  content: string | null;
  tags: string[] | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

function assignSpecies(row: KnowledgeRow): string | null {
  const ct = row.content_type;

  // DU reports and alerts
  if (ct === "du_report" || ct === "du_alert") return "duck";

  // Migration and birdcast content
  if (ct.startsWith("migration-") || ct.startsWith("birdcast-")) return "duck";

  // Hunt logs — use metadata species
  if (ct === "hunt_log") {
    const metaSpecies = row.metadata?.species;
    if (metaSpecies && typeof metaSpecies === "string") return metaSpecies;
    return null;
  }

  // Facts and regulations — check tags
  if (ct === "fact" || ct === "regulation") {
    if (Array.isArray(row.tags)) {
      for (const kw of SPECIES_KEYWORDS) {
        if (row.tags.some((t) => t.toLowerCase() === kw)) return kw;
      }
    }
    return null;
  }

  // Weather — null (affects all species)
  if (
    ct === "weather-event" || ct === "weather-daily" ||
    ct === "weather-pattern" || ct === "weather-insight"
  ) return null;

  // Other null types
  if (
    ct === "nws-alert" || ct === "nasa-daily" ||
    ct === "convergence-score" || ct === "solunar-weekly"
  ) return null;

  // Fallback: scan title + content for species keywords
  const text = `${row.title ?? ""} ${row.content ?? ""}`.toLowerCase();
  for (const kw of SPECIES_KEYWORDS) {
    if (text.includes(kw)) return kw;
  }

  return null;
}

function assignEffectiveDate(row: KnowledgeRow): string {
  const meta = row.metadata;

  if (meta) {
    // Try date fields in priority order
    for (const field of ["date", "submit_date", "article_date", "onset"]) {
      const val = meta[field];
      if (val && typeof val === "string") {
        const parsed = new Date(val);
        if (!isNaN(parsed.getTime())) {
          return parsed.toISOString().split("T")[0];
        }
      }
    }
  }

  // Fallback: created_at as date
  return row.created_at.split("T")[0];
}

async function fetchBatch(): Promise<KnowledgeRow[]> {
  const url = `${SUPABASE_URL}/rest/v1/hunt_knowledge?select=id,content_type,title,content,tags,metadata,created_at&species=is.null&effective_date=is.null&order=created_at.asc&limit=${BATCH_SIZE}`;
  const res = await fetch(url, { headers: supaHeaders });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function updateRow(id: string, species: string | null, effectiveDate: string): Promise<boolean> {
  const body: Record<string, any> = { effective_date: effectiveDate };
  if (species !== null) {
    body.species = species;
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/hunt_knowledge?id=eq.${id}`,
    {
      method: "PATCH",
      headers: { ...supaHeaders, Prefer: "return=minimal" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    console.error(`  Failed to update ${id}: ${res.status}`);
    return false;
  }
  return true;
}

async function main() {
  console.log("=== Backfill hunt_knowledge: species + effective_date ===");

  let totalUpdated = 0;
  let batchNum = 0;

  while (true) {
    batchNum++;
    const rows = await fetchBatch();

    if (rows.length === 0) {
      console.log("No more rows to process.");
      break;
    }

    let batchUpdated = 0;

    // Process in chunks of 50 concurrent updates to avoid hammering the API
    const CONCURRENCY = 50;
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const chunk = rows.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map((row) => {
          const species = assignSpecies(row);
          const effectiveDate = assignEffectiveDate(row);
          return updateRow(row.id, species, effectiveDate);
        }),
      );
      batchUpdated += results.filter(Boolean).length;
    }

    totalUpdated += batchUpdated;
    console.log(`Batch ${batchNum}: updated ${batchUpdated} rows (${totalUpdated} total)`);
  }

  console.log(`\nDone! Updated ${totalUpdated} rows total.`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
