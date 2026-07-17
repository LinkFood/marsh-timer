import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { STATE_NAMES } from '../_shared/states.ts';

// ---------------------------------------------------------------------------
// hunt-formation-watch — THE FORMATION LAYER v2 (docs/THE-WEEK.md 2026-07-17
// doctrine + docs/VALIDATED-LEADS-2026-07-17.md registry). Cron every 6h +
// on-demand GET. Every number in the copy is either read live from a lane or
// repeated EXACTLY from the registry's backtests — never invented.
//
// FIVE KNOWN-PHYSICS LEADS, fired by LIVE data, receipts attached:
//
//   flood-forming (v1, unchanged) — a state has >=1 unexpired NWS Flood Watch
//     on the live alert table. Lead time 1-3 DAYS (the court's watch->warning
//     retrodiction: 82% vs 28% control in the claim's 13 scoped states).
//     Links to the court's own hunt_claim_fires row where one exists — this
//     function NEVER inserts into the court's tables.
//
//   smoke-forming (v1 descriptive, MD ONLY) — v1's loose AQI trend survives
//     only for MD, whose chronic->=150 feed outlier (9.2% of days vs <1%
//     elsewhere) excludes it from B1 until audited. Descriptive copy only,
//     never the 7x claim.
//
//   aqi-ramp-forming (B1, registry lift 7.0, n=353) — strict ramp: max_aqi
//     rise >= +15/day on two CONSECUTIVE days AND day-D max in [100,150).
//     The strict band is load-bearing: "forming" never renders on
//     already-arrived smoke (119/472 loose-spec fires were persistence
//     contamination). All states EXCEPT MD. Lead time 1-2 days.
//     Court claim: b1-aqi-ramp-150.
//
//   drought-fire-forming (C1, registry lift 1.63, n=161, weeks-scale) —
//     weekly USDM lane: (D2+D3+D4)% >= 20 AND deepening week-over-week.
//     Graded tier MT/WA/ID/OR; watch tier NM (shown, not graded).
//     AZ/NV (lift 0.73/0.00) and TX/CO/CA (outcome-saturated) are NEVER
//     evaluated. Court claim: c1-drought-expansion-wildfire (grades
//     pending-settlement — NCEI lags ~a quarter).
//
//   precip-flood-forming (A2, registry lift 1.93, n=29,070) — 3-day rolling
//     precipitation sum on hunt_weather_history.precipitation_total_mm >=
//     the state-month p90 threshold (recomputed on THIS field — the A3
//     lesson: archive thresholds don't transfer; constant table below with
//     derivation receipts), OR any single day >= 2.0in. Lead time 1-2 days.
//     Court claim: a2-antecedent-precip-flood.
//
// Watch lifecycle in formation_watches (idempotent):
//   fired + no open watch  -> open (opened_at = today) + EMBED (embedding law)
//   fired + open watch     -> refresh evidence/copy/last_seen, keep opened_at
//   open watch + not fired -> status='faded', faded_at = today
//
// The court fires the three registered v2 claims off the embedded
// formation-watch rows (content_type 'formation-watch', needle
// '(<lead-id>)') — deterministic functions of the raw lanes, evidence
// attached; this function still never writes to the court's tables.
//
// Copy law: fact-only, lead-time honest, "forming" + the historical record,
// NEVER "will". The history book recognizes, it never predicts.
// ---------------------------------------------------------------------------

const FN = 'hunt-formation-watch';
const FLOOD_CLAIM_NAME = 'nws-flood-watch-verifies';
const NWS_HISTORY_START = '2026-03-08'; // earliest persistent nws-alert row on file
const AQI_TREND_DAYS = 4;               // 72h trend window + today
const MIN_FLOOD_PRECEDENT_DAYS = 3;     // below this, precedents = null (honest)

// v2 lead ids — parenthesized in the embedded content, which is what the
// court claims' text_any needles match on.
const B1_LEAD = 'aqi-ramp-forming';
const C1_LEAD = 'drought-fire-forming';
const A2_LEAD = 'precip-flood-forming';
const B1_EXCLUDED = new Set(['MD']);        // chronic->=150 outlier — descriptive only
const C1_GRADED_STATES = ['MT', 'WA', 'ID', 'OR'];
const C1_WATCH_STATES = ['NM'];             // watch tier: shown, not graded
// Registry backtest records — the receipts every fire carries. Numbers are
// the registry's, verbatim (docs/VALIDATED-LEADS-2026-07-17.md).
const B1_BACKTEST = {
  kind: 'backtest-record',
  n_fires: 353, hit_rate: 0.062, base_rate: 0.009, lift: 7.0,
  outcome: 'max_aqi >= 150 same state within 1-2 days',
  confound_on_record: 'fire-season month-matched base to harden at first court review',
  source: 'docs/VALIDATED-LEADS-2026-07-17.md (B1, backtested 2026-07-17)',
};
const C1_BACKTEST = {
  kind: 'backtest-record',
  n_fires: 161, hit_rate: 0.478, base_rate: 0.293, lift: 1.63, month_matched_lift: 1.39,
  outcome: 'wildfire event same state within 30 days',
  grading: 'pending-settlement — NCEI storm-event publishes with ~a quarter of lag',
  source: 'docs/VALIDATED-LEADS-2026-07-17.md (C1, backtested 2026-07-17)',
};
const A2_BACKTEST = {
  kind: 'backtest-record',
  n_fires: 29070, hit_rate: 0.247, base_rate: 0.128, lift: 1.93,
  scope: 'pooled all-states; 18/18 backtested states >= 1.5',
  outcome: 'flood signal same state within 1-2 days',
  confound_on_record: 'part of the lift is storm-system persistence — harden with next-day-precip-conditioned controls at first review',
  source: 'docs/VALIDATED-LEADS-2026-07-17.md (A2, backtested 2026-07-17)',
};

// A2 thresholds: per state-month p90 of the 3-day rolling sum of
// hunt_weather_history.precipitation_total_mm, in INCHES, floor 0.25.
// Derived 2026-07-17 from 51020 rows, 2020-09-01..2026-07-15,
// by scripts/compute-a2-thresholds.ts (deterministic: nearest-rank p90;
// rolling sum needs 3 consecutive calendar days present; mm/25.4).
// COVERAGE GAP ON RECORD: the table holds 5 hunting seasons (Sep-Feb,
// n~150/state-month) + the live era 2026-03+ only. Per-state-month n:
// m1:155-155 m2:141-141 m3:1-9 m4:15-27 m5:17-31 m6:20-30 m7:15-15 m8:0-0 m9:140-140 m10:155-155 m11:150-150 m12:155-155.
// Months with any state under 60 samples (3,4,5,6,7,8) fall back to the
// state's ALL-months p90 (same formula), then the 0.25in floor.
// Index 0 = January ... 11 = December.
const A2_P90_3DAY_IN: Record<string, number[]> = {
  AK: [0.25, 0.32, 0.43, 0.43, 0.43, 0.43, 0.43, 0.43, 0.56, 0.40, 0.25, 0.36],
  AL: [1.49, 1.44, 1.37, 1.37, 1.37, 1.37, 1.37, 1.37, 0.91, 1.23, 1.24, 1.40],
  AR: [1.41, 1.30, 1.20, 1.20, 1.20, 1.20, 1.20, 1.20, 0.74, 1.53, 0.86, 1.22],
  AZ: [0.67, 0.80, 0.48, 0.48, 0.48, 0.48, 0.48, 0.48, 0.42, 0.59, 0.25, 0.61],
  CA: [1.73, 1.60, 0.79, 0.79, 0.79, 0.79, 0.79, 0.79, 0.25, 0.25, 0.67, 1.60],
  CO: [0.25, 0.25, 0.27, 0.27, 0.27, 0.27, 0.27, 0.27, 0.39, 0.26, 0.33, 0.27],
  CT: [1.11, 0.80, 1.24, 1.24, 1.24, 1.24, 1.24, 1.24, 1.53, 1.50, 0.83, 1.78],
  DE: [0.89, 0.93, 0.98, 0.98, 0.98, 0.98, 0.98, 0.98, 1.15, 1.19, 0.70, 1.43],
  FL: [0.73, 0.72, 1.17, 1.17, 1.17, 1.17, 1.17, 1.17, 1.76, 1.03, 0.92, 0.49],
  GA: [1.30, 1.72, 1.08, 1.08, 1.08, 1.08, 1.08, 1.08, 1.22, 0.46, 0.84, 0.79],
  HI: [0.82, 1.16, 0.88, 0.88, 0.88, 0.88, 0.88, 0.88, 0.83, 1.22, 0.55, 1.23],
  IA: [0.55, 0.31, 0.61, 0.61, 0.61, 0.61, 0.61, 0.61, 0.52, 1.21, 0.63, 0.57],
  ID: [0.63, 0.57, 0.59, 0.59, 0.59, 0.59, 0.59, 0.59, 0.33, 0.73, 0.73, 0.78],
  IL: [0.79, 0.61, 0.76, 0.76, 0.76, 0.76, 0.76, 0.76, 0.54, 0.94, 0.61, 0.63],
  IN: [0.87, 0.87, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.95, 0.84, 0.69, 0.60],
  KS: [0.38, 0.25, 0.43, 0.43, 0.43, 0.43, 0.43, 0.43, 0.97, 0.25, 0.89, 0.27],
  KY: [1.22, 1.97, 1.19, 1.19, 1.19, 1.19, 1.19, 1.19, 1.38, 0.63, 0.90, 1.06],
  LA: [1.46, 1.31, 1.61, 1.61, 1.61, 1.61, 1.61, 1.61, 2.38, 0.89, 1.34, 1.91],
  MA: [1.18, 0.86, 1.17, 1.17, 1.17, 1.17, 1.17, 1.17, 1.24, 1.63, 1.03, 1.80],
  MD: [0.97, 0.97, 1.11, 1.11, 1.11, 1.11, 1.11, 1.11, 1.73, 1.18, 0.69, 1.76],
  ME: [1.03, 0.85, 1.11, 1.11, 1.11, 1.11, 1.11, 1.11, 1.17, 1.53, 1.13, 1.88],
  MI: [0.45, 0.50, 0.65, 0.65, 0.65, 0.65, 0.65, 0.65, 0.82, 0.93, 0.56, 0.61],
  MN: [0.25, 0.36, 0.51, 0.51, 0.51, 0.51, 0.51, 0.51, 0.72, 0.71, 0.53, 0.71],
  MO: [0.74, 0.63, 0.87, 0.87, 0.87, 0.87, 0.87, 0.87, 0.57, 0.94, 1.00, 0.59],
  MS: [1.20, 1.69, 1.22, 1.22, 1.22, 1.22, 1.22, 1.22, 1.02, 0.72, 1.28, 1.33],
  MT: [0.37, 0.44, 0.40, 0.40, 0.40, 0.40, 0.40, 0.40, 0.71, 0.54, 0.26, 0.33],
  NC: [0.92, 0.97, 0.98, 0.98, 0.98, 0.98, 0.98, 0.98, 1.69, 0.77, 0.65, 1.48],
  ND: [0.25, 0.25, 0.27, 0.27, 0.27, 0.27, 0.27, 0.27, 0.31, 0.36, 0.25, 0.36],
  NE: [0.36, 0.29, 0.48, 0.48, 0.48, 0.48, 0.48, 0.48, 0.38, 0.57, 0.63, 0.45],
  NH: [1.15, 0.71, 1.07, 1.07, 1.07, 1.07, 1.07, 1.07, 1.24, 1.02, 0.90, 1.64],
  NJ: [0.85, 0.92, 1.02, 1.02, 1.02, 1.02, 1.02, 1.02, 1.09, 1.16, 0.78, 1.41],
  NM: [0.27, 0.30, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.39, 0.30, 0.25],
  NV: [0.50, 0.54, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.30],
  NY: [0.81, 0.81, 0.90, 0.90, 0.90, 0.90, 0.90, 0.90, 1.27, 1.02, 0.83, 1.07],
  OH: [0.91, 0.93, 0.91, 0.91, 0.91, 0.91, 0.91, 0.91, 0.98, 0.81, 0.81, 0.73],
  OK: [0.64, 0.83, 0.78, 0.78, 0.78, 0.78, 0.78, 0.78, 0.54, 1.27, 0.80, 0.76],
  OR: [0.52, 0.38, 0.52, 0.52, 0.52, 0.52, 0.52, 0.52, 0.25, 0.26, 0.61, 0.58],
  PA: [0.83, 0.87, 0.90, 0.90, 0.90, 0.90, 0.90, 0.90, 0.96, 1.07, 0.66, 0.96],
  RI: [1.42, 0.93, 1.27, 1.27, 1.27, 1.27, 1.27, 1.27, 1.65, 1.47, 0.95, 2.05],
  SC: [1.26, 1.15, 0.98, 0.98, 0.98, 0.98, 0.98, 0.98, 1.00, 0.70, 0.59, 1.27],
  SD: [0.25, 0.25, 0.32, 0.32, 0.32, 0.32, 0.32, 0.32, 0.25, 0.49, 0.26, 0.34],
  TN: [1.30, 1.58, 1.35, 1.35, 1.35, 1.35, 1.35, 1.35, 0.97, 0.94, 0.67, 1.41],
  TX: [0.47, 0.36, 0.56, 0.56, 0.56, 0.56, 0.56, 0.56, 0.96, 0.61, 0.41, 0.25],
  UT: [0.47, 0.33, 0.31, 0.31, 0.31, 0.31, 0.31, 0.31, 0.25, 0.33, 0.25, 0.46],
  VA: [1.02, 1.12, 1.12, 1.12, 1.12, 1.12, 1.12, 1.12, 1.32, 0.95, 0.52, 1.52],
  VT: [0.72, 0.69, 0.89, 0.89, 0.89, 0.89, 0.89, 0.89, 0.90, 1.01, 0.86, 1.15],
  WA: [1.84, 1.17, 1.36, 1.36, 1.36, 1.36, 1.36, 1.36, 0.56, 1.11, 1.56, 1.93],
  WI: [0.40, 0.38, 0.59, 0.59, 0.59, 0.59, 0.59, 0.59, 0.76, 0.56, 0.68, 0.43],
  WV: [1.09, 1.37, 1.08, 1.08, 1.08, 1.08, 1.08, 1.08, 1.27, 0.84, 0.87, 1.05],
  WY: [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.47, 0.25, 0.25],
};

type Supa = ReturnType<typeof createSupabaseClient>;

interface FiredLead {
  lead_id: string; // flood-forming | smoke-forming | aqi-ramp-forming | drought-fire-forming | precip-flood-forming
  state: string;
  evidence: Record<string, unknown>;
  precedents: Record<string, unknown> | null;
  copy: string;
  claim_fire_id: string | null;
}

function addDaysStr(dateStr: string, n: number): string {
  return new Date(Date.parse(dateStr) + n * 86400000).toISOString().split('T')[0];
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function medDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

function stateName(abbr: string): string {
  return STATE_NAMES[abbr] ?? abbr;
}

function epaTier(aqi: number): string {
  if (aqi > 300) return 'Hazardous';
  if (aqi > 200) return 'Very Unhealthy';
  if (aqi > 150) return 'Unhealthy';
  if (aqi > 100) return 'Unhealthy for Sensitive Groups';
  if (aqi > 50) return 'Moderate';
  return 'Good';
}

// ---------------------------------------------------------------------------
// FLOOD-FORMING
// ---------------------------------------------------------------------------

interface FloodLive {
  state: string;
  watchCount: number;
  severities: string[];
  soonestExpiry: string;
}

async function liveFloodWatches(supabase: Supa): Promise<Map<string, FloodLive>> {
  const out = new Map<string, FloodLive>();
  const { data, error } = await supabase
    .from('hunt_nws_alerts')
    .select('states, severity, expires')
    .eq('event_type', 'Flood Watch')
    .gt('expires', new Date().toISOString())
    .limit(500);
  if (error) throw new Error(`hunt_nws_alerts query failed: ${error.message}`);
  for (const row of (data ?? []) as { states: string[] | null; severity: string | null; expires: string | null }[]) {
    for (const st of row.states ?? []) {
      const cur = out.get(st) ?? { state: st, watchCount: 0, severities: [], soonestExpiry: '' };
      cur.watchCount++;
      if (row.severity && !cur.severities.includes(row.severity)) cur.severities.push(row.severity);
      if (row.expires && (!cur.soonestExpiry || row.expires < cur.soonestExpiry)) cur.soonestExpiry = row.expires;
      out.set(st, cur);
    }
  }
  return out;
}

/** Watch->warning escalation record for one state, from the persistent
 *  nws-alert lane (live era only, ~4 months deep — the query is bounded by
 *  content_type + state + effective_date + title filter). Returns null when
 *  fewer than MIN_FLOOD_PRECEDENT_DAYS watch-days are on file. */
async function floodPrecedents(
  supabase: Supa,
  state: string,
  today: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('hunt_knowledge')
    .select('title, effective_date')
    .eq('content_type', 'nws-alert')
    .eq('state_abbr', state)
    .gte('effective_date', NWS_HISTORY_START)
    .or('title.ilike.%flood watch%,title.ilike.%flood warning%')
    .limit(1000);
  if (error) {
    console.error(`[${FN}] flood precedent query failed (${state}):`, error.message);
    return null;
  }
  const watchDays = new Set<string>();
  const warningDays = new Set<string>();
  for (const r of (data ?? []) as { title: string | null; effective_date: string | null }[]) {
    if (!r.title || !r.effective_date) continue;
    const day = String(r.effective_date).slice(0, 10);
    const t = r.title.toLowerCase();
    if (t.includes('flood watch')) watchDays.add(day);
    if (t.includes('flood warning')) warningDays.add(day);
  }
  // Only days whose full 3-day outcome window has closed count — today's (and
  // the last 3 days') watches can't fail an escalation they still have time for.
  const gradableDays = [...watchDays].filter((d) => d < addDaysStr(today, -3));
  if (gradableDays.length < MIN_FLOOD_PRECEDENT_DAYS) return null;
  let escalated = 0;
  for (const d of gradableDays) {
    for (let k = 1; k <= 3; k++) {
      if (warningDays.has(addDaysStr(d, k))) { escalated++; break; }
    }
  }
  return {
    kind: 'watch-escalation-record',
    since: NWS_HISTORY_START,
    watch_days: gradableDays.length,
    escalated_within_3d: escalated,
    window_days: 3,
    source: 'hunt_knowledge nws-alert lane (live era)',
  };
}

function floodCopy(
  state: string,
  live: FloodLive,
  precedents: Record<string, unknown> | null,
  inScope: boolean,
): string {
  const name = stateName(state);
  const head = live.watchCount === 1
    ? `A Flood Watch is live over ${name}`
    : `${live.watchCount} Flood Watches are live over ${name}`;
  if (!precedents) {
    return `${head} — the live record here is too short to count how often a watch escalated. This is a standing NWS fact, not a forecast.`;
  }
  const n = Number(precedents.watch_days);
  const k = Number(precedents.escalated_within_3d);
  const record = `of the last ${n} days a watch stood here, ${k} saw a Flood Warning within 3 days`;
  if (inScope) {
    return `${head} — ${record}. A graded claim on this board.`;
  }
  return `${head} — ${record}. This ground floods too often for our control yardstick to grade the escalation; the record is shown, not graded.`;
}

/** The court's own fire for this state, if the daily court has already fired
 *  the flood claim here — we link, never insert. */
async function courtFireIds(
  supabase: Supa,
  claimId: string,
  states: string[],
  today: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (states.length === 0) return out;
  const { data, error } = await supabase
    .from('hunt_claim_fires')
    .select('id, state_abbr, fired_at')
    .eq('claim_id', claimId)
    .in('state_abbr', states)
    .gte('fired_at', addDaysStr(today, -2))
    .order('fired_at', { ascending: false })
    .limit(100);
  if (error) {
    console.error(`[${FN}] claim fires query failed:`, error.message);
    return out;
  }
  for (const r of (data ?? []) as { id: string; state_abbr: string }[]) {
    if (!out.has(r.state_abbr)) out.set(r.state_abbr, r.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// SMOKE-FORMING
// ---------------------------------------------------------------------------

interface AqiTrend {
  state: string;
  days: string[];
  values: number[];
  latest: number;
  peak: number;
  risingIntoLatest: boolean;
  runLen: number; // consecutive rising days ending at latest (0 if not rising)
  arm: 'trend' | 'step';
}

/** Per-state max_aqi per day over the last AQI_TREND_DAYS days — THE dedup
 *  point for the live air-quality read (backfill-era rows are duplicated
 *  exactly 2x per state-day: collapse to max per effective_date; the
 *  hunt-air-quality ingest is now idempotent so new dupes stop accruing).
 *  Every AQI consumer below works off this map. */
async function aqiDayMax(supabase: Supa, today: string): Promise<Map<string, Map<string, number>>> {
  const from = addDaysStr(today, -(AQI_TREND_DAYS - 1));
  const { data, error } = await supabase
    .from('hunt_knowledge')
    .select('state_abbr, effective_date, metadata')
    .eq('content_type', 'air-quality')
    .gte('effective_date', from)
    .limit(1000);
  if (error) throw new Error(`air-quality query failed: ${error.message}`);

  const byState = new Map<string, Map<string, number>>();
  for (const r of (data ?? []) as { state_abbr: string | null; effective_date: string | null; metadata: { max_aqi?: number } | null }[]) {
    const aqi = Number(r.metadata?.max_aqi);
    if (!r.state_abbr || !r.effective_date || !Number.isFinite(aqi)) continue;
    const day = String(r.effective_date).slice(0, 10);
    const days = byState.get(r.state_abbr) ?? new Map<string, number>();
    days.set(day, Math.max(days.get(day) ?? -Infinity, aqi));
    byState.set(r.state_abbr, days);
  }
  return byState;
}

/** v1's loose smoke trend — SURVIVES FOR MD ONLY (descriptive, never the 7x
 *  claim). Elsewhere the strict B1 ramp replaced it: 119/472 loose-spec
 *  backtest fires were persistence contamination. */
function mdSmokeTrends(byState: Map<string, Map<string, number>>, today: string): Map<string, AqiTrend> {
  const out = new Map<string, AqiTrend>();
  for (const [state, dayMap] of byState) {
    if (state !== 'MD') continue;
    const days = [...dayMap.keys()].sort();
    if (days.length < 3) continue;
    // Freshness: the newest reading must be today or yesterday, or the lead is stale.
    if (days[days.length - 1] < addDaysStr(today, -1)) continue;
    const values = days.map((d) => dayMap.get(d)!);
    const latest = values[values.length - 1];
    const peak = Math.max(...values);
    let runLen = 0;
    for (let i = values.length - 1; i > 0 && values[i] > values[i - 1]; i--) runLen++;
    const rises: boolean[] = [];
    for (let i = 0; i < values.length - 1; i++) rises.push(values[i + 1] > values[i]);
    const twoConsecutiveRises = rises.some((r, i) => r && rises[i + 1] === true);

    const armTrend = twoConsecutiveRises && latest >= 100;
    const armStep = latest >= 150;
    if (!armTrend && !armStep) continue;
    out.set(state, {
      state, days, values, latest, peak,
      risingIntoLatest: runLen >= 1,
      runLen,
      arm: armStep ? 'step' : 'trend',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// B1 — AQI-RAMP-FORMING (strict; registry lift 7.0, n=353)
// ---------------------------------------------------------------------------

interface B1Ramp {
  state: string;
  days: [string, string, string];   // day D-2, D-1, D (consecutive calendar days)
  values: [number, number, number]; // deduped max_aqi
  rises: [number, number];
  latest: number;
}

/** Strict ramp: max_aqi rise >= +15/day on two consecutive days AND day-D max
 *  in [100,150). Requires 3 CONSECUTIVE calendar days on file (a gap breaks
 *  the per-day rate) with day-D no older than yesterday. MD never fires. */
function b1Ramps(byState: Map<string, Map<string, number>>, today: string): Map<string, B1Ramp> {
  const out = new Map<string, B1Ramp>();
  for (const [state, dayMap] of byState) {
    if (B1_EXCLUDED.has(state)) continue;
    const days = [...dayMap.keys()].sort();
    if (days.length < 3) continue;
    const dD = days[days.length - 1];
    if (dD < addDaysStr(today, -1)) continue; // stale lane
    const d1 = addDaysStr(dD, -1);
    const d2 = addDaysStr(dD, -2);
    if (!dayMap.has(d1) || !dayMap.has(d2)) continue;
    const values: [number, number, number] = [dayMap.get(d2)!, dayMap.get(d1)!, dayMap.get(dD)!];
    const rises: [number, number] = [values[1] - values[0], values[2] - values[1]];
    if (rises[0] < 15 || rises[1] < 15) continue;
    if (values[2] < 100 || values[2] >= 150) continue; // the band is load-bearing
    out.set(state, { state, days: [d2, d1, dD], values, rises, latest: values[2] });
  }
  return out;
}

/** Registry copy template: multiplier-led, absolute odds stated, lead time
 *  exactly as registered (1-2 days). */
function b1Copy(r: B1Ramp): string {
  const name = stateName(r.state);
  const series = r.values.map((v) => Math.round(v)).join('→');
  return `Modeled air over ${name} has climbed ${series} in two days — ${Math.round(r.latest)} is ${epaTier(r.latest)} on the EPA scale, still inside the 100–150 band. In the backtest, climbs shaped like this saw 150+ air within 1–2 days 6.2% of the time — about 7× the everyday odds (0.9%); absolute odds stay low. The record recognizes; it never predicts.`;
}

// ---------------------------------------------------------------------------
// C1 — DROUGHT-FIRE-FORMING (weekly USDM lane; registry lift 1.63, n=161)
// ---------------------------------------------------------------------------

interface DroughtFire {
  state: string;
  mapDate: string;
  severePct: number;   // d2+d3+d4
  weekChange: number;  // week-over-week change of d2+d3+d4
  d2: number; d3: number; d4: number;
  tier: 'graded' | 'watch';
}

/** Weekly evaluation off the drought-weekly lane: (D2+D3+D4)% >= 20 AND
 *  deepening (week_change d2+d3+d4 > 0). Only the registry's scope is even
 *  queried: MT/WA/ID/OR graded, NM watch-tier; AZ/NV/TX/CO/CA never. */
async function droughtFireLeads(supabase: Supa, today: string): Promise<Map<string, DroughtFire>> {
  const scope = [...C1_GRADED_STATES, ...C1_WATCH_STATES];
  const { data, error } = await supabase
    .from('hunt_knowledge')
    .select('state_abbr, effective_date, metadata')
    .eq('content_type', 'drought-weekly')
    .in('state_abbr', scope)
    .gte('effective_date', addDaysStr(today, -14))
    .limit(60);
  if (error) throw new Error(`drought-weekly query failed: ${error.message}`);

  // Latest map per state (weekly lane — the newest effective_date wins).
  const latest = new Map<string, { day: string; meta: Record<string, unknown> }>();
  for (const r of (data ?? []) as { state_abbr: string | null; effective_date: string | null; metadata: Record<string, unknown> | null }[]) {
    if (!r.state_abbr || !r.effective_date || !r.metadata) continue;
    const day = String(r.effective_date).slice(0, 10);
    const cur = latest.get(r.state_abbr);
    if (!cur || day > cur.day) latest.set(r.state_abbr, { day, meta: r.metadata });
  }

  const out = new Map<string, DroughtFire>();
  for (const [state, { day, meta }] of latest) {
    const d2 = Number(meta.d2_pct), d3 = Number(meta.d3_pct), d4 = Number(meta.d4_pct);
    if (![d2, d3, d4].every(Number.isFinite)) continue;
    const severePct = d2 + d3 + d4;
    const wc = meta.week_change as { d2?: number; d3?: number; d4?: number } | null;
    if (!wc) continue; // first-week rows can't establish deepening — honest skip
    const weekChange = Number(wc.d2 ?? 0) + Number(wc.d3 ?? 0) + Number(wc.d4 ?? 0);
    if (severePct < 20 || weekChange <= 0) continue;
    out.set(state, {
      state, mapDate: day,
      severePct: Math.round(severePct * 10) / 10,
      weekChange: Math.round(weekChange * 10) / 10,
      d2, d3, d4,
      tier: C1_GRADED_STATES.includes(state) ? 'graded' : 'watch',
    });
  }
  return out;
}

/** Registry copy: seasonality line carried verbatim; lead time weeks, never
 *  days. Watch tier (NM) states its facts but claims no multiplier. */
function c1Copy(f: DroughtFire): string {
  const name = stateName(f.state);
  const head = `Severe-or-worse drought (D2–D4) covers ${f.severePct}% of ${name} and deepened this week (+${f.weekChange} points, USDM map ${medDate(f.mapDate)})`;
  if (f.tier === 'watch') {
    return `${head}. Watch tier for this ground — the graded record is thinner here, so the footprint is shown, not graded. Lead time is weeks, not days.`;
  }
  return `${head}. In the backtest, a wildfire event followed within 30 days after 47.8% of expansions like this, against a 29.3% everyday rate — about 1.6×. About a third of the lift is fire-season timing; month-matched lift 1.39. Lead time is weeks, not days.`;
}

// ---------------------------------------------------------------------------
// A2 — PRECIP-FLOOD-FORMING (live daily precip lane; registry lift 1.93)
// ---------------------------------------------------------------------------

interface PrecipFire {
  state: string;
  days: [string, string, string];
  inches: [number, number, number];
  sumIn: number;
  thresholdIn: number;
  monthIdx: number; // 0-based
  arm: 'p90' | 'point' | 'both';
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** 3-day rolling precip sum (mm -> in) off hunt_weather_history against the
 *  A2_P90_3DAY_IN state-month threshold, plus the any-day >= 2.0in point
 *  condition (either arm fires). The lane lags ~1-2 days; the latest complete
 *  3-consecutive-day window must end no earlier than today-3 or the lead is
 *  honestly stale and does not fire. */
async function precipFloodLeads(supabase: Supa, today: string): Promise<Map<string, PrecipFire>> {
  const { data, error } = await supabase
    .from('hunt_weather_history')
    .select('state_abbr, date, precipitation_total_mm')
    .gte('date', addDaysStr(today, -6))
    .limit(500);
  if (error) throw new Error(`hunt_weather_history query failed: ${error.message}`);

  const byState = new Map<string, Map<string, number>>();
  for (const r of (data ?? []) as { state_abbr: string | null; date: string | null; precipitation_total_mm: number | null }[]) {
    const mm = Number(r.precipitation_total_mm);
    if (!r.state_abbr || !r.date || !Number.isFinite(mm)) continue;
    const days = byState.get(r.state_abbr) ?? new Map<string, number>();
    days.set(String(r.date).slice(0, 10), mm);
    byState.set(r.state_abbr, days);
  }

  const out = new Map<string, PrecipFire>();
  for (const [state, days] of byState) {
    const thresholds = A2_P90_3DAY_IN[state];
    if (!thresholds) continue;
    const sorted = [...days.keys()].sort();
    const dD = sorted[sorted.length - 1];
    if (dD < addDaysStr(today, -3)) continue; // stale lane — no fire
    const d1 = addDaysStr(dD, -1);
    const d2 = addDaysStr(dD, -2);
    if (!days.has(d1) || !days.has(d2)) continue; // incomplete window
    const inches: [number, number, number] = [
      r2(days.get(d2)! / 25.4), r2(days.get(d1)! / 25.4), r2(days.get(dD)! / 25.4),
    ];
    const sumIn = r2(inches[0] + inches[1] + inches[2]);
    const monthIdx = Number(dD.slice(5, 7)) - 1;
    const thresholdIn = thresholds[monthIdx];
    const p90Arm = sumIn >= thresholdIn;
    const pointArm = inches.some((v) => v >= 2.0);
    if (!p90Arm && !pointArm) continue;
    out.set(state, {
      state, days: [d2, d1, dD], inches, sumIn, thresholdIn, monthIdx,
      arm: p90Arm && pointArm ? 'both' : p90Arm ? 'p90' : 'point',
    });
  }
  return out;
}

/** Registry copy: pooled numbers (24.7% vs 12.8%) — the backtest gave no
 *  per-state splits to the registry, so per-state numbers are never claimed. */
function a2Copy(f: PrecipFire): string {
  const name = stateName(f.state);
  const seq = f.inches.map((v) => v.toFixed(2)).join('→');
  const record = `In the pooled backtest, a flood signal followed within 1–2 days after 24.7% of days like this, against 12.8% of other days — about 1.9×. Saturated soil and full channels are the mechanism; the record recognizes, it never predicts.`;
  if (f.arm === 'point') {
    const peak = Math.max(...f.inches).toFixed(2);
    return `A ${peak}in day of rain landed on ${name} (${seq}in through ${medDate(f.days[2])}) — past the registry's 2.0in single-day flag, though the three-day total (${f.sumIn}in) sits under this month's 90th percentile (${f.thresholdIn}in). ${record}`;
  }
  const pointBit = f.arm === 'both' ? ` A single day in the window also cleared the 2.0in flag.` : '';
  return `Three days put ${f.sumIn}in of rain on ${name} (${seq}in through ${medDate(f.days[2])}) — past this ground's 90th-percentile three-day soak for ${MONTHS[f.monthIdx]} (${f.thresholdIn}in).${pointBit} ${record}`;
}

/** Is any wildfire-perimeter row fresh (created within 48h)? The lane is
 *  currently dead, so this is expected false — the copy's default carries no
 *  fire clause until the lane is repaired. */
async function freshFirePerimeters(supabase: Supa): Promise<boolean> {
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('hunt_knowledge')
    .select('id')
    .eq('content_type', 'wildfire-perimeter')
    .gte('created_at', cutoff)
    .limit(1);
  if (error) {
    console.error(`[${FN}] wildfire-perimeter freshness query failed:`, error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/** The last 100+ AQI day on this ground before the current window, and how
 *  many of the 7 days after it also ran 100+. Null when no such day is on file. */
async function smokePrecedents(
  supabase: Supa,
  state: string,
  windowStart: string,
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase
    .from('hunt_knowledge')
    .select('effective_date, metadata')
    .eq('content_type', 'air-quality')
    .eq('state_abbr', state)
    .lt('effective_date', windowStart)
    .gte('metadata->max_aqi', 100)
    .order('effective_date', { ascending: false })
    .limit(4);
  if (error) {
    console.error(`[${FN}] smoke precedent query failed (${state}):`, error.message);
    return null;
  }
  const rows = (data ?? []) as { effective_date: string | null; metadata: { max_aqi?: number } | null }[];
  if (rows.length === 0) return null;
  const lastDay = String(rows[0].effective_date).slice(0, 10);
  const lastAqi = Number(rows[0].metadata?.max_aqi);

  // What followed: the 7 days after that day, dedup by day (backfill era wrote 2x).
  const { data: after, error: afterErr } = await supabase
    .from('hunt_knowledge')
    .select('effective_date, metadata')
    .eq('content_type', 'air-quality')
    .eq('state_abbr', state)
    .gt('effective_date', lastDay)
    .lte('effective_date', addDaysStr(lastDay, 7))
    .limit(20);
  if (afterErr) {
    console.error(`[${FN}] smoke followed query failed (${state}):`, afterErr.message);
    return { kind: 'last-100plus-day', day: lastDay, max_aqi: lastAqi, followed_100plus_days: null };
  }
  const perDay = new Map<string, number>();
  for (const r of (after ?? []) as { effective_date: string | null; metadata: { max_aqi?: number } | null }[]) {
    const aqi = Number(r.metadata?.max_aqi);
    if (!r.effective_date || !Number.isFinite(aqi)) continue;
    const day = String(r.effective_date).slice(0, 10);
    perDay.set(day, Math.max(perDay.get(day) ?? -Infinity, aqi));
  }
  const followed = [...perDay.values()].filter((v) => v >= 100).length;
  return {
    kind: 'last-100plus-day',
    day: lastDay,
    max_aqi: lastAqi,
    followed_100plus_days: followed,
    followed_window_days: 7,
    source: 'hunt_knowledge air-quality lane (open-meteo CAMS, state centroid)',
  };
}

function smokeCopy(
  trend: AqiTrend,
  precedents: Record<string, unknown> | null,
  firesFresh: boolean,
): string {
  const name = stateName(trend.state);
  const series = trend.values.map((v) => Math.round(v)).join('→');
  let head: string;
  if (trend.arm === 'step' && trend.values.length >= 2 && !trend.risingIntoLatest) {
    head = `Modeled air over ${name} reads ${Math.round(trend.latest)}`;
  } else if (trend.risingIntoLatest && trend.runLen >= 2) {
    head = `Modeled air over ${name} has degraded ${trend.runLen + 1} days running (${series})`;
  } else {
    head = `Modeled air over ${name} has run degraded through the last ${trend.values.length} days (${series}), peaking at ${Math.round(trend.peak)}`;
  }
  head += ` — ${Math.round(trend.latest)} is ${epaTier(trend.latest)} on the EPA scale`;
  if (firesFresh) head += ', with large fires on file upwind';
  let tail: string;
  if (!precedents) {
    tail = 'No earlier 100+ day is on file for this ground.';
  } else {
    const day = String(precedents.day);
    const followed = precedents.followed_100plus_days;
    if (followed === null || followed === undefined) {
      tail = `The last time this ground read 100+: ${medDate(day)}.`;
    } else if (Number(followed) === 0) {
      tail = `The last time this ground read 100+: ${medDate(day)} — the next 7 days ran clear.`;
    } else {
      tail = `The last time this ground read 100+: ${medDate(day)} — ${followed} of the next 7 days ran 100+ too.`;
    }
  }
  return `${head}. ${tail}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  let errors = 0;

  try {
    const supabase = createSupabaseClient();
    const today = new Date().toISOString().split('T')[0];
    const fired: FiredLead[] = [];

    // ---------------- FLOOD-FORMING ----------------
    const floodLive = await liveFloodWatches(supabase);

    // The court's claim: scope + id for linkage. Missing claim = no linkage,
    // every state treated as out-of-scope (honest copy fallback).
    let claimScope = new Set<string>();
    let fireIds = new Map<string, string>();
    const { data: claimRow } = await supabase
      .from('hunt_claims')
      .select('id, trigger_def')
      .eq('name', FLOOD_CLAIM_NAME)
      .maybeSingle();
    if (claimRow) {
      const scope = (claimRow as { trigger_def?: { scope?: string[] | string } }).trigger_def?.scope;
      if (Array.isArray(scope)) claimScope = new Set(scope);
      const scoped = [...floodLive.keys()].filter((s) => claimScope.has(s));
      fireIds = await courtFireIds(supabase, (claimRow as { id: string }).id, scoped, today);
    }

    for (const [state, live] of floodLive) {
      try {
        const precedents = await floodPrecedents(supabase, state, today);
        const inScope = claimScope.has(state);
        fired.push({
          lead_id: 'flood-forming',
          state,
          evidence: {
            source: 'hunt_nws_alerts (live, unexpired)',
            event_type: 'Flood Watch',
            watch_count: live.watchCount,
            severities: live.severities,
            soonest_expiry: live.soonestExpiry,
            in_claim_scope: inScope,
            lead_time: '1-3 days',
            as_of: new Date().toISOString(),
          },
          precedents,
          copy: floodCopy(state, live, precedents, inScope),
          claim_fire_id: fireIds.get(state) ?? null,
        });
      } catch (err) {
        console.error(`[${FN}] flood lead error (${state}):`, err);
        errors++;
      }
    }

    // ---------------- SMOKE-FORMING (v1 descriptive — MD ONLY) ----------------
    const aqiByState = await aqiDayMax(supabase, today);
    const trends = mdSmokeTrends(aqiByState, today);
    const firesFresh = await freshFirePerimeters(supabase);
    for (const [state, trend] of trends) {
      try {
        const precedents = await smokePrecedents(supabase, state, trend.days[0]);
        fired.push({
          lead_id: 'smoke-forming',
          state,
          evidence: {
            source: 'hunt_knowledge air-quality lane (open-meteo CAMS, state centroid)',
            days: trend.days,
            max_aqi: trend.values,
            latest: trend.latest,
            peak: trend.peak,
            arm: trend.arm,
            epa_tier: epaTier(trend.latest),
            fire_perimeters_fresh: firesFresh,
            scope_note: 'MD only — chronic >=150 feed outlier keeps MD descriptive, out of the B1 ramp claim',
            lead_time: 'days',
            as_of: new Date().toISOString(),
          },
          precedents,
          copy: smokeCopy(trend, precedents, firesFresh),
          claim_fire_id: null,
        });
      } catch (err) {
        console.error(`[${FN}] smoke lead error (${state}):`, err);
        errors++;
      }
    }

    // ---------------- B1: AQI-RAMP-FORMING (all states except MD) ----------------
    const ramps = b1Ramps(aqiByState, today);
    for (const [state, ramp] of ramps) {
      fired.push({
        lead_id: B1_LEAD,
        state,
        evidence: {
          source: 'hunt_knowledge air-quality lane (open-meteo CAMS, state centroid), deduped max per day',
          days: ramp.days,
          max_aqi: ramp.values,
          rises_per_day: ramp.rises,
          latest: ramp.latest,
          epa_tier: epaTier(ramp.latest),
          band: '[100,150)',
          lead_time: '1-2 days',
          as_of: new Date().toISOString(),
        },
        precedents: B1_BACKTEST,
        copy: b1Copy(ramp),
        claim_fire_id: null,
      });
    }

    // ---------------- C1: DROUGHT-FIRE-FORMING (MT/WA/ID/OR + NM watch) ----------
    try {
      const droughtFires = await droughtFireLeads(supabase, today);
      for (const [state, f] of droughtFires) {
        fired.push({
          lead_id: C1_LEAD,
          state,
          evidence: {
            source: 'hunt_knowledge drought-weekly lane (USDM state statistics)',
            usdm_map_date: f.mapDate,
            severe_pct_d2_d4: f.severePct,
            week_change_d2_d4: f.weekChange,
            d2_pct: f.d2, d3_pct: f.d3, d4_pct: f.d4,
            tier: f.tier,
            lead_time: 'weeks',
            as_of: new Date().toISOString(),
          },
          precedents: f.tier === 'graded' ? C1_BACKTEST : { ...C1_BACKTEST, tier_note: 'NM watch tier — shown, not graded; no multiplier claimed in copy' },
          copy: c1Copy(f),
          claim_fire_id: null,
        });
      }
    } catch (err) {
      console.error(`[${FN}] drought lead error:`, err);
      errors++;
    }

    // ---------------- A2: PRECIP-FLOOD-FORMING (all states) ----------------------
    try {
      const precipFires = await precipFloodLeads(supabase, today);
      for (const [state, f] of precipFires) {
        fired.push({
          lead_id: A2_LEAD,
          state,
          evidence: {
            source: 'hunt_weather_history.precipitation_total_mm (live daily lane, 2020-09+)',
            days: f.days,
            inches_per_day: f.inches,
            rolling_3d_in: f.sumIn,
            threshold_in: f.thresholdIn,
            threshold_month: MONTHS[f.monthIdx],
            arm: f.arm,
            lead_time: '1-2 days',
            as_of: new Date().toISOString(),
          },
          precedents: A2_BACKTEST,
          copy: a2Copy(f),
          claim_fire_id: null,
        });
      }
    } catch (err) {
      console.error(`[${FN}] precip lead error:`, err);
      errors++;
    }

    // ---------------- WATCH LIFECYCLE (idempotent) ----------------
    const { data: openRows, error: openErr } = await supabase
      .from('formation_watches')
      .select('id, lead_id, states, opened_at, claim_fire_id')
      .eq('status', 'forming');
    if (openErr) throw new Error(`formation_watches query failed: ${openErr.message}`);

    const keyOf = (lead: string, state: string) => `${lead}|${state}`;
    const openByKey = new Map<string, { id: string; opened_at: string; claim_fire_id: string | null }>();
    for (const r of (openRows ?? []) as { id: string; lead_id: string; states: string[]; opened_at: string; claim_fire_id: string | null }[]) {
      openByKey.set(keyOf(r.lead_id, r.states[0]), { id: r.id, opened_at: String(r.opened_at).slice(0, 10), claim_fire_id: r.claim_fire_id });
    }

    let opened = 0, updated = 0, faded = 0, embedded = 0;
    const newlyOpened: { row: FiredLead; id: string }[] = [];
    const firedKeys = new Set<string>();

    for (const f of fired) {
      const key = keyOf(f.lead_id, f.state);
      firedKeys.add(key);
      const existing = openByKey.get(key);
      if (existing) {
        const { error: updErr } = await supabase
          .from('formation_watches')
          .update({
            last_seen: today,
            evidence: f.evidence,
            precedents: f.precedents,
            copy: f.copy,
            claim_fire_id: f.claim_fire_id ?? existing.claim_fire_id,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
        if (updErr) { console.error(`[${FN}] update failed (${key}):`, updErr.message); errors++; }
        else updated++;
      } else {
        const { data: ins, error: insErr } = await supabase
          .from('formation_watches')
          .insert({
            lead_id: f.lead_id,
            states: [f.state],
            status: 'forming',
            opened_at: today,
            last_seen: today,
            evidence: f.evidence,
            precedents: f.precedents,
            copy: f.copy,
            claim_fire_id: f.claim_fire_id,
          })
          .select('id')
          .single();
        if (insErr || !ins) { console.error(`[${FN}] insert failed (${key}):`, insErr?.message); errors++; }
        else { opened++; newlyOpened.push({ row: f, id: (ins as { id: string }).id }); }
      }
    }

    for (const [key, row] of openByKey) {
      if (firedKeys.has(key)) continue;
      const { error: fadeErr } = await supabase
        .from('formation_watches')
        .update({ status: 'faded', faded_at: today, updated_at: new Date().toISOString() })
        .eq('id', row.id);
      if (fadeErr) { console.error(`[${FN}] fade failed (${key}):`, fadeErr.message); errors++; }
      else faded++;
    }

    // ---------------- EMBEDDING LAW: every newly-opened watch -> the brain ----
    if (newlyOpened.length > 0) {
      try {
        const texts = newlyOpened.map(({ row }) =>
          `FORMATION WATCH (${row.lead_id}) over ${stateName(row.state)} (${row.state}), opened ${today}: ${row.copy}`);
        const embeddings = await batchEmbed(texts); // shared module chunks at 20
        const rows = newlyOpened.map(({ row, id }, i) => ({
          title: `Formation watch: ${row.lead_id} — ${row.state} ${today}`,
          content: texts[i],
          content_type: 'formation-watch',
          tags: [row.state, 'formation-watch', row.lead_id, 'forming'],
          state_abbr: row.state,
          species: null,
          effective_date: today,
          metadata: {
            source: FN,
            lead_id: row.lead_id,
            watch_id: id,
            evidence: row.evidence,
            precedents: row.precedents,
            claim_fire_id: row.claim_fire_id,
          },
          embedding: embeddings[i],
        }));
        const { error: embErr } = await supabase.from('hunt_knowledge').insert(rows);
        if (embErr) { console.error(`[${FN}] embed insert failed:`, embErr.message); errors++; }
        else embedded = rows.length;
      } catch (err) {
        console.error(`[${FN}] embedding failed:`, err);
        errors++;
      }
    }

    const summary = {
      flood_states: [...floodLive.keys()],
      smoke_states: [...trends.keys()],
      aqi_ramp_states: fired.filter((f) => f.lead_id === B1_LEAD).map((f) => f.state),
      drought_fire_states: fired.filter((f) => f.lead_id === C1_LEAD).map((f) => f.state),
      precip_flood_states: fired.filter((f) => f.lead_id === A2_LEAD).map((f) => f.state),
      opened, updated, faded, embedded, errors,
      fire_perimeters_fresh: firesFresh,
      run_at: new Date().toISOString(),
    };
    console.log(`[${FN}] Done:`, JSON.stringify(summary));
    await logCronRun({
      functionName: FN,
      status: errors > 0 ? 'partial' : 'success',
      summary,
      durationMs: Date.now() - startTime,
    });
    return cronResponse({
      ...summary,
      watches: fired.map((f) => ({
        lead_id: f.lead_id, state: f.state, copy: f.copy,
        claim_fire_id: f.claim_fire_id, precedents: f.precedents,
      })),
    });
  } catch (error) {
    console.error(`[${FN}] Fatal error:`, error);
    await logCronRun({
      functionName: FN,
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    return cronErrorResponse('Internal server error');
  }
});
