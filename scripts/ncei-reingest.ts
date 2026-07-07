/**
 * NCEI Storm Events FULL re-ingest — PIPE 2 of THE-WEEK sprint.
 *
 * WHY (docs/HORSE-RIDE-SCORECARD.md): the v1 storm-event corpus (~1.5M rows) is
 * 15-25% undercounted (Katrina), 7x undercounted with zeroed deaths (Uri: 93 of
 * 665 TX rows, deaths:0 vs real 131 / $277M), type-filtered (no Hurricane /
 * Storm Surge/Tide / High Wind / waterspout rows — Sandy's NJ $24.96B recorded
 * as '0K'), duplicated up to TRIPLICATE, and stale (NCEI backfills casualties
 * months late).
 *
 * THE ROW CONTRACT (docs/THE-WEEK.md, locked 2026-07-05) — every row carries:
 *   metadata.source_event_id  = NCEI EVENT_ID (dedup key, idempotent upserts)
 *   metadata.event_time_utc   = BEGIN_DATE parts + CZ_TIMEZONE offset (null when
 *                               the source time/tz is unusable — never guessed)
 *   metadata.deaths/injuries  = DIRECT + INDIRECT, numeric
 *   metadata.damage_usd       = parsed DAMAGE_PROPERTY + DAMAGE_CROPS ("750M" → 750000000)
 *   metadata.provenance_url   = NCEI event-details page
 *   metadata.granularity      = "point" when lat/lng present, else "county"
 *   metadata.ingest_v         = 2  (v1 rows lack source_event_id — that IS the discriminator)
 *
 * SUPERSEDE, NEVER DELETE BLIND: the --supersede phase (separate run, AFTER the
 * re-ingest lands + spot-verifies) marks v1 rows metadata.superseded=true via a
 * server-side batched RPC (migration 20260705120000_mark_storm_v1_superseded.sql
 * — push it before running --supersede). Old rows stay queryable until the
 * post-week archive decision.
 *
 * Stages / usage:
 *   npx tsx scripts/ncei-reingest.ts --dry-run FILE [FILE...]  # parse local CSV/.gz only, print
 *                                                              # stats + scorecard verification windows.
 *                                                              # NO network, NO database, NO embeds.
 *   npx tsx scripts/ncei-reingest.ts --estimate                # fetch NCEI dir listing, project total
 *                                                              # rows / runtime / Voyage cost. Read-only.
 *   npx tsx scripts/ncei-reingest.ts [--years 1950-2026]       # THE RUN (write pipe — one at a time):
 *                                                              # download → parse → embed → insert,
 *                                                              # checkpointed per year, nohup-ready.
 *   npx tsx scripts/ncei-reingest.ts --supersede               # phase 2 (separate run): mark v1 rows
 *                                                              # superseded via RPC, 5k/batch.
 *   npx tsx scripts/ncei-reingest.ts --status                  # checkpoint status.
 *
 * Ops:
 *   - Idempotent on EVENT_ID: per-year, existing v2 source_event_ids are fetched
 *     (paginated — PostgREST caps at 1000/page) and skipped. Safe to kill + rerun.
 *   - Voyage ≤20/batch (HARD LIMIT), EMBED_LANES concurrent embed+insert lanes
 *     (default 3, env-tunable). Retries 5xx/network only, NEVER 4xx.
 *   - Downloads cached in scripts/.ncei-cache/, each year's .gz deleted after the
 *     year completes (KEEP_CACHE=1 to keep) — disk-health rule.
 *
 * Keys: SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI), VOYAGE_API_KEY (env or .env.local).
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { gunzipSync } from "node:zlib";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const NCEI_BASE = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/";
const CACHE_DIR = join(SCRIPTS_DIR, ".ncei-cache");
const CHECKPOINT_FILE = join(SCRIPTS_DIR, ".ncei-reingest-checkpoint.json");

const CONTENT_TYPE = "storm-event"; // SAME type as v1 — supersede, don't fork the type
const EMBED_BATCH = 20;             // HARD LIMIT — Voyage times out above 20
const EMBED_LANES = Math.max(1, parseInt(process.env.EMBED_LANES || "3", 10) || 3);
const PAGE_SIZE = 1000;             // PostgREST hard cap — paginate everything
const SUPERSEDE_BATCH = 5000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Key bootstrap (same pattern as otd-ingest.ts) ───────────────────────────
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

  if (needVoyage && !process.env.VOYAGE_API_KEY) {
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
  }
  if (needVoyage && !process.env.VOYAGE_API_KEY) {
    console.error("  ✗ VOYAGE_API_KEY required for the ingest run.");
    process.exit(1);
  }
}

function supaHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
}

// ─── Retry helper — 5xx/network only, NEVER 4xx ──────────────────────────────
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
      const wait = Math.min(2000 * 2 ** (attempt - 1), 60_000);
      console.log(`  ${label}: attempt ${attempt} failed (${String(lastErr).slice(0, 140)}), retrying in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// ─── State + timezone maps ────────────────────────────────────────────────────
const STATE_NAME_TO_ABBR: Record<string, string> = {
  ALABAMA: "AL", ALASKA: "AK", ARIZONA: "AZ", ARKANSAS: "AR", CALIFORNIA: "CA",
  COLORADO: "CO", CONNECTICUT: "CT", DELAWARE: "DE", "DISTRICT OF COLUMBIA": "DC",
  FLORIDA: "FL", GEORGIA: "GA", HAWAII: "HI", IDAHO: "ID", ILLINOIS: "IL",
  INDIANA: "IN", IOWA: "IA", KANSAS: "KS", KENTUCKY: "KY", LOUISIANA: "LA",
  MAINE: "ME", MARYLAND: "MD", MASSACHUSETTS: "MA", MICHIGAN: "MI", MINNESOTA: "MN",
  MISSISSIPPI: "MS", MISSOURI: "MO", MONTANA: "MT", NEBRASKA: "NE", NEVADA: "NV",
  "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY",
  "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND", OHIO: "OH", OKLAHOMA: "OK",
  OREGON: "OR", PENNSYLVANIA: "PA", "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC",
  "SOUTH DAKOTA": "SD", TENNESSEE: "TN", TEXAS: "TX", UTAH: "UT", VERMONT: "VT",
  VIRGINIA: "VA", WASHINGTON: "WA", "WEST VIRGINIA": "WV", WISCONSIN: "WI", WYOMING: "WY",
  // Territories + marine zones (LAKE MICHIGAN, GULF OF MEXICO, ATLANTIC SOUTH, ...)
  // are KEPT (all rows, no filters) with state_abbr=null + metadata.state_name.
};

// CZ_TIMEZONE is usually "CST-6" style; legacy rows carry bare abbreviations.
const TZ_FALLBACK: Record<string, number> = {
  EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7,
  AKST: -9, AKDT: -8, AST: -4, HST: -10, SST: -11, GST: 10, CHST: 10, UTC: 0, GMT: 0,
};
function tzOffsetHours(raw: string | undefined): number | null {
  const tz = (raw || "").trim().toUpperCase();
  if (!tz || tz === "UNK") return null;
  const m = tz.match(/^([A-Z]+)?(-?\d+)?$/);
  if (!m) return null;
  if (m[2] !== undefined && m[2] !== "") {
    const n = parseInt(m[2], 10);
    return n >= -12 && n <= 14 ? n : null;
  }
  if (m[1] && TZ_FALLBACK[m[1]] !== undefined) return TZ_FALLBACK[m[1]];
  return null;
}

// ─── Damage parsing: "750M" → 750000000. H=hundreds (legacy), K, M, B, T. ────
function parseDamageUsd(raw: string | undefined): number | null {
  const v = (raw || "").trim().toUpperCase();
  if (!v) return null;
  const m = v.match(/^([\d.]+)\s*([HKMBT])?$/);
  if (!m) return null; // lone "K", "?" etc. — unknown, never guessed
  const num = parseFloat(m[1]);
  if (!Number.isFinite(num)) return null;
  const mult = { H: 1e2, K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[m[2] as string] ?? 1;
  return Math.round(num * mult);
}

// ─── CSV parsing (multi-line quoted narratives — same fix as v1 hardening) ───
function splitCSVRecords(csvText: string): string[] {
  const records: string[] = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === "\n" && !inQuotes) {
      let end = i;
      if (end > start && csvText[end - 1] === "\r") end--;
      if (end > start) records.push(csvText.slice(start, end));
      start = i + 1;
    }
  }
  if (start < csvText.length) {
    const tail = csvText.slice(start).replace(/\r$/, "");
    if (tail) records.push(tail);
  }
  return records;
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { fields.push(current); current = ""; }
      else current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// ─── Parsed event → row ──────────────────────────────────────────────────────
type ParsedEvent = {
  eventId: string;
  episodeId: string | null;
  eventType: string;
  stateName: string;
  stateAbbr: string | null;
  czName: string;
  czType: string;
  czFips: string;
  effectiveDate: string;          // local begin date YYYY-MM-DD
  eventTimeUtc: string | null;    // full UTC ISO or null (never guessed)
  endTimeUtc: string | null;
  timezone: string;
  deathsDirect: number;
  deathsIndirect: number;
  injuriesDirect: number;
  injuriesIndirect: number;
  damagePropertyUsd: number | null;
  damageCropsUsd: number | null;
  magnitude: string | null;
  torFScale: string | null;
  lat: number | null;
  lng: number | null;
  narrative: string;
};

type ParseStats = {
  records: number;
  parsed: number;
  skippedNoEventId: number;
  skippedBadDate: number;
  nullEventTime: number;
  nonStateRows: number;           // territories + marine zones (kept)
  byType: Record<string, number>;
  embedChars: number;
};

function toIsoUtc(ym: string, day: string, hhmm: string, offset: number | null): { date: string | null; iso: string | null } {
  const y = parseInt(ym.slice(0, 4), 10);
  const mo = parseInt(ym.slice(4, 6), 10);
  const d = parseInt(day, 10);
  if (!y || !mo || !d || mo < 1 || mo > 12 || d < 1 || d > 31) return { date: null, iso: null };
  const date = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = parseInt(hhmm || "0", 10);
  const hh = Math.floor(t / 100);
  const mm = t % 100;
  if (offset === null || !Number.isFinite(t) || t < 0 || hh > 23 || mm > 59) return { date, iso: null };
  const utcMs = Date.UTC(y, mo - 1, d, hh, mm) - offset * 3600_000;
  return { date, iso: new Date(utcMs).toISOString().replace(".000Z", "Z") };
}

function parseFile(csvText: string): { events: ParsedEvent[]; stats: ParseStats } {
  const lines = splitCSVRecords(csvText);
  const stats: ParseStats = {
    records: Math.max(0, lines.length - 1), parsed: 0, skippedNoEventId: 0, skippedBadDate: 0,
    nullEventTime: 0, nonStateRows: 0, byType: {}, embedChars: 0,
  };
  if (lines.length < 2) return { events: [], stats };

  const headers = parseCSVLine(lines[0]).map((h) => h.trim().toUpperCase());
  const idx = (name: string) => headers.indexOf(name);
  const col = {
    beginYm: idx("BEGIN_YEARMONTH"), beginDay: idx("BEGIN_DAY"), beginTime: idx("BEGIN_TIME"),
    endYm: idx("END_YEARMONTH"), endDay: idx("END_DAY"), endTime: idx("END_TIME"),
    episodeId: idx("EPISODE_ID"), eventId: idx("EVENT_ID"), state: idx("STATE"),
    eventType: idx("EVENT_TYPE"), czType: idx("CZ_TYPE"), czFips: idx("CZ_FIPS"), czName: idx("CZ_NAME"),
    tz: idx("CZ_TIMEZONE"), injD: idx("INJURIES_DIRECT"), injI: idx("INJURIES_INDIRECT"),
    deaD: idx("DEATHS_DIRECT"), deaI: idx("DEATHS_INDIRECT"),
    dmgP: idx("DAMAGE_PROPERTY"), dmgC: idx("DAMAGE_CROPS"),
    mag: idx("MAGNITUDE"), torF: idx("TOR_F_SCALE"),
    lat: idx("BEGIN_LAT"), lon: idx("BEGIN_LON"),
    epNarr: idx("EPISODE_NARRATIVE"), evNarr: idx("EVENT_NARRATIVE"),
  };
  if (col.eventId === -1 || col.beginYm === -1 || col.state === -1 || col.eventType === -1) {
    throw new Error("CSV missing required columns (EVENT_ID / BEGIN_YEARMONTH / STATE / EVENT_TYPE)");
  }
  const f = (fields: string[], i: number) => (i === -1 ? "" : (fields[i] ?? "").trim());
  const int = (fields: string[], i: number) => parseInt(f(fields, i) || "0", 10) || 0;

  const events: ParsedEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = parseCSVLine(lines[i]);
    const eventId = f(fields, col.eventId);
    if (!eventId) { stats.skippedNoEventId++; continue; }

    const tzRaw = f(fields, col.tz);
    const offset = tzOffsetHours(tzRaw);
    const begin = toIsoUtc(f(fields, col.beginYm), f(fields, col.beginDay), f(fields, col.beginTime), offset);
    if (!begin.date) { stats.skippedBadDate++; continue; }
    if (!begin.iso) stats.nullEventTime++;
    const end = toIsoUtc(f(fields, col.endYm), f(fields, col.endDay), f(fields, col.endTime), offset);

    const stateName = f(fields, col.state).toUpperCase();
    const stateAbbr = STATE_NAME_TO_ABBR[stateName] ?? null;
    if (!stateAbbr) stats.nonStateRows++;

    const eventType = f(fields, col.eventType) || "Unknown";
    stats.byType[eventType] = (stats.byType[eventType] || 0) + 1;

    const magRaw = f(fields, col.mag);
    const torF = f(fields, col.torF) || null;
    let narrative = f(fields, col.evNarr) || f(fields, col.epNarr) || "";
    if (narrative.length > 500) narrative = narrative.slice(0, 500);

    events.push({
      eventId,
      episodeId: f(fields, col.episodeId) || null,
      eventType,
      stateName,
      stateAbbr,
      czName: f(fields, col.czName),
      czType: f(fields, col.czType),
      czFips: f(fields, col.czFips),
      effectiveDate: begin.date,
      eventTimeUtc: begin.iso,
      endTimeUtc: end.iso,
      timezone: tzRaw,
      deathsDirect: int(fields, col.deaD),
      deathsIndirect: int(fields, col.deaI),
      injuriesDirect: int(fields, col.injD),
      injuriesIndirect: int(fields, col.injI),
      damagePropertyUsd: parseDamageUsd(f(fields, col.dmgP)),
      damageCropsUsd: parseDamageUsd(f(fields, col.dmgC)),
      magnitude: magRaw && magRaw !== "0" && magRaw !== "0.00" ? magRaw : null,
      torFScale: torF,
      lat: parseFloat(f(fields, col.lat)) || null,
      lng: parseFloat(f(fields, col.lon)) || null,
      narrative,
    });
    stats.parsed++;
  }
  return { events, stats };
}

// ─── ParsedEvent → hunt_knowledge row (THE ROW CONTRACT) ─────────────────────
function buildRow(ev: ParsedEvent) {
  const deaths = ev.deathsDirect + ev.deathsIndirect;
  const injuries = ev.injuriesDirect + ev.injuriesIndirect;
  const damageUsd = ev.damagePropertyUsd === null && ev.damageCropsUsd === null
    ? null
    : (ev.damagePropertyUsd ?? 0) + (ev.damageCropsUsd ?? 0);
  const mag = ev.eventType === "Tornado" ? (ev.torFScale || ev.magnitude) : ev.magnitude;

  const place = [ev.czName, ev.stateAbbr ?? ev.stateName].filter(Boolean).join(" ");
  const title = `${ev.eventType} — ${place} ${ev.effectiveDate}`;

  const parts = [CONTENT_TYPE, ev.stateAbbr ?? ev.stateName, ev.effectiveDate, `type:${ev.eventType}`];
  if (mag) parts.push(`magnitude:${mag}`);
  if (deaths > 0) parts.push(`deaths:${deaths}`);
  if (injuries > 0) parts.push(`injuries:${injuries}`);
  if (damageUsd !== null && damageUsd > 0) parts.push(`damage_usd:${damageUsd}`);
  if (ev.narrative) parts.push(`narrative:${ev.narrative}`);
  const content = parts.join(" | ");

  const tags = [ev.eventType.toLowerCase().replace(/\s+/g, "-"), "severe-weather"];
  if (ev.stateAbbr) tags.unshift(ev.stateAbbr);
  else tags.push("non-state");

  return {
    title,
    content,
    content_type: CONTENT_TYPE,
    tags,
    state_abbr: ev.stateAbbr,
    species: null,
    effective_date: ev.effectiveDate,
    metadata: {
      source: "ncei-storm-events",
      ingest_v: 2,
      source_event_id: ev.eventId,
      episode_id: ev.episodeId,
      event_type: ev.eventType,
      event_time_utc: ev.eventTimeUtc,
      end_time_utc: ev.endTimeUtc,
      timezone: ev.timezone || null,
      deaths,
      injuries,
      deaths_direct: ev.deathsDirect,
      deaths_indirect: ev.deathsIndirect,
      injuries_direct: ev.injuriesDirect,
      injuries_indirect: ev.injuriesIndirect,
      damage_usd: damageUsd,
      damage_property_usd: ev.damagePropertyUsd,
      damage_crops_usd: ev.damageCropsUsd,
      magnitude: mag,
      provenance_url: `https://www.ncdc.noaa.gov/stormevents/eventdetails.jsp?id=${ev.eventId}`,
      granularity: ev.lat !== null && ev.lng !== null ? "point" : "county",
      lat: ev.lat,
      lng: ev.lng,
      county: ev.czName,
      cz_type: ev.czType,
      cz_fips: ev.czFips,
      state_name: ev.stateName,
    },
    embedText: content,
  };
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────
type Checkpoint = {
  years: Record<string, { file: string; records: number; inserted: number; skippedExisting: number; done: boolean }>;
  supersededTotal?: number;
};
function loadCheckpoint(): Checkpoint {
  if (existsSync(CHECKPOINT_FILE)) {
    try { return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf-8")); }
    catch { console.log("WARN: corrupt checkpoint, starting fresh (EVENT_ID idempotency prevents dupes)"); }
  }
  return { years: {} };
}
function saveCheckpoint(cp: Checkpoint) {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2) + "\n");
}

// ─── NCEI directory listing ───────────────────────────────────────────────────
async function fetchListing(): Promise<{ year: number; file: string; bytes: number | null }[]> {
  const res = await fetchWithRetry(NCEI_BASE, {}, "NCEI listing");
  const html = await res.text();
  const byYear = new Map<number, { file: string; bytes: number | null }>();
  // Apache-style listing: <a href="FILE">FILE</a>  DATE  SIZE
  const re = /StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d+)\.csv\.gz/g;
  const seen = new Map<number, string[]>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const y = parseInt(m[1], 10);
    if (!seen.has(y)) seen.set(y, []);
    seen.get(y)!.push(m[0]);
  }
  for (const [y, files] of seen) {
    files.sort(); // latest c-date wins
    const file = files[files.length - 1];
    // best-effort size scrape from the listing row
    const row = html.split(file).pop()?.split("\n")[0] ?? "";
    const sm = row.match(/\s(\d+)\s*$/m) || row.match(/\s([\d.]+[KMG])\s*$/m);
    let bytes: number | null = null;
    if (sm) {
      const v = sm[1];
      bytes = /[KMG]$/.test(v)
        ? Math.round(parseFloat(v) * ({ K: 1e3, M: 1e6, G: 1e9 }[v.slice(-1)] as number))
        : parseInt(v, 10);
    }
    byYear.set(y, { file, bytes });
  }
  return [...byYear.entries()].map(([year, v]) => ({ year, ...v })).sort((a, b) => a.year - b.year);
}

// ─── Existing v2 EVENT_IDs for a year (idempotency) ──────────────────────────
// KEYSET pagination on the pkey — NEVER unordered limit/offset. ROOT CAUSE of
// the 07-05 duplicate rows: this check used offset pages with NO order=; the
// DC-era rerun (07-05 ~21:44) ran while the v1 supersede UPDATE pass churned
// the same table, Postgres served the unordered pages in shifting physical
// order, ids fell between pages and were silently missed, and those events
// re-inserted as v2 duplicates (cleaned by scripts/dedupe-v2-storms.ts).
// Keyset on the immutable id is stable under any concurrent churn.
async function existingEventIds(year: number): Promise<Set<string>> {
  const ids = new Set<string>();
  let cursor = "";
  while (true) {
    const url =
      `${SUPABASE_URL}/rest/v1/hunt_knowledge` +
      `?content_type=eq.${CONTENT_TYPE}` +
      `&effective_date=gte.${year}-01-01&effective_date=lte.${year}-12-31` +
      `&metadata->>ingest_v=eq.2` +
      `&select=id,sid:metadata->>source_event_id` +
      (cursor ? `&id=gt.${cursor}` : "") +
      `&order=id.asc&limit=${PAGE_SIZE}`;
    const res = await fetchWithRetry(url, { headers: supaHeaders() }, `existing-ids ${year}@${cursor || "start"}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`existing-ids ${year}: non-array response`);
    for (const r of rows) if (r.sid) ids.add(String(r.sid));
    if (rows.length < PAGE_SIZE) break;
    cursor = rows[rows.length - 1].id;
  }
  return ids;
}

// ─── Embed + insert (lanes) ───────────────────────────────────────────────────
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

// NOTE: a retried POST can double-commit if the first attempt committed but the
// response was lost ("fetch failed" mid-response). No unique constraint exists on
// (content_type, source_event_id), so this is unguarded — scripts/dedupe-v2-storms.ts
// is the sweep for that class too. 07-05 run: 81 retry events, dupes measured tiny.
async function insertRows(rows: any[]): Promise<void> {
  await fetchWithRetry(
    `${SUPABASE_URL}/rest/v1/hunt_knowledge`,
    { method: "POST", headers: { ...supaHeaders(), Prefer: "return=minimal" }, body: JSON.stringify(rows) },
    "insert"
  );
}

/** Embed+insert all rows for a year with EMBED_LANES concurrent lanes. */
async function processYear(rows: ReturnType<typeof buildRow>[]): Promise<{ inserted: number; failedBatches: number }> {
  const batches: ReturnType<typeof buildRow>[][] = [];
  for (let i = 0; i < rows.length; i += EMBED_BATCH) batches.push(rows.slice(i, i + EMBED_BATCH));
  let next = 0, inserted = 0, failedBatches = 0;

  async function lane() {
    while (true) {
      const my = next++;
      if (my >= batches.length) return;
      const batch = batches[my];
      try {
        const embeddings = await embed(batch.map((r) => r.embedText));
        if (embeddings.length !== batch.length) throw new Error(`Voyage returned ${embeddings.length} for ${batch.length}`);
        await insertRows(batch.map((r, i) => {
          const { embedText, ...row } = r as any;
          return { ...row, embedding: JSON.stringify(embeddings[i]) };
        }));
        inserted += batch.length;
      } catch (err) {
        failedBatches++;
        console.error(`  batch ${my} FAILED (${String(err).slice(0, 160)}) — rerun will retry via EVENT_ID idempotency`);
      }
      if (inserted % 2000 < EMBED_BATCH) {
        console.log(`  … ${inserted}/${rows.length} embedded+inserted`);
      }
    }
  }
  await Promise.all(Array.from({ length: EMBED_LANES }, () => lane()));
  return { inserted, failedBatches };
}

// ─── Download ─────────────────────────────────────────────────────────────────
async function downloadYearFile(file: string): Promise<string> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const local = join(CACHE_DIR, file);
  if (!existsSync(local)) {
    console.log(`  downloading ${file}…`);
    const res = await fetchWithRetry(NCEI_BASE + file, {}, `download ${file}`, 4);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(local, buf);
    console.log(`  downloaded ${(buf.length / 1e6).toFixed(1)} MB`);
  } else {
    console.log(`  using cached ${file}`);
  }
  return gunzipSync(readFileSync(local)).toString("utf-8");
}

// ─── THE RUN ──────────────────────────────────────────────────────────────────
async function runIngest(yearsArg: string | undefined) {
  bootstrapKeys(true);
  let startY = 1950, endY = new Date().getUTCFullYear();
  if (yearsArg) {
    const m = yearsArg.match(/^(\d{4})-(\d{4})$/);
    if (!m) { console.error("--years wants YYYY-YYYY"); process.exit(1); }
    startY = parseInt(m[1], 10); endY = parseInt(m[2], 10);
  }
  console.log(`\n=== NCEI RE-INGEST (v2) === years ${startY}–${endY}, ${EMBED_LANES} embed lanes`);
  const listing = (await fetchListing()).filter((l) => l.year >= startY && l.year <= endY);
  console.log(`listing: ${listing.length} year files`);
  const cp = loadCheckpoint();
  let grandInserted = 0;
  const failedYears: number[] = [];

  for (const { year, file } of listing) {
    const done = cp.years[year];
    if (done?.done && done.file === file) { console.log(`\n--- ${year} — done (${done.inserted} rows), skipping`); continue; }
    if (done?.done && done.file !== file) console.log(`\n--- ${year} — NCEI regenerated file (${done.file} → ${file}), re-running (idempotent)`);
    else console.log(`\n--- ${year} ---`);

    try {
      const csv = await downloadYearFile(file);
      const { events, stats } = parseFile(csv);
      console.log(`  parsed ${stats.parsed}/${stats.records} records (${stats.skippedNoEventId} no-id, ${stats.skippedBadDate} bad-date, ${stats.nullEventTime} null event_time, ${stats.nonStateRows} territory/marine kept)`);

      const existing = await existingEventIds(year);
      const seen = new Set<string>(existing);
      const rows: ReturnType<typeof buildRow>[] = [];
      for (const ev of events) {
        if (seen.has(ev.eventId)) continue;
        seen.add(ev.eventId);
        rows.push(buildRow(ev));
      }
      console.log(`  ${rows.length} to ingest (${existing.size} already present as v2)`);

      const { inserted, failedBatches } = await processYear(rows);
      grandInserted += inserted;
      cp.years[year] = { file, records: stats.parsed, inserted: (done?.inserted || 0) + inserted, skippedExisting: existing.size, done: failedBatches === 0 };
      saveCheckpoint(cp);
      if (failedBatches > 0) { failedYears.push(year); console.error(`  ${year}: ${failedBatches} failed batches — year left NOT done, rerun to retry`); }
      else {
        console.log(`  ${year} DONE: +${inserted}`);
        if (process.env.KEEP_CACHE !== "1") { try { unlinkSync(join(CACHE_DIR, file)); } catch {} }
      }
    } catch (err) {
      failedYears.push(year);
      console.error(`  ${year} FAILED: ${String(err).slice(0, 300)} — rerun to retry`);
    }
  }

  console.log(`\n=== RUN COMPLETE: +${grandInserted} rows this run ===`);
  if (failedYears.length) {
    console.error(`FAILED YEARS: ${failedYears.join(", ")} — rerun the same command; checkpoint + EVENT_ID idempotency make it safe.`);
    process.exitCode = 1;
  } else {
    console.log("Next: spot-verify (Uri TX window, Katrina counts), THEN run --supersede in its own window.");
  }
}

// ─── SUPERSEDE (phase 2 — separate run, never the same day as the ingest) ────
async function runSupersede() {
  bootstrapKeys(false);
  console.log("\n=== SUPERSEDE v1 storm-event rows (metadata.superseded=true) ===");
  console.log("Requires migration 20260707100000_mark_storm_v1_superseded_windowed.sql pushed first.");
  const cp = loadCheckpoint();
  let total = cp.supersededTotal || 0;
  // Year windows ride the effective_date btree so each call's scan is bounded —
  // the unwindowed v1 RPC re-scanned every already-marked row and died at 57014.
  const endYear = new Date().getUTCFullYear();
  for (let year = 1950; year <= endYear; year++) {
    let yearTotal = 0;
    while (true) {
      const res = await fetchWithRetry(
        `${SUPABASE_URL}/rest/v1/rpc/mark_storm_v1_superseded`,
        {
          method: "POST",
          headers: supaHeaders(),
          body: JSON.stringify({ date_from: `${year}-01-01`, date_to: `${year}-12-31`, batch_size: SUPERSEDE_BATCH }),
        },
        "supersede-rpc"
      );
      const updated = await res.json();
      if (typeof updated !== "number") throw new Error(`RPC returned non-number: ${JSON.stringify(updated).slice(0, 200)}`);
      total += updated;
      yearTotal += updated;
      cp.supersededTotal = total;
      saveCheckpoint(cp);
      if (updated < SUPERSEDE_BATCH) break;
      await sleep(300); // breathe — IO budget
    }
    if (yearTotal > 0) console.log(`  ${year}: +${yearTotal} marked (running total ${total})`);
  }
  console.log(`SUPERSEDE COMPLETE: ${total} v1 rows marked lifetime. Now ship the reader-side filters (see PIPE-2 runbook).`);
}

// ─── ESTIMATE ─────────────────────────────────────────────────────────────────
const CALIBRATION_RECORDS_PER_GZ_BYTE = 67_562 / 11_602_648; // 2019 file, measured locally

async function runEstimate() {
  console.log("\n=== ESTIMATE (read-only) ===");
  const listing = await fetchListing();
  const withSize = listing.filter((l) => l.bytes);
  let totalRows = 0;
  if (withSize.length === listing.length) {
    totalRows = Math.round(listing.reduce((a, l) => a + (l.bytes || 0) * CALIBRATION_RECORDS_PER_GZ_BYTE, 0));
    console.log(`years: ${listing[0].year}–${listing[listing.length - 1].year} (${listing.length} files, sizes scraped)`);
  } else {
    totalRows = 1_920_000; // NCEI's published corpus size, fallback when listing has no sizes
    console.log(`years: ${listing[0].year}–${listing[listing.length - 1].year} (${listing.length} files; listing had no sizes — using NCEI published ~1.92M)`);
  }
  const batches = Math.ceil(totalRows / EMBED_BATCH);
  const tokens = totalRows * 65; // 64-71 tokens/row measured on 2019/2005/2021/2001 dry-runs
  // EMBED DECISION (2026-07-05): full per-event embedding, NO reuse, NO rollup.
  // - Reusing v1 embeddings needs ~8GB of embedding reads (IO budget killer) and
  //   title-matching is proven wrong in both directions (Cass County IN).
  // - State-day rollups lose per-event semantics the dossier needs.
  // - At ~$2.50 and ~7h with 3 lanes, full embed is cheap enough to be correct.
  console.log(`projected rows:    ~${totalRows.toLocaleString()}`);
  console.log(`embed batches:     ~${batches.toLocaleString()} (${EMBED_BATCH}/batch)`);
  console.log(`voyage tokens:     ~${(tokens / 1e6).toFixed(0)}M ≈ $${((tokens / 1e6) * 0.02).toFixed(2)} at voyage-3-lite $0.02/1M`);
  console.log(`runtime:           ~${((batches * 0.8) / EMBED_LANES / 3600).toFixed(1)}h at 0.8s/batch with ${EMBED_LANES} lanes (sequential worst case ~${((batches * 0.8) / 3600).toFixed(1)}h)`);
}

// ─── DRY RUN — parse local files, print scorecard verification windows ───────
function verifyWindows(events: ParsedEvent[]) {
  const years = new Set(events.map((e) => e.effectiveDate.slice(0, 4)));

  if (years.has("2021")) {
    console.log("\n  ── URI VERIFICATION (scorecard expects ≈665 TX rows / 131 deaths / $277M; archive holds 93 rows, deaths:0) ──");
    for (const [from, to] of [["2021-02-10", "2021-02-20"], ["2021-02-11", "2021-02-20"], ["2021-02-13", "2021-02-20"]]) {
      const w = events.filter((e) => e.stateAbbr === "TX" && e.effectiveDate >= from && e.effectiveDate <= to);
      const deaths = w.reduce((a, e) => a + e.deathsDirect + e.deathsIndirect, 0);
      const dmg = w.reduce((a, e) => a + (e.damagePropertyUsd ?? 0) + (e.damageCropsUsd ?? 0), 0);
      console.log(`  TX ${from}..${to}: ${w.length} rows, ${deaths} deaths, $${(dmg / 1e6).toFixed(1)}M damage`);
    }
    const after17 = events.filter((e) => e.stateAbbr === "TX" && e.effectiveDate >= "2021-02-18" && e.effectiveDate <= "2021-02-20");
    console.log(`  TX rows AFTER the archive's false 'ended Feb-17': ${after17.length} (scorecard: 63 run through Feb-20)`);
  }

  if (years.has("2005")) {
    console.log("\n  ── KATRINA VERIFICATION (2005-08-24..09-05, LA/MS/AL — must beat the archive's current counts) ──");
    for (const st of ["LA", "MS", "AL"]) {
      const w = events.filter((e) => e.stateAbbr === st && e.effectiveDate >= "2005-08-24" && e.effectiveDate <= "2005-09-05");
      const deaths = w.reduce((a, e) => a + e.deathsDirect + e.deathsIndirect, 0);
      console.log(`  ${st}: ${w.length} rows, ${deaths} deaths`);
    }
    const surge = events.filter((e) => e.eventType === "Storm Surge/Tide" && e.effectiveDate >= "2005-08-24" && e.effectiveDate <= "2005-09-05");
    console.log(`  Storm Surge/Tide rows in window (archive has ZERO of this type): ${surge.length}`);
    const landfall = events.filter((e) => ["LA", "MS", "AL", "FL"].includes(e.stateAbbr || "") && e.effectiveDate >= "2005-08-25" && e.effectiveDate <= "2005-08-29");
    console.log(`  LA/MS/AL/FL rows 08-25..08-29 (archive daily arc summed to 249): ${landfall.length}`);
  }

  if (years.has("2001")) {
    console.log("\n  ── 9/11 VERIFICATION (scorecard: real NCEI count 10; archive said 'only 4 Carolinas cells') ──");
    const day = events.filter((e) => e.effectiveDate === "2001-09-11");
    console.log(`  total rows 2001-09-11: ${day.length}`);
    for (const e of day) console.log(`    ${e.eventType} — ${e.czName} ${e.stateAbbr ?? e.stateName}`);
  }
}

async function runDryRun(files: string[]) {
  console.log("\n=== DRY RUN — parse only, no network, no database, no embeds ===");
  for (const path of files) {
    const raw = path.endsWith(".gz")
      ? gunzipSync(readFileSync(path)).toString("utf-8")
      : readFileSync(path, "utf-8");
    console.log(`\n▶ ${basename(path)} (${(statSync(path).size / 1e6).toFixed(1)} MB on disk)`);
    const { events, stats } = parseFile(raw);
    const rows = events.map(buildRow);
    const embedChars = rows.reduce((a, r) => a + r.embedText.length, 0);
    const types = Object.entries(stats.byType).sort((a, b) => b[1] - a[1]);
    console.log(`  records: ${stats.records} | parsed: ${stats.parsed} | no-id: ${stats.skippedNoEventId} | bad-date: ${stats.skippedBadDate}`);
    console.log(`  null event_time_utc: ${stats.nullEventTime} (${((stats.nullEventTime / Math.max(1, stats.parsed)) * 100).toFixed(1)}%) | territory/marine kept: ${stats.nonStateRows}`);
    console.log(`  event types: ${types.length} (${types.slice(0, 6).map(([t, n]) => `${t}:${n}`).join(", ")}, …)`);
    console.log(`  avg embed text: ${(embedChars / Math.max(1, rows.length)).toFixed(0)} chars ≈ ${(embedChars / Math.max(1, rows.length) / 4).toFixed(0)} tokens`);
    const withCoords = events.filter((e) => e.lat !== null && e.lng !== null).length;
    console.log(`  granularity: ${withCoords} point / ${events.length - withCoords} county`);
    const sample = rows.find((r) => r.metadata.deaths > 0 && r.metadata.damage_usd) || rows[0];
    if (sample) console.log(`  sample row: ${JSON.stringify({ title: sample.title, effective_date: sample.effective_date, metadata: sample.metadata }).slice(0, 600)}`);
    verifyWindows(events);
  }
}

// ─── Status ───────────────────────────────────────────────────────────────────
function status() {
  const cp = loadCheckpoint();
  const years = Object.keys(cp.years).sort();
  const doneYears = years.filter((y) => cp.years[y].done);
  const rows = years.reduce((a, y) => a + cp.years[y].inserted, 0);
  console.log(`Ingest: ${doneYears.length}/${years.length} touched years done, ${rows.toLocaleString()} rows inserted`);
  for (const y of years.filter((y) => !cp.years[y].done)) console.log(`  in-flight/failed: ${y} (${cp.years[y].inserted} in)`);
  if (cp.supersededTotal) console.log(`Superseded v1 rows marked: ${cp.supersededTotal.toLocaleString()}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || "";
  if (mode === "--status") return status();
  if (mode === "--dry-run") {
    if (args.length < 2) { console.error("--dry-run needs at least one CSV/.gz path"); process.exit(1); }
    return runDryRun(args.slice(1));
  }
  if (mode === "--estimate") return runEstimate();
  if (mode === "--supersede") return runSupersede();
  const yearsArg = mode === "--years" ? args[1] : undefined;
  if (mode && mode !== "--years") { console.error(`unknown mode ${mode}`); process.exit(1); }
  return runIngest(yearsArg);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
