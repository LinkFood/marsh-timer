/**
 * On-This-Day ingestion — Wikipedia "On This Day" EVENTS → hunt_knowledge
 *
 * Gives every calendar day historical-significance coverage (JUL5-GAP-REPORT §2A).
 * Events only — births/deaths/holidays are a separate future pipe.
 *
 * Two stages:
 *   1. FETCH  — 366 GETs to api.wikimedia.org (250ms spacing), staged to a local
 *               JSONL checkpoint so a rerun never refetches.
 *   2. INGEST — normalize → idempotency check per day → Voyage embed (≤20/batch,
 *               hard limit) → insert into hunt_knowledge via REST. Checkpoint
 *               after every batch; resumes cleanly.
 *
 * Usage:
 *   npx tsx scripts/otd-ingest.ts            # fetch (if needed) then ingest
 *   npx tsx scripts/otd-ingest.ts --fetch    # fetch stage only
 *   npx tsx scripts/otd-ingest.ts --ingest   # ingest stage only
 *   npx tsx scripts/otd-ingest.ts --status   # show stage/checkpoint status
 *
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI), VOYAGE_API_KEY (env or .env.local)
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const RAW_FILE = join(SCRIPTS_DIR, ".otd-raw.jsonl");
const CHECKPOINT_FILE = join(SCRIPTS_DIR, ".otd-checkpoint.json");

const USER_AGENT = "DuckCountdown/1.0 (duckcountdown.com; jayhillendalepress@gmail.com)";
const CONTENT_TYPE = "onthisday-event";
const EMBED_BATCH = 20; // HARD LIMIT — Voyage times out above 20
const FETCH_SPACING_MS = 250;

// ─── All 366 MM-DD keys (2024 = leap year) ─────────────────────────────────
const DAYS: string[] = [];
for (let m = 1; m <= 12; m++) {
  const daysInMonth = new Date(Date.UTC(2024, m, 0)).getUTCDate();
  for (let d = 1; d <= daysInMonth; d++) {
    DAYS.push(`${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Key bootstrap (same pattern as orchestrator-v2.ts) ─────────────────────
function bootstrapKeys() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const out = execSync(
        "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null",
        { encoding: "utf-8", timeout: 30_000 }
      ).trim();
      let key = "";
      try {
        // Newer CLI emits JSON: {"keys":[{"name":"service_role","api_key":"ey..."}]}
        const parsed = JSON.parse(out);
        key = (parsed.keys || parsed || []).find?.((k: any) => k.name === "service_role" || k.id === "service_role")?.api_key || "";
      } catch {
        // Older CLI table format: "service_role  ey..."
        const line = out.split("\n").find((l) => l.includes("service_role"));
        key = line ? line.trim().split(/\s+/).pop() || "" : "";
      }
      if (key && key.startsWith("ey")) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = key;
        console.log("  ✓ SUPABASE_SERVICE_ROLE_KEY — fetched from CLI");
      } else {
        console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI returned empty. Cannot continue.");
        process.exit(1);
      }
    } catch {
      console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI fetch failed. Export it and rerun.");
      process.exit(1);
    }
  } else {
    console.log("  ✓ SUPABASE_SERVICE_ROLE_KEY — from environment");
  }

  if (!process.env.VOYAGE_API_KEY) {
    const envLocalPath = join(SCRIPTS_DIR, "..", ".env.local");
    if (existsSync(envLocalPath)) {
      for (const line of readFileSync(envLocalPath, "utf-8").split("\n")) {
        const match = line.match(/^VOYAGE_API_KEY=(.+)$/);
        if (match) {
          process.env.VOYAGE_API_KEY = match[1].trim();
          console.log("  ✓ VOYAGE_API_KEY — from .env.local");
        }
      }
    }
  } else {
    console.log("  ✓ VOYAGE_API_KEY — from environment");
  }
  if (!process.env.VOYAGE_API_KEY) {
    console.error("  ✗ VOYAGE_API_KEY required for ingest stage.");
    process.exit(1);
  }
}

// ─── Retry helper — 5xx/network only, NEVER 4xx ─────────────────────────────
async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 5): Promise<Response> {
  let lastErr: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = (await res.text()).slice(0, 300);
      if (res.status >= 400 && res.status < 500) {
        throw new FatalHttpError(`${label} ${res.status} (4xx, no retry): ${body}`);
      }
      lastErr = new Error(`${label} ${res.status}: ${body}`);
    } catch (err: any) {
      if (err instanceof FatalHttpError) throw err;
      lastErr = err;
    }
    if (attempt < attempts) {
      const wait = Math.min(2000 * 2 ** (attempt - 1), 30_000);
      console.log(`  ${label}: attempt ${attempt} failed (${String(lastErr).slice(0, 120)}), retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw lastErr;
}
class FatalHttpError extends Error {}

// ─── Stage 1: FETCH ─────────────────────────────────────────────────────────
type RawDay = { mmdd: string; events: any[] };

function loadRawDays(): Map<string, any[]> {
  const map = new Map<string, any[]>();
  if (!existsSync(RAW_FILE)) return map;
  for (const line of readFileSync(RAW_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const day: RawDay = JSON.parse(line);
      map.set(day.mmdd, day.events);
    } catch {
      /* skip corrupt line — will refetch that day */
    }
  }
  return map;
}

async function fetchStage() {
  const staged = loadRawDays();
  const missing = DAYS.filter((d) => !staged.has(d));
  console.log(`\n=== FETCH STAGE === ${staged.size}/366 days already staged, ${missing.length} to fetch`);

  for (let i = 0; i < missing.length; i++) {
    const mmdd = missing[i];
    const [mm, dd] = mmdd.split("-");
    const url = `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${mm}/${dd}`;
    const res = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT } }, `OTD ${mmdd}`);
    const data = await res.json();
    const events = Array.isArray(data.events) ? data.events : [];
    appendFileSync(RAW_FILE, JSON.stringify({ mmdd, events }) + "\n");
    staged.set(mmdd, events);
    if ((i + 1) % 30 === 0 || i === missing.length - 1) {
      console.log(`  fetched ${i + 1}/${missing.length} (latest ${mmdd}: ${events.length} events)`);
    }
    await sleep(FETCH_SPACING_MS);
  }

  let total = 0;
  for (const events of staged.values()) total += events.length;
  console.log(`FETCH COMPLETE: ${staged.size}/366 days, ${total} raw events staged in ${RAW_FILE}`);
  for (const sample of ["01-01", "02-29", "07-05", "12-25"]) {
    console.log(`  sample ${sample}: ${staged.get(sample)?.length ?? 0} events`);
  }
  return staged;
}

// ─── Normalize ───────────────────────────────────────────────────────────────
type Row = {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  state_abbr: null;
  effective_date: string;
  metadata: Record<string, any>;
};

function isValidDate(year: number, mm: string, dd: string): boolean {
  const d = new Date(Date.UTC(2024, Number(mm) - 1, Number(dd))); // day validity vs leap handled below
  if (d.getUTCMonth() !== Number(mm) - 1 || d.getUTCDate() !== Number(dd)) return false;
  if (mm === "02" && dd === "29") {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }
  return true;
}

function normalizeEvent(mmdd: string, ev: any): Row | null {
  const year = ev?.year;
  const text = (ev?.text || "").trim();
  if (!text) return null;
  if (typeof year !== "number" || !Number.isInteger(year) || year < 1 || year > 9999) return null;
  const [mm, dd] = mmdd.split("-");
  if (!isValidDate(year, mm, dd)) return null;

  const pages: any[] = Array.isArray(ev.pages) ? ev.pages : [];
  const pageTitles = pages
    .map((p) => (p?.titles?.normalized || p?.title || "").trim())
    .filter(Boolean);
  const url = pages.map((p) => p?.content_urls?.desktop?.page).find(Boolean) || null;
  if (!url) return null; // provenance URL is mandatory — honesty law

  const coordPage = pages.find((p) => p?.coordinates && typeof p.coordinates.lat === "number");
  const coordinates = coordPage ? { lat: coordPage.coordinates.lat, lon: coordPage.coordinates.lon } : undefined;

  const effective_date = `${String(year).padStart(4, "0")}-${mm}-${dd}`;
  const content = pageTitles.length ? `${text} | pages: ${pageTitles.join(", ")}` : text;

  return {
    title: `${year}: ${text.slice(0, 80)}`,
    content,
    content_type: CONTENT_TYPE,
    tags: ["onthisday", "event"],
    state_abbr: null,
    effective_date,
    metadata: {
      mmdd,
      year,
      source: "wikipedia-onthisday",
      url,
      ...(coordinates ? { coordinates } : {}),
      pages: pageTitles,
    },
  };
}

// ─── Checkpoint ──────────────────────────────────────────────────────────────
type Checkpoint = {
  completed: Record<string, number>; // mmdd → rows inserted
  inProgress?: { mmdd: string; batch: number };
};

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
    } catch {
      console.log("WARN: corrupt checkpoint, starting fresh (idempotency check prevents dupes)");
    }
  }
  return { completed: {} };
}

function saveCheckpoint(cp: Checkpoint) {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2) + "\n");
}

// ─── Stage 2: INGEST (embed + insert) ────────────────────────────────────────
async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetchWithRetry(
    "https://api.voyageai.com/v1/embeddings",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "voyage-3-lite", input: texts, input_type: "document" }),
    },
    "Voyage"
  );
  const data = await res.json();
  if (!Array.isArray(data.data)) throw new Error("Voyage returned no data array");
  return data.data.map((d: any) => d.embedding);
}

async function existingTitles(mmdd: string): Promise<Set<string>> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const url =
    `${SUPABASE_URL}/rest/v1/hunt_knowledge` +
    `?content_type=eq.${CONTENT_TYPE}&metadata->>mmdd=eq.${mmdd}&select=title&limit=1000`;
  const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${key}`, apikey: key } }, `existing ${mmdd}`);
  const rows = await res.json();
  return new Set((Array.isArray(rows) ? rows : []).map((r: any) => r.title));
}

async function insertRows(rows: Row[], embeddings: number[][]) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const payload = rows.map((r, i) => ({ ...r, embedding: JSON.stringify(embeddings[i]) }));
  await fetchWithRetry(
    `${SUPABASE_URL}/rest/v1/hunt_knowledge`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    },
    "insert"
  );
}

async function ingestStage(staged: Map<string, any[]>) {
  const cp = loadCheckpoint();
  const pending = DAYS.filter((d) => staged.has(d) && cp.completed[d] === undefined);
  const doneRows = Object.values(cp.completed).reduce((a, b) => a + b, 0);
  console.log(`\n=== INGEST STAGE === ${Object.keys(cp.completed).length}/366 days done (${doneRows} rows), ${pending.length} days pending`);

  let inserted = 0;
  let skippedExisting = 0;
  let skippedUnusable = 0;
  const failedDays: string[] = [];

  for (const mmdd of pending) {
    try {
      const raw = staged.get(mmdd)!;
      const already = await existingTitles(mmdd);

      const rows: Row[] = [];
      const seen = new Set<string>(already);
      for (const ev of raw) {
        const row = normalizeEvent(mmdd, ev);
        if (!row) {
          skippedUnusable++;
          continue;
        }
        if (seen.has(row.title)) {
          skippedExisting++;
          continue;
        }
        seen.add(row.title);
        rows.push(row);
      }

      for (let b = 0; b * EMBED_BATCH < rows.length; b++) {
        const batch = rows.slice(b * EMBED_BATCH, (b + 1) * EMBED_BATCH);
        const embeddings = await embed(batch.map((r) => `${r.effective_date} | on this day | ${r.content}`));
        if (embeddings.length !== batch.length) throw new Error(`Voyage returned ${embeddings.length} for ${batch.length} inputs`);
        await insertRows(batch, embeddings);
        inserted += batch.length;
        cp.inProgress = { mmdd, batch: b };
        saveCheckpoint(cp);
        await sleep(150);
      }

      cp.completed[mmdd] = rows.length;
      delete cp.inProgress;
      saveCheckpoint(cp);
      console.log(`  ${mmdd}: +${rows.length} inserted (${already.size} pre-existing) — run total ${inserted}`);
    } catch (err: any) {
      failedDays.push(mmdd);
      console.error(`  ${mmdd}: FAILED — ${String(err).slice(0, 200)} (will retry on rerun)`);
    }
  }

  console.log(`\nINGEST COMPLETE: ${inserted} rows inserted this run, ${skippedExisting} skipped as already present, ${skippedUnusable} unusable (no year/text/url)`);
  if (failedDays.length) {
    console.log(`FAILED DAYS (${failedDays.length}): ${failedDays.join(", ")} — rerun the script to retry them.`);
    process.exitCode = 1;
  }
}

// ─── Status ──────────────────────────────────────────────────────────────────
function status() {
  const staged = loadRawDays();
  let total = 0;
  for (const events of staged.values()) total += events.length;
  console.log(`Fetch: ${staged.size}/366 days staged, ${total} raw events (${RAW_FILE})`);
  const cp = loadCheckpoint();
  const doneRows = Object.values(cp.completed).reduce((a, b) => a + b, 0);
  console.log(`Ingest: ${Object.keys(cp.completed).length}/366 days completed, ${doneRows} rows inserted`);
  if (cp.inProgress) console.log(`In progress: ${cp.inProgress.mmdd} batch ${cp.inProgress.batch}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const arg = process.argv[2] || "";
  if (arg === "--status") return status();

  console.log("OTD ingest — Wikipedia On-This-Day events → hunt_knowledge");
  bootstrapKeys();

  if (arg === "--ingest") {
    const staged = loadRawDays();
    if (staged.size === 0) {
      console.error("No staged data — run fetch stage first.");
      process.exit(1);
    }
    await ingestStage(staged);
    return;
  }

  const staged = await fetchStage();
  if (arg === "--fetch") return;
  await ingestStage(staged);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
