/**
 * ComCat earthquake re-ingest — USGS FDSN ComCat M4.5+ US 1900→now → hunt_knowledge
 *
 * Kills the worst bug in the corpus (HORSE-RIDE-SCORECARD §3.1): the old capped
 * ingest kept 45,378 M3 rows and ZERO M7 ever, and stored no origin times — so
 * the archive called Ridgecrest aftershocks "foreshocks". This pipe re-pulls
 * ComCat uncapped with full timestamps, conforming to THE-WEEK.md row contract.
 *
 * CONTENT TYPE NOTE: the old broken corpus already occupies content_type
 * 'earthquake-event' (no source_event_id, no event_time_utc). Per the row
 * contract those rows are NOT modified or deleted; this pipe writes a NEW
 * distinct type 'earthquake-event-v2' so the clean corpus is never mingled
 * with the capped one. Old rows are separable later (they lack source_event_id).
 *
 * Two stages (style-match otd-ingest.ts):
 *   1. FETCH  — yearly windows × 4 US bounding boxes (CONUS, AK east/west of
 *               dateline, HI), minmagnitude=4.5, eventtype=earthquake,
 *               250ms spacing, staged to local JSONL; rerun never refetches.
 *   2. INGEST — normalize per row contract → batch idempotency check on
 *               metadata->>source_event_id → Voyage embed (≤20/batch, hard
 *               limit) → insert via REST. Checkpoint per batch; resumes clean;
 *               reruns are no-ops.
 *
 * Usage:
 *   npx tsx scripts/comcat-ingest.ts            # fetch (if needed) then ingest
 *   npx tsx scripts/comcat-ingest.ts --fetch    # fetch stage only
 *   npx tsx scripts/comcat-ingest.ts --ingest   # ingest stage only
 *   npx tsx scripts/comcat-ingest.ts --status   # show stage/checkpoint status
 *   npx tsx scripts/comcat-ingest.ts --verify   # post-run verification queries
 *
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI), VOYAGE_API_KEY (env or .env.local)
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const RAW_FILE = join(SCRIPTS_DIR, ".comcat-raw.jsonl");
const CHECKPOINT_FILE = join(SCRIPTS_DIR, ".comcat-checkpoint.json");

const USER_AGENT = "DuckCountdown/1.0 (duckcountdown.com; jayhillendalepress@gmail.com)";
const CONTENT_TYPE = "earthquake-event-v2"; // see CONTENT TYPE NOTE above
const EMBED_BATCH = 20; // HARD LIMIT — Voyage times out above 20
const FETCH_SPACING_MS = 250;
const MIN_MAG = 4.5;
const START_YEAR = 1900;
const FDSN = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const FDSN_CAP = 20_000; // API hard cap per query — yearly windows must stay under it

// ─── US bounding boxes (AK split at the antimeridian — FDSN-safe) ───────────
const BOXES: { key: string; minLat: number; maxLat: number; minLon: number; maxLon: number }[] = [
  { key: "conus", minLat: 24.4, maxLat: 49.5, minLon: -125.0, maxLon: -66.5 },
  { key: "ak-e", minLat: 50.0, maxLat: 72.0, minLon: -180.0, maxLon: -129.9 },
  { key: "ak-w", minLat: 50.0, maxLat: 72.0, minLon: 170.0, maxLon: 180.0 },
  { key: "hi", minLat: 18.5, maxLat: 22.5, minLon: -161.0, maxLon: -154.5 },
];

// ─── Approximate state bounding boxes (lat/lng → state_abbr, null if offshore/ambiguous) ───
const STATE_BBOX: Record<string, [number, number, number, number]> = {
  // [minLat, maxLat, minLon, maxLon]
  AL: [30.2, 35.0, -88.5, -84.9], AZ: [31.3, 37.0, -114.8, -109.0], AR: [33.0, 36.5, -94.6, -89.6],
  CA: [32.5, 42.0, -124.4, -114.1], CO: [36.99, 41.0, -109.06, -102.04], CT: [40.98, 42.05, -73.73, -71.79],
  DE: [38.45, 39.84, -75.79, -75.05], FL: [24.5, 31.0, -87.6, -80.0], GA: [30.36, 35.0, -85.6, -80.84],
  HI: [18.9, 22.24, -160.25, -154.8], ID: [42.0, 49.0, -117.24, -111.04], IL: [36.97, 42.5, -91.5, -87.5],
  IN: [37.77, 41.76, -88.1, -84.78], IA: [40.38, 43.5, -96.64, -90.14], KS: [36.99, 40.0, -102.05, -94.59],
  KY: [36.5, 39.15, -89.57, -81.96], LA: [28.9, 33.02, -94.04, -88.82], ME: [43.06, 47.46, -71.08, -66.95],
  MD: [37.89, 39.72, -79.49, -75.05], MA: [41.24, 42.89, -73.51, -69.93], MI: [41.7, 48.3, -90.42, -82.12],
  MN: [43.5, 49.38, -97.24, -89.49], MS: [30.17, 35.0, -91.65, -88.1], MO: [35.99, 40.61, -95.77, -89.1],
  MT: [44.36, 49.0, -116.05, -104.04], NE: [40.0, 43.0, -104.05, -95.31], NV: [35.0, 42.0, -120.0, -114.04],
  NH: [42.7, 45.3, -72.56, -70.7], NJ: [38.93, 41.36, -75.56, -73.89], NM: [31.33, 37.0, -109.05, -103.0],
  NY: [40.5, 45.02, -79.76, -71.86], NC: [33.84, 36.59, -84.32, -75.46], ND: [45.94, 49.0, -104.05, -96.55],
  OH: [38.4, 41.98, -84.82, -80.52], OK: [33.62, 37.0, -103.0, -94.43], OR: [41.99, 46.29, -124.57, -116.46],
  PA: [39.72, 42.27, -80.52, -74.69], RI: [41.15, 42.02, -71.86, -71.12], SC: [32.03, 35.22, -83.35, -78.54],
  SD: [42.48, 45.95, -104.06, -96.44], TN: [34.98, 36.68, -90.31, -81.65], TX: [25.84, 36.5, -106.65, -93.51],
  UT: [37.0, 42.0, -114.05, -109.04], VT: [42.73, 45.02, -73.44, -71.46], VA: [36.54, 39.47, -83.68, -75.24],
  WA: [45.54, 49.0, -124.85, -116.92], WV: [37.2, 40.64, -82.64, -77.72], WI: [42.49, 47.08, -92.89, -86.25],
  WY: [41.0, 45.0, -111.05, -104.05],
  // Alaska spans the antimeridian — two boxes, checked specially below
};

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const STATE_ABBRS = new Set(Object.values(STATE_NAMES));

function bboxCandidates(lat: number, lng: number): string[] {
  const out: string[] = [];
  for (const [abbr, [minLat, maxLat, minLon, maxLon]] of Object.entries(STATE_BBOX)) {
    if (lat >= minLat && lat <= maxLat && lng >= minLon && lng <= maxLon) out.push(abbr);
  }
  // Alaska: two boxes across the antimeridian
  if (lat >= 51.2 && lat <= 71.4 && ((lng >= -179.99 && lng <= -129.97) || (lng >= 172.4 && lng <= 180))) {
    out.push("AK");
  }
  return out;
}

/** State from the USGS place string, e.g. "16km ESE of Ridgecrest, CA" or "..., California". */
function placeState(place: string): string | null {
  const tail = place.split(",").pop()?.trim().toLowerCase() || "";
  if (STATE_NAMES[tail]) return STATE_NAMES[tail];
  const upper = tail.toUpperCase();
  if (upper.length === 2 && STATE_ABBRS.has(upper)) return upper;
  return null;
}

/**
 * CA/NV is the one bbox overlap that matters seismically (eastern CA / western NV),
 * and the real border is clean geometry: lon -120 north of lat 39, then a straight
 * diagonal from (39, -120) to (35, -114.633) at the Colorado River. Deterministic,
 * not a guess.
 */
function caNvSide(lat: number, lng: number): "CA" | "NV" {
  if (lng <= -120) return "CA";
  if (lat >= 39) return "NV";
  const borderLng = -120 + (39 - lat) * ((120 - 114.633) / (39 - 35));
  return lng < borderLng ? "CA" : "NV";
}

/**
 * Resolve state_abbr: bbox candidates from lat/lng; exactly one → use it;
 * several (bboxes overlap) → place-string tiebreak if it's a candidate, then the
 * CA/NV geometric border; anything else ambiguous → null. Zero (offshore) → null.
 * NEVER guesses.
 */
function resolveState(lat: number, lng: number, place: string): string | null {
  const candidates = bboxCandidates(lat, lng);
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  const fromPlace = placeState(place);
  if (fromPlace && candidates.includes(fromPlace)) return fromPlace;
  if (candidates.length === 2 && candidates.includes("CA") && candidates.includes("NV")) {
    return caNvSide(lat, lng);
  }
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Key bootstrap (same pattern as otd-ingest.ts) ──────────────────────────
function bootstrapKeys(needVoyage: boolean) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const out = execSync(
        "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null",
        { encoding: "utf-8", timeout: 30_000 }
      ).trim();
      let key = "";
      try {
        const parsed = JSON.parse(out);
        key = (parsed.keys || parsed || []).find?.((k: any) => k.name === "service_role" || k.id === "service_role")?.api_key || "";
      } catch {
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

  if (!needVoyage) return;
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
class FatalHttpError extends Error {}
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

// ─── Stage 1: FETCH ─────────────────────────────────────────────────────────
type RawWindow = { key: string; features: any[] }; // key = `${box}:${year}`

function windowKeys(): string[] {
  const endYear = new Date().getUTCFullYear();
  const keys: string[] = [];
  for (const box of BOXES) {
    for (let y = START_YEAR; y <= endYear; y++) keys.push(`${box.key}:${y}`);
  }
  return keys;
}

function loadRawWindows(): Map<string, any[]> {
  const map = new Map<string, any[]>();
  if (!existsSync(RAW_FILE)) return map;
  for (const line of readFileSync(RAW_FILE, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const w: RawWindow = JSON.parse(line);
      map.set(w.key, w.features);
    } catch {
      /* skip corrupt line — will refetch that window */
    }
  }
  return map;
}

async function fetchStage() {
  const staged = loadRawWindows();
  const all = windowKeys();
  const missing = all.filter((k) => !staged.has(k));
  console.log(`\n=== FETCH STAGE === ${staged.size}/${all.length} windows already staged, ${missing.length} to fetch`);

  for (let i = 0; i < missing.length; i++) {
    const key = missing[i];
    const [boxKey, yearStr] = key.split(":");
    const box = BOXES.find((b) => b.key === boxKey)!;
    const year = Number(yearStr);
    const params = new URLSearchParams({
      format: "geojson",
      starttime: `${year}-01-01T00:00:00`,
      endtime: `${year + 1}-01-01T00:00:00`,
      minmagnitude: String(MIN_MAG),
      eventtype: "earthquake",
      minlatitude: String(box.minLat),
      maxlatitude: String(box.maxLat),
      minlongitude: String(box.minLon),
      maxlongitude: String(box.maxLon),
      orderby: "time-asc",
    });
    const res = await fetchWithRetry(`${FDSN}?${params}`, { headers: { "User-Agent": USER_AGENT } }, `ComCat ${key}`);
    const data = await res.json();
    const features = Array.isArray(data.features) ? data.features : [];
    if (features.length >= FDSN_CAP) {
      throw new Error(`${key} returned ${features.length} features — hit the FDSN cap, window must be split. ABORT.`);
    }
    appendFileSync(RAW_FILE, JSON.stringify({ key, features }) + "\n");
    staged.set(key, features);
    if ((i + 1) % 25 === 0 || i === missing.length - 1) {
      console.log(`  fetched ${i + 1}/${missing.length} (latest ${key}: ${features.length} events)`);
    }
    await sleep(FETCH_SPACING_MS);
  }

  let total = 0;
  for (const features of staged.values()) total += features.length;
  console.log(`FETCH COMPLETE: ${staged.size}/${all.length} windows, ${total} raw features staged in ${RAW_FILE}`);
  return staged;
}

// ─── Normalize (THE-WEEK.md row contract) ───────────────────────────────────
type Row = {
  title: string;
  content: string;
  content_type: string;
  tags: string[];
  state_abbr: string | null;
  effective_date: string;
  metadata: Record<string, any>;
};

function magBucket(mag: number): string {
  if (mag >= 8) return "magnitude-8";
  if (mag >= 7) return "magnitude-7";
  if (mag >= 6) return "magnitude-6";
  if (mag >= 5) return "magnitude-5";
  return "magnitude-4";
}

function normalizeFeature(f: any): Row | null {
  const id = f?.id;
  const props = f?.properties || {};
  const coords = f?.geometry?.coordinates;
  if (!id || typeof id !== "string") return null;
  if (typeof props.time !== "number") return null; // contract: quakes MUST carry event_time_utc
  if (typeof props.mag !== "number" || props.mag < MIN_MAG) return null;
  if (!Array.isArray(coords) || typeof coords[0] !== "number" || typeof coords[1] !== "number") return null;

  const [lng, lat, depthKmRaw] = coords;
  const eventTime = new Date(props.time);
  if (isNaN(eventTime.getTime())) return null;
  const event_time_utc = eventTime.toISOString();
  const effective_date = event_time_utc.slice(0, 10);
  const mag = Math.round(props.mag * 10) / 10;
  const depth_km = typeof depthKmRaw === "number" ? Math.round(depthKmRaw * 10) / 10 : null;
  const place = (props.place || "").trim() || `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
  const provenance_url = props.url || `https://earthquake.usgs.gov/earthquakes/eventpage/${id}`;
  const state_abbr = resolveState(lat, lng, place);

  const content =
    `earthquake | M${mag} | ${place} | ${effective_date} ${event_time_utc.slice(11, 19)} UTC` +
    ` | depth:${depth_km ?? "unknown"}km | ${state_abbr ?? "offshore/unresolved"}` +
    (typeof props.felt === "number" ? ` | felt:${props.felt}` : "");

  return {
    title: `M${mag} — ${place} — ${effective_date}`,
    content,
    content_type: CONTENT_TYPE,
    tags: ["earthquake", "seismic", magBucket(mag), ...(state_abbr ? [state_abbr] : [])],
    state_abbr,
    effective_date,
    metadata: {
      source: "usgs-comcat",
      source_event_id: id,
      event_time_utc,
      magnitude: mag,
      depth_km,
      lat,
      lng,
      place,
      ...(typeof props.felt === "number" ? { felt: props.felt } : {}),
      provenance_url,
      granularity: "point",
    },
  };
}

function normalizeAll(staged: Map<string, any[]>): Row[] {
  const byId = new Map<string, Row>();
  let unusable = 0;
  for (const features of staged.values()) {
    for (const f of features) {
      const row = normalizeFeature(f);
      if (!row) {
        unusable++;
        continue;
      }
      byId.set(row.metadata.source_event_id, row); // dedup across windows/boxes
    }
  }
  const rows = [...byId.values()].sort((a, b) =>
    a.metadata.event_time_utc.localeCompare(b.metadata.event_time_utc)
  );
  console.log(`Normalized: ${rows.length} unique events (${unusable} unusable/filtered)`);
  return rows;
}

// ─── Checkpoint ──────────────────────────────────────────────────────────────
type Checkpoint = { nextPage: number; pageSize: number; inserted: number };

function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8"));
    } catch {
      console.log("WARN: corrupt checkpoint, starting fresh (source_event_id check prevents dupes)");
    }
  }
  return { nextPage: 0, pageSize: 200, inserted: 0 };
}

function saveCheckpoint(cp: Checkpoint) {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2) + "\n");
}

// ─── Stage 2: INGEST ─────────────────────────────────────────────────────────
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

/** Batch-check which source_event_ids already exist (chunks of 100, bounded limit). */
async function existingIds(ids: string[]): Promise<Set<string>> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const url =
      `${SUPABASE_URL}/rest/v1/hunt_knowledge` +
      `?content_type=eq.${CONTENT_TYPE}` +
      `&metadata->>source_event_id=in.(${chunk.map((s) => `"${s}"`).join(",")})` +
      `&select=metadata->>source_event_id&limit=${chunk.length}`;
    const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${key}`, apikey: key } }, "existing-ids");
    const rows = await res.json();
    for (const r of Array.isArray(rows) ? rows : []) {
      const id = r.source_event_id ?? Object.values(r)[0];
      if (id) found.add(String(id));
    }
  }
  return found;
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
  const rows = normalizeAll(staged);
  const cp = loadCheckpoint();
  const pages = Math.ceil(rows.length / cp.pageSize);
  console.log(`\n=== INGEST STAGE === ${rows.length} rows in ${pages} pages of ${cp.pageSize}, resuming at page ${cp.nextPage} (${cp.inserted} inserted so far)`);

  let inserted = 0;
  let skippedExisting = 0;

  for (let p = cp.nextPage; p < pages; p++) {
    const page = rows.slice(p * cp.pageSize, (p + 1) * cp.pageSize);
    const present = await existingIds(page.map((r) => r.metadata.source_event_id));
    const fresh = page.filter((r) => !present.has(r.metadata.source_event_id));
    skippedExisting += page.length - fresh.length;

    for (let b = 0; b * EMBED_BATCH < fresh.length; b++) {
      const batch = fresh.slice(b * EMBED_BATCH, (b + 1) * EMBED_BATCH);
      const embeddings = await embed(batch.map((r) => r.content));
      if (embeddings.length !== batch.length) throw new Error(`Voyage returned ${embeddings.length} for ${batch.length} inputs`);
      await insertRows(batch, embeddings);
      inserted += batch.length;
      cp.inserted += batch.length;
      saveCheckpoint(cp); // mid-page checkpoint is safe — id check makes reruns no-ops
      await sleep(150);
    }

    cp.nextPage = p + 1;
    saveCheckpoint(cp);
    if ((p + 1) % 10 === 0 || p === pages - 1) {
      console.log(`  page ${p + 1}/${pages} — run total ${inserted} inserted, ${skippedExisting} already present`);
    }
  }

  console.log(`\nINGEST COMPLETE: ${inserted} rows inserted this run, ${skippedExisting} skipped as already present, ${cp.inserted} inserted lifetime`);

  // Local band summary (of the full normalized corpus)
  const bands: Record<string, number> = {};
  for (const r of rows) bands[magBucket(r.metadata.magnitude)] = (bands[magBucket(r.metadata.magnitude)] || 0) + 1;
  console.log("Corpus by band:", JSON.stringify(bands));
}

// ─── Verify ──────────────────────────────────────────────────────────────────
async function countWhere(filter: string): Promise<number> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetchWithRetry(
    `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.${CONTENT_TYPE}&${filter}&select=id&limit=1`,
    { method: "HEAD", headers: { Authorization: `Bearer ${key}`, apikey: key, Prefer: "count=exact" } },
    "count"
  );
  return Number(res.headers.get("content-range")?.split("/")[1] ?? -1);
}

async function queryRows(filter: string): Promise<any[]> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetchWithRetry(
    `${SUPABASE_URL}/rest/v1/hunt_knowledge?content_type=eq.${CONTENT_TYPE}&${filter}`,
    { headers: { Authorization: `Bearer ${key}`, apikey: key } },
    "verify-query"
  );
  return res.json();
}

async function verify() {
  console.log("\n=== VERIFY ===");

  console.log("\n(a) Counts by magnitude band:");
  for (const band of ["magnitude-4", "magnitude-5", "magnitude-6", "magnitude-7", "magnitude-8"]) {
    console.log(`  ${band}: ${await countWhere(`tags=cs.{${band}}`)}`);
  }
  console.log(`  TOTAL: ${await countWhere("id=not.is.null")}`);

  console.log("\n(b) Ridgecrest 2019 (must show M6.4 on 07-04 and M7.1 on 07-05, with event_time_utc):");
  const ridgecrest = await queryRows(
    "effective_date=gte.2019-07-04&effective_date=lte.2019-07-06&metadata->>magnitude=gte.6" +
      "&select=title,state_abbr,metadata->>event_time_utc,metadata->>magnitude,metadata->>source_event_id&order=effective_date.asc"
  );
  for (const r of ridgecrest) console.log(`  ${JSON.stringify(r)}`);

  console.log("\n(c) Named quakes present:");
  const named: [string, string][] = [
    ["Landers 1992", "effective_date=eq.1992-06-28&metadata->>magnitude=gte.7"],
    ["Northridge 1994", "effective_date=eq.1994-01-17&metadata->>magnitude=gte.6.5"],
    ["Hector Mine 1999", "effective_date=eq.1999-10-16&metadata->>magnitude=gte.7"],
    ["Napa 2014", "effective_date=eq.2014-08-24&metadata->>magnitude=gte.6"],
  ];
  for (const [label, filter] of named) {
    const rows = await queryRows(`${filter}&select=title,metadata->>event_time_utc,metadata->>source_event_id&limit=5`);
    console.log(`  ${label}: ${rows.length ? rows.map((r: any) => `${r.title} @ ${r.event_time_utc}`).join(" | ") : "MISSING"}`);
  }

  console.log("\n(d) Row-contract sample (10 rows — every field must be present):");
  const sample = await queryRows("select=title,state_abbr,effective_date,metadata&limit=10&order=effective_date.desc");
  const required = ["source_event_id", "event_time_utc", "magnitude", "lat", "lng", "place", "provenance_url", "granularity"];
  let ok = 0;
  for (const r of sample) {
    const missing = required.filter((f) => r.metadata?.[f] === undefined || r.metadata?.[f] === null);
    // depth_km may be null (some historic events lack depth) — report separately
    if (missing.length === 0) ok++;
    else console.log(`  CONTRACT VIOLATION: "${r.title}" missing ${missing.join(",")}`);
  }
  console.log(`  ${ok}/${sample.length} sample rows pass the contract (depth_km nullable for pre-instrumental events)`);
}

// ─── Status ──────────────────────────────────────────────────────────────────
function status() {
  const staged = loadRawWindows();
  let total = 0;
  for (const f of staged.values()) total += f.length;
  console.log(`Fetch: ${staged.size}/${windowKeys().length} windows staged, ${total} raw features (${RAW_FILE})`);
  const cp = loadCheckpoint();
  console.log(`Ingest: page ${cp.nextPage} next, ${cp.inserted} rows inserted lifetime`);
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const arg = process.argv[2] || "";
  if (arg === "--status") return status();

  console.log(`ComCat re-ingest — USGS FDSN M${MIN_MAG}+ US ${START_YEAR}→now → hunt_knowledge (${CONTENT_TYPE})`);

  if (arg === "--verify") {
    bootstrapKeys(false);
    return verify();
  }

  bootstrapKeys(arg !== "--fetch");

  if (arg === "--ingest") {
    const staged = loadRawWindows();
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
