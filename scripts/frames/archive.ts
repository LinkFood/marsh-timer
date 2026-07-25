/**
 * archive.ts — the READ side of the archive, and the warm series cache.
 *
 * Three scripts used to hold three copies of the same bounded-read code:
 * backfill-frames.ts (the board bake), bake-series-columns.ts (the card bake) and
 * anything that wants a series. They now share this one, so a fix to the read
 * discipline lands everywhere at once.
 *
 * READ DISCIPLINE, non-negotiable (hunt_knowledge is ~7.6M rows):
 *   - NEVER `order=created_at.desc` unfiltered — statement timeout 57014.
 *   - Bound every query by `effective_date` (btree), one calendar year at a time.
 *   - ≤1000 rows per page, offset-paged inside the year.
 *   - Retry 5xx and network errors ONLY. A 4xx is fatal and is never retried.
 *
 * ── THE CACHE ENVELOPE, AND WHY IT NOW CARRIES PER-FIELD COVERAGE ──────────────
 *
 *   { endYear, fields: { <field>: { <iso-date>: value } }, fieldEndYear? }
 *
 * `endYear` is the coverage claim the 2026-07-17 CACHE COVERAGE LAW rests on: a
 * cached series is only usable if it was fetched with coverage ≥ the requested
 * end year. (A bounded `YEAR_TO=2021` run once wrote truncated caches that a later
 * full bake silently reused, blanking board_frames 2022→present for four years.)
 *
 * The card now wants fields the board layout does not carry — precipitation, the
 * overnight low, snow — and those arrive on a different day from `avg_high_f`.
 * A single top-level `endYear` cannot describe a file whose fields were fetched at
 * different times without lying about one of them, so coverage is per field:
 *
 *   coverage(field) = fieldEndYear[field] ?? endYear
 *
 * and the top-level `endYear` is written as the MINIMUM across fields, so a reader
 * that only knows about the old envelope under-claims rather than over-claims.
 *
 * ── MERGE, NEVER CLOBBER ──────────────────────────────────────────────────────
 * Writes merge into whatever is already on disk. This is load-bearing: the card's
 * metrics are NOT board slots (that is the whole point — see seriesCatalog.ts), so
 * a future board re-bake fetching only `avg_high_f` must not wipe the precipitation
 * the card reads. Before this rule that is exactly what a re-bake would have done.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));

/** Overridable so a worktree can point at the one warm cache instead of re-pulling 1.4M rows. */
export const CACHE_DIR = process.env.FRAME_CACHE_DIR || join(SCRIPTS_DIR, ".frame-cache");
export const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
export const AO_URL = "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.ao.index.b500101.current.ascii";
/** PostgREST caps a response at 1000 rows silently. Page, never assume. */
export const PAGE = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ─────────────────────────── keys / HTTP ─────────────────────────── */

export function bootstrapKeys() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const out = execSync("npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd --output json 2>/dev/null", { encoding: "utf-8", timeout: 30000 }).trim();
    const key = JSON.parse(out).find((k: any) => k.id === "service_role" || k.name === "service_role")?.api_key;
    if (!key || !key.startsWith("ey")) { console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI returned no key."); process.exit(1); }
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  }
}

export function supaHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
}

export class FatalHttpError extends Error {}

export async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 6): Promise<Response> {
  let lastErr: any;
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = (await res.text()).slice(0, 200);
      if (res.status >= 400 && res.status < 500) throw new FatalHttpError(`${label} ${res.status}: ${body}`);
      lastErr = new Error(`${label} ${res.status}: ${body}`);
    } catch (e: any) { if (e instanceof FatalHttpError) throw e; lastErr = e; }
    if (a < attempts) await sleep(Math.min(1500 * 2 ** (a - 1), 30000));
  }
  throw lastErr;
}

/** One calendar year of `hunt_knowledge`, offset-paged, bounded on the btree column. */
export async function fetchAllBounded(baseQuery: string, y: number): Promise<any[]> {
  const out: any[] = []; let offset = 0;
  while (true) {
    const res = await fetchWithRetry(`${SUPABASE_URL}/rest/v1/hunt_knowledge?${baseQuery}&effective_date=gte.${y}-01-01&effective_date=lte.${y}-12-31&limit=${PAGE}&offset=${offset}`, { headers: supaHeaders() }, `${baseQuery.slice(0, 30)}@${y}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`non-array @${y}: ${JSON.stringify(rows).slice(0, 120)}`);
    out.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

/* ─────────────────────────── raw cache files ─────────────────────────── */

export function cacheGet<T>(name: string): T | null {
  const p = join(CACHE_DIR, name);
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf-8")); } catch {} }
  return null;
}

/** Atomic: write a sibling temp file and rename, so a kill mid-write cannot leave
 *  a truncated cache that the coverage check would then trust. */
export function cacheSet(name: string, data: any) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  const final = join(CACHE_DIR, name);
  const tmp = `${final}.tmp`;
  writeFileSync(tmp, typeof data === "string" ? data : JSON.stringify(data));
  renameSync(tmp, final);
}

/* ─────────────────────────── the series cache ─────────────────────────── */

export type SeriesCache = {
  /** MINIMUM coverage across every field in this file. Legacy readers see this only. */
  endYear: number;
  fields: Record<string, Record<string, number>>;
  /** Per-field coverage. Absent entry ⇒ `endYear`. */
  fieldEndYear?: Record<string, number>;
};

const cacheName = (instId: string) => `series-${instId}.json`;

export function readSeriesCache(instId: string): SeriesCache | null {
  const c = cacheGet<SeriesCache>(cacheName(instId));
  if (!c || !c.fields || typeof c.endYear !== "number") return null; // legacy bare map ⇒ unverifiable ⇒ refetch
  return c;
}

/** The end year this file can be trusted through, for one field. */
export function coverageOf(c: SeriesCache, field: string): number {
  if (!c.fields[field]) return -Infinity;
  return c.fieldEndYear?.[field] ?? c.endYear;
}

/**
 * Overlay freshly-fetched fields onto whatever is on disk. Fields that were NOT
 * fetched are carried through untouched, with their own coverage preserved.
 */
export function writeSeriesCacheMerged(
  instId: string,
  endYear: number,
  fetched: Map<string, Map<string, number>>,
) {
  const prev = readSeriesCache(instId);
  const fields: Record<string, Record<string, number>> = { ...(prev?.fields ?? {}) };
  const fieldEndYear: Record<string, number> = {};
  if (prev) for (const f of Object.keys(prev.fields)) fieldEndYear[f] = coverageOf(prev, f);
  for (const [f, m] of fetched) {
    fields[f] = Object.fromEntries(m);
    fieldEndYear[f] = endYear;
  }
  const minCoverage = Math.min(...Object.values(fieldEndYear));
  cacheSet(cacheName(instId), { endYear: minCoverage, fields, fieldEndYear } satisfies SeriesCache);
}

/* ─────────────────────────── loading a series ─────────────────────────── */

/** The minimum an instrument must describe to be loadable. `Instrument` satisfies it. */
export type SeriesSource = {
  id: string;
  source_ct: string;
  source_key: Record<string, string>;
};

/** Which duplicate to keep when two rows land on one date (twin rows / null copies). */
export type DedupSide = "low" | "high" | "last";

function put(map: Map<string, number>, date: string, v: number, side: DedupSide) {
  if (!Number.isFinite(v)) return;
  const cur = map.get(date);
  if (cur === undefined) { map.set(date, v); return; }
  if (side === "low") map.set(date, Math.min(cur, v));
  else if (side === "high") map.set(date, Math.max(cur, v));
  else map.set(date, v);
}

export type LoadSeriesOpts = {
  /** Which metadata fields to load. Defaults to whatever the cache already holds. */
  fields: string[];
  /** Per-field dedup side. Missing entry ⇒ "last". */
  dedup?: Record<string, DedupSide>;
  /** Progress line per year, for the long ghcn pulls. */
  onYear?: (y: number, rows: number) => void;
};

/**
 * One instrument's per-field series, disk-cached, fetching ONLY the fields whose
 * coverage is short. Returns `Map<field, Map<iso-date, value>>` for the requested
 * fields.
 *
 * CROSS-ERA POOL DRIFT (documented, accepted): frames baked before the coverage law
 * carry bytes computed against that bake's pools; a fresh fetch includes later
 * readings, so the same-doy pools — and therefore the percentile bytes — differ
 * slightly across the 2021/2022 boundary. Pre-2022 frames are NOT re-baked for
 * this; a byte-exact store needs one full 1950→present re-bake on a single cache.
 */
export async function loadSeries(
  inst: SeriesSource,
  endYear: number,
  opts: LoadSeriesOpts,
): Promise<Map<string, Map<string, number>>> {
  const want = opts.fields;
  const cached = readSeriesCache(inst.id);
  const missing = want.filter((f) => !cached || coverageOf(cached, f) < endYear);

  const out = new Map<string, Map<string, number>>();
  if (cached) {
    for (const f of want) {
      if (missing.includes(f)) continue;
      out.set(f, new Map(Object.entries(cached.fields[f])));
    }
  }
  if (missing.length === 0) return out;

  const sideOf = (f: string): DedupSide => opts.dedup?.[f] ?? "last";
  const fetched = new Map<string, Map<string, number>>();
  for (const f of missing) fetched.set(f, new Map());

  if (inst.source_ct === "cpc-daily-ao") {
    // Daily CPC Arctic-Oscillation file (public ftp). The Uri anchor needs daily.
    let text = cacheGet<string>("cpc-ao.txt") as any;
    if (!text) { text = await (await fetchWithRetry(AO_URL, {}, "CPC AO")).text(); cacheSet("cpc-ao.txt", text); }
    const vm = fetched.get("value");
    if (vm) {
      for (const line of text.split("\n")) {
        const p = line.trim().split(/\s+/);
        if (p.length < 4) continue;
        const [y, mo, d, v] = p; const val = parseFloat(v);
        if (Number.isFinite(val)) put(vm, `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`, val, "last");
      }
    }
  } else if (inst.source_ct === "climate-index-daily") {
    // Daily CPC index rows in the archive; -99 sentinel = missing.
    const id = inst.source_key.index_id;
    const vm = fetched.get("value");
    for (let y = 1950; vm && y <= endYear; y++) {
      const rows = await fetchAllBounded(`content_type=eq.climate-index-daily&metadata->>index_id=eq.${id}&select=effective_date,val:metadata->>value`, y);
      for (const r of rows) { const val = parseFloat(r.val); if (Number.isFinite(val) && val > -99) put(vm, r.effective_date, val, "last"); }
    }
  } else if (inst.source_ct === "climate-index") {
    // Monthly index → month-held daily step (honest but coarse).
    const id = inst.source_key.index_id;
    const vm = fetched.get("value");
    for (let y = 1950; vm && y <= endYear; y++) {
      const rows = await fetchAllBounded(`content_type=eq.climate-index&metadata->>index_id=eq.${id}&select=effective_date,val:metadata->>value`, y);
      for (const r of rows) {
        const val = parseFloat(r.val);
        if (!Number.isFinite(val) || val <= -99) continue; // -99.9 = missing marker
        const [yy, mo] = r.effective_date.split("-").map(Number);
        const days = new Date(Date.UTC(yy, mo, 0)).getUTCDate();
        for (let dd = 1; dd <= days; dd++) vm.set(`${yy}-${String(mo).padStart(2, "0")}-${String(dd).padStart(2, "0")}`, val);
      }
    }
  } else {
    // DB station/state lanes, per-year bounded, year-round.
    const key = inst.source_key.state_abbr ? `state_abbr=eq.${inst.source_key.state_abbr}` : `metadata->>station_id=eq.${inst.source_key.station_id}`;
    const sel = "select=effective_date," + missing.map((f, i) => `f${i}:metadata->>${f}`).join(",");
    const startYear = inst.source_ct === "ocean-buoy-historical" ? 1970 : inst.source_ct === "tide-gauge" ? 1900 : 1950;
    for (let y = startYear; y <= endYear; y++) {
      const rows = await fetchAllBounded(`content_type=eq.${inst.source_ct}&${key}&${sel}`, y);
      for (const r of rows) missing.forEach((f, i) => put(fetched.get(f)!, r.effective_date, parseFloat(r[`f${i}`]), sideOf(f)));
      opts.onYear?.(y, rows.length);
    }
  }

  writeSeriesCacheMerged(inst.id, endYear, fetched);
  for (const [f, m] of fetched) out.set(f, m);
  return out;
}
