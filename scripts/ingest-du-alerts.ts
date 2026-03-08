/**
 * Ingest DU migration alerts into hunt_du_articles + hunt_knowledge
 * Paginates the DU content API, filters for migration alerts, fetches full article bodies,
 * embeds via Voyage AI, and stores in Supabase.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/ingest-du-alerts.ts
 *   START_OFFSET=100 SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/ingest-du-alerts.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;
const START_OFFSET = parseInt(process.env.START_OFFSET || "0", 10);

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) { console.error("VOYAGE_API_KEY required"); process.exit(1); }

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

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

const DU_API_BASE = "https://www.ducks.org/sites/ducksorg/contents/data/api.json";
const PAGE_SIZE = 50;
const RATE_LIMIT_MS = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      if (res.status >= 500 && attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`  Retry ${attempt + 1}/${retries} after ${wait / 1000}s (${res.status})...`);
        await sleep(wait);
        continue;
      }
      if (res.status === 429 && attempt < retries - 1) {
        const wait = (attempt + 1) * 30000;
        console.log(`  Rate limited, waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`  Network error, retrying in ${wait / 1000}s: ${err}`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

function extractArticleText(html: string): string {
  // Remove script/style tags and their content
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Try to extract from article body area — look for common content containers
  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || text.match(/class="[^"]*article[_-]?body[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || text.match(/class="[^"]*field-item[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || text.match(/class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

  const raw = articleMatch ? articleMatch[1] : text;

  // Strip remaining HTML tags
  let clean = raw.replace(/<[^>]+>/g, " ");
  // Collapse whitespace
  clean = clean.replace(/\s+/g, " ").trim();
  // Decode common HTML entities
  clean = clean
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  return clean;
}

async function batchEmbed(texts: string[], retries = 3): Promise<number[][]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
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
        console.log(`    Embed rate limited, waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`    Embed retry ${attempt + 1}/${retries} after ${wait / 1000}s (${res.status})...`);
        await sleep(wait);
        continue;
      }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        const wait = (attempt + 1) * 10000;
        console.log(`    Embed error, retrying in ${wait / 1000}s: ${err}`);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted embed retries");
}

interface DUArticle {
  uuid: string;
  title: string;
  articleDate: string;
  url: string;
  teaser: string;
  categories: { name: string }[];
  states: { name: string }[];
}

interface ProcessedArticle {
  uuid: string;
  title: string;
  article_date: string;
  url: string;
  teaser: string;
  states: string[];
  body: string;
  state_abbr: string | null;
  embed_text: string;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function fetchDUPage(offset: number): Promise<{ articles: DUArticle[]; remainingArticles: number }> {
  const url = `${DU_API_BASE}?limit=${PAGE_SIZE}&offset=${offset}`;
  const res = await fetchWithRetry(url);
  return res.json();
}

async function processArticle(article: DUArticle): Promise<ProcessedArticle | null> {
  const fullUrl = `https://www.ducks.org${article.url}`;
  let body = "";

  try {
    const res = await fetchWithRetry(fullUrl);
    const html = await res.text();
    body = extractArticleText(html);
  } catch (err) {
    console.warn(`  Failed to fetch body for ${article.uuid}: ${err}`);
    body = article.teaser || "";
  }

  const stateNames = article.states?.map((s) => s.name) || [];
  const firstAbbr = stateNames.length === 1 ? (STATE_ABBRS[stateNames[0]] || null) : null;
  const dateStr = article.articleDate || new Date().toISOString();

  const embedText = `du_alert | ${stateNames.join(", ")} | ${dateStr.split("T")[0]} | ${article.title} | ${article.teaser || ""}`;

  return {
    uuid: article.uuid,
    title: article.title,
    article_date: dateStr,
    url: fullUrl,
    teaser: article.teaser || "",
    states: stateNames,
    body,
    state_abbr: firstAbbr,
    embed_text: embedText,
  };
}

async function insertDUArticle(article: ProcessedArticle): Promise<boolean> {
  const row = {
    uuid: article.uuid,
    title: article.title,
    article_date: article.article_date,
    url: article.url,
    teaser: article.teaser,
    states: article.states,
    body: article.body,
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_du_articles`, {
    method: "POST",
    headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`  Failed to insert article ${article.uuid}: ${errText}`);
    return false;
  }
  return true;
}

async function insertKnowledgeRow(article: ProcessedArticle, embedding: number[]): Promise<boolean> {
  const content = article.body.length > 2000 ? article.body.substring(0, 2000) : article.body;

  const row = {
    title: article.title,
    content,
    content_type: "du_alert",
    tags: article.states,
    embedding: JSON.stringify(embedding),
    state_abbr: article.state_abbr,
    metadata: JSON.stringify({
      source: "du_migration_alerts",
      uuid: article.uuid,
      article_date: article.article_date,
    }),
  };

  const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
    method: "POST",
    headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`  Failed to insert knowledge for ${article.uuid}: ${errText}`);
    return false;
  }
  return true;
}

async function markEmbedded(uuid: string): Promise<void> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/hunt_du_articles?uuid=eq.${encodeURIComponent(uuid)}`,
    {
      method: "PATCH",
      headers: { ...supaHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ embedded_at: new Date().toISOString() }),
    },
  );
  if (!res.ok) {
    console.warn(`  Failed to mark embedded for ${uuid}`);
  }
}

async function main() {
  console.log("=== DU Migration Alerts Ingestion ===");
  console.log(`Starting from offset ${START_OFFSET}`);

  let offset = START_OFFSET;
  let totalProcessed = 0;
  let totalEmbedded = 0;
  let hasMore = true;

  while (hasMore) {
    console.log(`\nFetching page at offset=${offset}...`);
    const page = await fetchDUPage(offset);
    const articles = page.articles || [];
    const remaining = page.remainingArticles ?? 0;

    if (articles.length === 0) {
      console.log("No more articles.");
      break;
    }

    // Filter for migration alerts only
    const migrationAlerts = articles.filter((a: DUArticle) =>
      a.url && a.url.includes("migration-alerts")
    );

    console.log(`  ${articles.length} articles, ${migrationAlerts.length} migration alerts`);

    // Process migration alerts: fetch body, insert, collect for embedding
    const batch: ProcessedArticle[] = [];

    for (const article of migrationAlerts) {
      const processed = await processArticle(article);
      if (!processed) continue;

      const inserted = await insertDUArticle(processed);
      if (inserted) {
        batch.push(processed);
        totalProcessed++;
      }

      await sleep(RATE_LIMIT_MS);
    }

    // Embed in batches of 20
    for (let i = 0; i < batch.length; i += 20) {
      const embedBatch = batch.slice(i, i + 20);
      const texts = embedBatch.map((a) => a.embed_text);

      try {
        const embeddings = await batchEmbed(texts);

        for (let j = 0; j < embedBatch.length; j++) {
          const article = embedBatch[j];
          const ok = await insertKnowledgeRow(article, embeddings[j]);
          if (ok) {
            await markEmbedded(article.uuid);
            totalEmbedded++;
          }
        }

        console.log(`  Embedded ${embedBatch.length} articles (total: ${totalEmbedded})`);
      } catch (err) {
        console.error(`  Embedding batch failed: ${err}`);
      }

      await sleep(500);
    }

    hasMore = remaining > 0;
    offset += PAGE_SIZE;
  }

  console.log(`\nDone! Processed: ${totalProcessed}, Embedded: ${totalEmbedded}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
