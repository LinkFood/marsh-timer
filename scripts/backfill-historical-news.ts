/**
 * Backfill Chronicling America historical newspaper data into hunt_knowledge
 * 100+ years of digitized wildlife/hunting columns from US newspapers
 *
 * Uses LOC Collections API (chroniclingamerica.loc.gov redirects to Cloudflare challenge)
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-historical-news.ts
 *   START_PAGE=100 npx tsx scripts/backfill-historical-news.ts
 *   START_TERM=3 npx tsx scripts/backfill-historical-news.ts  (skip first N search terms)
 *
 * Uses hunt-generate-embedding edge function (no local Voyage key needed)
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }

const START_PAGE = parseInt(process.env.START_PAGE || "1");
const MAX_PAGES = parseInt(process.env.MAX_PAGES || "500");
const START_TERM = parseInt(process.env.START_TERM || "0");

const SEARCH_TERMS = [
  { term: "duck migration", species: "duck" },
  { term: "goose flight", species: "goose" },
  { term: "deer hunting season", species: "deer" },
  { term: "wild turkey hunting", species: "turkey" },
  { term: "waterfowl hunting", species: "duck" },
  { term: "bird migration flyway", species: null },
  { term: "duck season opening", species: "duck" },
  { term: "goose hunting season", species: "goose" },
  { term: "mourning dove season", species: "dove" },
  { term: "wildlife migration pattern", species: null },
];

// Keywords that indicate the article is actually about wildlife/hunting (not noise)
const RELEVANCE_KEYWORDS = [
  "duck", "goose", "geese", "waterfowl", "mallard", "teal", "pintail", "canvasback",
  "deer", "buck", "doe", "whitetail", "antler",
  "turkey", "gobbler", "tom",
  "dove", "mourning dove",
  "hunting", "hunter", "hunt", "season", "bag limit", "flyway",
  "migration", "migrating", "migratory", "flight", "flock",
  "wildlife", "game bird", "game warden", "sportsman", "sportsmen",
];

const STATE_ABBRS: Record<string, string> = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA",
  "colorado":"CO","connecticut":"CT","delaware":"DE","florida":"FL","georgia":"GA",
  "idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS",
  "kentucky":"KY","louisiana":"LA","maine":"ME","maryland":"MD","massachusetts":"MA",
  "michigan":"MI","minnesota":"MN","mississippi":"MS","missouri":"MO","montana":"MT",
  "nebraska":"NE","nevada":"NV","new hampshire":"NH","new jersey":"NJ",
  "new mexico":"NM","new york":"NY","north carolina":"NC","north dakota":"ND","ohio":"OH",
  "oklahoma":"OK","oregon":"OR","pennsylvania":"PA","rhode island":"RI",
  "south carolina":"SC","south dakota":"SD","tennessee":"TN","texas":"TX","utah":"UT",
  "vermont":"VT","virginia":"VA","washington":"WA","west virginia":"WV",
  "wisconsin":"WI","wyoming":"WY",
  "district of columbia":"DC",
};

function isRelevant(text: string): boolean {
  const lower = text.toLowerCase();
  let matches = 0;
  for (const kw of RELEVANCE_KEYWORDS) {
    if (lower.includes(kw)) matches++;
    if (matches >= 2) return true;
  }
  return false;
}

function extractState(locations: string[]): string | null {
  for (const loc of locations) {
    const lower = loc.toLowerCase().trim();
    if (STATE_ABBRS[lower]) return STATE_ABBRS[lower];
  }
  return null;
}

async function embed(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`Embedding ${res.status}: ${await res.text()}`);
    const data = await res.json();
    results.push(data.embedding);
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
  if (!res.ok) { console.error(`  Upsert error: ${res.status} ${await res.text()}`); return 0; }
  return rows.length;
}

async function fetchPage(query: string, page: number, attempt = 1): Promise<any> {
  const encoded = encodeURIComponent(query);
  const url = `https://www.loc.gov/collections/chronicling-america/?q=${encoded}&fo=json&c=20&sp=${page}`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 429) {
      if (attempt > 5) throw new Error("Rate limited 5 times in a row — giving up on this page");
      const wait = Math.min(60 * attempt, 300); // 60s, 120s, 180s, 240s, 300s
      console.log(`  Rate limited (attempt ${attempt}), waiting ${wait}s...`);
      await new Promise(r => setTimeout(r, wait * 1000));
      return fetchPage(query, page, attempt + 1);
    }
    throw new Error(`LOC API ${res.status}`);
  }

  const text = await res.text();
  if (text.includes("Just a moment") || text.includes("challenge-platform")) {
    throw new Error("Cloudflare challenge detected — API blocked");
  }

  return JSON.parse(text);
}

async function main() {
  let totalEmbedded = 0;
  let totalSkipped = 0;

  const terms = SEARCH_TERMS.slice(START_TERM);
  console.log(`Starting backfill. ${terms.length} search terms, pages ${START_PAGE}-${MAX_PAGES}, 20 results/page`);

  for (let ti = 0; ti < terms.length; ti++) {
    const search = terms[ti];
    console.log(`\n[${ti + 1 + START_TERM}/${SEARCH_TERMS.length}] Searching: "${search.term}"`);

    for (let page = START_PAGE; page <= MAX_PAGES; page++) {
      try {
        const data = await fetchPage(search.term, page);
        const results = data.results || [];
        if (results.length === 0) {
          console.log(`  Page ${page}: no more results`);
          break;
        }

        const entries: Array<{ text: string; meta: Record<string, any> }> = [];

        for (const item of results) {
          const title = (item.title || "").replace(/\s+/g, " ").trim();
          const date = item.date || "";
          const descriptions: string[] = Array.isArray(item.description) ? item.description : [];
          const snippet = descriptions.join(" ").slice(0, 500).replace(/\s+/g, " ").trim();
          const locations: string[] = Array.isArray(item.location) ? item.location : [];

          if (!snippet || snippet.length < 50) continue;

          // Filter: must be relevant to wildlife/hunting
          const combined = `${title} ${snippet}`;
          if (!isRelevant(combined)) {
            totalSkipped++;
            continue;
          }

          const stateAbbr = extractState(locations);

          // Date is already ISO format from this API (YYYY-MM-DD)
          const isoDate = date.match(/^\d{4}-\d{2}-\d{2}$/) ? date : null;

          const text = [
            `historical-newspaper | ${title}`,
            `date:${isoDate || date} | state:${stateAbbr || "unknown"}`,
            `search_term:${search.term}`,
            `excerpt: ${snippet}`,
          ].join(" | ");

          entries.push({
            text,
            meta: {
              title: `newspaper ${(title + " " + date).slice(0, 80)}`,
              content: text,
              content_type: "historical-newspaper",
              tags: ["historical", "newspaper", search.term.split(" ")[0], stateAbbr || "unknown"],
              species: search.species,
              state_abbr: stateAbbr,
              effective_date: isoDate || null,
              metadata: {
                source: "chronicling-america",
                newspaper_title: title,
                original_date: date,
                search_term: search.term,
                page_url: item.url || null,
              },
            },
          });
        }

        // Embed and upsert in chunks of 20
        for (let i = 0; i < entries.length; i += 20) {
          const chunk = entries.slice(i, i + 20);
          const n = await upsertBatch(chunk);
          totalEmbedded += n;
        }

        console.log(`  Page ${page}: ${entries.length} relevant / ${results.length} total, ${totalEmbedded} embedded (${totalSkipped} skipped)`);

        // Be gentle — 3s between pages to avoid LOC rate limits
        await new Promise(r => setTimeout(r, 3000));
      } catch (err: any) {
        if (err.message?.includes("Cloudflare")) {
          console.error(`  FATAL: ${err.message}`);
          console.log(`\nStopped at term ${ti + START_TERM} "${search.term}" page ${page}. Resume with START_TERM=${ti + START_TERM} START_PAGE=${page}`);
          console.log(`Total embedded: ${totalEmbedded}`);
          process.exit(1);
        }
        console.error(`  Page ${page}: ${err}`);
      }
    }
  }

  console.log(`\nDone. Total embedded: ${totalEmbedded}, skipped: ${totalSkipped}`);
}

main().catch(console.error);
