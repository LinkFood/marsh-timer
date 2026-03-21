/**
 * Backfill NCEI snow depth data into hunt_knowledge
 * Historical daily snow depth per state, Oct-Mar, 2015-2025
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-snow-cover.ts
 *   START_YEAR=2020 START_MONTH=11 npx tsx scripts/backfill-snow-cover.ts
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY!;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
if (!VOYAGE_KEY) { console.error("VOYAGE_API_KEY required"); process.exit(1); }

const START_YEAR = parseInt(process.env.START_YEAR || "2015");
const START_MONTH = parseInt(process.env.START_MONTH || "10");

const STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];

// Snow months: Oct-Mar
const SNOW_MONTHS = [10, 11, 12, 1, 2, 3];

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

function coverLevel(avgDepth: number): string {
  if (avgDepth === 0) return "no_snow";
  if (avgDepth < 1) return "trace";
  if (avgDepth < 4) return "light";
  if (avgDepth < 12) return "moderate";
  return "heavy";
}

async function main() {
  let totalEmbedded = 0;

  for (let year = START_YEAR; year <= 2025; year++) {
    for (const month of SNOW_MONTHS) {
      // Skip months before start
      if (year === START_YEAR && month < START_MONTH) continue;

      // Handle season year boundary (Oct-Dec = current year, Jan-Mar = next year)
      const actualYear = month >= 10 ? year : year + 1;
      if (actualYear > 2026) continue;

      const yyyymm = `${actualYear}${String(month).padStart(2, "0")}`;
      console.log(`\nFetching snow data for ${yyyymm}...`);

      const entries: Array<{ text: string; meta: Record<string, any> }> = [];

      for (const state of STATES) {
        try {
          const url = `https://www.ncei.noaa.gov/access/monitoring/daily-snow/${state}/snow-depth/${yyyymm}/map-data.json`;
          const res = await fetch(url);
          if (!res.ok) continue;

          const data = await res.json();
          if (!data?.features || data.features.length === 0) continue;

          // Aggregate station data
          let totalDepth = 0;
          let maxDepth = 0;
          let stationsReporting = 0;
          let stationsWithSnow = 0;

          for (const feature of data.features) {
            const values = feature.properties?.values;
            if (!values || typeof values !== "object") continue;
            // values is { "1": depth, "2": depth, ... } keyed by day of month
            const depths = Object.values(values)
              .map((v: any) => parseFloat(v))
              .filter((d: number) => !isNaN(d));
            if (depths.length === 0) continue;
            const avgStationDepth = depths.reduce((a: number, b: number) => a + b, 0) / depths.length;
            const maxStationDepth = Math.max(...depths);
            stationsReporting++;
            totalDepth += avgStationDepth;
            if (maxStationDepth > maxDepth) maxDepth = maxStationDepth;
            if (avgStationDepth > 0) stationsWithSnow++;
          }

          if (stationsReporting === 0) continue;

          const avgDepth = totalDepth / stationsReporting;
          const pctWithSnow = Math.round((stationsWithSnow / stationsReporting) * 100);
          const level = coverLevel(avgDepth);
          const dateStr = `${actualYear}-${String(month).padStart(2, "0")}-15`; // mid-month

          const text = [
            `snow-cover-monthly | ${state} | ${yyyymm}`,
            `avg_depth:${avgDepth.toFixed(1)}in | max:${maxDepth.toFixed(1)}in`,
            `stations:${stationsReporting} | with_snow:${stationsWithSnow} (${pctWithSnow}%)`,
            `cover_level:${level}`,
          ].join(" | ");

          entries.push({
            text,
            meta: {
              title: `snow-cover ${state} ${yyyymm}`,
              content: text,
              content_type: "snow-cover-monthly",
              tags: [state, "snow", "ice", "winter", level],
              species: null,
              state_abbr: state,
              effective_date: dateStr,
              metadata: {
                source: "ncei",
                avg_depth_inches: avgDepth,
                max_depth_inches: maxDepth,
                stations_reporting: stationsReporting,
                stations_with_snow: stationsWithSnow,
                pct_with_snow: pctWithSnow,
                cover_level: level,
              },
            },
          });

          // Gentle rate limiting for NCEI
          await new Promise(r => setTimeout(r, 300));
        } catch (err) {
          // Silent skip — many states won't have snow data
        }
      }

      // Embed and upsert
      for (let i = 0; i < entries.length; i += 20) {
        const chunk = entries.slice(i, i + 20);
        const n = await upsertBatch(chunk);
        totalEmbedded += n;
      }

      console.log(`  ${yyyymm}: ${entries.length} states with snow data, ${totalEmbedded} total embedded`);
    }
  }

  console.log(`\nDone. Total embedded: ${totalEmbedded}`);
}

main().catch(console.error);
