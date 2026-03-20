/**
 * Backfill Chronicling America historical newspaper data into hunt_knowledge
 * 100+ years of digitized wildlife/hunting columns from US newspapers
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-historical-news.ts
 *   START_PAGE=100 npx tsx scripts/backfill-historical-news.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY!;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) { console.error("VOYAGE_API_KEY required"); process.exit(1); }

const START_PAGE = parseInt(process.env.START_PAGE || "1");
const MAX_PAGES = parseInt(process.env.MAX_PAGES || "500");

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

const STATE_ABBRS: Record<string, string> = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
  "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
  "Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS",
  "Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA",
  "Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT",
  "Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ",
  "New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH",
  "Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI",
  "South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT",
  "Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV",
  "Wisconsin":"WI","Wyoming":"WY",
  "District of Columbia":"DC",
};

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

async function main() {
  let totalEmbedded = 0;

  for (const search of SEARCH_TERMS) {
    console.log(`\nSearching: "${search.term}"`);

    for (let page = START_PAGE; page <= MAX_PAGES; page++) {
      try {
        const encoded = encodeURIComponent(search.term);
        const url = `https://chroniclingamerica.loc.gov/search/pages/results/?andtext=${encoded}&format=json&page=${page}`;

        const res = await fetch(url);
        if (!res.ok) {
          if (res.status === 429) {
            console.log("  Rate limited, waiting 30s...");
            await new Promise(r => setTimeout(r, 30000));
            continue;
          }
          break; // No more pages
        }

        const data = await res.json();
        const items = data.items || [];
        if (items.length === 0) break;

        const entries: Array<{ text: string; meta: Record<string, any> }> = [];

        for (const item of items) {
          const title = item.title || "";
          const date = item.date || "";
          const snippet = (item.ocr_eng || "").slice(0, 500).replace(/\n+/g, " ").trim();
          if (!snippet || snippet.length < 50) continue;

          // Extract state
          const stateNames = Object.keys(STATE_ABBRS);
          let stateAbbr: string | null = null;
          for (const sn of stateNames) {
            if (title.includes(sn) || (item.state || []).includes(sn)) {
              stateAbbr = STATE_ABBRS[sn];
              break;
            }
          }

          // Parse date (format: YYYYMMDD)
          let isoDate = "";
          if (date.length === 8) {
            isoDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
          }

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

        // Embed and upsert
        for (let i = 0; i < entries.length; i += 20) {
          const chunk = entries.slice(i, i + 20);
          const n = await upsertBatch(chunk);
          totalEmbedded += n;
        }

        console.log(`  Page ${page}: ${entries.length} articles, ${totalEmbedded} total embedded`);

        // Be gentle with Library of Congress
        await new Promise(r => setTimeout(r, 1500));
      } catch (err) {
        console.error(`  Page ${page}: ${err}`);
      }
    }
  }

  console.log(`\nDone. Total embedded: ${totalEmbedded}`);
}

main().catch(console.error);
