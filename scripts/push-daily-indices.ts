/**
 * Push daily climate index values to hunt_knowledge
 * Runs locally (your machine can reach ftp.cpc.ncep.noaa.gov, edge functions can't)
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/push-daily-indices.ts
 *   DAYS=30 npx tsx scripts/push-daily-indices.ts  (push last 30 days instead of 7)
 *
 * Run daily via local cron, launchd, or manually. Takes ~10 seconds.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY || null; // Optional — falls back to edge function

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }

const DAYS = parseInt(process.env.DAYS || "7");

const INDICES = [
  {
    id: "AO", name: "Arctic Oscillation",
    url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.ao.index.b500101.current.ascii",
    impact: {
      negative: "Cold air outbreak risk — arctic air pushing south. Migration trigger.",
      positive: "Mild arctic — reduced cold intrusions. Migration may stall.",
      neutral: "Neutral arctic pattern.",
    },
  },
  {
    id: "NAO", name: "North Atlantic Oscillation",
    url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.nao.index.b500101.current.ascii",
    impact: {
      negative: "Stormy eastern US — Atlantic flyway migration enhanced.",
      positive: "Mild dry eastern US — Atlantic flyway may slow.",
      neutral: "Neutral Atlantic pattern.",
    },
  },
  {
    id: "PNA", name: "Pacific North American Pattern",
    url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.pna.index.b500101.current.ascii",
    impact: {
      negative: "Wet/cool West, dry/mild East.",
      positive: "Cold trough East — cold outbreak setup for Central/Mississippi flyways.",
      neutral: "Neutral PNA.",
    },
  },
];

function parseDaily(text: string, daysBack: number): Array<{ date: string; value: number }> {
  const lines = text.trim().split("\n");
  const entries: Array<{ date: string; value: number }> = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    const value = parseFloat(parts[3]);
    if (isNaN(value) || isNaN(year) || year < 2000) continue;
    entries.push({
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      value,
    });
  }

  return entries.slice(-daysBack);
}

function phase(v: number): "negative" | "positive" | "neutral" {
  if (v <= -0.5) return "negative";
  if (v >= 0.5) return "positive";
  return "neutral";
}

async function embed(texts: string[]): Promise<number[][]> {
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += 20) {
    const chunk = texts.slice(i, i + 20);

    if (VOYAGE_KEY) {
      // Direct Voyage API
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "voyage-3-lite", input: chunk, input_type: "document" }),
      });
      if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
      const data = await res.json();
      for (const item of data.data) results.push(item.embedding);
    } else {
      // Fallback: use edge function for embedding (slower but no Voyage key needed)
      for (const text of chunk) {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SERVICE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(`Edge embed ${res.status}`);
        const data = await res.json();
        results.push(data.embedding);
      }
    }
  }
  return results;
}

async function main() {
  let totalEmbedded = 0;

  for (const index of INDICES) {
    console.log(`Fetching daily ${index.name}...`);

    const res = await fetch(index.url);
    if (!res.ok) { console.error(`  ${index.id}: HTTP ${res.status}`); continue; }

    const text = await res.text();
    const recent = parseDaily(text, DAYS);
    console.log(`  ${recent.length} daily values (last ${DAYS} days)`);

    const entries: Array<{ text: string; meta: Record<string, any> }> = [];

    for (const day of recent) {
      const p = phase(day.value);
      const impact = index.impact[p];

      const entryText = [
        `climate-index-daily | ${index.id} | ${index.name}`,
        `date:${day.date} | value:${day.value.toFixed(3)} | phase:${p}`,
        `impact: ${impact}`,
      ].join(" | ");

      entries.push({
        text: entryText,
        meta: {
          title: `daily-${index.id} ${day.date}`,
          content: entryText,
          content_type: "climate-index-daily",
          tags: [index.id.toLowerCase(), "climate", "daily", "live"],
          species: null,
          state_abbr: null,
          effective_date: day.date,
          metadata: {
            source: "noaa-cpc-daily",
            index_id: index.id,
            index_name: index.name,
            value: day.value,
            phase: p,
            resolution: "daily",
          },
        },
      });
    }

    // Embed and upsert
    for (let i = 0; i < entries.length; i += 20) {
      const chunk = entries.slice(i, i + 20);
      const texts = chunk.map(e => e.text);
      const embeddings = await embed(texts);
      const rows = chunk.map((e, j) => ({
        ...e.meta,
        embedding: JSON.stringify(embeddings[j]),
      }));

      const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY!,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(rows),
      });

      if (!res.ok) {
        console.error(`  Upsert error: ${res.status}`);
      } else {
        totalEmbedded += rows.length;
      }
    }

    console.log(`  ${entries.length} daily values embedded`);
  }

  console.log(`\nDone. Total embedded: ${totalEmbedded}`);
}

main().catch(console.error);
