/**
 * Backfill NOAA GLERL Great Lakes ice cover data into hunt_knowledge
 * Pulls daily ice concentration percentages for all 5 Great Lakes,
 * embeds via Voyage AI, and upserts into hunt_knowledge.
 *
 * Data source: NOAA Great Lakes Environmental Research Laboratory (GLERL)
 * URL: https://apps.glerl.noaa.gov/coastwatch/webdata/statistic/ice/dat/
 * Files: g{startYear}_{endYear}_ice.dat (seasons from 2008-2009 through current)
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-glerl-ice.ts
 *
 * Resume support:
 *   START_YEAR=2020  — skip seasons starting before 2020
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}
if (!VOYAGE_KEY) {
  console.error("VOYAGE_API_KEY required");
  process.exit(1);
}

const START_YEAR = process.env.START_YEAR ? parseInt(process.env.START_YEAR) : null;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const GLERL_BASE =
  "https://apps.glerl.noaa.gov/coastwatch/webdata/statistic/ice/dat";

// Seasons available on GLERL (2008-2009 through 2025-2026)
function generateSeasons(): { startYear: number; endYear: number; filename: string; season: string }[] {
  const seasons: { startYear: number; endYear: number; filename: string; season: string }[] = [];
  for (let startYear = 2008; startYear <= 2025; startYear++) {
    const endYear = startYear + 1;
    seasons.push({
      startYear,
      endYear,
      filename: `g${startYear}_${endYear}_ice.dat`,
      season: `${startYear}-${endYear}`,
    });
  }
  return seasons;
}

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function dayOfYearToDate(year: number, dayOfYear: number): string {
  const d = new Date(year, 0);
  d.setDate(dayOfYear);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------- Fetch & Parse ----------

interface IceDay {
  date: string;
  superior_pct: number;
  michigan_pct: number;
  huron_pct: number;
  erie_pct: number;
  ontario_pct: number;
  st_clair_pct: number;
  total_pct: number;
}

async function fetchAndParseSeason(filename: string): Promise<IceDay[]> {
  const url = `${GLERL_BASE}/${filename}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeout);
    throw new Error(`Fetch failed for ${filename}: ${err}`);
  }
  clearTimeout(timeout);

  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) {
      // Never retry 4xx
      console.error(`  ${filename}: ${res.status} (skipping, no retry on 4xx)`);
      return [];
    }
    throw new Error(`${filename}: HTTP ${res.status}`);
  }

  const text = await res.text();
  const lines = text.split("\n");
  const entries: IceDay[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip header lines — data lines start with a 4-digit year
    if (!/^\d{4}\s/.test(trimmed)) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 8) continue;

    const year = parseInt(parts[0]);
    const dayOfYear = parseInt(parts[1]);
    const superior = parseFloat(parts[2]);
    const michigan = parseFloat(parts[3]);
    const huron = parseFloat(parts[4]);
    const erie = parseFloat(parts[5]);
    const ontario = parseFloat(parts[6]);
    const stClair = parseFloat(parts[7]);
    const total = parts.length >= 9 ? parseFloat(parts[8]) : NaN;

    if (isNaN(year) || isNaN(dayOfYear)) continue;

    const date = dayOfYearToDate(year, dayOfYear);

    entries.push({
      date,
      superior_pct: isNaN(superior) ? 0 : round2(superior),
      michigan_pct: isNaN(michigan) ? 0 : round2(michigan),
      huron_pct: isNaN(huron) ? 0 : round2(huron),
      erie_pct: isNaN(erie) ? 0 : round2(erie),
      ontario_pct: isNaN(ontario) ? 0 : round2(ontario),
      st_clair_pct: isNaN(stClair) ? 0 : round2(stClair),
      total_pct: isNaN(total) ? 0 : round2(total),
    });
  }

  return entries;
}

// ---------- Embedding ----------

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
      // Never retry 4xx (except 429)
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

// ---------- Supabase upsert ----------

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
        if (res.status >= 400 && res.status < 500) {
          const text = await res.text();
          console.error(`  Insert 4xx (no retry): ${text}`);
          break;
        }
        if (attempt < 2) {
          console.log(`  Insert retry ${attempt + 1}/3...`);
          await delay(5000);
          continue;
        }
        const text = await res.text();
        console.error(`  Insert failed after retries: ${text}`);
      } catch (err) {
        if (attempt < 2) {
          console.log(`  Insert retry ${attempt + 1}/3 (network)...`);
          await delay(5000);
          continue;
        }
        console.error(`  Insert failed (network): ${err}`);
      }
    }
  }
}

// ---------- Build entries ----------

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  species: null;
  state_abbr: null;
  effective_date: string;
  metadata: Record<string, unknown>;
  embedText: string;
}

function buildEntry(day: IceDay, season: string): PreparedEntry {
  const content =
    `glerl-ice-cover | ${day.date}` +
    ` | superior:${day.superior_pct}%` +
    ` | michigan:${day.michigan_pct}%` +
    ` | huron:${day.huron_pct}%` +
    ` | erie:${day.erie_pct}%` +
    ` | ontario:${day.ontario_pct}%` +
    ` | total:${day.total_pct}%`;

  return {
    title: `Great Lakes ice cover ${day.date}`,
    content,
    content_type: "glerl-ice-cover",
    tags: ["great-lakes", "ice-cover", "winter", "waterfowl"],
    species: null,
    state_abbr: null,
    effective_date: day.date,
    metadata: {
      source: "glerl-coastwatch",
      superior_pct: day.superior_pct,
      michigan_pct: day.michigan_pct,
      huron_pct: day.huron_pct,
      erie_pct: day.erie_pct,
      ontario_pct: day.ontario_pct,
      st_clair_pct: day.st_clair_pct,
      total_pct: day.total_pct,
      season,
    },
    embedText: content,
  };
}

// ---------- Process entries (embed + insert) ----------

async function processEntries(entries: PreparedEntry[]): Promise<number> {
  let inserted = 0;

  // Embed in batches of 20
  for (let i = 0; i < entries.length; i += 20) {
    const batch = entries.slice(i, i + 20);
    const texts = batch.map((e) => e.embedText);

    let embeddings: number[][];
    try {
      embeddings = await batchEmbed(texts);
    } catch (err) {
      console.error(`    Embed batch failed, skipping ${batch.length} entries: ${err}`);
      continue;
    }

    const rows = batch.map((e, idx) => ({
      title: e.title,
      content: e.content,
      content_type: e.content_type,
      tags: e.tags,
      species: e.species,
      state_abbr: e.state_abbr,
      effective_date: e.effective_date,
      metadata: e.metadata,
      embedding: JSON.stringify(embeddings[idx]),
    }));

    await insertBatch(rows);
    inserted += rows.length;

    // Pause between embed batches
    await delay(500);
  }

  return inserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== GLERL Great Lakes Ice Cover Backfill ===");
  const seasons = generateSeasons();
  console.log(`Seasons: ${seasons.length} (${seasons[0].season} through ${seasons[seasons.length - 1].season})`);
  if (START_YEAR) console.log(`Resuming from start year: ${START_YEAR}`);

  let totalInserted = 0;

  for (const season of seasons) {
    // Resume support
    if (START_YEAR && season.startYear < START_YEAR) {
      continue;
    }

    console.log(`\n--- Season ${season.season} (${season.filename}) ---`);

    let days: IceDay[];
    try {
      days = await fetchAndParseSeason(season.filename);
    } catch (err) {
      console.error(`  Fetch/parse failed: ${err}`);
      continue;
    }

    if (days.length === 0) {
      console.log("  No data rows found, skipping");
      continue;
    }

    console.log(`  Parsed ${days.length} daily records`);

    // Build entries
    const entries = days.map((d) => buildEntry(d, season.season));

    // Embed + insert
    try {
      const inserted = await processEntries(entries);
      totalInserted += inserted;
      console.log(`  Inserted ${inserted} entries`);
    } catch (err) {
      console.error(`  Embed/insert failed (continuing): ${err}`);
    }

    // 500ms between file downloads
    await delay(500);
  }

  console.log(`\n=== Done! Total: ${totalInserted} entries inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
