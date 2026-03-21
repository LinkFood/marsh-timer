/**
 * Retrospective bio-environmental correlator
 * Iterates bird entries in hunt_knowledge and finds environmental events
 * that occurred within 72 hours in the same state. Builds correlation
 * entries, embeds via Voyage AI, and upserts to hunt_knowledge.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/correlate-bio-environmental.ts
 *   START_OFFSET=500 npx tsx scripts/correlate-bio-environmental.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY!;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) { console.error("VOYAGE_API_KEY required"); process.exit(1); }

const START_OFFSET = parseInt(process.env.START_OFFSET || "0", 10);
const BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Content type filters
// ---------------------------------------------------------------------------

const BIRD_TYPES = [
  "birdweather-daily", "birdweather-acoustic", "birdcast-daily",
  "migration-spike-extreme", "migration-spike-significant", "migration-spike-moderate",
];

const ENV_TYPES = [
  "weather-event", "weather-realtime", "nws-alert", "usgs-water",
  "drought-weekly", "fire-activity", "storm-event", "earthquake-event", "climate-index",
];

// ---------------------------------------------------------------------------
// Voyage AI batch embedding (direct, 20 at a time)
// ---------------------------------------------------------------------------

async function embedBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += 20) {
    const chunk = texts.slice(i, i + 20);
    const res = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${VOYAGE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "voyage-3-lite",
        input: chunk,
        input_type: "document",
      }),
    });
    if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const item of data.data) results.push(item.embedding);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Upsert batch into hunt_knowledge via REST API
// ---------------------------------------------------------------------------

async function upsertBatch(
  entries: Array<{ text: string; meta: Record<string, any> }>
): Promise<number> {
  if (entries.length === 0) return 0;

  const texts = entries.map((e) => e.text);
  const embeddings = await embedBatch(texts);
  const rows = entries.map((e, i) => ({
    ...e.meta,
    embedding: JSON.stringify(embeddings[i]),
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      console.error(`  Upsert error: ${res.status} ${await res.text()}`);
    } else {
      upserted += chunk.length;
    }
  }
  return upserted;
}

// ---------------------------------------------------------------------------
// Fetch bird entries via REST API
// ---------------------------------------------------------------------------

async function fetchBirdBatch(offset: number): Promise<any[] | null> {
  const typeFilter = BIRD_TYPES.map((t) => `content_type.eq.${t}`).join(",");
  const url = `${SUPABASE_URL}/rest/v1/hunt_knowledge?select=id,title,content,content_type,state_abbr,effective_date,metadata&or=(${typeFilter})&state_abbr=not.is.null&effective_date=not.is.null&order=created_at.asc&offset=${offset}&limit=${BATCH_SIZE}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
  });
  if (!res.ok) {
    console.error(`  Bird fetch error: ${res.status} ${await res.text()}`);
    return null;
  }
  return await res.json();
}

// ---------------------------------------------------------------------------
// Fetch environmental events in same state within 72 hours via REST API
// ---------------------------------------------------------------------------

async function fetchEnvEvents(stateAbbr: string, dateFrom: string, dateTo: string): Promise<any[]> {
  const typeFilter = ENV_TYPES.map((t) => `content_type.eq.${t}`).join(",");
  const url = `${SUPABASE_URL}/rest/v1/hunt_knowledge?select=id,title,content_type,effective_date,metadata&or=(${typeFilter})&state_abbr=eq.${stateAbbr}&effective_date=gte.${dateFrom}&effective_date=lte.${dateTo}&limit=15`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      apikey: SERVICE_KEY,
    },
  });
  if (!res.ok) return [];
  return await res.json();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let totalProcessed = 0;
  let totalCorrelations = 0;
  let totalEmbedded = 0;
  let totalErrors = 0;
  let offset = START_OFFSET;

  console.log(`[correlator] Starting bio-environmental correlation pass`);
  console.log(`[correlator] Bird types: ${BIRD_TYPES.join(", ")}`);
  console.log(`[correlator] Env types: ${ENV_TYPES.join(", ")}`);
  console.log(`[correlator] Start offset: ${START_OFFSET}`);
  console.log("---");

  while (true) {
    const birdEntries = await fetchBirdBatch(offset);
    if (!birdEntries || birdEntries.length === 0) {
      console.log("[correlator] No more bird entries");
      break;
    }

    console.log(`\n[batch] offset=${offset}, entries=${birdEntries.length}`);

    const entries: Array<{ text: string; meta: Record<string, any> }> = [];

    for (const bird of birdEntries) {
      totalProcessed++;

      // Calculate 72-hour window
      const dateObj = new Date(bird.effective_date);
      const dateFrom = new Date(dateObj.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const dateTo = new Date(dateObj.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

      const envEvents = await fetchEnvEvents(bird.state_abbr, dateFrom, dateTo);
      if (envEvents.length === 0) continue;

      // Build correlation text
      const envSummary = envEvents
        .map((e: any) => `- [${e.content_type}] ${e.title} (${e.effective_date})`)
        .join("\n");

      const corrText = [
        `bio-environmental-correlation | ${bird.state_abbr} | ${bird.effective_date}`,
        `Bird signal: ${bird.title} (${bird.content_type})`,
        `Environmental context (72hr window):`,
        envSummary,
        `Cross-domain match count: ${envEvents.length}`,
      ].join("\n");

      const envTypes = [...new Set(envEvents.map((e: any) => e.content_type))];

      entries.push({
        text: corrText,
        meta: {
          title: `Bio-Env Correlation: ${bird.state_abbr} ${bird.effective_date} — ${bird.content_type}`,
          content: corrText,
          content_type: "bio-environmental-correlation",
          state_abbr: bird.state_abbr,
          species: "duck",
          effective_date: bird.effective_date,
          tags: [bird.state_abbr, "correlation", "bio-signal", bird.content_type, ...envTypes],
          metadata: {
            source: "bio-environmental-correlator",
            bird_entry_id: bird.id,
            bird_content_type: bird.content_type,
            bird_title: bird.title,
            env_matches: envEvents.length,
            env_types: envTypes,
            env_entries: envEvents.map((e: any) => ({
              id: e.id,
              title: e.title,
              type: e.content_type,
              date: e.effective_date,
            })),
          },
        },
      });

      totalCorrelations++;

      // Embed/upsert in batches of 20
      if (entries.length >= 20) {
        try {
          const n = await upsertBatch(entries.splice(0, 20));
          totalEmbedded += n;
        } catch (err) {
          console.error("  Embed/upsert error:", err);
          totalErrors++;
          entries.splice(0, 20);
        }
      }

      // Checkpoint logging
      if (totalProcessed % 100 === 0) {
        console.log(
          `[checkpoint] Processed: ${totalProcessed}, Correlations: ${totalCorrelations}, Embedded: ${totalEmbedded}, Errors: ${totalErrors}, Offset: ${offset}`
        );
      }

      // Small delay between env queries to not hammer Supabase
      await new Promise((r) => setTimeout(r, 100));
    }

    // Flush remaining entries for this batch
    if (entries.length > 0) {
      try {
        const n = await upsertBatch(entries);
        totalEmbedded += n;
      } catch (err) {
        console.error("  Flush error:", err);
        totalErrors++;
      }
    }

    offset += BATCH_SIZE;

    // Delay between batches
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n===== COMPLETE =====");
  console.log(`Total processed:  ${totalProcessed}`);
  console.log(`Total correlations: ${totalCorrelations}`);
  console.log(`Total embedded:   ${totalEmbedded}`);
  console.log(`Total errors:     ${totalErrors}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
