/**
 * Backfill Chronicling America — Expanded Environmental/Disaster Topics
 *
 * Searches LOC's Chronicling America for historical newspaper coverage of
 * floods, hurricanes, tornadoes, earthquakes, droughts, blizzards, heat waves,
 * wildfires, dust storms, tsunamis, and crop failures (1850-1963).
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-chronicling-america-expanded.ts
 *
 * Resume:
 *   START_TERM=3 START_DECADE=1900 START_PAGE=5 npx tsx scripts/backfill-chronicling-america-expanded.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY!;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) { console.error("VOYAGE_API_KEY required"); process.exit(1); }

const START_TERM = parseInt(process.env.START_TERM || "0");
const START_DECADE_STR = process.env.START_DECADE || "";
const START_PAGE = parseInt(process.env.START_PAGE || "1");
const MAX_PAGES_PER_DECADE = 20;

// ---------------------------------------------------------------------------
// Search terms
// ---------------------------------------------------------------------------

const SEARCH_TERMS = [
  { term: "great flood", category: "flood" },
  { term: "hurricane damage", category: "hurricane" },
  { term: "tornado destroyed", category: "tornado" },
  { term: "earthquake damage", category: "earthquake" },
  { term: "severe drought", category: "drought" },
  { term: "blizzard snow", category: "blizzard" },
  { term: "heat wave deaths", category: "heat" },
  { term: "forest fire wildfire", category: "wildfire" },
  { term: "dust storm", category: "dust-storm" },
  { term: "river flood overflow", category: "flood" },
  { term: "tidal wave tsunami", category: "tsunami" },
  { term: "crop failure famine", category: "agriculture" },
];

// ---------------------------------------------------------------------------
// Decade ranges
// ---------------------------------------------------------------------------

const DECADES: Array<{ start: number; end: number; label: string }> = [];
for (let y = 1850; y <= 1960; y += 10) {
  const end = y === 1960 ? 1963 : y + 9;
  DECADES.push({ start: y, end, label: `${y}s` });
}

// ---------------------------------------------------------------------------
// Relevance filter
// ---------------------------------------------------------------------------

const RELEVANCE_KEYWORDS = [
  "flood", "flooded", "flooding", "overflow", "levee", "dam",
  "tornado", "twister", "cyclone", "funnel",
  "hurricane", "tropical storm", "gale",
  "earthquake", "tremor", "quake", "seismic",
  "drought", "dry spell", "parched", "water shortage",
  "blizzard", "snowstorm", "freezing", "ice storm",
  "heat wave", "record heat", "scorching",
  "wildfire", "forest fire", "brush fire", "burned acres",
  "dust storm", "dust bowl", "sandstorm",
  "tidal wave", "tsunami", "storm surge",
  "crop failure", "famine", "harvest lost",
  "destroyed", "damage", "devastation", "killed", "deaths",
  "disaster", "catastrophe", "emergency",
];

function isRelevant(text: string): boolean {
  const lower = text.toLowerCase();
  let matches = 0;
  for (const kw of RELEVANCE_KEYWORDS) {
    if (lower.includes(kw)) matches++;
    if (matches >= 2) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// State extraction
// ---------------------------------------------------------------------------

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
};

function extractStateFromPublication(place: string | null | undefined): string | null {
  if (!place) return null;
  const lower = place.toLowerCase();
  // Try longest state names first (e.g., "west virginia" before "virginia")
  const sorted = Object.keys(STATE_ABBRS).sort((a, b) => b.length - a.length);
  for (const state of sorted) {
    if (lower.includes(state)) return STATE_ABBRS[state];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

function cleanOcr(raw: string): string {
  return raw
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "") // control chars
    .replace(/\s+/g, " ")                                 // collapse whitespace
    .trim();
}

// ---------------------------------------------------------------------------
// Delay helper
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Voyage AI embedding (batches of 20)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Supabase upsert
// ---------------------------------------------------------------------------

async function upsertBatch(entries: Array<{ text: string; meta: Record<string, any> }>): Promise<number> {
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

// ---------------------------------------------------------------------------
// LOC Chronicling America fetch
// ---------------------------------------------------------------------------

async function fetchLocPage(
  term: string, year1: number, year2: number, page: number, attempt = 1
): Promise<any> {
  const encoded = encodeURIComponent(term);
  const url =
    `https://chroniclingamerica.loc.gov/search/pages/results/` +
    `?andtext=${encoded}&format=json&page=${page}` +
    `&dateFilterType=yearRange&date1=${year1}&date2=${year2}`;

  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 429) {
      if (attempt > 5) throw new Error("Rate limited 5x in a row — skipping");
      const wait = 30 * attempt;
      console.log(`  429 rate limited (attempt ${attempt}), backing off ${wait}s...`);
      await delay(wait * 1000);
      return fetchLocPage(term, year1, year2, page, attempt + 1);
    }
    if (res.status >= 500) {
      if (attempt > 3) throw new Error(`LOC 5xx after 3 retries: ${res.status}`);
      console.log(`  ${res.status} server error (attempt ${attempt}), retrying in 10s...`);
      await delay(10_000);
      return fetchLocPage(term, year1, year2, page, attempt + 1);
    }
    // 4xx (not 429) — never retry
    throw new Error(`LOC API ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Narrative builder
// ---------------------------------------------------------------------------

function buildNarrative(
  item: any, category: string, stateAbbr: string | null
): { narrative: string; excerpt: string | null } {
  const newspaper = item.title || "an unknown newspaper";
  const place = item.place_of_publication || "an unknown location";
  const date = item.date || "an unknown date";

  let narrative =
    `A newspaper article published in ${newspaper} of ${place} on ${date} ` +
    `reported on ${category} conditions.`;

  // If there's OCR text, extract a relevant excerpt
  let excerpt: string | null = null;
  if (item.ocr_eng) {
    const cleaned = cleanOcr(item.ocr_eng);
    if (cleaned.length > 30) {
      excerpt = cleaned.slice(0, 200);
      if (cleaned.length > 200) excerpt += "...";
    }
  }

  if (excerpt) {
    narrative += ` ...excerpt from the article: '${excerpt}'`;
  }

  return { narrative, excerpt };
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  // LOC dates come as "YYYYMMDD" or "YYYY-MM-DD" or other formats
  const m1 = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m1) return `${m1[1]}-${m1[2]}-${m1[3]}`;
  const m2 = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m2) return m2[1];
  const m3 = raw.match(/^(\d{4})/);
  if (m3) return `${m3[1]}-01-01`;
  return null;
}

// ---------------------------------------------------------------------------
// Decade label for tags
// ---------------------------------------------------------------------------

function decadeTag(year: number): string {
  const d = Math.floor(year / 10) * 10;
  return `${d}s`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let totalInserted = 0;
  let totalSkipped = 0;

  const startDecade = START_DECADE_STR ? parseInt(START_DECADE_STR) : null;

  console.log("=== Chronicling America Expanded Backfill ===");
  console.log(`Terms: ${SEARCH_TERMS.length} | Decades: 1850-1963\n`);

  for (let ti = START_TERM; ti < SEARCH_TERMS.length; ti++) {
    const search = SEARCH_TERMS[ti];
    console.log(`[${ti + 1}/${SEARCH_TERMS.length}] Searching: "${search.term}"`);

    for (let di = 0; di < DECADES.length; di++) {
      const decade = DECADES[di];

      // Resume support: skip decades before START_DECADE for the START_TERM
      if (ti === START_TERM && startDecade && decade.start < startDecade) continue;

      const firstPage = (ti === START_TERM && decade.start === startDecade) ? START_PAGE : 1;
      let decadeRelevant = 0;
      let decadeEmbedded = 0;

      for (let page = firstPage; page <= MAX_PAGES_PER_DECADE; page++) {
        try {
          const data = await fetchLocPage(search.term, decade.start, decade.end, page);
          const items = Array.isArray(data.items) ? data.items : [];

          if (items.length === 0) break; // no more results for this decade

          const entries: Array<{ text: string; meta: Record<string, any> }> = [];

          for (const item of items) {
            const ocrRaw = item.ocr_eng || "";
            const title = (item.title || "").replace(/\s+/g, " ").trim();
            const combinedText = `${title} ${cleanOcr(ocrRaw)}`;

            if (!isRelevant(combinedText)) {
              totalSkipped++;
              continue;
            }

            const stateAbbr = extractStateFromPublication(item.place_of_publication);
            const isoDate = parseDate(item.date);
            const { narrative } = buildNarrative(item, search.category, stateAbbr);

            const yearNum = isoDate ? parseInt(isoDate.slice(0, 4)) : decade.start;
            const dTag = decadeTag(yearNum);

            const tags = [
              search.category,
              "newspaper",
              "historical",
              dTag,
            ];
            if (stateAbbr) tags.unshift(stateAbbr);

            const entryTitle = `Newspaper: ${search.category} ${stateAbbr || "US"} ${isoDate || decade.label}`;

            const embeddingText = [
              `historical-newspaper | ${entryTitle}`,
              `date:${isoDate || decade.label} | state:${stateAbbr || "unknown"} | category:${search.category}`,
              narrative,
            ].join(" | ");

            entries.push({
              text: embeddingText,
              meta: {
                title: entryTitle.slice(0, 120),
                content: narrative,
                content_type: "historical-newspaper",
                tags,
                species: null,
                state_abbr: stateAbbr,
                effective_date: isoDate,
                metadata: {
                  source: "chronicling-america-loc",
                  newspaper_title: title,
                  date: item.date || null,
                  place_of_publication: item.place_of_publication || null,
                  url: item.url || null,
                  category: search.category,
                  decade: decade.label,
                },
              },
            });
          }

          decadeRelevant += entries.length;

          // Embed and upsert in chunks of 20
          for (let i = 0; i < entries.length; i += 20) {
            const chunk = entries.slice(i, i + 20);
            const n = await upsertBatch(chunk);
            decadeEmbedded += n;
            totalInserted += n;
          }

          // 2 second minimum between LOC requests
          await delay(2000);
        } catch (err: any) {
          console.error(`  ${decade.label} page ${page}: ${err.message || err}`);
          // Log resume point and continue to next decade
          console.log(`  Resume: START_TERM=${ti} START_DECADE=${decade.start} START_PAGE=${page}`);
          break;
        }
      }

      if (decadeRelevant > 0) {
        console.log(`  ${decade.label}: ${decadeRelevant} relevant articles -> ${decadeEmbedded} embedded`);
      }
    }
  }

  console.log(`\n=== Done! Total: ${totalInserted} entries inserted (${totalSkipped} skipped) ===`);
}

main().catch(console.error);
