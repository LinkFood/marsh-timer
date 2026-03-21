/**
 * Backfill BirdCast historical migration radar data into hunt_knowledge
 * Scrapes dashboard.birdcast.info for each state × migration season night
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-birdcast-historical.ts
 *   START_STATE=GA START_YEAR=2022 END_YEAR=2024 npx tsx scripts/backfill-birdcast-historical.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY!;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) { console.error("VOYAGE_API_KEY required"); process.exit(1); }

const START_STATE = process.env.START_STATE || null;
const START_YEAR = parseInt(process.env.START_YEAR || "2021", 10);
const END_YEAR = parseInt(process.env.END_YEAR || "2025", 10);

// ---------------------------------------------------------------------------
// State list (sorted alphabetically)
// ---------------------------------------------------------------------------

const STATE_ABBRS = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
];

// ---------------------------------------------------------------------------
// Types (copied from edge function)
// ---------------------------------------------------------------------------

interface NightReading {
  numAloft: number;
  meanHeight: number;
  avgDirection: number;
  avgSpeed: number;
  vid: number;
}

interface BirdcastData {
  cumulativeBirds: number;
  isHigh: boolean;
  nightSeries: NightReading[];
}

interface BirdcastRow {
  date: string;
  state_abbr: string;
  cumulative_birds: number | null;
  is_high: boolean;
  peak_num_aloft: number | null;
  avg_direction: number | null;
  avg_speed: number | null;
  mean_height: number | null;
}

// ---------------------------------------------------------------------------
// Parse BirdCast NUXT data from HTML (copied from edge function)
// ---------------------------------------------------------------------------

function parseBirdcastHtml(html: string): BirdcastData | null {
  const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*([\s\S]*?)<\/script>/);
  if (!nuxtMatch) return null;

  let nuxtObj: Record<string, unknown>;
  try {
    nuxtObj = eval(nuxtMatch[1].replace(/;$/, ""));
  } catch {
    return null;
  }

  const fetchData = (nuxtObj as Record<string, unknown>)?.fetch as
    Record<string, Record<string, unknown>> | undefined;
  if (!fetchData) return null;

  const regionData = fetchData["Region:0"];
  if (!regionData) return null;

  const liveData = regionData.migrationLiveDataFromApi as {
    cumulativeBirds?: number;
    isHigh?: boolean;
    nightSeries?: Array<{
      numAloft?: number;
      meanHeight?: number;
      avgDirection?: number;
      avgSpeed?: number;
      vid?: number;
    }>;
  } | undefined;

  if (!liveData) return null;

  const nightSeries: NightReading[] = (liveData.nightSeries || [])
    .filter((r) => r.numAloft != null)
    .map((r) => ({
      numAloft: r.numAloft ?? 0,
      meanHeight: r.meanHeight ?? 0,
      avgDirection: r.avgDirection ?? 0,
      avgSpeed: r.avgSpeed ?? 0,
      vid: r.vid ?? 0,
    }));

  return {
    cumulativeBirds: liveData.cumulativeBirds ?? 0,
    isHigh: liveData.isHigh ?? false,
    nightSeries,
  };
}

// ---------------------------------------------------------------------------
// Process parsed data into row values (copied from edge function)
// ---------------------------------------------------------------------------

function toRow(stateAbbr: string, dateStr: string, data: BirdcastData): BirdcastRow {
  const series = data.nightSeries;

  let peakNumAloft: number | null = null;
  let avgDirection: number | null = null;
  let avgSpeed: number | null = null;
  let meanHeight: number | null = null;

  if (series.length > 0) {
    peakNumAloft = Math.max(...series.map((s) => s.numAloft));
    const sumDir = series.reduce((a, s) => a + s.avgDirection, 0);
    const sumSpd = series.reduce((a, s) => a + s.avgSpeed, 0);
    const sumHt = series.reduce((a, s) => a + s.meanHeight, 0);
    avgDirection = Math.round((sumDir / series.length) * 10) / 10;
    avgSpeed = Math.round((sumSpd / series.length) * 10) / 10;
    meanHeight = Math.round((sumHt / series.length) * 10) / 10;
  }

  return {
    date: dateStr,
    state_abbr: stateAbbr,
    cumulative_birds: data.cumulativeBirds,
    is_high: data.isHigh,
    peak_num_aloft: peakNumAloft,
    avg_direction: avgDirection,
    avg_speed: avgSpeed,
    mean_height: meanHeight,
  };
}

// ---------------------------------------------------------------------------
// Compass helper (copied from edge function)
// ---------------------------------------------------------------------------

function degreesToCompass(deg: number): string {
  if (deg >= 337 || deg < 23) return "N";
  if (deg < 68) return "NE";
  if (deg < 113) return "E";
  if (deg < 158) return "SE";
  if (deg < 203) return "S";
  if (deg < 248) return "SW";
  if (deg < 293) return "W";
  return "NW";
}

// ---------------------------------------------------------------------------
// Generate migration season dates for a given year
// ---------------------------------------------------------------------------

function getMigrationDates(year: number): string[] {
  const dates: string[] = [];

  // Spring: March 1 - June 15
  const springStart = new Date(year, 2, 1); // month is 0-indexed
  const springEnd = new Date(year, 5, 15);
  for (let d = new Date(springStart); d <= springEnd; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split("T")[0]);
  }

  // Fall: August 1 - November 15
  const fallStart = new Date(year, 7, 1);
  const fallEnd = new Date(year, 10, 15);
  for (let d = new Date(fallStart); d <= fallEnd; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split("T")[0]);
  }

  return dates;
}

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

  // Upsert in chunks of 50
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
// Fetch and parse a single BirdCast page
// ---------------------------------------------------------------------------

async function fetchBirdcastPage(
  abbr: string,
  date: string
): Promise<BirdcastRow | null> {
  const url = `https://dashboard.birdcast.info/region/US-${abbr}?night=${date}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; DuckCountdown/1.0; +https://duckcountdown.com)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const data = parseBirdcastHtml(html);
    if (!data) return null;
    return toRow(abbr, date, data);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let totalEmbedded = 0;
  let totalFetched = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Determine which states to process
  let states = [...STATE_ABBRS];
  if (START_STATE) {
    const idx = states.indexOf(START_STATE);
    if (idx === -1) {
      console.error(`Invalid START_STATE: ${START_STATE}`);
      process.exit(1);
    }
    states = states.slice(idx);
    console.log(`Resuming from state: ${START_STATE}`);
  }

  // Build year list
  const years: number[] = [];
  for (let y = START_YEAR; y <= END_YEAR; y++) years.push(y);

  console.log(
    `BirdCast historical backfill: ${states.length} states × ${years.length} years (${START_YEAR}-${END_YEAR})`
  );
  console.log(
    `Migration windows: Spring (Mar 1 - Jun 15), Fall (Aug 1 - Nov 15)`
  );
  console.log("---");

  for (const abbr of states) {
    console.log(`\n=== ${abbr} ===`);

    for (const year of years) {
      const dates = getMigrationDates(year);
      console.log(`  ${year}: ${dates.length} migration nights`);

      // Accumulate entries for batch embed/upsert
      const entries: Array<{ text: string; meta: Record<string, any> }> = [];

      for (const date of dates) {
        const row = await fetchBirdcastPage(abbr, date);

        if (!row) {
          totalSkipped++;
          continue;
        }

        totalFetched++;

        // Build embed text (per spec)
        const dirStr =
          row.avg_direction != null
            ? `${degreesToCompass(row.avg_direction)}(${row.avg_direction}°)`
            : "unknown";
        const spdStr = row.avg_speed != null ? `${row.avg_speed}` : "unknown";
        const embedText = `birdcast-historical | ${abbr} | ${date} | birds:${row.cumulative_birds} intensity:${row.is_high ? "high" : "low"} direction:${dirStr} speed:${spdStr}`;

        entries.push({
          text: embedText,
          meta: {
            title: `${abbr} birdcast ${date}`,
            content: embedText,
            content_type: "birdcast-historical",
            state_abbr: abbr,
            effective_date: date,
            tags: ["birdcast", "migration", "radar", abbr],
            species: "duck",
            metadata: {
              source: "birdcast",
              cumulative_birds: row.cumulative_birds,
              is_high: row.is_high,
              peak_num_aloft: row.peak_num_aloft,
              avg_direction: row.avg_direction,
              avg_speed: row.avg_speed,
              mean_height: row.mean_height,
            },
          },
        });

        // Log each scrape
        console.log(
          `    ${date} | birds:${row.cumulative_birds} high:${row.is_high}`
        );

        // Embed/upsert in batches of 20
        if (entries.length >= 20) {
          try {
            const n = await upsertBatch(entries.splice(0, 20));
            totalEmbedded += n;
          } catch (err) {
            console.error(`    Embed/upsert error:`, err);
            totalErrors++;
            entries.splice(0, 20); // drop failed batch, keep going
          }
        }

        // Checkpoint logging
        if (totalFetched % 100 === 0) {
          console.log(
            `[checkpoint] ${abbr} ${date} — ${totalEmbedded} entries embedded, ${totalSkipped} skipped, ${totalErrors} errors`
          );
        }

        // Rate limit: 300ms between BirdCast requests
        await new Promise((r) => setTimeout(r, 300));
      }

      // Flush remaining entries for this year
      if (entries.length > 0) {
        try {
          const n = await upsertBatch(entries);
          totalEmbedded += n;
        } catch (err) {
          console.error(`    Flush error:`, err);
          totalErrors++;
        }
      }
    }

    console.log(
      `  ${abbr} done — running total: ${totalEmbedded} embedded`
    );
  }

  console.log("\n===== COMPLETE =====");
  console.log(`Total fetched:  ${totalFetched}`);
  console.log(`Total embedded: ${totalEmbedded}`);
  console.log(`Total skipped:  ${totalSkipped}`);
  console.log(`Total errors:   ${totalErrors}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
