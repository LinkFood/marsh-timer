/**
 * Duck–Front MVE — the "founding-fact" experiment at DAILY resolution, PLACEBO-FIRST.
 * ============================================================================
 *
 * QUESTION (docs/DUCK-FRONT-TEST-SCOPE.md): at daily resolution, do cold-front
 * passages precede duck/waterfowl migration pulses by 1–3 days — in the MATCHED
 * flyway but NOT in a WRONG flyway?
 *
 * NON-NEGOTIABLE (from the convergence postmortem, 2026-07-02): run the
 * wrong-flyway PLACEBO FIRST. If a front in flyway X "predicts" a pulse in
 * flyway Y just as well as in flyway X, the whole thing is seasonality and we
 * STOP with the verdict "seasonal artifact, no mechanism visible at this
 * resolution." Every positive is presumed effort/seasonal artifact until the
 * placebo clears it.
 *
 * READ-ONLY. Zero DB writes, zero embedding, zero schema change. Single script.
 * REST against hunt_knowledge / hunt_migration_history / hunt_weather_events /
 * hunt_weather_history with the postmortem's hard rules:
 *   - hunt_knowledge NEVER ordered by created_at; every query filters
 *     content_type + state_abbr + effective_date bounds and orders by
 *     effective_date (btree-indexed).
 *   - PostgREST 1000-row cap respected: every fetch is a bounded window,
 *     paginated by offset/limit when a window could exceed 1000.
 *   - Retryable errors (5xx, Cloudflare 522, 57014 statement timeout) get
 *     generous backoff (up to 2 min, 10 attempts) — rides out the index
 *     rebuild. NON-retryable 4xx aborts immediately.
 *   - No exact counts.
 *
 * TWO waterfowl series are built and reported SEPARATELY (the effort confound
 * differs between them — this is deliberate, per the task):
 *   - "wf-text"  : waterfowl-isolated daily count parsed from hunt_knowledge
 *                  content ("... waterfowl:N ...") — the migration-monitor cron
 *                  writes it into the embedding text but not as a column.
 *   - "allbirds" : hunt_migration_history.sighting_count (raw Σ howMany, ALL
 *                  birds) — the clean PK'd column, but not waterfowl-isolated.
 * Both are effort-corrected by dividing by location_count (unique hotspots ≈
 * weak effort proxy — the crude MVE mitigation; the real fix is EBD party-hours,
 * out of scope) and deseasonalized to a within-state trailing-21-day z-score.
 *
 * THE EFFORT CONFOUND IS NOT SOLVED HERE. Per the scope doc, any positive
 * result is presumed an observer-behavior artifact until the EBD birds/party-hour
 * series exists. This MVE's job is (a) run the honest placebo cheaply, (b) tell
 * us whether the full EBD project is worth it — NOT to answer the question.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/duck-front-mve.ts
 * Env:
 *   DATE_FROM=2025-10-01 DATE_TO=2026-07-03   window bounds (default live window)
 *   STATES=KS,AR,MD,CA                          representative states (1 per flyway)
 *   TEMP_DROP_MIN=15                            °F drop to count a cold_front (default: any stored)
 *   LAGS=1,2,3                                  response lags in days
 *   PLACEBO_GUARD_DAYS=3                        partner must be front-free within ±N days of event
 *   OUT_DIR=analysis/duck-front-mve             where the JSON report lands
 *   SLICE=1                                     validation slice: STATES=KS,CA, last 120 days only
 */

import * as fs from "fs";
import * as path from "path";

const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://rvhyotvklfowklzjahdd.supabase.co";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  (() => {
    // fall back to a local key file if present (validation convenience only)
    const p = path.join(process.env.HOME || "", ".dcd_sk");
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8").trim() : undefined;
  })();

if (!SERVICE_KEY) {
  console.error("SUPABASE_SERVICE_ROLE_KEY required");
  process.exit(1);
}

const SCRIPTS_DIR = import.meta.dirname || __dirname;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SLICE = process.env.SLICE === "1";

const DATE_FROM = process.env.DATE_FROM || (SLICE ? "2026-03-05" : "2025-10-01");
const DATE_TO = process.env.DATE_TO || "2026-07-03";

const STATES = (process.env.STATES || (SLICE ? "KS,CA" : "KS,AR,MD,CA"))
  .toUpperCase()
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// °F day-over-day high drop required to count a stored cold_front event as a
// "front" for this run. hunt-weather-watchdog already thresholds at >15°F, so
// the default 0 keeps every stored event; raise it to tighten.
const TEMP_DROP_MIN = process.env.TEMP_DROP_MIN
  ? parseFloat(process.env.TEMP_DROP_MIN)
  : 0;

const LAGS = (process.env.LAGS || "1,2,3")
  .split(",")
  .map((x) => parseInt(x.trim(), 10))
  .filter((x) => Number.isFinite(x));

const PLACEBO_GUARD_DAYS = process.env.PLACEBO_GUARD_DAYS
  ? parseInt(process.env.PLACEBO_GUARD_DAYS, 10)
  : 3;

const Z_WINDOW = 21; // trailing-day window for deseasonalization z-score
const Z_MIN_HISTORY = 10; // need >=N trailing obs to trust a z-score
const Z_STD_FLOOR = 0.5; // floor so a flat window doesn't explode z

const OUT_DIR = path.resolve(
  process.env.OUT_DIR ||
    path.join(SCRIPTS_DIR, "..", "analysis", "duck-front-mve"),
);

const supaHeaders = {
  Authorization: `Bearer ${SERVICE_KEY}`,
  apikey: SERVICE_KEY!,
};

// ---------------------------------------------------------------------------
// state → flyway (USFWS four-flyway administrative boundaries, whole-state
// assignment). Straddle states (MT/WY/CO between Central & Pacific; the Dakotas
// nominally Central) are assigned to their PRIMARY administrative flyway. This
// is the standard USFWS waterfowl-council map. Documented so the placebo pairing
// is auditable. AK -> Pacific, HI omitted.
// ---------------------------------------------------------------------------

const FLYWAY: Record<string, "Atlantic" | "Mississippi" | "Central" | "Pacific"> = {
  // Atlantic
  ME: "Atlantic", NH: "Atlantic", VT: "Atlantic", MA: "Atlantic", RI: "Atlantic",
  CT: "Atlantic", NY: "Atlantic", NJ: "Atlantic", PA: "Atlantic", DE: "Atlantic",
  MD: "Atlantic", WV: "Atlantic", VA: "Atlantic", NC: "Atlantic", SC: "Atlantic",
  GA: "Atlantic", FL: "Atlantic",
  // Mississippi
  AL: "Mississippi", AR: "Mississippi", IL: "Mississippi", IN: "Mississippi",
  IA: "Mississippi", KY: "Mississippi", LA: "Mississippi", MI: "Mississippi",
  MN: "Mississippi", MS: "Mississippi", MO: "Mississippi", OH: "Mississippi",
  TN: "Mississippi", WI: "Mississippi",
  // Central
  CO: "Central", KS: "Central", MT: "Central", NE: "Central", NM: "Central",
  ND: "Central", OK: "Central", SD: "Central", TX: "Central", WY: "Central",
  // Pacific
  AZ: "Pacific", CA: "Pacific", ID: "Pacific", NV: "Pacific", OR: "Pacific",
  UT: "Pacific", WA: "Pacific", AK: "Pacific",
};

// ---------------------------------------------------------------------------
// Fetch helper — bounded, paginated, retryable-vs-not per the hard rules
// ---------------------------------------------------------------------------

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson<T>(pathAndQuery: string, label: string): Promise<T> {
  const MAX = 10;
  for (let attempt = 0; attempt < MAX; attempt++) {
    const backoff = Math.min(120_000, (attempt + 1) * 12_000);
    try {
      const res = await fetch(SUPABASE_URL + pathAndQuery, { headers: supaHeaders });
      if (res.ok) return (await res.json()) as T;

      const text = await res.text();
      const isStmtTimeout = text.includes("57014");
      const isCf522 = res.status === 522 || text.includes("Connection timed out");
      // NON-retryable 4xx (bad query, auth) aborts immediately. 57014 and CF522
      // are server-side load/timeout — always retry.
      if (res.status >= 400 && res.status < 500 && !isStmtTimeout && !isCf522) {
        throw new Error(`${label}: 4xx (not retrying) ${res.status} ${text.slice(0, 250)}`);
      }
      if (attempt < MAX - 1) {
        console.log(
          `    ${label}: ${res.status}${isStmtTimeout ? " (57014)" : isCf522 ? " (522)" : ""}, retry ${attempt + 1}/${MAX} in ${backoff / 1000}s`,
        );
        await delay(backoff);
        continue;
      }
      throw new Error(`${label}: failed after ${MAX} retries: ${res.status} ${text.slice(0, 250)}`);
    } catch (err: any) {
      if (err.message?.includes("4xx (not retrying)")) throw err;
      if (attempt < MAX - 1) {
        console.log(`    ${label}: ${err.message?.slice(0, 120)}, retry ${attempt + 1}/${MAX}`);
        await delay(backoff);
        continue;
      }
      throw err;
    }
  }
  throw new Error(`${label}: exhausted retries`);
}

/** Paginate a bounded table window past the 1000-row cap via offset/limit. */
async function fetchAllPaged<T>(baseQuery: string, label: string): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await fetchJson<T[]>(`${baseQuery}&limit=${PAGE}&offset=${offset}`, `${label}[${offset}]`);
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Series builders
// ---------------------------------------------------------------------------

const MIGRATION_CONTENT_TYPES = [
  "migration-daily",
  "migration-spike-moderate",
  "migration-spike-significant",
  "migration-spike-extreme",
  "migration-lull",
];

interface DailyPoint {
  date: string;
  waterfowlRaw: number | null; // parsed waterfowl:N from content
  allbirdsRaw: number | null; // sighting_count (all birds)
  locationCount: number | null; // effort proxy
}

interface KnowledgeRow {
  effective_date: string;
  content: string;
  content_type: string;
}

interface MigHistRow {
  date: string;
  sighting_count: number | null;
  location_count: number | null;
}

/** Parse "waterfowl:N" out of the migration embedding text. Returns null if the
 * token is absent (groupBreakdown drops zero-count groups, so absence == 0 birds
 * counted OR no waterfowl seen — we treat absent as 0, present as N). */
function parseWaterfowl(content: string): number | null {
  const m = content.match(/waterfowl:(\d+)/i);
  if (m) return parseInt(m[1], 10);
  // Only treat as 0 (not null) if this is a real migration line (has "sightings:")
  if (/sightings:\d+/i.test(content)) return 0;
  return null;
}

async function buildDailySeries(state: string): Promise<DailyPoint[]> {
  // hunt_knowledge: waterfowl text. One row per state-day in window (<1000 for
  // ~1yr) but paginate to be safe.
  const ctIn = `(${MIGRATION_CONTENT_TYPES.join(",")})`;
  const kRows = await fetchAllPaged<KnowledgeRow>(
    `/rest/v1/hunt_knowledge?select=effective_date,content,content_type` +
      `&content_type=in.${ctIn}` +
      `&state_abbr=eq.${state}` +
      `&effective_date=gte.${DATE_FROM}` +
      `&effective_date=lte.${DATE_TO}` +
      `&order=effective_date.asc`,
    `wf-text ${state}`,
  );

  // hunt_migration_history: all-birds + location_count. PK (state,species,date).
  const hRows = await fetchAllPaged<MigHistRow>(
    `/rest/v1/hunt_migration_history?select=date,sighting_count,location_count` +
      `&state_abbr=eq.${state}` +
      `&species=eq.all-birds` +
      `&date=gte.${DATE_FROM}` +
      `&date=lte.${DATE_TO}` +
      `&order=date.asc`,
    `mig-hist ${state}`,
  );

  // Merge by date. Prefer one row per date (dedupe — hunt_knowledge can carry
  // dup inserts; take the last-seen waterfowl value per date).
  const byDate = new Map<string, DailyPoint>();
  for (const r of kRows) {
    const d = r.effective_date;
    const wf = parseWaterfowl(r.content);
    const prev = byDate.get(d);
    byDate.set(d, {
      date: d,
      waterfowlRaw: wf ?? prev?.waterfowlRaw ?? null,
      allbirdsRaw: prev?.allbirdsRaw ?? null,
      locationCount: prev?.locationCount ?? null,
    });
  }
  for (const r of hRows) {
    const d = r.date;
    const prev = byDate.get(d);
    byDate.set(d, {
      date: d,
      waterfowlRaw: prev?.waterfowlRaw ?? null,
      allbirdsRaw: r.sighting_count ?? prev?.allbirdsRaw ?? null,
      locationCount: r.location_count ?? prev?.locationCount ?? null,
    });
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Front series
// ---------------------------------------------------------------------------

interface FrontEventRow {
  state_abbr: string;
  event_date: string;
  temp_drop_f: number | null;
}

async function fetchFronts(state: string): Promise<Set<string>> {
  const rows = await fetchAllPaged<FrontEventRow>(
    `/rest/v1/hunt_weather_events?select=state_abbr,event_date,temp_drop_f` +
      `&event_type=eq.cold_front` +
      `&state_abbr=eq.${state}` +
      `&event_date=gte.${DATE_FROM}` +
      `&event_date=lte.${DATE_TO}` +
      `&order=event_date.asc`,
    `fronts ${state}`,
  );
  const set = new Set<string>();
  for (const r of rows) {
    // TEMP_DROP_MIN=0 keeps every stored cold_front; >0 requires the stored
    // drop magnitude meet it (watchdog stores temp_drop_f as a positive number).
    if (TEMP_DROP_MIN === 0 || (r.temp_drop_f ?? 0) >= TEMP_DROP_MIN) set.add(r.event_date);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Deseasonalize: within-state trailing-21-day z-score of the effort-corrected
// series. Same method the postmortem reformulation used.
// ---------------------------------------------------------------------------

interface ZSeries {
  // date -> z-anomaly (null where insufficient trailing history / missing value)
  wfZ: Map<string, number | null>;
  allbirdsZ: Map<string, number | null>;
  coverage: { wfDays: number; allbirdsDays: number; totalDays: number };
}

function effortCorrect(raw: number | null, loc: number | null): number | null {
  if (raw == null) return null;
  return raw / Math.max(loc ?? 1, 1);
}

function trailingZ(
  points: DailyPoint[],
  pick: (p: DailyPoint) => number | null,
): Map<string, number | null> {
  const z = new Map<string, number | null>();
  const hist: { date: string; v: number }[] = [];
  for (const p of points) {
    const v = pick(p);
    // trailing window strictly BEFORE this date (no leakage of today's value)
    const cutoff = new Date(p.date + "T00:00:00Z");
    cutoff.setUTCDate(cutoff.getUTCDate() - Z_WINDOW);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const window = hist.filter((h) => h.date > cutoffStr);
    if (v == null || window.length < Z_MIN_HISTORY) {
      z.set(p.date, null);
    } else {
      const mean = window.reduce((a, b) => a + b.v, 0) / window.length;
      const varSum = window.reduce((a, b) => a + (b.v - mean) ** 2, 0);
      const std = Math.max(Math.sqrt(varSum / Math.max(1, window.length - 1)), Z_STD_FLOOR);
      z.set(p.date, Math.max(-8, Math.min(8, (v - mean) / std)));
    }
    if (v != null) hist.push({ date: p.date, v });
  }
  return z;
}

function buildZSeries(points: DailyPoint[]): ZSeries {
  const wfZ = trailingZ(points, (p) => effortCorrect(p.waterfowlRaw, p.locationCount));
  const allbirdsZ = trailingZ(points, (p) => effortCorrect(p.allbirdsRaw, p.locationCount));
  return {
    wfZ,
    allbirdsZ,
    coverage: {
      wfDays: points.filter((p) => p.waterfowlRaw != null).length,
      allbirdsDays: points.filter((p) => p.allbirdsRaw != null).length,
      totalDays: points.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

function mean(a: number[]): number {
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
}
function std(a: number[]): number {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1));
}
/** Welch two-sample t and a normal-approx two-sided p. Rough — n is small; this
 * is a screen, not a publication test. */
function welch(a: number[], b: number[]): { t: number; p: number; df: number } {
  const ma = mean(a), mb = mean(b);
  const va = std(a) ** 2, vb = std(b) ** 2;
  const na = a.length, nb = b.length;
  const se = Math.sqrt(va / na + vb / nb);
  if (!(se > 0) || na < 2 || nb < 2) return { t: NaN, p: NaN, df: NaN };
  const t = (ma - mb) / se;
  const df =
    (va / na + vb / nb) ** 2 /
    ((va / na) ** 2 / (na - 1) + (vb / nb) ** 2 / (nb - 1));
  // two-sided p via normal approx (df usually >20 here; conservative enough)
  const p = 2 * (1 - normCdf(Math.abs(t)));
  return { t, p, df };
}
function normCdf(x: number): number {
  // Abramowitz-Stegun
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const prob =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return 1 - prob;
}
/** One-sample t vs 0. */
function oneSampleT(a: number[]): { mean: number; t: number; p: number; n: number } {
  const m = mean(a), s = std(a), n = a.length;
  if (n < 2 || !(s > 0)) return { mean: m, t: NaN, p: NaN, n };
  const t = m / (s / Math.sqrt(n));
  return { mean: m, t, p: 2 * (1 - normCdf(Math.abs(t))), n };
}

// Benjamini-Hochberg
function bh(pvals: { key: string; p: number }[]): Record<string, number> {
  const valid = pvals.filter((x) => Number.isFinite(x.p)).sort((a, b) => a.p - b.p);
  const m = valid.length;
  const out: Record<string, number> = {};
  let prev = 1;
  for (let i = m - 1; i >= 0; i--) {
    const q = Math.min(prev, (valid[i].p * m) / (i + 1));
    out[valid[i].key] = q;
    prev = q;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Event study — PLACEBO FIRST
// ---------------------------------------------------------------------------

interface StateData {
  state: string;
  flyway: string;
  points: DailyPoint[];
  z: ZSeries;
  fronts: Set<string>;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** For a treatment state's front days, gather the response z at each lag in the
 * SAME state (matched arm). For the placebo arm we read the SAME dates+lags in a
 * WRONG-flyway partner that had NO front within ±guard days of the event day.
 * Because dates are identical across arms, calendar-week / seasonality is held
 * constant by construction — any matched>placebo gap is the local signal. */
function eventStudy(
  treat: StateData,
  partner: StateData,
  series: "wfZ" | "allbirdsZ",
): {
  lag: number;
  matched: number[];
  placebo: number[];
  nEventsUsed: number;
  nEventsDropped: number;
}[] {
  const results: {
    lag: number;
    matched: number[];
    placebo: number[];
    nEventsUsed: number;
    nEventsDropped: number;
  }[] = LAGS.map((lag) => ({ lag, matched: [], placebo: [], nEventsUsed: 0, nEventsDropped: 0 }));

  const partnerHasFrontNear = (d: string): boolean => {
    for (let k = -PLACEBO_GUARD_DAYS; k <= PLACEBO_GUARD_DAYS; k++) {
      if (partner.fronts.has(addDays(d, k))) return true;
    }
    return false;
  };

  for (const fd of [...treat.fronts].sort()) {
    // continental-front guard: skip events where the placebo partner also had a
    // front that week (else "wrong flyway" isn't frontless — self-deception #5)
    const partnerContaminated = partnerHasFrontNear(fd);
    for (const r of results) {
      const respDate = addDays(fd, r.lag);
      const mZ = treat.z[series].get(respDate) ?? null;
      const pZ = partner.z[series].get(respDate) ?? null;
      if (mZ != null) r.matched.push(mZ);
      if (!partnerContaminated && pZ != null) {
        r.placebo.push(pZ);
        r.nEventsUsed++;
      } else if (partnerContaminated) {
        r.nEventsDropped++;
      }
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`\n=== Duck–Front MVE (placebo-first) ===`);
  console.log(`window ${DATE_FROM} → ${DATE_TO} | states ${STATES.join(",")} | lags ${LAGS.join(",")}`);
  console.log(`SLICE=${SLICE} TEMP_DROP_MIN=${TEMP_DROP_MIN} placebo-guard=±${PLACEBO_GUARD_DAYS}d\n`);

  // lens ledger — EVERY lens tried is logged (postmortem rule: a survivor found
  // after N silent tries is noise; BH-correct across all of them).
  const lensLedger: string[] = [];

  const data: Record<string, StateData> = {};
  for (const st of STATES) {
    const fw = FLYWAY[st];
    if (!fw) {
      console.log(`  ! ${st}: no flyway assignment, skipping`);
      continue;
    }
    console.log(`  building ${st} (${fw})...`);
    const points = await buildDailySeries(st);
    const z = buildZSeries(points);
    const fronts = await fetchFronts(st);
    data[st] = { state: st, flyway: fw, points, z, fronts };
    console.log(
      `    ${st}: ${points.length} day-rows, wf-cover ${z.coverage.wfDays}, allbirds-cover ${z.coverage.allbirdsDays}, fronts ${fronts.size}`,
    );
  }

  const present = Object.values(data);
  if (present.length < 2) {
    console.log(`\nNeed >=2 states across >=2 flyways to run the placebo. Have ${present.length}. Aborting.`);
    return;
  }

  // Assign each treatment state a WRONG-flyway partner (deterministic: nearest
  // other-flyway state by list order; must be a different flyway).
  const partnerFor: Record<string, string> = {};
  for (const t of present) {
    const cand = present.find((p) => p.flyway !== t.flyway);
    if (cand) partnerFor[t.state] = cand.state;
  }

  const report: any = {
    experiment: "duck-front-mve",
    startedAt,
    window: { from: DATE_FROM, to: DATE_TO },
    config: { states: STATES, lags: LAGS, tempDropMin: TEMP_DROP_MIN, placeboGuardDays: PLACEBO_GUARD_DAYS, slice: SLICE },
    flywayMap: Object.fromEntries(present.map((p) => [p.state, p.flyway])),
    partnerFor,
    coverage: Object.fromEntries(present.map((p) => [p.state, p.z.coverage])),
    frontCounts: Object.fromEntries(present.map((p) => [p.state, p.fronts.size])),
    arms: [] as any[],
    pForBH: [] as { key: string; p: number }[],
  };

  const SERIES: ("wfZ" | "allbirdsZ")[] = ["wfZ", "allbirdsZ"];

  for (const t of present) {
    const partnerState = partnerFor[t.state];
    if (!partnerState) continue;
    const partner = data[partnerState];

    for (const series of SERIES) {
      const seriesLabel = series === "wfZ" ? "wf-text" : "allbirds";
      const es = eventStudy(t, partner, series);
      for (const r of es) {
        const lens = `${t.state}(${t.flyway})→placebo:${partner.state}(${partner.flyway}) | ${seriesLabel} | lag+${r.lag}`;
        lensLedger.push(lens);

        const mStat = oneSampleT(r.matched);
        const pStat = oneSampleT(r.placebo);
        const contrast = welch(r.matched, r.placebo);

        report.arms.push({
          treatState: t.state,
          treatFlyway: t.flyway,
          placeboState: partner.state,
          placeboFlyway: partner.flyway,
          series: seriesLabel,
          lag: r.lag,
          matched: { n: mStat.n, meanZ: round(mStat.mean), t: round(mStat.t), p: round(mStat.p) },
          placebo: { n: pStat.n, meanZ: round(pStat.mean), t: round(pStat.t), p: round(pStat.p) },
          contrastMatchedMinusPlacebo: {
            deltaMeanZ: round(mStat.mean - pStat.mean),
            t: round(contrast.t),
            p: round(contrast.p),
          },
          placeboEventsDropped_continentalFront: r.nEventsDropped,
        });
        if (Number.isFinite(contrast.p)) report.pForBH.push({ key: lens, p: contrast.p });
      }
    }
  }

  // BH across every matched-vs-placebo contrast tried
  const qvals = bh(report.pForBH);
  for (const arm of report.arms) {
    const key = `${arm.treatState}(${arm.treatFlyway})→placebo:${arm.placeboState}(${arm.placeboFlyway}) | ${arm.series} | lag+${arm.lag}`;
    arm.contrastMatchedMinusPlacebo.q_BH = round(qvals[key] ?? NaN);
  }

  report.lensLedger = lensLedger;
  report.lensCount = lensLedger.length;

  // ---- VERDICT (placebo-first decision rule) --------------------------------
  // The MVE is a screen. A result "separates" only if, for a series+lag, the
  // matched arm is meaningfully positive AND beats its placebo after BH.
  const SEP_DELTA = 0.25; // z-units — a floor below which "separation" is noise
  const separations = report.arms.filter(
    (a: any) =>
      a.matched.n >= 8 &&
      a.placebo.n >= 8 &&
      a.matched.meanZ > 0 &&
      a.contrastMatchedMinusPlacebo.deltaMeanZ >= SEP_DELTA &&
      Number.isFinite(a.contrastMatchedMinusPlacebo.q_BH) &&
      a.contrastMatchedMinusPlacebo.q_BH < 0.1,
  );

  const anyPowered = report.arms.some((a: any) => a.matched.n >= 8 && a.placebo.n >= 8);

  let verdict: string;
  if (!anyPowered) {
    verdict =
      "UNDERPOWERED — too few front-events with valid response z in this slice/window to run the placebo honestly. Not evidence of anything. (Expected for SLICE / off-season windows.)";
  } else if (separations.length === 0) {
    verdict =
      "SEASONAL ARTIFACT — NO MECHANISM VISIBLE AT THIS RESOLUTION. Wrong-flyway placebo predicts as well as (or better than) the matched flyway. Per the postmortem rule, we STOP: any apparent front→pulse link here is seasonality/effort, not a local mechanism. This is the expected MVE outcome given n=1 fall + effort confound + state-aggregation smear; a null here is NOT exoneration of the hypothesis — it means the EBD (party-hour-corrected, multi-season) data is required to see it, if it exists.";
  } else {
    verdict =
      `PLACEBO SEPARATED in ${separations.length} lens(es): ` +
      separations
        .map((s: any) => `${s.treatState} ${s.series} lag+${s.lag} (Δz=${s.contrastMatchedMinusPlacebo.deltaMeanZ}, q=${s.contrastMatchedMinusPlacebo.q_BH})`)
        .join("; ") +
      ". TREAT AS EFFORT-ARTIFACT-UNTIL-PROVEN: the crude location-count effort correction cannot rule out observer behavior (fronts → nice weather → more checklists). This is a GO signal for the EBD full version (§4), not an answer. Log stands; do not over-read one fall season.";
  }
  report.verdict = verdict;
  report.separationsFound = separations.length;

  // ---- write + print --------------------------------------------------------
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `report-${SLICE ? "slice-" : ""}${DATE_FROM}_${DATE_TO}.json`);
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));

  console.log(`\n--- ARMS (matched vs wrong-flyway placebo) ---`);
  for (const a of report.arms) {
    console.log(
      `${a.treatState}(${a.treatFlyway}) vs ${a.placeboState}(${a.placeboFlyway}) | ${a.series} lag+${a.lag} | ` +
        `matched z=${a.matched.meanZ} (n=${a.matched.n}) | placebo z=${a.placebo.meanZ} (n=${a.placebo.n}) | ` +
        `Δ=${a.contrastMatchedMinusPlacebo.deltaMeanZ} q=${a.contrastMatchedMinusPlacebo.q_BH} | dropped(cont.front)=${a.placeboEventsDropped_continentalFront}`,
    );
  }
  console.log(`\nlenses tried: ${report.lensCount}`);
  console.log(`\n=== VERDICT ===\n${verdict}\n`);
  console.log(`report → ${outFile}`);
}

function round(x: number): number | null {
  return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null;
}

main().catch((e) => {
  console.error("\nFATAL:", e.message);
  process.exit(1);
});
