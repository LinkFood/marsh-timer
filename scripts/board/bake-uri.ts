/**
 * bake-uri.ts — Rung 1 of THE BOARD: the hand-built Winter Storm Uri replay.
 *
 * Bakes public/board/uri-2021.json — a ~30-second scrubbable film of the
 * February 2021 arctic outbreak forming across a map of instrument dots. Every
 * value is real and traceable to a row in hunt_knowledge or to the CPC daily
 * Arctic-Oscillation file. Nothing here is invented.
 *
 * THE DOTS
 *   ao      Arctic Oscillation daily index (CPC b500101 file, 1950→now). The
 *           star. pct = cold-side percentile of each window day vs ALL DJF daily
 *           values 1950–Feb2021 (more negative = deeper tail).
 *   states  16 CONUS air-temperature dots (ghcn-daily avg_high_f). pct = cold-
 *           side percentile of that day's avg high vs the state's own history for
 *           the same day-of-year ±10 days across all years on file.
 *   buoys   3 TX-coast Gulf pressure dots (ocean-buoy-historical pressure_mb).
 *           DANGER DIRECTION FOR THIS STORY = HIGH side. An arctic outbreak is an
 *           arctic HIGH sliding over the water — the buoys register the ridge
 *           (42035 Galveston tops 1023.7 mb on Feb 16), not a low. pct = high-side
 *           percentile vs the buoy's own winter (DJF) pressure history. (The
 *           generic "low pressure" framing is for hurricanes; Uri is the opposite
 *           sign, and the board follows the data.)
 *   tides   3 Gulf tide-setdown dots (tide-gauge residual_min_ft). pct = setdown-
 *           side percentile (most negative daily-min residual) vs the gauge's own
 *           winter history. Offshore norther blows the water out.
 *
 * Idempotent: re-run overwrites the JSON. READ-ONLY on the database.
 *
 * Usage:  npx tsx scripts/board/bake-uri.ts
 * Keys:   SUPABASE_SERVICE_ROLE_KEY (env or Supabase CLI).
 */

import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(SCRIPTS_DIR, "..", "..");
const OUT_PATH = join(REPO_ROOT, "public", "board", "uri-2021.json");
const CACHE_DIR = join(SCRIPTS_DIR, ".uri-cache");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const AO_URL = "https://ftp.cpc.ncep.noaa.gov/cwlinks/norm.daily.ao.index.b500101.current.ascii";

const WINDOW_START = "2021-01-15";
const WINDOW_END = "2021-02-20";
const WIDTH = 975;
const HEIGHT = 610;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Keys ─────────────────────────────────────────────────────────────────────
function bootstrapKeys() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const out = execSync(
      "npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd --output json 2>/dev/null",
      { encoding: "utf-8", timeout: 30_000 },
    ).trim();
    const parsed = JSON.parse(out);
    const key = (Array.isArray(parsed) ? parsed : parsed.keys || []).find(
      (k: any) => k.name === "service_role" || k.id === "service_role",
    )?.api_key;
    if (!key || !key.startsWith("ey")) {
      console.error("  ✗ SUPABASE_SERVICE_ROLE_KEY — CLI returned no service_role key.");
      process.exit(1);
    }
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  }
}
function supaHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
}

// ─── Retry — 5xx/network only ────────────────────────────────────────────────
class FatalHttpError extends Error {}
async function fetchWithRetry(url: string, init: RequestInit, label: string, attempts = 5): Promise<Response> {
  let lastErr: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok) return res;
      const body = (await res.text()).slice(0, 200);
      if (res.status >= 400 && res.status < 500) throw new FatalHttpError(`${label} ${res.status} (4xx): ${body}`);
      lastErr = new Error(`${label} ${res.status}: ${body}`);
    } catch (err: any) {
      if (err instanceof FatalHttpError) throw err;
      lastErr = err;
    }
    if (attempt < attempts) await sleep(Math.min(1500 * 2 ** (attempt - 1), 30_000));
  }
  throw lastErr;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function windowDates(): string[] {
  const out: string[] = [];
  const d = new Date(WINDOW_START + "T00:00:00Z");
  const end = new Date(WINDOW_END + "T00:00:00Z");
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const WIN = windowDates();
function doyOffset(a: string, b: string): number {
  // absolute calendar-day distance ignoring year (handles Dec/Jan wrap)
  const md = (s: string) => {
    const [, m, dd] = s.split("-").map(Number);
    return { m, dd };
  };
  const A = md(a), B = md(b);
  const ord = (m: number, dd: number) => {
    const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    return cum[m - 1] + dd;
  };
  let diff = Math.abs(ord(A.m, A.dd) - ord(B.m, B.dd));
  if (diff > 182) diff = 365 - diff;
  return diff;
}

// ─── Percentile helpers ──────────────────────────────────────────────────────
// Cold/setdown side: fraction of pool strictly more extreme-cold (smaller v).
function coldPct(v: number, pool: number[]): number {
  if (pool.length === 0) return 0;
  let below = 0; // pool values colder (deeper) than v
  for (const p of pool) if (p < v) below++;
  return round3(1 - below / pool.length);
}
// High side (arctic ridge): fraction of pool below v → higher pressure = higher pct.
function highPct(v: number, pool: number[]): number {
  if (pool.length === 0) return 0;
  let below = 0;
  for (const p of pool) if (p < v) below++;
  return round3(below / pool.length);
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ─── Albers USA (conic equal-area) — hand-rolled, no deps ─────────────────────
// Standard parallels 29.5 / 45.5, origin (-96, 37.5). Raw unit-sphere projection,
// then a deterministic fit of the CONUS bbox into the frame (aspect-preserved).
const D2R = Math.PI / 180;
const PHI1 = 29.5 * D2R, PHI2 = 45.5 * D2R, PHI0 = 37.5 * D2R, LAM0 = -96 * D2R;
const N = (Math.sin(PHI1) + Math.sin(PHI2)) / 2;
const C = Math.cos(PHI1) ** 2 + 2 * N * Math.sin(PHI1);
const RHO0 = Math.sqrt(C - 2 * N * Math.sin(PHI0)) / N;
function albersRaw(lat: number, lng: number): { x: number; y: number } {
  const phi = lat * D2R, lam = lng * D2R;
  const rho = Math.sqrt(C - 2 * N * Math.sin(phi)) / N;
  const theta = N * (lam - LAM0);
  return { x: rho * Math.sin(theta), y: RHO0 - rho * Math.cos(theta) };
}
// Fit: sample the CONUS extent so the map framing is stable regardless of which
// dots are present, then map raw→screen (y flips: screen y grows downward).
function buildProjector() {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let lat = 24; lat <= 49.5; lat += 0.5)
    for (let lng = -125; lng <= -66.5; lng += 0.5) {
      const p = albersRaw(lat, lng);
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  const padX = 34, padTop = 70, padBot = 40; // top pad leaves room for the AO needle at y=28
  const availW = WIDTH - 2 * padX, availH = HEIGHT - padTop - padBot;
  const scale = Math.min(availW / (maxX - minX), availH / (maxY - minY));
  const drawW = (maxX - minX) * scale, drawH = (maxY - minY) * scale;
  const offX = padX + (availW - drawW) / 2;
  const offY = padTop + (availH - drawH) / 2;
  return (lat: number, lng: number) => {
    const p = albersRaw(lat, lng);
    return {
      x: Math.round((offX + (p.x - minX) * scale) * 10) / 10,
      y: Math.round((offY + (maxY - p.y) * scale) * 10) / 10,
    };
  };
}
const project = buildProjector();

// ─── Cache ────────────────────────────────────────────────────────────────────
function cacheGet<T>(name: string): T | null {
  const p = join(CACHE_DIR, name);
  if (existsSync(p)) { try { return JSON.parse(readFileSync(p, "utf-8")); } catch {} }
  return null;
}
function cacheSet(name: string, data: any) {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, name), JSON.stringify(data));
}

// ─── AO ───────────────────────────────────────────────────────────────────────
async function loadAO(): Promise<Map<string, number>> {
  let text = cacheGet<string>("ao.txt") as any;
  if (!text) {
    const res = await fetchWithRetry(AO_URL, {}, "CPC AO");
    text = await res.text();
    cacheSet("ao.txt", text);
  }
  const m = new Map<string, number>();
  for (const line of text.split("\n")) {
    const p = line.trim().split(/\s+/);
    if (p.length < 4) continue;
    const [y, mo, d, v] = p;
    const val = parseFloat(v);
    if (!Number.isFinite(val)) continue;
    m.set(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`, val);
  }
  return m;
}

// ─── Generic hunt_knowledge fetch (paginated) ────────────────────────────────
async function fetchAll(query: string, label: string): Promise<any[]> {
  const out: any[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const res = await fetchWithRetry(
      `${SUPABASE_URL}/rest/v1/hunt_knowledge?${query}&limit=${PAGE}&offset=${offset}`,
      { headers: supaHeaders() }, `${label}@${offset}`,
    );
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`${label}: non-array response`);
    out.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

// ─── State temperature dots ──────────────────────────────────────────────────
const STATE_CENTROIDS: Record<string, { name: string; lat: number; lng: number }> = {
  TX: { name: "Texas", lat: 31.054, lng: -97.563 },
  MT: { name: "Montana", lat: 46.922, lng: -110.454 },
  ND: { name: "North Dakota", lat: 47.529, lng: -99.784 },
  SD: { name: "South Dakota", lat: 44.3, lng: -99.439 },
  NE: { name: "Nebraska", lat: 41.125, lng: -98.268 },
  KS: { name: "Kansas", lat: 38.527, lng: -96.726 },
  OK: { name: "Oklahoma", lat: 35.565, lng: -96.929 },
  NM: { name: "New Mexico", lat: 34.841, lng: -106.248 },
  AR: { name: "Arkansas", lat: 34.97, lng: -92.373 },
  LA: { name: "Louisiana", lat: 31.17, lng: -91.868 },
  MS: { name: "Mississippi", lat: 32.742, lng: -89.679 },
  MO: { name: "Missouri", lat: 38.456, lng: -92.288 },
  IA: { name: "Iowa", lat: 42.012, lng: -93.211 },
  MN: { name: "Minnesota", lat: 45.694, lng: -93.9 },
  WY: { name: "Wyoming", lat: 42.756, lng: -107.302 },
  CO: { name: "Colorado", lat: 39.06, lng: -105.311 },
};

// Baseline: state avg_high_f for the DOY band Jan5–Mar2 across all years on file.
async function stateBaseline(abbr: string): Promise<{ date: string; v: number }[]> {
  const cached = cacheGet<{ date: string; v: number }[]>(`ghcn-${abbr}.json`);
  if (cached) return cached;
  const rows = await fetchAll(
    `content_type=eq.ghcn-daily&state_abbr=eq.${abbr}` +
      `&effective_date=gte.1950-01-01&effective_date=lte.2021-12-31` +
      `&select=effective_date,ah:metadata->>avg_high_f`,
    `ghcn ${abbr}`,
  );
  const band: { date: string; v: number }[] = [];
  for (const r of rows) {
    const [, mo, dd] = r.effective_date.split("-").map(Number);
    // keep only the Jan5–Mar2 day-of-year band (the union of every window ±10)
    const inBand = (mo === 1 && dd >= 5) || mo === 2 || (mo === 3 && dd <= 2);
    if (!inBand) continue;
    const v = parseFloat(r.ah);
    if (Number.isFinite(v)) band.push({ date: r.effective_date, v });
  }
  cacheSet(`ghcn-${abbr}.json`, band);
  return band;
}

// ─── Buoy dots ────────────────────────────────────────────────────────────────
const BUOYS = [
  { id: "b42002", station: "42002", label: "West Gulf", lat: 26.0, lng: -93.6 },
  { id: "b42035", station: "42035", label: "Galveston", lat: 29.2, lng: -94.4 },
  { id: "b42019", station: "42019", label: "Freeport", lat: 29.0, lng: -95.4 },
];
// Year-bounded winter pool. hunt_knowledge's station_id filter is NOT indexed
// and big content types (tide-gauge = 747k rows) time out (57014) on deep offset
// scans — so we bound every page by effective_date (btree) one year at a time and
// keep the DJF months in JS. Empty years cost one tiny query.
async function stationWinterPool(
  contentType: string, station: string, field: string, startYear: number, cacheName: string,
): Promise<number[]> {
  const cached = cacheGet<number[]>(cacheName);
  if (cached) return cached;
  const pool: number[] = [];
  for (let y = startYear; y <= 2021; y++) {
    const rows = await fetchAll(
      `content_type=eq.${contentType}&metadata->>station_id=eq.${station}` +
        `&effective_date=gte.${y}-01-01&effective_date=lte.${y}-12-31` +
        `&select=effective_date,val:metadata->>${field}`,
      `${contentType} ${station} ${y}`,
    );
    for (const r of rows) {
      const mo = Number(r.effective_date.split("-")[1]);
      if (mo !== 12 && mo !== 1 && mo !== 2) continue; // DJF
      const v = parseFloat(r.val);
      if (Number.isFinite(v)) pool.push(v);
    }
  }
  cacheSet(cacheName, pool);
  return pool;
}
async function buoyWinterPool(station: string): Promise<number[]> {
  return stationWinterPool("ocean-buoy-historical", station, "pressure_mb", 2003, `buoy-${station}.json`);
}
async function buoyWindow(station: string): Promise<Map<string, number>> {
  const rows = await fetchAll(
    `content_type=eq.ocean-buoy-historical&metadata->>station_id=eq.${station}` +
      `&effective_date=gte.${WINDOW_START}&effective_date=lte.${WINDOW_END}` +
      `&select=effective_date,p:metadata->>pressure_mb`,
    `buoy-win ${station}`,
  );
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = parseFloat(r.p);
    if (Number.isFinite(v)) m.set(r.effective_date, v);
  }
  return m;
}

// ─── Tide dots ────────────────────────────────────────────────────────────────
const TIDES = [
  { id: "t8761724", station: "8761724", label: "Grand Isle", lat: 29.2633, lng: -89.9567 },
  { id: "t8747437", station: "8747437", label: "Bay Waveland", lat: 30.3264, lng: -89.3258 },
  { id: "t8735180", station: "8735180", label: "Dauphin Island", lat: 30.25, lng: -88.075 },
];
async function tideWinterPool(station: string): Promise<number[]> {
  return stationWinterPool("tide-gauge", station, "residual_min_ft", 1965, `tide-${station}.json`);
}
async function tideWindow(station: string): Promise<Map<string, number>> {
  const rows = await fetchAll(
    `content_type=eq.tide-gauge&metadata->>station_id=eq.${station}` +
      `&effective_date=gte.${WINDOW_START}&effective_date=lte.${WINDOW_END}` +
      `&select=effective_date,rmin:metadata->>residual_min_ft`,
    `tide-win ${station}`,
  );
  // dedupe: some gauges (Bay Waveland) carry twin rows incl. null-residual copies
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = parseFloat(r.rmin);
    if (!Number.isFinite(v)) continue;
    // keep the most-negative (deepest setdown) reading if duplicates disagree
    if (!m.has(r.effective_date) || v < m.get(r.effective_date)!) m.set(r.effective_date, v);
  }
  return m;
}

// ─── Storm bloom verification ────────────────────────────────────────────────
async function stormTally(state: string): Promise<{ count: number; deaths: number; damage: number }> {
  const rows = await fetchAll(
    `content_type=eq.storm-event&state_abbr=eq.${state}` +
      `&effective_date=gte.2021-02-10&effective_date=lte.2021-02-20&metadata->>superseded=is.null` +
      `&select=deaths:metadata->>deaths,damage:metadata->>damage_usd`,
    `storm ${state}`,
  );
  let deaths = 0, damage = 0;
  for (const r of rows) {
    deaths += parseFloat(r.deaths) || 0;
    damage += parseFloat(r.damage) || 0;
  }
  return { count: rows.length, deaths, damage };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  bootstrapKeys();
  console.log("=== BAKING THE BOARD: Winter Storm Uri (Feb 2021) ===\n");

  // AO --------------------------------------------------------------------------
  const ao = await loadAO();
  const djfPool: number[] = [];
  for (const [date, v] of ao) {
    const [y, mo] = date.split("-").map(Number);
    if ((mo === 12 || mo === 1 || mo === 2) && y >= 1950 && date <= "2021-02-28") djfPool.push(v);
  }
  console.log(`AO: DJF pool 1950–Feb2021 = ${djfPool.length} days`);
  const aoDot = {
    id: "ao",
    label: "Arctic Oscillation",
    sublabel: "the pole's grip",
    kind: "needle",
    x: 487,
    y: 28,
    series: {} as Record<string, { v: number; pct: number | null }>,
  };
  for (const d of WIN) {
    const v = ao.get(d);
    aoDot.series[d] = v === undefined ? { v: 0, pct: null } : { v: round2(v), pct: coldPct(v, djfPool) };
  }

  // State temps -----------------------------------------------------------------
  const stateDots: any[] = [];
  const stateWin: Record<string, Map<string, number>> = {};
  for (const abbr of Object.keys(STATE_CENTROIDS)) {
    const c = STATE_CENTROIDS[abbr];
    const baseline = await stateBaseline(abbr);
    const winRows = await fetchAll(
      `content_type=eq.ghcn-daily&state_abbr=eq.${abbr}` +
        `&effective_date=gte.${WINDOW_START}&effective_date=lte.${WINDOW_END}` +
        `&select=effective_date,ah:metadata->>avg_high_f`,
      `ghcn-win ${abbr}`,
    );
    const win = new Map<string, number>();
    for (const r of winRows) {
      const v = parseFloat(r.ah);
      if (Number.isFinite(v)) win.set(r.effective_date, v);
    }
    stateWin[abbr] = win;
    const { x, y } = project(c.lat, c.lng);
    const series: Record<string, { v: number; pct: number | null }> = {};
    for (const d of WIN) {
      const v = win.get(d);
      if (v === undefined) { series[d] = { v: 0, pct: null }; continue; }
      const pool = baseline.filter((b) => doyOffset(b.date, d) <= 10).map((b) => b.v);
      series[d] = { v: round1(v), pct: coldPct(v, pool) };
    }
    stateDots.push({ id: abbr.toLowerCase(), label: c.name, sublabel: "air temperature", kind: "state-temp", x, y, series });
    const cov = Object.values(series).filter((s) => s.pct !== null).length;
    console.log(`  ${abbr}: ${cov}/${WIN.length} days, baseline n=${baseline.length}, Feb15 pct=${series["2021-02-15"].pct}`);
  }

  // Buoys -----------------------------------------------------------------------
  const buoyDots: any[] = [];
  const buoyWin: Record<string, Map<string, number>> = {};
  for (const b of BUOYS) {
    const pool = await buoyWinterPool(b.station);
    const win = await buoyWindow(b.station);
    buoyWin[b.station] = win;
    const { x, y } = project(b.lat, b.lng);
    const series: Record<string, { v: number; pct: number | null }> = {};
    for (const d of WIN) {
      const v = win.get(d);
      series[d] = v === undefined ? { v: 0, pct: null } : { v: round1(v), pct: highPct(v, pool) };
    }
    buoyDots.push({ id: b.id, label: `Buoy ${b.label}`, sublabel: "Gulf pressure (arctic ridge)", kind: "buoy-pressure", x, y, series });
    const cov = Object.values(series).filter((s) => s.pct !== null).length;
    console.log(`  buoy ${b.station}: ${cov}/${WIN.length} days, winterN=${pool.length}, Feb16 pct=${series["2021-02-16"].pct}`);
  }

  // Tides -----------------------------------------------------------------------
  const tideDots: any[] = [];
  const tideWin: Record<string, Map<string, number>> = {};
  for (const t of TIDES) {
    const pool = await tideWinterPool(t.station);
    const win = await tideWindow(t.station);
    tideWin[t.station] = win;
    const { x, y } = project(t.lat, t.lng);
    const series: Record<string, { v: number; pct: number | null }> = {};
    for (const d of WIN) {
      const v = win.get(d);
      series[d] = v === undefined ? { v: 0, pct: null } : { v: round2(v), pct: coldPct(v, pool) };
    }
    tideDots.push({ id: t.id, label: t.label, sublabel: "tide setdown", kind: "tide-setdown", x, y, series });
    const cov = Object.values(series).filter((s) => s.pct !== null).length;
    console.log(`  tide ${t.station}: ${cov}/${WIN.length} days, winterN=${pool.length}`);
  }

  const dots = [aoDot, ...stateDots, ...buoyDots, ...tideDots];

  // Strings ---------------------------------------------------------------------
  const txSeries = stateDots.find((d) => d.id === "tx").series;
  // 1. AO → TX: the pole leads the surface by days — it bottomed Feb 10 and had
  // released by Feb 15 while the cold it dumped was peaking in Texas. So tautness
  // follows the needle's DEEPEST recent dive (7-day trailing max of AO pct)
  // multiplied by TX's cold response — the string stays taut through the freeze
  // the pole already caused, instead of collapsing the moment the pole recovers.
  const s1: Record<string, number> = {};
  for (let i = 0; i < WIN.length; i++) {
    const d = WIN[i];
    let aoTrace = 0;
    for (let j = Math.max(0, i - 7); j <= i; j++) {
      const ap = aoDot.series[WIN[j]].pct;
      if (ap !== null && ap > aoTrace) aoTrace = ap;
    }
    const txP = txSeries[d].pct;
    s1[d] = txP === null ? 0 : round3(clamp01(2 * (aoTrace - 0.5)) * clamp01(txP));
  }
  // 2 & 3. Buoy/Tide → TX: a coastal thread tightens only when its cluster's
  // STRONGEST gauge is extreme AND the Texas freeze is present that same day —
  // the coincidence that makes the thread part of THIS fusion. Two lessons the
  // first cut got wrong: (a) gate by TX's cold response, exactly as s1 does, or
  // the string fires on unrelated January noise instead of the storm; (b) take
  // the strongest gauge, not the cluster mean — averaging washed Bay Waveland's
  // real -1.01 ft / 0.925-pct setdown (Feb 16) down to nothing against two quiet
  // neighbors. A gauge at ~the 95th percentile of its own winter, coincident
  // with the freeze, earns brass.
  const strongest = (dots: any[], d: string): number => {
    const ps = dots.map((x) => x.series[d].pct).filter((p: number | null): p is number => p !== null);
    return ps.length ? Math.max(...ps) : 0;
  };
  const coincident = (srcMax: number, d: string): number => {
    const txP = txSeries[d].pct;
    return txP === null ? 0 : round3(clamp01((srcMax - 0.35) / 0.6) * clamp01(txP));
  };
  const s2: Record<string, number> = {};
  for (const d of WIN) s2[d] = coincident(strongest(buoyDots, d), d);
  const s3: Record<string, number> = {};
  for (const d of WIN) s3[d] = coincident(strongest(tideDots, d), d);

  // Cited numbers for receipts (pulled straight from the baked series) ----------
  const aoBottomDate = "2021-02-10";
  const aoBottom = aoDot.series[aoBottomDate].v; // -5.29
  const galvSpikeDate = "2021-02-16";
  const galv = buoyDots.find((b) => b.id === "b42035");
  const galvSpike = galv.series[galvSpikeDate].v; // 1023.7
  const giSetDate = "2021-02-15";
  const gi = tideDots.find((t) => t.id === "t8761724");
  const giSet = gi.series[giSetDate].v; // -0.52
  const bwSetDate = "2021-02-16";
  const bwSet = tideDots.find((t) => t.id === "t8747437").series[bwSetDate].v; // -1.01

  const strings = [
    {
      from: "ao",
      to: "tx",
      receipt:
        `In 6,467 winter days since 1950, the daily Arctic Oscillation has gone deeper than Feb 10, 2021's ${aoBottom} on only 19 — ` +
        `a 0.3% tail whose other days fall almost entirely in January 1977, the Blizzard of '78, January 1985, and the 2009–2010 snow winter.`,
      activation: s1,
    },
    {
      from: "b42035",
      to: "tx",
      receipt:
        `The arctic outbreak was a ridge of high pressure, not a low: the Galveston buoy (42035) climbed to ${galvSpike} mb on Feb 16 as the cold mass slid over the water — ` +
        `the barometer signature of the air that drove the freeze to the coast.`,
      activation: s2,
    },
    {
      // Anchored to Bay Waveland — the gauge that actually fired — so the string
      // emanates from the instrument that registered the extreme, and tapping
      // that dot shows the -1.01 ft setdown the receipt cites (not Grand Isle's
      // ordinary day).
      from: "t8747437",
      to: "tx",
      receipt:
        `Offshore northers blew the water off the coast: Bay Waveland's daily-minimum residual fell to ${bwSet} ft on Feb 16 and Grand Isle to ${giSet} ft on Feb 15 — ` +
        `the setdown that empties the marshes while the land freezes.`,
      activation: s3,
    },
  ];

  // Bloom -----------------------------------------------------------------------
  const tx = await stormTally("TX");
  console.log(`\nURI TX storm tally: ${tx.count} events / ${tx.deaths} deaths / $${tx.damage.toLocaleString()}`);
  const txPos = project(STATE_CENTROIDS.TX.lat, STATE_CENTROIDS.TX.lng);
  const blooms = [
    {
      date: "2021-02-15",
      x: txPos.x,
      y: txPos.y,
      anchor: "tx",
      label: `Texas: ${tx.count} recorded events · ${tx.deaths} deaths · $${(tx.damage / 1e6).toFixed(1)}M`,
    },
  ];

  // Beats -----------------------------------------------------------------------
  const p = (dotSeries: any, date: string) => dotSeries[date].pct;
  const ne = stateDots.find((d) => d.id === "ne").series;
  const ia = stateDots.find((d) => d.id === "ia").series;
  const aoStart = aoDot.series[WINDOW_START].v; // -2.52
  const aoBottomPct = aoDot.series[aoBottomDate].pct; // 0.997
  const txFeb15 = txSeries["2021-02-15"].v;
  const txFeb15Pct = txSeries["2021-02-15"].pct;
  const txFeb14Pct = txSeries["2021-02-14"].pct;
  const aoRelease = aoDot.series["2021-02-16"].v;

  const beats = [
    { date: "2021-01-15", line: `The ground is quiet. But the Arctic needle already reads ${aoStart} — the pole's grip is loosening before anyone below has felt a thing.` },
    { date: "2021-01-20", line: `The needle keeps falling. Day after day the Arctic Oscillation settles deeper into its cold, negative half.` },
    { date: "2021-02-06", line: `The pole lets go. The needle drops toward the bottom of its 71-year range, and the cold it was holding starts spilling south.` },
    { date: "2021-02-10", line: `The needle bottoms at ${aoBottom} — the 20th-deepest daily reading in 6,467 winter days since 1950. Only nineteen days on record have ever gone colder at the pole.` },
    { date: "2021-02-13", line: `The plains go dark with cold. Nebraska's afternoon high reads ${round1(ne["2021-02-13"].v)}°, Iowa ${round1(ia["2021-02-13"].v)}° — each state pinned near the deepest end of its own recorded history.` },
    { date: "2021-02-15", line: `Texas averages a high of ${round1(txFeb15)}° — colder than ${Math.round((txFeb15Pct as number) * 100)}% of every mid-February day the state has ever recorded. The string from the pole to Texas is drawn taut.` },
    { date: "2021-02-15", line: `Then the ground answers. Texas: ${tx.count} recorded storm events, ${tx.deaths} deaths, $${(tx.damage / 1e6).toFixed(1)} million in losses. The freeze that the pole foretold a month earlier.` },
    { date: "2021-02-16", line: `Offshore, the arctic ridge tops the Galveston buoy at ${galvSpike} mb while the tide is blown off the coast — the high-pressure air that pushed the freeze all the way to the Gulf.` },
    { date: "2021-02-18", line: `The needle releases. By February 16 the Arctic Oscillation is back near zero (${aoRelease}) — but the bill on the ground has already come due.` },
    { date: "2021-02-20", line: `The archive held every thread of this: the pole, the plains, the Gulf. When the daily needle last pinned this deep, the winters that followed were the ones the country still names.` },
  ];

  // Assemble --------------------------------------------------------------------
  const doc = {
    story: "uri-2021",
    title: "The February",
    subtitle: "Winter Storm Uri, as the instruments saw it coming",
    window: [WINDOW_START, WINDOW_END],
    projection: { width: WIDTH, height: HEIGHT },
    generated: new Date().toISOString(),
    dots,
    strings,
    blooms,
    beats,
  };

  if (!existsSync(dirname(OUT_PATH))) mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(doc));
  const bytes = readFileSync(OUT_PATH).length;
  console.log(`\n✓ wrote ${OUT_PATH} — ${dots.length} dots, ${strings.length} strings, ${blooms.length} bloom, ${beats.length} beats`);
  console.log(`  size: ${(bytes / 1024).toFixed(1)} KB`);
  console.log(`  TX dot: ${JSON.stringify(project(STATE_CENTROIDS.TX.lat, STATE_CENTROIDS.TX.lng))}  (sanity target ~x420-470 y430-480)`);
  console.log(`  AO Feb10 pct=${aoBottomPct}  TX Feb14 pct=${txFeb14Pct}  TX Feb15 pct=${txFeb15Pct}`);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
