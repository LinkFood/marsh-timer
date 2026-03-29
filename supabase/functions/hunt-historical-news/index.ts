import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// Search terms targeting historical wildlife/environmental content
const SEARCH_TERMS = [
  "duck migration",
  "goose flight",
  "deer season",
  "wild turkey",
  "waterfowl migration",
  "bird migration",
];

// Migration season months (October-February)
const SEASON_MONTHS = [10, 11, 12, 1, 2];

// State abbreviation lookup from Chronicling America state facet values
const STATE_MAP: Record<string, string> = {
  "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
  "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
  "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
  "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
  "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
  "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS",
  "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
  "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK",
  "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT",
  "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
  "Wisconsin": "WI", "Wyoming": "WY", "District of Columbia": "DC",
};

function extractStateAbbr(stateList: string[]): string | null {
  for (const s of stateList) {
    const abbr = STATE_MAP[s];
    if (abbr) return abbr;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    // Allow overriding the page offset via request body for resumability
    let startPage = 1;
    try {
      const body = await req.json();
      if (body?.startPage) startPage = body.startPage;
    } catch {
      // No body or invalid JSON — use defaults
    }

    const MAX_PAGES_PER_TERM = 3; // 3 pages x 20 results = 60 per term, 360 total max
    const RESULTS_PER_PAGE = 20;

    let totalEmbedded = 0;
    let totalSkipped = 0;
    let errors = 0;

    for (const term of SEARCH_TERMS) {
      console.log(`\nSearching: "${term}"`);
      const entries: { text: string; meta: Record<string, unknown> }[] = [];

      for (let page = startPage; page < startPage + MAX_PAGES_PER_TERM; page++) {
        try {
          const url = `https://chroniclingamerica.loc.gov/search/pages/results/?andtext=${encodeURIComponent(term)}&format=json&page=${page}&rows=${RESULTS_PER_PAGE}`;

          console.log(`  Page ${page}...`);
          const res = await fetch(url);

          if (!res.ok) {
            console.warn(`  HTTP ${res.status} for page ${page}`);
            if (res.status >= 500) {
              errors++;
            }
            // Don't retry 4xx
            continue;
          }

          const data = await res.json();
          const items = data.items || [];

          if (items.length === 0) {
            console.log(`  No more results for "${term}"`);
            break;
          }

          for (const item of items) {
            // Parse the date (format: YYYYMMDD)
            const dateStr = item.date || "";
            if (dateStr.length < 8) continue;

            const year = parseInt(dateStr.slice(0, 4));
            const month = parseInt(dateStr.slice(4, 6));
            const day = parseInt(dateStr.slice(6, 8));

            // Filter to migration season months
            if (!SEASON_MONTHS.includes(month)) {
              totalSkipped++;
              continue;
            }

            const isoDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
            const title = (item.title_normal || item.title || "").trim();
            const newspaper = title || "Unknown newspaper";
            const stateList: string[] = item.state || [];
            const stateAbbr = extractStateAbbr(stateList);
            const snippet = (item.ocr_eng || "").slice(0, 500).trim();

            if (!snippet) continue;

            // Build a clean content string for embedding
            const content = `historical-newspaper | ${isoDate} | ${stateAbbr || "US"} | ${newspaper} | search:"${term}" | ${snippet}`;

            // Unique title for upsert dedup
            const entryTitle = `hist-news ${isoDate} ${stateAbbr || "US"} ${newspaper.slice(0, 40)} ${term}`;

            entries.push({
              text: content,
              meta: {
                title: entryTitle,
                content,
                content_type: "historical-newspaper",
                tags: [stateAbbr || "US", "historical", "newspaper", term.replace(" ", "-")],
                state_abbr: stateAbbr,
                species: term.includes("duck") || term.includes("waterfowl") ? "duck"
                  : term.includes("goose") ? "goose"
                  : term.includes("deer") ? "deer"
                  : term.includes("turkey") ? "turkey"
                  : term.includes("bird") ? null
                  : null,
                effective_date: isoDate,
                metadata: {
                  source: "chronicling-america",
                  search_term: term,
                  newspaper,
                  year,
                  month,
                  day,
                  loc_url: item.url || null,
                  page_url: item.id ? `https://chroniclingamerica.loc.gov${item.id}` : null,
                },
              },
            });
          }

          // Rate limit: 1 req/sec — be gentle with Library of Congress
          await sleep(1100);

        } catch (err) {
          console.warn(`  Error on page ${page}: ${err}`);
          errors++;
        }
      }

      // Embed and insert in batches of 20
      for (let i = 0; i < entries.length; i += 20) {
        const chunk = entries.slice(i, i + 20);
        const texts = chunk.map(e => e.text);

        try {
          const embeddings = await batchEmbed(texts);

          const rows = chunk.map((e, j) => ({
            ...e.meta,
            embedding: JSON.stringify(embeddings[j]),
          }));

          const { error: upsertError } = await supabase
            .from("hunt_knowledge")
            .insert(rows);

          if (upsertError) {
            console.error(`  Upsert error: ${upsertError.message}`);
            errors++;
          } else {
            totalEmbedded += rows.length;
          }
        } catch (embedErr) {
          console.error(`  Embed/upsert error: ${embedErr}`);
          errors++;
        }
      }

      console.log(`  "${term}": ${entries.length} entries from season months`);

      // Extra delay between search terms
      await sleep(2000);
    }

    const durationMs = Date.now() - startTime;

    await logCronRun({
      functionName: "hunt-historical-news",
      status: errors > 0 ? "partial" : "success",
      summary: { embedded: totalEmbedded, skipped: totalSkipped, errors, terms: SEARCH_TERMS.length },
      durationMs,
    });

    return successResponse(req, {
      embedded: totalEmbedded,
      skipped: totalSkipped,
      errors,
      terms: SEARCH_TERMS.length,
      durationMs,
    });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);

    await logCronRun({
      functionName: "hunt-historical-news",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });

    return errorResponse(req, String(err), 500);
  }
});
