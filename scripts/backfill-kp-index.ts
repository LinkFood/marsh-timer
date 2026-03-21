/**
 * Backfill geomagnetic Kp index data into hunt_knowledge
 * Downloads the GFZ Potsdam bulk Kp file (daily values since 1932),
 * parses three-hourly Kp values, classifies geomagnetic activity,
 * embeds via Voyage AI, and upserts into hunt_knowledge.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-kp-index.ts
 *
 * Resume support:
 *   START_DATE=2020-01-01  — skip days before this date
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

const START_DATE = process.env.START_DATE || null;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

const KP_FILE_URL =
  "https://kp.gfz.de/app/files/Kp_ap_Ap_SN_F107_since_1932.txt";

// ---------- Types ----------

interface KpDay {
  date: string; // YYYY-MM-DD
  year: number;
  month: number;
  day: number;
  kpValues: number[]; // 8 three-hourly Kp values
  apValues: number[]; // 8 three-hourly ap values
  apDaily: number;
  avgKp: number;
  maxKp: number;
  level: string;
}

// ---------- Helpers ----------

async function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function classifyKp(maxKp: number): string {
  if (maxKp >= 8) return "severe-storm";
  if (maxKp >= 6) return "major-storm";
  if (maxKp >= 5) return "minor-storm";
  if (maxKp >= 4) return "active";
  if (maxKp >= 2) return "unsettled";
  return "quiet";
}

function levelLabel(level: string): string {
  return level.replace(/-/g, " ");
}

// ---------- Download & Parse ----------

async function downloadKpFile(): Promise<string> {
  console.log(`Downloading Kp file from ${KP_FILE_URL}...`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  const res = await fetch(KP_FILE_URL, { signal: controller.signal });
  clearTimeout(timeout);
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  console.log(`Downloaded ${(text.length / 1024 / 1024).toFixed(1)} MB`);
  return text;
}

function parseKpFile(raw: string): KpDay[] {
  const lines = raw.split("\n");
  const days: KpDay[] = [];

  for (const line of lines) {
    // Skip comments and empty lines
    if (line.startsWith("#") || line.trim().length === 0) continue;

    // Fixed-width parsing — split on whitespace
    const parts = line.trim().split(/\s+/);
    if (parts.length < 23) continue; // need at least year,month,day + 4 skip + 8 Kp + 8 ap + Ap

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    if (isNaN(year) || isNaN(month) || isNaN(day)) continue;

    // Columns: [0]=year [1]=month [2]=day [3]=days [4]=days.5 [5]=bartels_rot [6]=day_in_rot
    // [7..14] = 8 Kp values
    // [15..22] = 8 ap values
    // [23] = daily Ap

    const kpValues: number[] = [];
    for (let i = 7; i <= 14; i++) {
      const v = parseFloat(parts[i]);
      kpValues.push(isNaN(v) ? 0 : v);
    }

    const apValues: number[] = [];
    for (let i = 15; i <= 22; i++) {
      const v = parseInt(parts[i], 10);
      apValues.push(isNaN(v) ? 0 : v);
    }

    const apDaily = parts.length > 23 ? parseInt(parts[23], 10) : 0;

    const avgKp = round2(kpValues.reduce((a, b) => a + b, 0) / kpValues.length);
    const maxKp = round2(Math.max(...kpValues));
    const level = classifyKp(maxKp);

    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    days.push({
      date: dateStr,
      year,
      month,
      day,
      kpValues,
      apValues,
      apDaily: isNaN(apDaily) ? 0 : apDaily,
      avgKp,
      maxKp,
      level,
    });
  }

  return days;
}

// ---------- Filter ----------

function shouldInclude(d: KpDay): boolean {
  // All days since 2015 for recent correlation analysis
  if (d.year >= 2015) return true;
  // Pre-2015: only biologically significant events (Kp >= 4)
  if (d.maxKp >= 4) return true;
  return false;
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

async function upsertBatch(rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
        method: "POST",
        headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(chunk),
      });
      if (res.ok) break;
      if (res.status >= 400 && res.status < 500) {
        const text = await res.text();
        console.error(`  Upsert 4xx (not retrying): ${res.status} ${text}`);
        break;
      }
      if (attempt < 2) {
        console.log(`  Upsert retry ${attempt + 1}/3...`);
        await delay(5000);
        continue;
      }
      const text = await res.text();
      console.error(`  Upsert failed after retries: ${text}`);
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

function buildEntry(d: KpDay): PreparedEntry {
  const kpStr = d.kpValues.map((v) => round2(v)).join(",");
  const titleLevel = d.maxKp >= 4 ? `Geomagnetic ${levelLabel(d.level)} Kp=${d.maxKp}` : `Geomagnetic activity Kp=${d.maxKp}`;

  const embedText =
    `geomagnetic-kp | ${d.date} | avg_kp:${d.avgKp} | max_kp:${d.maxKp}` +
    ` | level:${d.level} | 8 three-hourly values: ${kpStr}`;

  const tags = ["geomagnetic", "kp-index", "solar"];
  if (d.maxKp >= 4) tags.push(d.level);

  return {
    title: `${titleLevel} ${d.date}`,
    content: embedText,
    content_type: "geomagnetic-kp",
    tags,
    species: null,
    state_abbr: null,
    effective_date: d.date,
    metadata: {
      source: "gfz-potsdam",
      avg_kp: d.avgKp,
      max_kp: d.maxKp,
      level: d.level,
      kp_values: d.kpValues.map((v) => round2(v)),
      ap_daily: d.apDaily,
    },
    embedText,
  };
}

// ---------- Process entries (embed + upsert) ----------

async function processEntries(entries: PreparedEntry[]): Promise<number> {
  let inserted = 0;

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
      state_abbr: e.state_abbr,
      species: e.species,
      effective_date: e.effective_date,
      metadata: e.metadata,
      embedding: JSON.stringify(embeddings[idx]),
    }));

    await upsertBatch(rows);
    inserted += rows.length;

    // Pause between embed batches
    await delay(500);
  }

  return inserted;
}

// ---------- Main ----------

async function main() {
  console.log("=== Geomagnetic Kp Index Backfill ===");
  if (START_DATE) console.log(`Resuming from: ${START_DATE}`);

  // Step 1: Download
  const raw = await downloadKpFile();

  // Step 2: Parse
  const allDays = parseKpFile(raw);
  console.log(`Parsed ${allDays.length} total days (${allDays[0]?.date} to ${allDays[allDays.length - 1]?.date})`);

  // Step 3: Filter
  let filtered = allDays.filter(shouldInclude);
  if (START_DATE) {
    filtered = filtered.filter((d) => d.date >= START_DATE);
  }

  const stormDays = filtered.filter((d) => d.maxKp >= 4).length;
  const recentDays = filtered.filter((d) => d.year >= 2015).length;
  console.log(`Filtered to ${filtered.length} entries (${stormDays} storm days pre-2015 + ${recentDays} days since 2015)`);

  // Step 4: Build entries
  const entries = filtered.map(buildEntry);

  // Step 5: Embed + upsert in chunks
  let totalInserted = 0;
  const chunkSize = 200; // Process 200 entries at a time for progress reporting

  for (let i = 0; i < entries.length; i += chunkSize) {
    const chunk = entries.slice(i, i + chunkSize);
    const firstDate = chunk[0].effective_date;
    const lastDate = chunk[chunk.length - 1].effective_date;

    try {
      const inserted = await processEntries(chunk);
      totalInserted += inserted;
      console.log(
        `  ${firstDate} to ${lastDate}: ${inserted} embedded (${totalInserted}/${entries.length} total, ${Math.round((totalInserted / entries.length) * 100)}%)`
      );
    } catch (err) {
      console.error(`  ${firstDate} to ${lastDate}: failed (continuing): ${err}`);
    }
  }

  console.log(`\n=== Done! Total: ${totalInserted} entries inserted ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
