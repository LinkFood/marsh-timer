import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors, getCorsHeaders } from '../_shared/cors.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// ---------------------------------------------------------------------------
// Google Trends Search Interest Ingest
// ---------------------------------------------------------------------------
// Google has no free public API for custom keyword interest-over-time.
// The only free, unauthenticated, server-safe endpoint is the RSS feed:
//   https://trends.google.com/trending/rss?geo=US
//   https://trends.google.com/trending/rss?geo=US-TX
//
// This returns the top ~20 daily trending searches per region.
// We fetch national + top hunting state feeds, then filter for terms
// related to hunting, wildlife, migration, and outdoor activity.
//
// When people search "duck hunting", "deer season", "cold front hunting",
// etc., it's a crowdsourced leading indicator of animal movement.
// ---------------------------------------------------------------------------

const HUNTING_KEYWORDS = [
  "duck hunting", "duck season", "goose hunting", "goose season",
  "deer hunting", "deer season", "turkey hunting", "turkey season",
  "dove hunting", "dove season", "waterfowl", "migration",
  "hunting season", "duck blind", "decoy", "wader", "shotgun season",
  "archery season", "muzzleloader", "bag limit", "flyway",
  "duck call", "goose call", "bird hunting", "upland",
  "cold front hunting", "duck hunting forecast",
  "teal season", "snow goose", "light goose", "pintail",
  "mallard", "wood duck", "canvasback", "redhead duck",
  "whitetail", "white-tailed deer", "mule deer", "elk hunting",
  "wildlife", "game warden", "dnr", "fish and game",
  "hunting license", "hunting permit", "public land hunting",
  "duck stamp", "federal duck stamp",
  "bird migration", "bird watching", "birding",
  "hunting forecast", "hunting weather", "hunting report",
];

// Top hunting states — keeps request count manageable (~15 states + national)
const HUNTING_STATES: Record<string, string> = {
  AR: "Arkansas", LA: "Louisiana", MS: "Mississippi", TX: "Texas",
  MO: "Missouri", TN: "Tennessee", AL: "Alabama", GA: "Georgia",
  SC: "South Carolina", NC: "North Carolina", IL: "Illinois",
  MN: "Minnesota", WI: "Wisconsin", MI: "Michigan", ND: "North Dakota",
  SD: "South Dakota", KS: "Kansas", OK: "Oklahoma", MD: "Maryland",
  CA: "California",
};

interface TrendItem {
  title: string;
  approxTraffic: string;
  pubDate: string;
  newsTitle: string;
  newsSource: string;
}

/**
 * Parse Google Trends RSS XML into structured items.
 * Uses string parsing — no XML library needed for this simple structure.
 */
function parseRSS(xml: string): TrendItem[] {
  const items: TrendItem[] = [];
  const itemBlocks = xml.split("<item>");

  for (let i = 1; i < itemBlocks.length; i++) {
    const block = itemBlocks[i];
    const title = extractTag(block, "title") || "";
    const approxTraffic = extractTag(block, "ht:approx_traffic") || "0";
    const pubDate = extractTag(block, "pubDate") || "";
    const newsTitle = extractTag(block, "ht:news_item_title") || "";
    const newsSource = extractTag(block, "ht:news_item_source") || "";

    items.push({ title, approxTraffic, pubDate, newsTitle, newsSource });
  }

  return items;
}

function extractTag(xml: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  if (start === -1) return null;
  const end = xml.indexOf(close, start);
  if (end === -1) return null;
  // Decode XML entities
  return xml.slice(start + open.length, end)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"');
}

/**
 * Check if a trending search title matches any hunting-related keyword.
 * Returns matched keywords for tagging.
 */
function matchesHunting(title: string): string[] {
  const lower = title.toLowerCase();
  const matches: string[] = [];
  for (const kw of HUNTING_KEYWORDS) {
    if (lower.includes(kw)) {
      matches.push(kw);
    }
  }
  // Also check if the news headline contains hunting terms
  return matches;
}

function parseTraffic(traffic: string): number {
  const cleaned = traffic.replace(/[^0-9]/g, "");
  return parseInt(cleaned, 10) || 0;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const today = new Date().toISOString().slice(0, 10);

  try {
    const supabase = createSupabaseClient();
    const entries: { text: string; meta: Record<string, unknown> }[] = [];
    let fetchErrors = 0;

    // Build list of feeds to fetch: national + hunting states
    const feeds: { geo: string; abbr: string | null; name: string }[] = [
      { geo: "US", abbr: null, name: "National" },
    ];
    for (const [abbr, name] of Object.entries(HUNTING_STATES)) {
      feeds.push({ geo: `US-${abbr}`, abbr, name });
    }

    console.log(`Fetching ${feeds.length} Google Trends RSS feeds for ${today}`);

    // Track seen titles to avoid duplicates across feeds
    const seen = new Set<string>();

    for (const feed of feeds) {
      try {
        const url = `https://trends.google.com/trending/rss?geo=${feed.geo}`;
        const res = await fetch(url, {
          headers: { "User-Agent": "DuckCountdown/1.0 (duckcountdown.com)" },
        });

        if (!res.ok) {
          console.warn(`  ${feed.name} (${feed.geo}): HTTP ${res.status}`);
          fetchErrors++;
          continue;
        }

        const xml = await res.text();
        const items = parseRSS(xml);

        for (const item of items) {
          // Check title AND news headline for hunting relevance
          const titleMatches = matchesHunting(item.title);
          const newsMatches = matchesHunting(item.newsTitle);
          const allMatches = [...new Set([...titleMatches, ...newsMatches])];

          if (allMatches.length === 0) continue;

          // Deduplicate by title+geo
          const dedupeKey = `${item.title.toLowerCase()}|${feed.geo}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          const traffic = parseTraffic(item.approxTraffic);
          const region = feed.abbr || "US";

          const text = [
            `search-trends | ${region} | ${today}`,
            `trending: "${item.title}" | traffic: ${item.approxTraffic}`,
            `matched: ${allMatches.join(", ")}`,
            item.newsTitle ? `headline: ${item.newsTitle}` : null,
            item.newsSource ? `source: ${item.newsSource}` : null,
          ].filter(Boolean).join(" | ");

          entries.push({
            text,
            meta: {
              title: `search-trends ${region} ${item.title} ${today}`,
              content: text,
              content_type: "search-trends",
              tags: [region, "search-trends", "google-trends", ...allMatches],
              state_abbr: feed.abbr || null,
              species: inferSpecies(allMatches),
              effective_date: today,
              metadata: {
                source: "google-trends-rss",
                trending_query: item.title,
                approx_traffic: item.approxTraffic,
                traffic_numeric: traffic,
                matched_keywords: allMatches,
                news_title: item.newsTitle || null,
                news_source: item.newsSource || null,
                geo: feed.geo,
                region_name: feed.name,
              },
            },
          });
        }

        // Rate limit: 500ms between feeds to avoid hammering Google
        await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        console.warn(`  ${feed.name}: ${err}`);
        fetchErrors++;
      }
    }

    console.log(`Found ${entries.length} hunting-related trending searches`);

    // Embed and insert in batches of 20
    let totalEmbedded = 0;
    let embedErrors = 0;

    for (let i = 0; i < entries.length; i += 20) {
      try {
        const chunk = entries.slice(i, i + 20);
        const texts = chunk.map(e => e.text);
        const embeddings = await batchEmbed(texts);

        const rows = chunk.map((e, j) => ({
          ...e.meta,
          embedding: JSON.stringify(embeddings[j]),
        }));

        const { error: upsertError } = await supabase
          .from("hunt_knowledge")
          .upsert(rows, { onConflict: "title" });

        if (upsertError) {
          console.error(`  Upsert error: ${upsertError.message}`);
          embedErrors++;
        } else {
          totalEmbedded += rows.length;
        }
      } catch (err) {
        console.error(`  Embed/upsert error: ${err}`);
        embedErrors++;
      }
    }

    const durationMs = Date.now() - startTime;
    const totalErrors = fetchErrors + embedErrors;

    await logCronRun({
      functionName: "hunt-search-trends",
      status: totalErrors > 0 ? (totalEmbedded > 0 ? "partial" : "error") : "success",
      summary: {
        date: today,
        feeds_fetched: feeds.length,
        fetch_errors: fetchErrors,
        hunting_matches: entries.length,
        embedded: totalEmbedded,
        embed_errors: embedErrors,
      },
      durationMs,
      ...(totalErrors > 0 && totalEmbedded === 0
        ? { errorMessage: `${fetchErrors} fetch errors, ${embedErrors} embed errors` }
        : {}),
    });

    const result = {
      date: today,
      feeds_fetched: feeds.length,
      fetch_errors: fetchErrors,
      hunting_matches: entries.length,
      embedded: totalEmbedded,
      embed_errors: embedErrors,
      durationMs,
      note: entries.length === 0
        ? "No hunting-related terms trending today. This is expected — hunting terms spike seasonally (Sep-Jan for waterfowl, Oct-Dec for deer). The function is working correctly."
        : undefined,
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });

  } catch (err) {
    const durationMs = Date.now() - startTime;
    console.error("Fatal:", err);
    await logCronRun({
      functionName: "hunt-search-trends",
      status: "error",
      errorMessage: String(err),
      durationMs,
    });
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
    });
  }
});

/**
 * Infer species from matched keywords.
 * Returns the most specific species, or null if generic.
 */
function inferSpecies(matches: string[]): string | null {
  const joined = matches.join(" ");
  if (/duck|teal|pintail|mallard|wood duck|canvasback|redhead duck|duck blind|duck call|duck stamp|federal duck stamp|waterfowl|decoy/.test(joined)) return "duck";
  if (/goose|snow goose|light goose|goose call/.test(joined)) return "goose";
  if (/deer|whitetail|white-tailed deer|mule deer|archery season|muzzleloader/.test(joined)) return "deer";
  if (/turkey/.test(joined)) return "turkey";
  if (/dove/.test(joined)) return "dove";
  if (/elk/.test(joined)) return "deer"; // close enough for search context
  return null;
}
