/**
 * Build the per-state, per-day anomaly panel for the strangest-days re-run
 * (the HERO-AHA path defined by the aha-hunt judge, 2026-07-02).
 *
 * Reads hunt_knowledge ghcn-daily rows (content_type='ghcn-daily', one row per
 * state per day, metadata: avg_high_f/avg_low_f/avg_precip_in/snowfall_in/
 * station_count) for the full CONUS and computes day-of-year climatological
 * z-scores per state:
 *
 *   z_temp   — daily mean temp (avg_high+avg_low)/2 vs +/-7-day windowed normal
 *   z_swing  — day-over-day change in mean temp vs windowed swing normal
 *   z_precip — avg precip vs windowed normal (std floored, zero-inflated ok)
 *   z_snow   — snowfall vs windowed normal (std floored so summer snow doesn't
 *              divide by ~0; all z capped at +/-10)
 *
 * The panel is DATA ONLY — axis merging (temp_anom+temp_swing -> one temp
 * axis) and space_wx exclusion are the SCORER's job (score-strangest-days.ts).
 *
 * READ-ONLY against the DB. Writes local JSON panel files only.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/build-strangest-days-panel.ts
 *
 * Env:
 *   ONLY_STATES=CO,WY,NE   — restrict to these states (dry-run/validation)
 *   YEAR_FROM=1950 YEAR_TO=2026 — year bounds (default 1950-2026)
 *   OUT_DIR=analysis/strangest-days — panel + checkpoint output dir
 *   FORCE=1                — rebuild states even if checkpointed
 *
 * Resumability: checkpoint file (panel-checkpoint.json) records completed
 * states; a completed state with its panel file present is skipped on re-run.
 * Panel files are written atomically (tmp + rename) so a killed run never
 * leaves a half-written state marked complete.
 *
 * Gap tolerance: years with zero/partial rows are FLAGGED (missingYears /
 * partialYears in the checkpoint + console) and the state still completes —
 * WY may still be backfilling; the runner must not crash on residual gaps.
 *
 * Hard rules honored (postmortem law):
 *   - PostgREST 1000-row cap: every query is a single-year window (<=366 rows)
 *   - hunt_knowledge NEVER ordered by created_at, never unbounded: every query
 *     filters content_type + state_abbr + effective_date year bounds and
 *     orders by effective_date (btree-indexed)
 *   - no exact counts, no writes, no embedding
 */

import * as fs from "fs";
import * as path from "path";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const SCRIPTS_DIR = import.meta.dirname || __dirname;

const YEAR_FROM = process.env.YEAR_FROM ? parseInt(process.env.YEAR_FROM, 10) : 1950;
const YEAR_TO = process.env.YEAR_TO ? parseInt(process.env.YEAR_TO, 10) : 2026;
const OUT_DIR = path.resolve(
  process.env.OUT_DIR || path.join(SCRIPTS_DIR, "..", "analysis", "strangest-days"),
);
const FORCE = process.env.FORCE === "1";

// Full CONUS — 48 contiguous states (AK/HI excluded from the panel by spec).
const CONUS_STATES = [
  "AL","AZ","AR","CA","CO","CT","DE","FL","GA","ID",
  "IL","IN","IA","KS","KY","LA","ME","MD","MA","MI",
  "MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY",
  "NC","ND","OH","OK","OR","PA","RI","SC","SD","TN",
  "TX","UT","VT","VA","WA","WV","WI","WY",
];

const ONLY_STATES = process.env.ONLY_STATES
  ? process.env.ONLY_STATES.toUpperCase().split(",").map((s) => s.trim()).filter(Boolean)
  : null;

const STATES = ONLY_STATES
  ? CONUS_STATES.filter((s) => ONLY_STATES.includes(s))
  : CONUS_STATES;

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
};

// Climatology parameters
const DOY_WINDOW = 7; // +/- days pooled for day-of-year normals
const Z_CAP = 10; // cap |z| so floored-std extremes don't produce Infinity
const STD_FLOOR_TEMP = 1.0; // deg F
const STD_FLOOR_SWING = 1.0; // deg F
const STD_FLOOR_PRECIP = 0.05; // inches
const STD_FLOOR_SNOW = 0.2; // inches
const MIN_STATIONS = 3; // days with fewer reporting stations are dropped
const PARTIAL_YEAR_MIN_DAYS = 360; // <this many rows in a non-edge year = partial

// ---------- Types ----------

interface GhcnRow {
  effective_date: string;
  metadata: {
    avg_high_f?: number;
    avg_low_f?: number;
    avg_precip_in?: number;
    snowfall_in?: number | null;
    station_count?: number;
  };
}

interface PanelDay {
  date: string;
  tmean: number;
  z_temp: number;
  swing: number | null;
  z_swing: number | null;
  precip: number;
  z_precip: number;
  snow: number;
  z_snow: number;
  n_stations: number;
}

interface StatePanel {
  state: string;
  builtAt: string;
  yearFrom: number;
  yearTo: number;
  days: PanelDay[];
  missingYears: number[];
  partialYears: { year: number; rows: number }[];
  droppedThinDays: number;
}

interface Checkpoint {
  version: number;
  yearFrom: number;
  yearTo: number;
  states: Record<
    string,
    {
      days: number;
      missingYears: number[];
      partialYears: { year: number; rows: number }[];
      builtAt: string;
    }
  >;
}

// ---------- Helpers ----------

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Day-of-year index 0..365 on a leap-year reference calendar (so Mar 1 is
 * the same slot every year and Feb 29 gets its own slot). */
function doyIndex(dateStr: string): number {
  const [, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  const CUM = [0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335]; // leap-year cumulative
  return CUM[m - 1] + (d - 1);
}

function circularDoyDist(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 366 - diff);
}

function meanStd(arr: number[]): { mean: number; std: number } {
  const n = arr.length;
  if (n === 0) return { mean: 0, std: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const varSum = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  return { mean, std: Math.sqrt(varSum / Math.max(1, n - 1)) };
}

function zScore(value: number, mean: number, std: number, floor: number): number {
  const s = Math.max(std, floor);
  const z = (value - mean) / s;
  return Math.max(-Z_CAP, Math.min(Z_CAP, Math.round(z * 100) / 100));
}

// ---------- Fetch (paginated by year window; <=366 rows, under the 1000 cap) ----------

async function fetchStateYear(state: string, year: number): Promise<GhcnRow[]> {
  const url =
    `${SUPABASE_URL}/rest/v1/hunt_knowledge` +
    `?select=effective_date,metadata` +
    `&content_type=eq.ghcn-daily` +
    `&state_abbr=eq.${state}` +
    `&effective_date=gte.${year}-01-01` +
    `&effective_date=lte.${year}-12-31` +
    `&order=effective_date.asc` +
    `&limit=400`;

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: supaHeaders });
      if (res.ok) return (await res.json()) as GhcnRow[];

      const text = await res.text();
      // 57014 statement timeout arrives with a 4xx/5xx wrapper depending on
      // PostgREST version — it is a server-side timeout, always retryable.
      const isStmtTimeout = text.includes("57014");
      if (res.status >= 400 && res.status < 500 && !isStmtTimeout) {
        throw new Error(`fetch 4xx (not retrying): ${res.status} ${text}`);
      }
      if (attempt < 3) {
        console.log(`    ${state} ${year}: ${res.status}${isStmtTimeout ? " (57014)" : ""}, retry ${attempt + 1}/4...`);
        await delay((attempt + 1) * 5000);
        continue;
      }
      throw new Error(`fetch failed after retries: ${res.status} ${text}`);
    } catch (err: any) {
      if (err.message?.startsWith("fetch 4xx")) throw err;
      if (attempt < 3) {
        await delay((attempt + 1) * 5000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("exhausted retries");
}

// ---------- Panel build per state ----------

interface RawDay {
  date: string;
  doy: number;
  tmean: number;
  precip: number;
  snow: number;
  nStations: number;
}

function buildStatePanel(state: string, raw: RawDay[]): Omit<StatePanel, "missingYears" | "partialYears" | "droppedThinDays"> {
  raw.sort((a, b) => a.date.localeCompare(b.date));

  // Swings: day-over-day mean-temp change, only across consecutive calendar days
  const byDate = new Map(raw.map((d) => [d.date, d]));
  const prevDate = (dateStr: string): string => {
    const dt = new Date(dateStr + "T00:00:00Z");
    dt.setUTCDate(dt.getUTCDate() - 1);
    return dt.toISOString().slice(0, 10);
  };
  const swings = new Map<string, number>();
  for (const d of raw) {
    const prev = byDate.get(prevDate(d.date));
    if (prev) swings.set(d.date, d.tmean - prev.tmean);
  }

  // Day-of-year pooled climatology: bucket values by doy, then pool +/-window
  const tempByDoy: number[][] = Array.from({ length: 366 }, () => []);
  const swingByDoy: number[][] = Array.from({ length: 366 }, () => []);
  const precipByDoy: number[][] = Array.from({ length: 366 }, () => []);
  const snowByDoy: number[][] = Array.from({ length: 366 }, () => []);
  for (const d of raw) {
    tempByDoy[d.doy].push(d.tmean);
    precipByDoy[d.doy].push(d.precip);
    snowByDoy[d.doy].push(d.snow);
    const sw = swings.get(d.date);
    if (sw !== undefined) swingByDoy[d.doy].push(sw);
  }

  const pooled = (buckets: number[][], doy: number): number[] => {
    const out: number[] = [];
    for (let k = 0; k < 366; k++) {
      if (circularDoyDist(k, doy) <= DOY_WINDOW) out.push(...buckets[k]);
    }
    return out;
  };

  // Precompute climatology per doy (only doys that occur)
  const climCache = new Map<
    number,
    { t: { mean: number; std: number }; s: { mean: number; std: number }; p: { mean: number; std: number }; n: { mean: number; std: number } }
  >();
  const climFor = (doy: number) => {
    let c = climCache.get(doy);
    if (!c) {
      c = {
        t: meanStd(pooled(tempByDoy, doy)),
        s: meanStd(pooled(swingByDoy, doy)),
        p: meanStd(pooled(precipByDoy, doy)),
        n: meanStd(pooled(snowByDoy, doy)),
      };
      climCache.set(doy, c);
    }
    return c;
  };

  const days: PanelDay[] = raw.map((d) => {
    const c = climFor(d.doy);
    const sw = swings.get(d.date);
    return {
      date: d.date,
      tmean: Math.round(d.tmean * 10) / 10,
      z_temp: zScore(d.tmean, c.t.mean, c.t.std, STD_FLOOR_TEMP),
      swing: sw !== undefined ? Math.round(sw * 10) / 10 : null,
      z_swing: sw !== undefined ? zScore(sw, c.s.mean, c.s.std, STD_FLOOR_SWING) : null,
      precip: d.precip,
      z_precip: zScore(d.precip, c.p.mean, c.p.std, STD_FLOOR_PRECIP),
      snow: d.snow,
      z_snow: zScore(d.snow, c.n.mean, c.n.std, STD_FLOOR_SNOW),
      n_stations: d.nStations,
    };
  });

  return {
    state,
    builtAt: new Date().toISOString(),
    yearFrom: YEAR_FROM,
    yearTo: YEAR_TO,
    days,
  };
}

// ---------- Checkpoint ----------

const checkpointPath = path.join(OUT_DIR, "panel-checkpoint.json");

function loadCheckpoint(): Checkpoint {
  try {
    const cp = JSON.parse(fs.readFileSync(checkpointPath, "utf8")) as Checkpoint;
    if (cp.yearFrom !== YEAR_FROM || cp.yearTo !== YEAR_TO) {
      console.log(
        `Checkpoint year range (${cp.yearFrom}-${cp.yearTo}) differs from requested (${YEAR_FROM}-${YEAR_TO}) — ignoring old checkpoint`,
      );
      return { version: 1, yearFrom: YEAR_FROM, yearTo: YEAR_TO, states: {} };
    }
    return cp;
  } catch {
    return { version: 1, yearFrom: YEAR_FROM, yearTo: YEAR_TO, states: {} };
  }
}

function saveCheckpoint(cp: Checkpoint) {
  const tmp = checkpointPath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cp, null, 2));
  fs.renameSync(tmp, checkpointPath);
}

function writePanelAtomic(state: string, panel: StatePanel) {
  const file = path.join(OUT_DIR, `panel-${state}.json`);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(panel));
  fs.renameSync(tmp, file);
}

// ---------- Main ----------

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const cp = loadCheckpoint();

  console.log("=== Strangest-Days Panel Builder (read-only) ===");
  console.log(`States: ${STATES.length} | Years: ${YEAR_FROM}-${YEAR_TO} | Out: ${OUT_DIR}`);
  if (ONLY_STATES) console.log(`Only states: ${STATES.join(",")}`);

  const gapReport: string[] = [];
  let statesBuilt = 0;
  let statesSkipped = 0;

  for (const state of STATES) {
    const panelFile = path.join(OUT_DIR, `panel-${state}.json`);
    if (!FORCE && cp.states[state] && fs.existsSync(panelFile)) {
      statesSkipped++;
      console.log(`--- ${state}: checkpointed (${cp.states[state].days} days), skipping`);
      continue;
    }

    console.log(`--- ${state} ---`);
    const raw: RawDay[] = [];
    const missingYears: number[] = [];
    const partialYears: { year: number; rows: number }[] = [];
    let droppedThinDays = 0;
    const t0 = Date.now();

    for (let year = YEAR_FROM; year <= YEAR_TO; year++) {
      const rows = await fetchStateYear(state, year);
      if (rows.length === 0) {
        missingYears.push(year);
        continue;
      }
      if (rows.length < PARTIAL_YEAR_MIN_DAYS && year < YEAR_TO) {
        partialYears.push({ year, rows: rows.length });
      }
      for (const r of rows) {
        const m = r.metadata || {};
        if (typeof m.avg_high_f !== "number" || typeof m.avg_low_f !== "number") continue;
        const nStations = m.station_count ?? 0;
        if (nStations < MIN_STATIONS) {
          droppedThinDays++;
          continue;
        }
        raw.push({
          date: r.effective_date,
          doy: doyIndex(r.effective_date),
          tmean: (m.avg_high_f + m.avg_low_f) / 2,
          precip: typeof m.avg_precip_in === "number" ? m.avg_precip_in : 0,
          snow: typeof m.snowfall_in === "number" ? m.snowfall_in : 0,
          nStations,
        });
      }
      await delay(150); // gentle on the shared DB — backfill pipe may be running
    }

    if (raw.length === 0) {
      console.log(`  ${state}: NO DATA in ${YEAR_FROM}-${YEAR_TO} — flagged, not written`);
      gapReport.push(`${state}: NO DATA`);
      continue;
    }

    const core = buildStatePanel(state, raw);
    const panel: StatePanel = { ...core, missingYears, partialYears, droppedThinDays };
    writePanelAtomic(state, panel);

    cp.states[state] = {
      days: panel.days.length,
      missingYears,
      partialYears,
      builtAt: panel.builtAt,
    };
    saveCheckpoint(cp);
    statesBuilt++;

    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    let gapNote = "";
    if (missingYears.length > 0) {
      // Compress consecutive years for readability
      gapNote = ` | MISSING YEARS: ${missingYears.length} (${missingYears[0]}..${missingYears[missingYears.length - 1]})`;
      gapReport.push(`${state}: missing ${missingYears.join(",")}`);
    }
    if (partialYears.length > 0) {
      gapNote += ` | partial: ${partialYears.map((p) => `${p.year}(${p.rows})`).join(",")}`;
      gapReport.push(`${state}: partial ${partialYears.map((p) => `${p.year}:${p.rows}`).join(",")}`);
    }
    console.log(
      `  ${state}: ${panel.days.length} panel days in ${secs}s (thin-dropped ${droppedThinDays})${gapNote}`,
    );
  }

  console.log(`\n=== Panel build done: ${statesBuilt} built, ${statesSkipped} already checkpointed ===`);
  if (gapReport.length > 0) {
    console.log("=== GAP REPORT (tolerated, re-run after backfill closes them) ===");
    for (const g of gapReport) console.log(`  ${g}`);
  } else {
    console.log("=== No gaps detected ===");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
