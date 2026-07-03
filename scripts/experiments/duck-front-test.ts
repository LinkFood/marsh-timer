/**
 * Duck–Front Test — MVE (minimum-viable experiment)
 * =================================================
 * Founding-fact screen: at DAILY resolution, do cold-front passages precede
 * duck (waterfowl) migration pulses by 1–3 days in the MATCHED flyway but NOT
 * in a WRONG flyway?
 *
 * This is a PLACEBO-FIRST screen, not an answer. Per the convergence postmortem
 * (2026-07-02) the "upstream handoff" variant already died on exactly this test:
 * it "measured 'it's fall.'" If a front in flyway X predicts a pulse in flyway Y
 * just as well as in flyway X, the whole result is seasonality and we STOP.
 *
 * READ-ONLY. Zero writes to hunt_knowledge or any hunt_ table. Zero schema
 * changes. Uses only data we already hold, via the PostgREST REST API.
 *
 * Data sources (all read-only):
 *   - hunt_knowledge         waterfowl:N parsed out of migration content text
 *   - hunt_migration_history location_count (crude effort proxy)
 *   - hunt_weather_events    event_type='cold_front' (dated front log)
 *   - hunt_weather_history   (optional) pressure/wind to require a real signature
 *
 * SAFETY (the box is fragile — IVFFlat rebuild + strangest-days jobs saturate it):
 *   - Every hunt_knowledge query is filtered by content_type + state_abbr +
 *     effective_date range. NEVER ordered by created_at unfiltered (57014).
 *   - Bounded + paginated with limit/offset (PostgREST 1000-row cap).
 *   - 522 / 5xx / network errors retried with exponential backoff.
 *   - Per-state raw pulls are CHECKPOINTED to a local cache dir, so a re-run is
 *     idempotent and resumes without re-hammering the DB.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/experiments/duck-front-test.ts
 *   npx tsx scripts/experiments/duck-front-test.ts --self-test          # no DB, synthetic pipeline proof
 *   STATES=KS,AR,MD,CA FROM=2025-09-01 TO=2026-06-30 npx tsx scripts/experiments/duck-front-test.ts
 *   REFRESH=1 npx tsx scripts/experiments/duck-front-test.ts            # ignore cache, re-fetch
 *
 * Env:
 *   SUPABASE_SERVICE_ROLE_KEY (required unless --self-test)
 *   SUPABASE_URL   default https://rvhyotvklfowklzjahdd.supabase.co
 *   STATES         default KS,AR,MD,CA   (Central, Mississippi, Atlantic, Pacific reps)
 *   FROM / TO      default 2025-09-01 / 2026-06-30 (the live eBird collection window)
 *   LAGS           default 1,2,3
 *   TEMP_DROP_MIN  default 15  (matches the watchdog's cold_front threshold)
 *   REFRESH        set to 1 to bypass the on-disk cache
 *   CACHE_DIR      default scripts/experiments/.cache
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SELF_TEST = process.argv.includes("--self-test");

const STATES = (process.env.STATES || "KS,AR,MD,CA")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);
const FROM = process.env.FROM || "2025-09-01";
const TO = process.env.TO || "2026-06-30";
const LAGS = (process.env.LAGS || "1,2,3").split(",").map((n) => parseInt(n.trim(), 10));
const TEMP_DROP_MIN = parseFloat(process.env.TEMP_DROP_MIN || "15");
const REFRESH = process.env.REFRESH === "1";
const CACHE_DIR = process.env.CACHE_DIR || join("scripts", "experiments", ".cache");

const MIGRATION_TYPES = [
  "migration-daily",
  "migration-spike-moderate",
  "migration-spike-significant",
  "migration-spike-extreme",
  "migration-lull",
];

const PAGE = 1000; // PostgREST hard cap
const Z_WINDOW = 21; // trailing days for deseasonalizing z-score
const Z_MIN_N = 7; // need at least this many trailing points to trust a z

// USFWS flyway assignment (50-state constant; no flyway column exists in the DB)
const STATE_FLYWAY: Record<string, "Atlantic" | "Mississippi" | "Central" | "Pacific"> = {
  // Atlantic
  ME: "Atlantic", NH: "Atlantic", VT: "Atlantic", MA: "Atlantic", RI: "Atlantic",
  CT: "Atlantic", NY: "Atlantic", NJ: "Atlantic", PA: "Atlantic", DE: "Atlantic",
  MD: "Atlantic", VA: "Atlantic", WV: "Atlantic", NC: "Atlantic", SC: "Atlantic",
  GA: "Atlantic", FL: "Atlantic",
  // Mississippi
  OH: "Mississippi", IN: "Mississippi", MI: "Mississippi", WI: "Mississippi",
  IL: "Mississippi", KY: "Mississippi", TN: "Mississippi", AL: "Mississippi",
  MS: "Mississippi", AR: "Mississippi", LA: "Mississippi", MO: "Mississippi",
  IA: "Mississippi", MN: "Mississippi",
  // Central
  MT: "Central", WY: "Central", CO: "Central", NM: "Central", ND: "Central",
  SD: "Central", NE: "Central", KS: "Central", OK: "Central", TX: "Central",
  // Pacific
  WA: "Pacific", OR: "Pacific", ID: "Pacific", NV: "Pacific", UT: "Pacific",
  AZ: "Pacific", CA: "Pacific",
  // Alaska/Hawaii — Pacific for completeness
  AK: "Pacific", HI: "Pacific",
};

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function log(...args: unknown[]) {
  console.log(`[duck-front ${new Date().toISOString().slice(11, 19)}]`, ...args);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function dayKey(d: string): string {
  return d.slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ISO week — used for calendar-week matching in the placebo control
function isoWeek(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const wk =
    1 +
    Math.round(
      ((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7,
    );
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function std(xs: number[], m: number): number {
  if (xs.length < 2) return NaN;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

// ---------------------------------------------------------------------------
// REST helper — bounded, paginated, retry with backoff on 522/5xx/network
// ---------------------------------------------------------------------------

async function restGet(path: string): Promise<any[]> {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 30_000);
      const res = await fetch(url, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
        signal: controller.signal,
      });
      clearTimeout(t);
      // NEVER retry 4xx (per house rules) — surface it.
      if (res.status >= 400 && res.status < 500) {
        throw new Error(`REST ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      if (res.status >= 500) {
        const backoff = Math.min(30_000, 2000 * 2 ** (attempt - 1));
        log(`  ${res.status} (attempt ${attempt}/${maxAttempts}) — backoff ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      const text = await res.text();
      // Cloudflare 522 sometimes arrives as an HTML body with a 200-ish edge code
      if (text.startsWith("<!DOCTYPE") || text.startsWith("<html")) {
        const backoff = Math.min(30_000, 2000 * 2 ** (attempt - 1));
        log(`  HTML error page (Cloudflare 5xx, attempt ${attempt}/${maxAttempts}) — backoff ${backoff}ms`);
        await sleep(backoff);
        continue;
      }
      return JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("REST 4")) throw err; // don't retry 4xx
      const backoff = Math.min(30_000, 2000 * 2 ** (attempt - 1));
      log(`  network/timeout "${msg.slice(0, 80)}" (attempt ${attempt}/${maxAttempts}) — backoff ${backoff}ms`);
      await sleep(backoff);
    }
  }
  throw new Error(`restGet failed after ${maxAttempts} attempts: ${path}`);
}

// Paginate a filtered query. Always pass content_type/state/date filters in `base`.
async function restGetAll(base: string): Promise<any[]> {
  const out: any[] = [];
  let offset = 0;
  for (;;) {
    const page = await restGet(`${base}&limit=${PAGE}&offset=${offset}`);
    out.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
    await sleep(250); // gentle on a fragile box
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetch + cache per-state raw series (checkpointed, idempotent)
// ---------------------------------------------------------------------------

interface RawState {
  state: string;
  from: string;
  to: string;
  // effective_date -> parsed waterfowl count (from hunt_knowledge content text)
  waterfowl: Record<string, number>;
  // date -> location_count (effort proxy, from hunt_migration_history)
  locations: Record<string, number>;
  // sorted list of cold_front dates (from hunt_weather_events)
  frontDates: string[];
  // date -> temp_drop_f for fronts (from the event metadata)
  frontDrop: Record<string, number>;
}

function cachePath(state: string): string {
  return join(CACHE_DIR, `raw_${state}_${FROM}_${TO}.json`);
}

const WATERFOWL_RE = /waterfowl:(\d+)/i;

async function fetchState(state: string): Promise<RawState> {
  const cp = cachePath(state);
  if (!REFRESH && existsSync(cp)) {
    log(`  ${state}: cache hit -> ${cp}`);
    return JSON.parse(readFileSync(cp, "utf8"));
  }

  log(`  ${state}: fetching migration content...`);
  const typeFilter = `content_type=in.(${MIGRATION_TYPES.join(",")})`;
  const migRows = await restGetAll(
    `hunt_knowledge?select=content,effective_date&state_abbr=eq.${state}` +
      `&${typeFilter}&effective_date=gte.${FROM}&effective_date=lte.${TO}` +
      `&order=effective_date.asc`,
  );
  const waterfowl: Record<string, number> = {};
  for (const r of migRows) {
    if (!r.effective_date || !r.content) continue;
    const m = WATERFOWL_RE.exec(r.content);
    if (!m) continue;
    const day = dayKey(r.effective_date);
    const n = parseInt(m[1], 10);
    // If multiple rows land on one day (spike + daily), keep the max waterfowl seen
    waterfowl[day] = Math.max(waterfowl[day] ?? 0, n);
  }
  log(`  ${state}: ${migRows.length} migration rows -> ${Object.keys(waterfowl).length} days with waterfowl:N`);

  log(`  ${state}: fetching location_count (effort proxy)...`);
  const histRows = await restGetAll(
    `hunt_migration_history?select=date,location_count&state_abbr=eq.${state}` +
      `&species=eq.all-birds&date=gte.${FROM}&date=lte.${TO}&order=date.asc`,
  );
  const locations: Record<string, number> = {};
  for (const r of histRows) {
    if (r.date) locations[dayKey(r.date)] = r.location_count ?? 0;
  }

  log(`  ${state}: fetching cold_front events...`);
  const frontRows = await restGetAll(
    `hunt_weather_events?select=event_date,metadata&state_abbr=eq.${state}` +
      `&event_type=eq.cold_front&event_date=gte.${FROM}&event_date=lte.${TO}` +
      `&order=event_date.asc`,
  );
  const frontDrop: Record<string, number> = {};
  const frontSet = new Set<string>();
  for (const r of frontRows) {
    if (!r.event_date) continue;
    const drop = Number(r.metadata?.temp_drop_f ?? 0);
    if (drop < TEMP_DROP_MIN) continue; // honor the configured threshold
    const day = dayKey(r.event_date);
    frontSet.add(day);
    frontDrop[day] = Math.max(frontDrop[day] ?? 0, drop);
  }
  const frontDates = [...frontSet].sort();
  log(`  ${state}: ${frontDates.length} cold_front days (>=${TEMP_DROP_MIN}F drop)`);

  const raw: RawState = { state, from: FROM, to: TO, waterfowl, locations, frontDates, frontDrop };
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cp, JSON.stringify(raw));
  log(`  ${state}: cached -> ${cp}`);
  return raw;
}

// ---------------------------------------------------------------------------
// Build effort-corrected, deseasonalized daily z-anomaly series
// ---------------------------------------------------------------------------

interface Series {
  state: string;
  flyway: string;
  // date -> z-anomaly of effort-corrected waterfowl density
  z: Record<string, number>;
  frontDates: string[];
  frontDrop: Record<string, number>;
  effortCorrected: boolean;
}

function buildSeries(raw: RawState): Series {
  const flyway = STATE_FLYWAY[raw.state] || "Unknown";
  const days = Object.keys(raw.waterfowl).sort();

  // Effort correction: waterfowl / max(location_count, 1). If we have no
  // location data at all, fall back to raw (and flag it loudly downstream).
  const haveEffort = Object.keys(raw.locations).length > 0;
  const corrected: Record<string, number> = {};
  for (const d of days) {
    const loc = raw.locations[d];
    corrected[d] = haveEffort && loc && loc > 0 ? raw.waterfowl[d] / loc : raw.waterfowl[d];
  }

  // Trailing 21-day z-score (same deseasonalizing method the postmortem used).
  const z: Record<string, number> = {};
  for (const d of days) {
    const windowVals: number[] = [];
    for (let k = 1; k <= Z_WINDOW; k++) {
      const prev = addDays(d, -k);
      if (corrected[prev] !== undefined) windowVals.push(corrected[prev]);
    }
    if (windowVals.length < Z_MIN_N) continue;
    const m = mean(windowVals);
    const s = std(windowVals, m);
    if (!isFinite(s) || s === 0) continue;
    z[d] = (corrected[d] - m) / s;
  }

  return { state: raw.state, flyway, z, frontDates: raw.frontDates, frontDrop: raw.frontDrop, effortCorrected: haveEffort };
}

// ---------------------------------------------------------------------------
// The placebo-first test
// ---------------------------------------------------------------------------

interface ArmResult {
  lag: number;
  n: number;
  meanZ: number;
}

// Matched arm: mean post-front z-anomaly in the SAME state at each lag.
function matchedArm(s: Series, lag: number): ArmResult {
  const vals: number[] = [];
  for (const f of s.frontDates) {
    const target = addDays(f, lag);
    if (s.z[target] !== undefined) vals.push(s.z[target]);
  }
  return { lag, n: vals.length, meanZ: mean(vals) };
}

// Placebo arm: take the MATCHED state's front dates and read the WRONG-flyway
// state's z-anomaly at the same lag — but only when the wrong-flyway state had
// NO cold_front within +/-3 days (item 5: continental fronts break the placebo).
function placeboArm(front: Series, wrong: Series, lag: number): ArmResult {
  const wrongFrontDays = new Set(wrong.frontDates);
  const contaminated = (d: string) => {
    for (let k = -3; k <= 3; k++) if (wrongFrontDays.has(addDays(d, k))) return true;
    return false;
  };
  const vals: number[] = [];
  for (const f of front.frontDates) {
    if (contaminated(f)) continue; // wrong flyway also had a front — not a clean placebo
    const target = addDays(f, lag);
    if (wrong.z[target] !== undefined) vals.push(wrong.z[target]);
  }
  return { lag, n: vals.length, meanZ: mean(vals) };
}

// Baseline (matched control): mean z-anomaly on NON-front days in the same
// state, restricted to calendar weeks that contained a front (same-week control).
function baselineArm(s: Series): ArmResult {
  const frontDays = new Set(s.frontDates);
  const frontWeeks = new Set(s.frontDates.map(isoWeek));
  // also exclude the +1..+3 windows so we compare to genuine no-front days
  const inWindow = new Set<string>();
  for (const f of s.frontDates) for (const l of LAGS) inWindow.add(addDays(f, l));
  const vals: number[] = [];
  for (const [d, zv] of Object.entries(s.z)) {
    if (frontDays.has(d) || inWindow.has(d)) continue;
    if (!frontWeeks.has(isoWeek(d))) continue;
    vals.push(zv);
  }
  return { lag: 0, n: vals.length, meanZ: mean(vals) };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function fmt(x: number): string {
  return isFinite(x) ? x.toFixed(3) : "n/a";
}

function report(seriesList: Series[]) {
  console.log("\n" + "=".repeat(78));
  console.log("DUCK–FRONT TEST — MVE RESULT (placebo-first screen)");
  console.log("=".repeat(78));

  // Effort-confound caveat — FRONT AND CENTER, per the postmortem checklist.
  const anyUncorrected = seriesList.some((s) => !s.effortCorrected);
  console.log("\n### CAVEAT #1 — THE EFFORT CONFOUND (read this first) ###");
  console.log("eBird counts track BIRDER ACTIVITY, not birds. A front clears the sky ->");
  console.log("nicer day -> more checklists -> more birds counted. That manufactures a");
  console.log("front->'pulse' correlation that is pure observer behavior and is temporally");
  console.log("aligned with fronts (worst kind). This MVE only crudely corrects via");
  console.log("waterfowl / location_count. The real fix is EBD birds-per-party-hour (see");
  console.log("docs/EBD-REQUEST.md). ANY positive result here is presumed effort artifact");
  console.log("until the EBD lands.");
  if (anyUncorrected) {
    console.log("!! WARNING: one or more states had NO location_count data — those series are");
    console.log("!! RAW (uncorrected). Treat their numbers as effort-driven noise.");
  }
  console.log("\n### CAVEAT #2 — n=1 fall season, state-aggregation smear, one live window. ###");
  console.log("Underpowered by construction. A null here is NOT exoneration; a positive is");
  console.log("NOT proof. This screen exists to decide whether the full EBD build is worth it.");

  console.log("\n### PER-STATE COVERAGE ###");
  for (const s of seriesList) {
    const zdays = Object.keys(s.z).length;
    console.log(
      `  ${s.state} (${s.flyway}): ${zdays} z-scored days, ${s.frontDates.length} fronts, ` +
        `effort-corrected=${s.effortCorrected}`,
    );
  }

  // PLACEBO FIRST — for every ordered (front-flyway X, wrong-flyway Y) pair.
  console.log("\n### THE PLACEBO TEST (runs FIRST) ###");
  console.log("matchedZ = post-front anomaly in the front's OWN flyway.");
  console.log("placeboZ = same fronts, read in a WRONG flyway (frontless there +/-3d).");
  console.log("baselineZ = same-week no-front days in the front's own flyway.");
  console.log("If matchedZ is NOT clearly above BOTH placeboZ and baselineZ -> SEASONALITY, STOP.\n");

  const lensLog: string[] = [];
  let anySeparation = false;

  for (const front of seriesList) {
    const base = baselineArm(front);
    for (const wrong of seriesList) {
      if (wrong.state === front.state) continue;
      if (wrong.flyway === front.flyway) continue; // wrong arm must be a DIFFERENT flyway
      for (const lag of LAGS) {
        const m = matchedArm(front, lag);
        const p = placeboArm(front, wrong, lag);
        lensLog.push(
          `front=${front.state}(${front.flyway}) wrong=${wrong.state}(${wrong.flyway}) lag=${lag}`,
        );
        const separates =
          isFinite(m.meanZ) &&
          isFinite(p.meanZ) &&
          isFinite(base.meanZ) &&
          m.n >= 5 &&
          m.meanZ > 0.15 &&
          m.meanZ - p.meanZ > 0.15 &&
          m.meanZ - base.meanZ > 0.15;
        if (separates) anySeparation = true;
        console.log(
          `  ${front.state}->${wrong.state}  lag+${lag}:  ` +
            `matchedZ=${fmt(m.meanZ)} (n=${m.n})   ` +
            `placeboZ=${fmt(p.meanZ)} (n=${p.n})   ` +
            `baselineZ=${fmt(base.meanZ)} (n=${base.n})   ` +
            `${separates ? "<-- separates" : ""}`,
        );
      }
    }
  }

  // Multiple-comparisons honesty (postmortem rule #6): log every lens tried.
  console.log(`\n### LENSES TRIED (log all — BH-correct any survivor) ###`);
  console.log(`  ${lensLog.length} (front-flyway x wrong-flyway x lag) combinations evaluated.`);
  console.log(`  A survivor found after this many silent tries is noise until BH-corrected`);
  console.log(`  and replicated on a second season (which we do not have — n=1).`);

  console.log("\n### VERDICT ###");
  if (!anySeparation) {
    console.log("  NO SEPARATION. The matched-flyway arm does not beat the wrong-flyway");
    console.log("  placebo (and/or the same-week baseline). Per the placebo-first rule this");
    console.log("  reads as SEASONALITY / no local mechanism at this resolution — OR simply");
    console.log("  underpowered (n=1 season, state smear). Either way: DO NOT claim signal.");
    console.log("  The honest next step is the EBD full build, not a stronger claim here.");
  } else {
    console.log("  A matched arm separated from BOTH placebo and baseline on >=1 lens.");
    console.log("  This is a DIRECTIONAL HINT ONLY. It is NOT signal: (a) presumed effort");
    console.log("  artifact until EBD party-hour correction, (b) not BH-corrected across the");
    console.log("  lenses above, (c) n=1 season, un-cross-validatable. Report it as 'worth");
    console.log("  the EBD build,' never as 'fronts drive ducks.'");
  }
  console.log("=".repeat(78) + "\n");
}

// ---------------------------------------------------------------------------
// Self-test — proves the parse + z-score + placebo pipeline runs, no DB.
// Injects a KNOWN matched-flyway signal and a flat wrong flyway; the placebo
// arm must run and the matched arm must exceed it.
// ---------------------------------------------------------------------------

function selfTest() {
  log("SELF-TEST: synthetic pipeline (no DB)");

  // Build a synthetic RawState with a planted front->pulse in the matched state.
  // `frontMod` staggers the wrong flyway's fronts onto DIFFERENT dates so the
  // placebo arm has clean (frontless) days to read.
  function synth(state: string, planted: boolean, frontMod: number): RawState {
    const waterfowl: Record<string, number> = {};
    const locations: Record<string, number> = {};
    const frontDrop: Record<string, number> = {};
    const frontDates: string[] = [];
    const isFront = (i: number) => i > 20 && i % 20 === frontMod;
    let d = "2025-09-01";
    for (let i = 0; i < 200; i++) {
      // baseline density ~100 birds over ~10 hotspots (+ mild wobble)
      let count = 100 + Math.round(20 * Math.sin(i / 7));
      // planted pulse at +2 days after this state's own fronts
      if (planted && isFront(i - 2)) count = 260;
      waterfowl[d] = count;
      locations[d] = 10;
      if (isFront(i)) {
        frontDates.push(d);
        frontDrop[d] = 18;
      }
      d = addDays(d, 1);
    }
    return { state, from: "2025-09-01", to: "2026-03-01", waterfowl, locations, frontDates, frontDrop };
  }

  // Also verify the content-parse regex on a real-shaped content string.
  const sample =
    "SPIKE(moderate) migration | Kansas | 2025-11-04 | all-birds sightings:1841 waterfowl:342 songbird:900 baseline:1200.0 deviation:53.4% | Cheyenne Bottoms, Quivira";
  const parsed = WATERFOWL_RE.exec(sample);
  log(`  content-parse check: waterfowl=${parsed ? parsed[1] : "FAIL"} (expect 342)`);
  if (!parsed || parsed[1] !== "342") throw new Error("content parse regex FAILED");

  const matched = buildSeries(synth("KS", true, 0)); // Central, planted signal, fronts at i%20==0
  const wrong = buildSeries(synth("MD", false, 10)); // Atlantic, flat, fronts staggered to i%20==10
  log(`  matched(KS) z-days=${Object.keys(matched.z).length} fronts=${matched.frontDates.length}`);
  log(`  wrong(MD)   z-days=${Object.keys(wrong.z).length} fronts=${wrong.frontDates.length}`);

  const m2 = matchedArm(matched, 2);
  const p2 = placeboArm(matched, wrong, 2);
  const base = baselineArm(matched);
  log(`  matchedArm lag+2: meanZ=${fmt(m2.meanZ)} n=${m2.n}  (expect strongly positive)`);
  log(`  placeboArm lag+2: meanZ=${fmt(p2.meanZ)} n=${p2.n}  (expect ~0, and n>0 => arm RAN)`);
  log(`  baselineArm:      meanZ=${fmt(base.meanZ)} n=${base.n}`);

  const ok =
    p2.n > 0 && // placebo arm actually executed
    isFinite(m2.meanZ) &&
    m2.meanZ > 0.5 && // planted signal recovered
    m2.meanZ - p2.meanZ > 0.5; // matched beats placebo
  log(`  SELF-TEST ${ok ? "PASS" : "FAIL"} — placebo arm ran=${p2.n > 0}, matched>placebo=${m2.meanZ - p2.meanZ > 0.5}`);
  if (!ok) process.exit(1);

  // Run the full report on the synthetic pair too, to exercise the printer.
  report([matched, wrong]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (SELF_TEST) {
    selfTest();
    return;
  }
  if (!SERVICE_KEY) {
    console.error("SUPABASE_SERVICE_ROLE_KEY required (or run with --self-test)");
    process.exit(1);
  }

  log(`States: ${STATES.join(", ")}  window ${FROM}..${TO}  lags ${LAGS.join(",")}`);
  log(`Flyways: ${STATES.map((s) => `${s}=${STATE_FLYWAY[s]}`).join(" ")}`);
  const flyways = new Set(STATES.map((s) => STATE_FLYWAY[s]));
  if (flyways.size < 2) {
    log("WARNING: all states share one flyway — the placebo arm cannot run. Add a cross-flyway state.");
  }

  const seriesList: Series[] = [];
  for (const state of STATES) {
    const raw = await fetchState(state); // checkpointed
    seriesList.push(buildSeries(raw));
  }

  report(seriesList);
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
