/**
 * Backfill 75 years of macro climate oscillation indices into hunt_knowledge.
 * Sources: NOAA Physical Sciences Laboratory (PSL)
 * Indices: AO, NAO, PDO, ENSO (Nino 3.4), PNA — monthly from 1950-present.
 * ~4,500 entries total. Small volume, massive cross-referencing value.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-climate-indices.ts
 *
 * Resume options:
 *   START_INDEX=PDO  — skip indices before PDO in the list
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VOYAGE_KEY = process.env.VOYAGE_API_KEY;

if (!SERVICE_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }
const USE_EDGE_FN = !VOYAGE_KEY;
if (USE_EDGE_FN) console.log("No VOYAGE_API_KEY — using hunt-generate-embedding edge function (slower)");

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
  "Content-Type": "application/json",
};

// --- Index definitions ---

interface IndexDef {
  id: string;
  name: string;
  url: string;
  missingValues: number[];
  impacts: { positive: string; negative: string };
  thresholds: { positive: number; negative: number };
}

const INDICES: IndexDef[] = [
  {
    id: "AO",
    name: "Arctic Oscillation",
    url: "https://psl.noaa.gov/data/correlation/ao.data",
    missingValues: [-99.99, -9.90],
    impacts: {
      negative: "Cold air outbreak pattern — arctic air pushing south, strong migration trigger",
      positive: "Mild arctic pattern — reduced cold intrusions, migration may stall",
    },
    thresholds: { positive: 0.5, negative: -0.5 },
  },
  {
    id: "NAO",
    name: "North Atlantic Oscillation",
    url: "https://psl.noaa.gov/data/correlation/nao.data",
    missingValues: [-99.99, -9.90],
    impacts: {
      negative: "Stormy eastern US — Atlantic flyway migration enhanced",
      positive: "Mild dry eastern US — Atlantic flyway may slow",
    },
    thresholds: { positive: 0.5, negative: -0.5 },
  },
  {
    id: "PDO",
    name: "Pacific Decadal Oscillation",
    url: "https://psl.noaa.gov/data/correlation/pdo.data",
    missingValues: [-99.99, -9.90],
    impacts: {
      negative: "Cool Pacific — wetter Pacific NW, affects Pacific flyway staging",
      positive: "Warm Pacific — drier Pacific NW, staging shifts",
    },
    thresholds: { positive: 0.5, negative: -0.5 },
  },
  {
    id: "ENSO",
    name: "ENSO Nino 3.4 Anomaly",
    url: "https://psl.noaa.gov/data/correlation/nina34.anom.data",
    missingValues: [-99.99, -9.90],
    impacts: {
      negative: "La Niña — drier South, can amplify cold outbreaks",
      positive: "El Niño — wetter South, suppresses cold outbreaks",
    },
    thresholds: { positive: 0.5, negative: -0.5 },
  },
  {
    id: "PNA",
    name: "Pacific-North American Pattern",
    url: "https://psl.noaa.gov/data/correlation/pna.data",
    missingValues: [-99.99, -9.90],
    impacts: {
      positive: "Ridge West/trough East — cold outbreak setup for Central/Mississippi flyways",
      negative: "Ridge East — wet/cool West, dry/mild East",
    },
    thresholds: { positive: 0.5, negative: -0.5 },
  },
];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// --- Embedding ---

async function embedViaEdgeFn(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/hunt-generate-embedding`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text, input_type: "document" }),
      });
      if (res.ok) {
        const data = await res.json();
        return data.embedding;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      throw new Error(`Edge fn error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 10000));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

async function batchEmbed(texts: string[], retries = 3): Promise<number[][]> {
  if (USE_EDGE_FN) {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await embedViaEdgeFn(text, retries));
      await new Promise((r) => setTimeout(r, 100));
    }
    return results;
  }
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
        const wait = (attempt + 1) * 30000;
        console.log(`    Rate limited, waiting ${wait / 1000}s...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      if (res.status >= 500 && attempt < retries - 1) {
        const wait = (attempt + 1) * 5000;
        console.log(`    Retry ${attempt + 1}/${retries} after ${wait / 1000}s (${res.status})...`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw new Error(`Voyage error: ${res.status} ${await res.text()}`);
    } catch (err) {
      if (attempt < retries - 1) {
        const wait = (attempt + 1) * 10000;
        console.log(`    Error, retrying in ${wait / 1000}s: ${err}`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Exhausted retries");
}

// --- Insert ---

async function insertBatch(rows: any[]): Promise<void> {
  for (let i = 0; i < rows.length; i += 20) {
    const chunk = rows.slice(i, i + 20);
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/hunt_knowledge`, {
        method: "POST",
        headers: { ...supaHeaders, Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(chunk),
      });
      if (res.ok) break;
      if (attempt < 2) {
        console.log(`  Insert retry ${attempt + 1}/3...`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      const text = await res.text();
      console.error(`  Insert failed after retries: ${text}`);
    }
  }
}

// --- Parse PSL data format ---

interface MonthlyEntry {
  year: number;
  month: number; // 1-12
  value: number;
}

function parsePSLData(raw: string, missingValues: number[]): MonthlyEntry[] {
  const lines = raw.trim().split("\n");
  const entries: MonthlyEntry[] = [];

  // First line is header: "startYear endYear" — extract start/end years
  // Data lines: "YYYY  val1 val2 ... val12"
  // Last line may repeat the year range or have trailing info

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Split on whitespace
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;

    const year = parseInt(parts[0], 10);
    if (isNaN(year) || year < 1950 || year > 2030) continue;

    // Remaining parts are monthly values (up to 12)
    for (let m = 0; m < Math.min(parts.length - 1, 12); m++) {
      const val = parseFloat(parts[m + 1]);
      if (isNaN(val)) continue;

      // Check for missing values
      const isMissing = missingValues.some((mv) => Math.abs(val - mv) < 0.01);
      if (isMissing) continue;

      entries.push({ year, month: m + 1, value: val });
    }
  }

  return entries;
}

// --- Classify phase ---

function classifyPhase(value: number, thresholds: { positive: number; negative: number }): "positive" | "negative" | "neutral" {
  if (value >= thresholds.positive) return "positive";
  if (value <= thresholds.negative) return "negative";
  return "neutral";
}

function neutralImpact(indexId: string): string {
  switch (indexId) {
    case "AO": return "Neutral Arctic Oscillation — no strong arctic signal, typical seasonal patterns";
    case "NAO": return "Neutral NAO — average Atlantic pattern, no strong flyway signal";
    case "PDO": return "Neutral PDO — average Pacific conditions, typical coastal staging";
    case "ENSO": return "ENSO neutral — no El Niño or La Niña forcing, baseline conditions";
    case "PNA": return "Neutral PNA — no strong ridge/trough pattern, typical continental flow";
    default: return "Neutral phase — average conditions";
  }
}

// --- Prepare entries ---

interface PreparedEntry {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  state_abbr: null;
  species: null;
  effective_date: string;
  metadata: Record<string, any>;
  embedText: string;
}

function prepareEntry(indexDef: IndexDef, entry: MonthlyEntry): PreparedEntry {
  const phase = classifyPhase(entry.value, indexDef.thresholds);
  const monthStr = MONTH_NAMES[entry.month - 1];
  const dateStr = `${entry.year}-${String(entry.month).padStart(2, "0")}-01`;

  let impact: string;
  if (phase === "positive") impact = indexDef.impacts.positive;
  else if (phase === "negative") impact = indexDef.impacts.negative;
  else impact = neutralImpact(indexDef.id);

  const embedText = `climate-index | ${indexDef.id} (${indexDef.name}) | ${monthStr} ${entry.year} | value:${entry.value.toFixed(2)} | phase:${phase} | ${impact}`;

  return {
    title: `${indexDef.id} ${monthStr} ${entry.year}`,
    content: embedText,
    content_type: "climate-index",
    tags: [indexDef.id.toLowerCase(), "climate", "oscillation", "macro-pattern", "migration-trigger"],
    state_abbr: null,
    species: null,
    effective_date: dateStr,
    metadata: {
      source: "noaa_psl",
      index_id: indexDef.id,
      index_name: indexDef.name,
      value: entry.value,
      phase,
      month: entry.month,
      year: entry.year,
    },
    embedText,
  };
}

// --- Main ---

async function main() {
  const START_INDEX = process.env.START_INDEX || null;

  console.log("=== Backfill Climate Oscillation Indices ===");
  console.log(`Indices: ${INDICES.map((i) => i.id).join(", ")}`);
  console.log("Period: 1950-present (monthly)");
  if (START_INDEX) console.log(`Resuming from index: ${START_INDEX}`);

  let globalCount = 0;
  let skipping = !!START_INDEX;

  for (const indexDef of INDICES) {
    if (skipping) {
      if (indexDef.id === START_INDEX) {
        skipping = false;
      } else {
        console.log(`Skipping ${indexDef.id} (before ${START_INDEX})`);
        continue;
      }
    }

    console.log(`\n--- ${indexDef.id} (${indexDef.name}) ---`);
    console.log(`  Fetching from ${indexDef.url}`);

    let raw: string;
    try {
      const res = await fetch(indexDef.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.text();
    } catch (err) {
      console.error(`  FAILED to fetch ${indexDef.id}: ${err}`);
      continue;
    }

    const entries = parsePSLData(raw, indexDef.missingValues);
    console.log(`  Parsed ${entries.length} monthly values (${entries[0]?.year || "?"}-${entries[entries.length - 1]?.year || "?"})`);

    if (entries.length === 0) {
      console.log(`  No valid entries, skipping`);
      continue;
    }

    let batchTexts: string[] = [];
    let batchEntries: PreparedEntry[] = [];
    let pendingRows: any[] = [];
    let indexCount = 0;

    for (let i = 0; i < entries.length; i++) {
      const prepared = prepareEntry(indexDef, entries[i]);
      batchTexts.push(prepared.embedText);
      batchEntries.push(prepared);

      // Embed in batches of 20
      if (batchTexts.length === 20 || i === entries.length - 1) {
        const embeddings = await batchEmbed(batchTexts);

        for (let j = 0; j < batchEntries.length; j++) {
          const e = batchEntries[j];
          pendingRows.push({
            title: e.title,
            content: e.content,
            content_type: e.content_type,
            tags: e.tags,
            state_abbr: e.state_abbr,
            species: e.species,
            effective_date: e.effective_date,
            metadata: e.metadata,
            embedding: JSON.stringify(embeddings[j]),
          });
        }

        indexCount += batchEntries.length;
        globalCount += batchEntries.length;

        const batchStart = batchEntries[0].title;
        const batchEnd = batchEntries[batchEntries.length - 1].title;
        console.log(`  ${batchStart} -> ${batchEnd} (${batchTexts.length} embedded, ${indexCount}/${entries.length} index, ${globalCount} total)`);

        batchTexts = [];
        batchEntries = [];

        // Insert in batches of 50
        if (pendingRows.length >= 50) {
          await insertBatch(pendingRows);
          pendingRows = [];
        }

        await new Promise((r) => setTimeout(r, 300));
      }
    }

    // Flush remaining
    if (pendingRows.length > 0) {
      await insertBatch(pendingRows);
    }

    console.log(`  ${indexDef.id} done: ${indexCount} entries`);
  }

  console.log(`\n=== Complete: ${globalCount} climate index entries embedded ===`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
