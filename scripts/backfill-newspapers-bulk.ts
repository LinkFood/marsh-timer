/**
 * Bulk Chronicling America Newspaper Backfill — DATE-BASED
 *
 * Instead of searching for specific terms, this iterates month-by-month
 * through the entire LOC Chronicling America archive (1836-1963) and
 * embeds EVERYTHING available. No relevance filter — for the time machine,
 * every newspaper page is valuable.
 *
 * Uses the LOC Collections API (not chroniclingamerica.loc.gov which
 * triggers Cloudflare challenges).
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-newspapers-bulk.ts
 *
 * Resume:
 *   START_YEAR=1900 START_MONTH=6 npx tsx scripts/backfill-newspapers-bulk.ts
 *
 * Estimated: 500K-2M entries over 2-3 days
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY!;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) { console.error("VOYAGE_API_KEY required"); process.exit(1); }

const START_YEAR = parseInt(process.env.START_YEAR || "1836");
const START_MONTH = parseInt(process.env.START_MONTH || "1");
const MAX_PAGES_PER_MONTH = parseInt(process.env.MAX_PAGES || "50");
const ITEMS_PER_PAGE = 20;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY,
  "Content-Type": "application/json",
};

// ---------- State extraction ----------

const STATE_ABBRS: Record<string, string> = {
  "alabama":"AL","alaska":"AK","arizona":"AZ","arkansas":"AR","california":"CA",
  "colorado":"CO","connecticut":"CT","delaware":"DE","florida":"FL","georgia":"GA",
  "hawaii":"HI","idaho":"ID","illinois":"IL","indiana":"IN","iowa":"IA","kansas":"KS",
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

function extractState(locations: string[]): string | null {
  for (const loc of locations) {
    const lower = loc.toLowerCase().trim();
    // Direct match
    if (STATE_ABBRS[lower]) return STATE_ABBRS[lower];
    // Check if state name appears in the location string
    for (const [name, abbr] of Object.entries(STATE_ABBRS)) {
      if (lower.includes(name)) return abbr;
    }
  }
  return null;
}

function extractStateFromTitle(title: string): string | null {
  const lower = title.toLowerCase();
  for (const [name, abbr] of Object.entries(STATE_ABBRS)) {
    if (lower.includes(name)) return abbr;
  }
  // Check for common city→state mappings
  const cityMap: Record<string, string> = {
    "new york": "NY", "chicago": "IL", "philadelphia": "PA", "boston": "MA",
    "san francisco": "CA", "los angeles": "CA", "st. louis": "MO",
    "new orleans": "LA", "baltimore": "MD", "detroit": "MI",
    "cleveland": "OH", "pittsburgh": "PA", "cincinnati": "OH",
    "milwaukee": "WI", "minneapolis": "MN", "seattle": "WA",
    "denver": "CO", "atlanta": "GA", "dallas": "TX", "houston": "TX",
    "memphis": "TN", "nashville": "TN", "richmond": "VA",
    "portland": "OR", "indianapolis": "IN", "kansas city": "MO",
    "omaha": "NE", "salt lake": "UT", "sacramento": "CA",
  };
  for (const [city, abbr] of Object.entries(cityMap)) {
    if (lower.includes(city)) return abbr;
  }
  return null;
}

// ---------- Helpers ----------

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function cleanText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "") // control chars
    .replace(/\s+/g, " ")
    .trim();
}

function formatDate(dateStr: string): string {
  // LOC dates are YYYY-MM-DD or YYYY
  if (!dateStr) return "";
  return dateStr.split("T")[0];
}

function humanDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: "UTC",
  });
}

function lastDayOfMonth(year: number, month: number): string {
  const d = new Date(year, month, 0);
  return d.toISOString().split("T")[0];
}

function monthLabel(year: number, month: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long" });
}

// ---------- LOC Collections API ----------

async function fetchLOC(
  dateStart: string,
  dateEnd: string,
  page: number,
  attempt = 1,
): Promise<{ results: any[]; total: number }> {
  // LOC Collections API with date filter, no search term
  const url =
    `https://www.loc.gov/collections/chronicling-america/` +
    `?dates=${dateStart}/${dateEnd}&fo=json&c=${ITEMS_PER_PAGE}&sp=${page}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.status === 429) {
      if (attempt > 5) throw new Error("Rate limited 5 times — skipping");
      const wait = Math.min(30 * attempt, 120);
      console.log(`  429 rate limited (attempt ${attempt}), waiting ${wait}s...`);
      await delay(wait * 1000);
      return fetchLOC(dateStart, dateEnd, page, attempt + 1);
    }

    if (res.status === 503) {
      // LOC goes down periodically — back off hard and retry
      if (attempt > 10) throw new Error("LOC 503 for 10 attempts — API may be down for maintenance");
      const wait = Math.min(60 * attempt, 600); // Up to 10 min backoff
      console.log(`  LOC 503 (attempt ${attempt}), API may be down — waiting ${wait}s...`);
      await delay(wait * 1000);
      return fetchLOC(dateStart, dateEnd, page, attempt + 1);
    }

    if (!res.ok) {
      throw new Error(`LOC API ${res.status}`);
    }

    const text = await res.text();

    // Check for Cloudflare challenge
    if (text.includes("Just a moment") || text.includes("challenge-platform")) {
      if (attempt > 3) throw new Error("Cloudflare challenge — API blocked");
      console.log(`  Cloudflare challenge (attempt ${attempt}), waiting 60s...`);
      await delay(60000);
      return fetchLOC(dateStart, dateEnd, page, attempt + 1);
    }

    const data = JSON.parse(text);
    const results = data.results || data.items || [];
    const total = data.pagination?.total || data.count || 0;
    return { results, total };
  } catch (err: any) {
    clearTimeout(timeout);
    if (err.name === "AbortError") {
      if (attempt > 3) throw new Error("Timeout after 3 attempts");
      console.log(`  Timeout (attempt ${attempt}), retrying...`);
      await delay(5000);
      return fetchLOC(dateStart, dateEnd, page, attempt + 1);
    }
    if (attempt > 3) throw err;
    console.log(`  Error (attempt ${attempt}): ${err.message}, retrying...`);
    await delay(5000 * attempt);
    return fetchLOC(dateStart, dateEnd, page, attempt + 1);
  }
}

// ---------- Voyage AI embedding ----------

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
        await delay((attempt + 1) * 30000);
        continue;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        await delay((attempt + 1) * 5000);
        continue;
      }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        await delay((attempt + 1) * 10000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// ---------- Supabase insert ----------

async function insertBatch(rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
          method: "POST",
          headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify(chunk),
        });
        if (res.ok) break;
        if (attempt < 2) {
          console.log(`  Insert retry ${attempt + 1}/3...`);
          await delay(5000);
          continue;
        }
        const text = await res.text();
        console.error(`  Insert failed after retries: ${text}`);
      } catch (err) {
        if (attempt < 2) { await delay(5000); continue; }
        console.error(`  Insert fetch failed: ${err}`);
      }
    }
  }
}

// ---------- Build narrative entry ----------

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  state_abbr: string | null;
  species: null;
  effective_date: string;
  metadata: Record<string, unknown>;
  embedText: string;
}

function buildEntry(item: any): PreparedEntry | null {
  const newspaperTitle = cleanText(item.title || "Unknown Newspaper");
  const date = formatDate(item.date || "");
  if (!date || date.length < 4) return null;

  const descriptions: string[] = Array.isArray(item.description) ? item.description : [];
  const snippet = cleanText(descriptions.join(" ")).slice(0, 800);
  if (!snippet || snippet.length < 30) return null;

  const locations: string[] = Array.isArray(item.location) ? item.location : [];
  const stateAbbr = extractState(locations) || extractStateFromTitle(newspaperTitle);

  const place = locations.length > 0 ? locations[0] : "";
  const humanDt = humanDate(date);

  // Build narrative
  let narrative: string;
  if (place) {
    narrative = `The ${newspaperTitle} of ${place}, published on ${humanDt}, reported: ${snippet}`;
  } else {
    narrative = `The ${newspaperTitle}, published on ${humanDt}, reported: ${snippet}`;
  }

  // Truncate to reasonable embed length
  if (narrative.length > 1000) narrative = narrative.slice(0, 1000);

  const decade = `${Math.floor(parseInt(date.slice(0, 4)) / 10) * 10}s`;

  const tags: string[] = ["newspaper", "historical", decade];
  if (stateAbbr) tags.push(stateAbbr);

  return {
    title: `${newspaperTitle} ${date}`,
    content: narrative,
    content_type: "newspaper-archive",
    tags,
    state_abbr: stateAbbr,
    species: null,
    effective_date: date,
    metadata: {
      source: "chronicling-america-loc",
      newspaper: newspaperTitle,
      date,
      place_of_publication: place,
      locations,
      url: item.url || item.id || null,
      decade,
    },
    embedText: narrative,
  };
}

// ---------- Process entries (embed + insert) ----------

async function processEntries(entries: PreparedEntry[]): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    const texts = batch.map(e => e.embedText);

    let embeddings: number[][];
    try {
      embeddings = await batchEmbed(texts);
    } catch (err) {
      console.error(`    Embed batch failed, skipping ${batch.length}: ${err}`);
      continue;
    }

    const rows = batch.map((e, idx) => ({
      title: e.title,
      content: e.content,
      content_type: e.content_type,
      tags: e.tags,
      state_abbr: e.state_abbr,
      species: e.species,
      effective_date: e.effective_date,
      metadata: e.metadata,
      embedding: JSON.stringify(embeddings[idx]),
    }));

    await insertBatch(rows);
    inserted += rows.length;
    await delay(300);
  }

  return inserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== Chronicling America BULK Newspaper Backfill ===");
  console.log(`Range: ${START_YEAR}-${START_MONTH.toString().padStart(2, "0")} to 1963-12`);
  console.log(`Max pages per month: ${MAX_PAGES_PER_MONTH}`);
  console.log(`Items per page: ${ITEMS_PER_PAGE}`);
  console.log(`API delay: 2s between requests`);
  console.log();

  let totalInserted = 0;
  let totalMonths = 0;
  let emptyMonths = 0;

  for (let year = START_YEAR; year <= 1963; year++) {
    const startMonth = (year === START_YEAR) ? START_MONTH : 1;

    console.log(`\n--- ${year} ---`);
    let yearInserted = 0;

    for (let month = startMonth; month <= 12; month++) {
      if (year === 1963 && month > 12) break;

      const dateStart = `${year}-${String(month).padStart(2, "0")}-01`;
      const dateEnd = lastDayOfMonth(year, month);
      const label = monthLabel(year, month);

      totalMonths++;
      let monthEntries: PreparedEntry[] = [];
      let monthTotal = 0;

      for (let page = 1; page <= MAX_PAGES_PER_MONTH; page++) {
        // Rate limit: 2s between LOC requests
        await delay(2000);

        let results: any[];
        let total: number;
        try {
          ({ results, total } = await fetchLOC(dateStart, dateEnd, page));
        } catch (err: any) {
          console.error(`  ${label} page ${page}: ${err.message}`);
          break; // Move to next month on persistent error
        }

        if (page === 1) monthTotal = total;

        if (results.length === 0) break;

        // Build entries from results
        for (const item of results) {
          const entry = buildEntry(item);
          if (entry) monthEntries.push(entry);
        }

        // If we have enough entries, embed a batch to keep memory down
        if (monthEntries.length >= 100) {
          const inserted = await processEntries(monthEntries);
          yearInserted += inserted;
          totalInserted += inserted;
          monthEntries = [];
        }
      }

      // Embed remaining entries for this month
      if (monthEntries.length > 0) {
        const inserted = await processEntries(monthEntries);
        yearInserted += inserted;
        totalInserted += inserted;
      }

      if (monthTotal === 0) {
        emptyMonths++;
      } else {
        console.log(`  ${label}: ${monthTotal} available, ${yearInserted > 0 ? yearInserted : 0} embedded (running total: ${totalInserted.toLocaleString()})`);
      }
    }

    console.log(`  ${year} total: ${yearInserted.toLocaleString()} entries`);
  }

  console.log(`\n=== Done! ===`);
  console.log(`Total: ${totalInserted.toLocaleString()} entries inserted`);
  console.log(`Months processed: ${totalMonths} (${emptyMonths} empty)`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
