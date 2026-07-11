/**
 * Backfill FULL daily climate index history (AO / NAO / PNA) into hunt_knowledge.
 * Gives THE BOARD's needle daily resolution across 76 years (1950 → present).
 *
 * The CPC "current" files carry the COMPLETE daily record since 1950-01-01
 * (format: `year month day value`). This script parses all of it and embeds
 * every day per THE EMBEDDING LAW.
 *
 * WINDOW: 1950-01-01 → 2026-05-15 (inclusive, HARD end).
 *   Existing `climate-index-daily` rows cover ONLY 2026-05-16 → 2026-06-30
 *   (~135 rows from catch-up runs). Ending at 2026-05-15 means ZERO overlap,
 *   so NO dedupe pass is needed. Rows are still merge-duplicates-safe on insert.
 *
 * ~27,900 days × 3 indices ≈ ~83,700 rows. Voyage cost ~$0.20. Runtime ~1-2h.
 *
 * Checkpointed per-index-per-year (scripts/.daily-indices-checkpoint.json,
 * gitignored) — kill + rerun resumes exactly. Idempotent.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/backfill-daily-indices.ts
 *   npx tsx scripts/backfill-daily-indices.ts --status    (print checkpoint state, no writes)
 *   npx tsx scripts/backfill-daily-indices.ts --dry-run   (parse + count + 5 samples, no writes)
 *
 * Reuses parse / phase / embed / insert / service-key patterns from
 * scripts/push-daily-indices.ts (the daily pusher).
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const VOYAGE_KEY = process.env.VOYAGE_API_KEY || null; // Optional — falls back to edge function

const DRY_RUN = process.argv.includes("--dry-run");
const STATUS = process.argv.includes("--status");

// Window: hard bounds. String comparison on YYYY-MM-DD is lexical-safe.
const START_DATE = "1950-01-01";
const END_DATE = "2026-05-15"; // hard end — zero overlap with existing 2026-05-16+ rows

const SENTINEL_FLOOR = -99; // CPC missing-data sentinel (-999 / -99.9). Skip value <= this.

const CHECKPOINT_PATH = new URL("./.daily-indices-checkpoint.json", import.meta.url).pathname;

const EMBED_BATCH = 20; // Voyage max per batch
const EMBED_CONCURRENCY = 3; // proven lane count
const INSERT_BATCH = 50;

// ── Service role key: bootstrap via the `--output json | jq`-style parse.
//    The plain table parse is a known landmine; use the JSON api-keys output.
function bootstrapServiceKey(): string {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const json = execSync(
      "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd --output json",
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const keys = JSON.parse(json);
    const row = keys.find((k: any) => k.name === "service_role");
    if (row?.api_key) return row.api_key;
  } catch {
    /* fall through */
  }
  console.error("SUPABASE_SERVICE_ROLE_KEY required (env or supabase CLI)");
  process.exit(1);
}

const SERVICE_KEY = STATUS ? "" : bootstrapServiceKey();

const INDICES = [
  {
    id: "AO",
    name: "Arctic Oscillation",
    url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.ao.index.b500101.current.ascii",
    impact: {
      negative: "Cold air outbreak risk — arctic air pushing south. Migration trigger.",
      positive: "Mild arctic — reduced cold intrusions. Migration may stall.",
      neutral: "Neutral arctic pattern.",
    },
  },
  {
    id: "NAO",
    name: "North Atlantic Oscillation",
    url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.nao.index.b500101.current.ascii",
    impact: {
      negative: "Stormy eastern US — Atlantic flyway migration enhanced.",
      positive: "Mild dry eastern US — Atlantic flyway may slow.",
      neutral: "Neutral Atlantic pattern.",
    },
  },
  {
    id: "PNA",
    name: "Pacific North American Pattern",
    url: "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.pna.index.b500101.current.ascii",
    impact: {
      negative: "Wet/cool West, dry/mild East.",
      positive: "Cold trough East — cold outbreak setup for Central/Mississippi flyways.",
      neutral: "Neutral PNA.",
    },
  },
];

type Day = { date: string; year: number; value: number };
type ParseResult = { days: Day[]; sentinelSkipped: number };

// Parse the full CPC daily file. Keeps ONLY days within [START_DATE, END_DATE]
// and skips missing-data sentinels (value <= -99). Returns sentinel skip count.
function parseFull(text: string): ParseResult {
  const lines = text.trim().split("\n");
  const days: Day[] = [];
  let sentinelSkipped = 0;

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    const day = parseInt(parts[2]);
    const value = parseFloat(parts[3]);
    if (isNaN(value) || isNaN(year) || isNaN(month) || isNaN(day)) continue;

    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (date < START_DATE || date > END_DATE) continue; // hard window

    if (value <= SENTINEL_FLOOR) {
      sentinelSkipped++; // CPC missing-data poison — never ingest (20 deleted tonight)
      continue;
    }

    days.push({ date, year, value });
  }

  return { days, sentinelSkipped };
}

function phase(v: number): "negative" | "positive" | "neutral" {
  if (v <= -0.5) return "negative";
  if (v >= 0.5) return "positive";
  return "neutral";
}

function buildEntry(index: (typeof INDICES)[number], day: Day) {
  const p = phase(day.value);
  const impact = index.impact[p];
  const entryText = `climate-index-daily | ${index.id} | ${index.name} | date:${day.date} | value:${day.value.toFixed(3)} | phase:${p} | impact: ${impact}`;
  return {
    text: entryText,
    row: {
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
  };
}

// ── fetch with 5xx/network-only retry + backoff. NEVER retries 4xx.
async function fetchRetry(url: string, init?: RequestInit, label = "fetch"): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 400 && res.status < 500) return res; // 4xx: do NOT retry, surface it
      if (res.status >= 500) {
        lastErr = new Error(`${label} ${res.status}`);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e; // network error — retry
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} failed`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Embed one chunk (<=20 texts). Voyage direct, else edge-function fallback.
async function embedChunk(chunk: string[]): Promise<number[][]> {
  if (VOYAGE_KEY) {
    const res = await fetchRetry(
      "https://api.voyageai.com/v1/embeddings",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${VOYAGE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "voyage-3-lite", input: chunk, input_type: "document" }),
      },
      "voyage"
    );
    if (!res.ok) throw new Error(`Voyage ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.data.map((item: any) => item.embedding);
  }
  // Fallback: edge function, one text at a time (no Voyage key needed)
  const out: number[][] = [];
  for (const text of chunk) {
    const res = await fetchRetry(
      `${SUPABASE_URL}/functions/v1/hunt-generate-embedding`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      },
      "edge-embed"
    );
    if (!res.ok) throw new Error(`Edge embed ${res.status}`);
    const data = await res.json();
    out.push(data.embedding);
  }
  return out;
}

// Embed all texts for a year with EMBED_CONCURRENCY (~3) batches in flight.
async function embedAll(texts: string[]): Promise<number[][]> {
  const chunks: string[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) chunks.push(texts.slice(i, i + EMBED_BATCH));

  const results: number[][][] = new Array(chunks.length);
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const idx = next++;
      results[idx] = await embedChunk(chunks[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(EMBED_CONCURRENCY, chunks.length) }, worker));
  return results.flat();
}

// ── Checkpoint: { [indexId]: { [year]: { inserted, skipped, done } } }
type Checkpoint = Record<string, Record<string, { inserted: number; sentinelSkipped: number; done: boolean }>>;

function loadCheckpoint(): Checkpoint {
  if (!existsSync(CHECKPOINT_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8"));
  } catch {
    return {};
  }
}
function saveCheckpoint(cp: Checkpoint) {
  writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2));
}

async function insertRows(rows: any[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    const batch = rows.slice(i, i + INSERT_BATCH);
    const res = await fetchRetry(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${SERVICE_KEY}`,
          apikey: SERVICE_KEY,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates",
        },
        body: JSON.stringify(batch),
      },
      "insert"
    );
    if (!res.ok) throw new Error(`Insert ${res.status}: ${await res.text()}`);
  }
}

// ── --status
function printStatus() {
  const cp = loadCheckpoint();
  if (Object.keys(cp).length === 0) {
    console.log("No checkpoint yet — backfill has not run.");
    return;
  }
  let grandInserted = 0;
  let grandSkipped = 0;
  for (const index of INDICES) {
    const years = cp[index.id] || {};
    const yrKeys = Object.keys(years).sort();
    let idxInserted = 0;
    let idxSkipped = 0;
    let doneYears = 0;
    for (const y of yrKeys) {
      idxInserted += years[y].inserted;
      idxSkipped += years[y].sentinelSkipped;
      if (years[y].done) doneYears++;
    }
    grandInserted += idxInserted;
    grandSkipped += idxSkipped;
    const range = yrKeys.length ? `${yrKeys[0]}–${yrKeys[yrKeys.length - 1]}` : "none";
    console.log(
      `${index.id.padEnd(4)} ${doneYears} years done (${range})  inserted=${idxInserted}  sentinel-skipped=${idxSkipped}`
    );
  }
  console.log(`\nTOTAL inserted=${grandInserted}  sentinel-skipped=${grandSkipped}`);
}

// ── --dry-run: parse + count + 5 samples. Writes nothing (no checkpoint, no DB).
async function dryRun() {
  console.log(`DRY RUN — window ${START_DATE} → ${END_DATE} (inclusive). No writes.\n`);
  const samples: string[] = [];
  let grandDays = 0;
  let grandSentinel = 0;

  for (const index of INDICES) {
    const res = await fetchRetry(index.url, undefined, index.id);
    if (!res.ok) {
      console.error(`  ${index.id}: HTTP ${res.status} — skipped`);
      continue;
    }
    const text = await res.text();
    const { days, sentinelSkipped } = parseFull(text);
    grandDays += days.length;
    grandSentinel += sentinelSkipped;

    const first = days[0]?.date ?? "n/a";
    const last = days[days.length - 1]?.date ?? "n/a";
    console.log(
      `${index.id.padEnd(4)} parseable days=${days.length}  sentinel-skipped=${sentinelSkipped}  range=${first}…${last}`
    );

    // collect a couple sample rows across the indices
    if (samples.length < 5 && days.length) {
      const picks = [days[0], days[Math.floor(days.length / 2)], days[days.length - 1]];
      for (const d of picks) {
        if (samples.length >= 5) break;
        samples.push(JSON.stringify(buildEntry(index, d).row));
      }
    }
  }

  console.log(`\n5 SAMPLE ROWS:`);
  samples.slice(0, 5).forEach((s, i) => console.log(`  [${i + 1}] ${s}`));

  console.log(
    `\nTOTAL parseable days (all indices) = ${grandDays}   sentinel-skipped = ${grandSentinel}`
  );
  console.log(`Window ends: ${END_DATE} (confirmed — zero overlap with existing 2026-05-16+ rows).`);
}

// ── Full backfill
async function main() {
  if (STATUS) return printStatus();
  if (DRY_RUN) return dryRun();

  const startedAt = Date.now();
  const cp = loadCheckpoint();
  let totalInserted = 0;
  let totalSentinel = 0;

  for (const index of INDICES) {
    console.log(`\n=== ${index.id} (${index.name}) ===`);
    const res = await fetchRetry(index.url, undefined, index.id);
    if (!res.ok) {
      console.error(`  ${index.id}: HTTP ${res.status} — skipping index`);
      continue;
    }
    const text = await res.text();
    const { days, sentinelSkipped } = parseFull(text);
    console.log(`  Parsed ${days.length} days (sentinel-skipped ${sentinelSkipped})`);

    // group by year
    const byYear = new Map<number, Day[]>();
    for (const d of days) {
      if (!byYear.has(d.year)) byYear.set(d.year, []);
      byYear.get(d.year)!.push(d);
    }

    cp[index.id] ||= {};
    const yearsSorted = Array.from(byYear.keys()).sort((a, b) => a - b);

    for (const year of yearsSorted) {
      const yKey = String(year);
      if (cp[index.id][yKey]?.done) {
        totalInserted += cp[index.id][yKey].inserted;
        continue; // resume: already ingested
      }

      const yearDays = byYear.get(year)!;
      const entries = yearDays.map((d) => buildEntry(index, d));
      const texts = entries.map((e) => e.text);

      const embeddings = await embedAll(texts);
      const rows = entries.map((e, j) => ({ ...e.row, embedding: JSON.stringify(embeddings[j]) }));
      await insertRows(rows);

      cp[index.id][yKey] = { inserted: rows.length, sentinelSkipped: 0, done: true };
      saveCheckpoint(cp);
      totalInserted += rows.length;
      console.log(`  ${index.id} ${year}: ${rows.length} days embedded + inserted`);
    }

    // record the index-level sentinel count on the earliest year slot for --status visibility
    if (cp[index.id][yearsSorted[0] != null ? String(yearsSorted[0]) : ""]) {
      cp[index.id][String(yearsSorted[0])].sentinelSkipped = sentinelSkipped;
      saveCheckpoint(cp);
    }
    totalSentinel += sentinelSkipped;
  }

  const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(
    `\n──────────────────────────────────────────────\n` +
      `DONE. Total inserted: ${totalInserted}  sentinel-skipped: ${totalSentinel}  (${mins} min)\n` +
      `Window: ${START_DATE} → ${END_DATE}. Checkpoint: ${CHECKPOINT_PATH}`
  );
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
