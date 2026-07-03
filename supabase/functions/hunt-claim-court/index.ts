import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { STATE_ABBRS } from '../_shared/states.ts';

// ---------------------------------------------------------------------------
// hunt-claim-court — the honest docket. Daily at 09:00 UTC.
//
// FIRE phase:  for each active claim in hunt_claims, evaluate trigger_def
//              against yesterday's data per in-scope state; insert a row into
//              hunt_claim_fires idempotently (unique claim_id+state+fired_at).
// GRADE phase: for fires whose window_end has passed and evaluated=false,
//              evaluate outcome_def over the fire's window, then over
//              CONTROL_N matched control windows (same state, same length,
//              random non-overlapping dates in the live-data era), and store
//              hit + lift. Lift convention (same as hunt-alert-grader v2):
//                control_rate = control_hits / control_n
//                lift = hit ? 1 / max(control_rate, 1/(2*control_n)) : 0
//              The 1/(2N) floor keeps lift finite (max 20 at N=10). lift <= 1
//              means the outcome fires as often on random windows; only
//              lift > 1 is evidence the trigger means something.
//
// =============================== VOCABULARY =================================
// trigger_def:
//   {
//     "scope": "all" | ["MD","VA",...],   // states to evaluate daily
//     "mode": "all" | "any",              // combine conditions (default "all")
//     "conditions": [ Condition, ... ]
//   }
// outcome_def:
//   {
//     "window_days": N,                   // outcome window after fire date
//     "mode": "all" | "any",              // combine conditions (default "any")
//     "conditions": [ Condition, ... ]
//   }
//
// Condition (three kinds — keep this vocabulary SMALL):
//
// 1. presence — bounded hunt_knowledge lookup (content_type + effective_date
//    + state always bounded; rows fetched with a hard limit and filtered
//    client-side, never jsonb-path SQL comparisons):
//    { "kind": "presence", "content_type": "drought-weekly",
//      "lookback_days": 10,               // trigger only; default 1 (yesterday)
//      "min_count": 1,                    // default 1
//      "metadata_num": [                  // optional, ALL must hold per row
//        { "path": "d2_pct", "op": "gte", "value": 5 } ],  // dot-paths ok
//      "text_any": ["flood"] }            // optional, OR substring match on
//                                         // title/content, case-insensitive
//
// 2. metadata_z — z-score of a numeric metadata field in hunt_knowledge vs a
//    trailing per-state baseline (daily means per effective_date):
//    { "kind": "metadata_z", "content_type": "ocean-buoy", "path": "sst_c",
//      "op": "gte", "z": 1.0,
//      "baseline_days": 45,               // default 60
//      "lookback_days": 3 }               // days of the eval window that may
//                                         // satisfy the threshold (trigger
//                                         // default 1; outcome uses window)
//    Requires >= MIN_BASELINE_DAYS distinct baseline days, else false.
//
// 3. weather_z — z-score against hunt_weather_history (structured daily table,
//    state+date bounded; the only non-hunt_knowledge source in the vocabulary
//    because daily temps live there, not in metadata):
//    { "kind": "weather_z", "metric": "temp_high_f" | "diurnal_range_f",
//      "op": "gte", "z": 3.0, "baseline_days": 60, "lookback_days": 1 }
//
// For triggers, a condition is evaluated over [evalDate - lookback_days + 1,
// evalDate]. For outcomes, over the fire's [fired_at + 1, window_end] window
// (lookback_days ignored; z-kinds pass if ANY day in the window crosses).
// ============================================================================

const CONTROL_N = 10;
const LIVE_ERA_START = '2026-03-15';
const MIN_BASELINE_DAYS = 8;
const ROW_FETCH_LIMIT = 200;
const TIME_BUDGET_MS = 120_000; // wall-clock budget, same pattern as the grader

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MetadataNumFilter {
  path: string;
  op: 'gte' | 'lte' | 'gt' | 'lt' | 'eq';
  value: number;
}

interface Condition {
  kind: 'presence' | 'metadata_z' | 'weather_z';
  content_type?: string;
  lookback_days?: number;
  min_count?: number;
  metadata_num?: MetadataNumFilter[];
  text_any?: string[];
  path?: string;
  op?: 'gte' | 'lte' | 'gt' | 'lt' | 'eq';
  z?: number;
  baseline_days?: number;
  metric?: 'temp_high_f' | 'diurnal_range_f';
}

interface TriggerDef {
  scope?: 'all' | string[];
  mode?: 'all' | 'any';
  conditions?: Condition[];
}

interface OutcomeDef {
  window_days?: number;
  mode?: 'all' | 'any';
  conditions?: Condition[];
}

interface Claim {
  id: string;
  name: string;
  status: string;
  trigger_def: TriggerDef;
  outcome_def: OutcomeDef;
}

interface Fire {
  id: string;
  claim_id: string;
  state_abbr: string;
  fired_at: string;
  window_end: string;
}

type Supa = ReturnType<typeof createSupabaseClient>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addDaysStr(dateStr: string, n: number): string {
  return new Date(Date.parse(dateStr) + n * 86400000).toISOString().split('T')[0];
}

function cmp(value: number, op: string, threshold: number): boolean {
  switch (op) {
    case 'gte': return value >= threshold;
    case 'lte': return value <= threshold;
    case 'gt': return value > threshold;
    case 'lt': return value < threshold;
    case 'eq': return value === threshold;
    default: return false;
  }
}

function resolvePath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function meanStd(values: number[]): { mean: number; sd: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

// ---------------------------------------------------------------------------
// Condition evaluation — every hunt_knowledge query is bounded by
// content_type + effective_date (+ state), with a hard row limit.
// ---------------------------------------------------------------------------

async function evalPresence(
  supabase: Supa,
  cond: Condition,
  stateAbbr: string,
  windowStart: string,
  windowEnd: string,
): Promise<boolean> {
  if (!cond.content_type) return false;
  const { data, error } = await supabase
    .from('hunt_knowledge')
    .select('id, title, content, metadata')
    .eq('content_type', cond.content_type)
    .eq('state_abbr', stateAbbr)
    .not('effective_date', 'is', null)
    .gte('effective_date', windowStart)
    .lte('effective_date', windowEnd)
    .limit(ROW_FETCH_LIMIT);
  if (error) {
    console.error(`[hunt-claim-court] presence query failed (${cond.content_type}/${stateAbbr}):`, error.message);
    return false;
  }
  let rows = data ?? [];

  if (Array.isArray(cond.metadata_num) && cond.metadata_num.length > 0) {
    rows = rows.filter(r =>
      cond.metadata_num!.every(f => {
        const v = Number(resolvePath(r.metadata, f.path));
        return Number.isFinite(v) && cmp(v, f.op, f.value);
      })
    );
  }
  if (Array.isArray(cond.text_any) && cond.text_any.length > 0) {
    const needles = cond.text_any.map(t => t.toLowerCase());
    rows = rows.filter(r => {
      const hay = `${r.title ?? ''} ${r.content ?? ''}`.toLowerCase();
      return needles.some(n => hay.includes(n));
    });
  }
  return rows.length >= (cond.min_count ?? 1);
}

async function evalMetadataZ(
  supabase: Supa,
  cond: Condition,
  stateAbbr: string,
  windowStart: string,
  windowEnd: string,
): Promise<boolean> {
  if (!cond.content_type || !cond.path || cond.z === undefined) return false;
  const baselineDays = cond.baseline_days ?? 60;
  const baselineStart = addDaysStr(windowStart, -baselineDays);

  const { data, error } = await supabase
    .from('hunt_knowledge')
    .select('effective_date, metadata')
    .eq('content_type', cond.content_type)
    .eq('state_abbr', stateAbbr)
    .not('effective_date', 'is', null)
    .gte('effective_date', baselineStart)
    .lte('effective_date', windowEnd)
    .limit(ROW_FETCH_LIMIT * 3);
  if (error) {
    console.error(`[hunt-claim-court] metadata_z query failed (${cond.content_type}/${stateAbbr}):`, error.message);
    return false;
  }

  // Daily means of the metadata field
  const byDay = new Map<string, number[]>();
  for (const r of data ?? []) {
    const v = Number(resolvePath(r.metadata, cond.path));
    if (!Number.isFinite(v)) continue;
    const day = String(r.effective_date).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(v);
  }
  const dailyMeans = [...byDay.entries()]
    .map(([day, vals]) => ({ day, mean: vals.reduce((a, b) => a + b, 0) / vals.length }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const baseline = dailyMeans.filter(d => d.day < windowStart).map(d => d.mean);
  const inWindow = dailyMeans.filter(d => d.day >= windowStart && d.day <= windowEnd);
  if (baseline.length < MIN_BASELINE_DAYS || inWindow.length === 0) return false;

  const { mean, sd } = meanStd(baseline);
  if (sd === 0) return false;
  return inWindow.some(d => cmp((d.mean - mean) / sd, cond.op ?? 'gte', cond.z!));
}

async function evalWeatherZ(
  supabase: Supa,
  cond: Condition,
  stateAbbr: string,
  windowStart: string,
  windowEnd: string,
): Promise<boolean> {
  if (!cond.metric || cond.z === undefined) return false;
  const baselineDays = cond.baseline_days ?? 60;
  const baselineStart = addDaysStr(windowStart, -baselineDays);

  const { data, error } = await supabase
    .from('hunt_weather_history')
    .select('date, temp_high_f, temp_low_f')
    .eq('state_abbr', stateAbbr)
    .gte('date', baselineStart)
    .lte('date', windowEnd)
    .order('date', { ascending: true })
    .limit(ROW_FETCH_LIMIT);
  if (error) {
    console.error(`[hunt-claim-court] weather_z query failed (${stateAbbr}):`, error.message);
    return false;
  }

  const series = (data ?? [])
    .map(r => {
      const hi = Number(r.temp_high_f);
      const lo = Number(r.temp_low_f);
      const value = cond.metric === 'diurnal_range_f' ? hi - lo : hi;
      return { day: String(r.date).slice(0, 10), value };
    })
    .filter(d => Number.isFinite(d.value));

  const baseline = series.filter(d => d.day < windowStart).map(d => d.value);
  const inWindow = series.filter(d => d.day >= windowStart && d.day <= windowEnd);
  if (baseline.length < MIN_BASELINE_DAYS || inWindow.length === 0) return false;

  const { mean, sd } = meanStd(baseline);
  if (sd === 0) return false;
  return inWindow.some(d => cmp((d.value - mean) / sd, cond.op ?? 'gte', cond.z!));
}

async function evalCondition(
  supabase: Supa,
  cond: Condition,
  stateAbbr: string,
  windowStart: string,
  windowEnd: string,
): Promise<boolean> {
  switch (cond.kind) {
    case 'presence': return evalPresence(supabase, cond, stateAbbr, windowStart, windowEnd);
    case 'metadata_z': return evalMetadataZ(supabase, cond, stateAbbr, windowStart, windowEnd);
    case 'weather_z': return evalWeatherZ(supabase, cond, stateAbbr, windowStart, windowEnd);
    default: return false;
  }
}

// Evaluate a set of conditions over an explicit window (outcome / controls).
async function evalConditionsOverWindow(
  supabase: Supa,
  conditions: Condition[],
  mode: 'all' | 'any',
  stateAbbr: string,
  windowStart: string,
  windowEnd: string,
): Promise<boolean> {
  if (!Array.isArray(conditions) || conditions.length === 0) return false;
  const results: boolean[] = [];
  for (const cond of conditions) {
    const ok = await evalCondition(supabase, cond, stateAbbr, windowStart, windowEnd);
    results.push(ok);
    if (mode === 'all' && !ok) return false;   // short-circuit AND
    if (mode === 'any' && ok) return true;     // short-circuit OR
  }
  return mode === 'all' ? results.every(Boolean) : results.some(Boolean);
}

// Evaluate a trigger for one state on evalDate — each condition gets its own
// lookback window ending on evalDate.
async function evalTrigger(
  supabase: Supa,
  trigger: TriggerDef,
  stateAbbr: string,
  evalDate: string,
): Promise<boolean> {
  const conditions = Array.isArray(trigger.conditions) ? trigger.conditions : [];
  if (conditions.length === 0) return false;
  const mode = trigger.mode === 'any' ? 'any' : 'all';
  for (const cond of conditions) {
    const lookback = Math.max(1, cond.lookback_days ?? 1);
    const windowStart = addDaysStr(evalDate, -(lookback - 1));
    const ok = await evalCondition(supabase, cond, stateAbbr, windowStart, evalDate);
    if (mode === 'all' && !ok) return false;
    if (mode === 'any' && ok) return true;
  }
  return mode === 'all';
}

// Random non-overlapping control window starts (same convention as the grader).
function pickControlStarts(fireStart: string, fireEnd: string, windowDays: number, n: number): string[] {
  const eraStartMs = Date.parse(LIVE_ERA_START);
  const latestStartMs = Date.now() - windowDays * 86400000;
  if (latestStartMs <= eraStartMs) return [];
  const dayRange = Math.floor((latestStartMs - eraStartMs) / 86400000);
  const fireStartMs = Date.parse(fireStart);
  const fireEndMs = Date.parse(fireEnd);
  const starts = new Set<string>();
  let attempts = 0;
  while (starts.size < n && attempts < n * 8) {
    attempts++;
    const startMs = eraStartMs + Math.floor(Math.random() * (dayRange + 1)) * 86400000;
    const endMs = startMs + windowDays * 86400000;
    if (startMs <= fireEndMs && endMs >= fireStartMs) continue; // overlaps fire window
    starts.add(new Date(startMs).toISOString().split('T')[0]);
  }
  return [...starts];
}

function computeLift(hit: boolean, controlHits: number, controlN: number): number | null {
  if (controlN === 0) return hit ? null : 0;
  const controlRate = controlHits / controlN;
  if (!hit) return 0;
  return Math.round((1 / Math.max(controlRate, 1 / (2 * controlN))) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  const fnName = 'hunt-claim-court';
  const budgetLeft = () => TIME_BUDGET_MS - (Date.now() - startTime);

  try {
    const supabase = createSupabaseClient();
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Tolerate running before any claims exist (or before the table has rows).
    const { data: claimRows, error: claimsErr } = await supabase
      .from('hunt_claims')
      .select('id, name, status, trigger_def, outcome_def')
      .eq('status', 'active');

    if (claimsErr) {
      console.error(`[${fnName}] Claims query failed:`, claimsErr.message);
      await logCronRun({ functionName: fnName, status: 'error', errorMessage: claimsErr.message, durationMs: Date.now() - startTime });
      return cronErrorResponse('Claims query failed');
    }

    const claims = (Array.isArray(claimRows) ? claimRows : []) as Claim[];
    let fired = 0;
    let firesEvaluatedStates = 0;
    let graded = 0;
    let errors = 0;

    // ---------------- FIRE phase ----------------
    for (const claim of claims) {
      if (budgetLeft() < TIME_BUDGET_MS / 2) break; // reserve half the budget for grading
      const trigger = claim.trigger_def ?? {};
      const scope: string[] = Array.isArray(trigger.scope) ? trigger.scope : STATE_ABBRS;
      const windowDays = Math.max(1, claim.outcome_def?.window_days ?? 7);

      for (const stateAbbr of scope) {
        if (budgetLeft() < TIME_BUDGET_MS / 2) break;
        try {
          firesEvaluatedStates++;
          const triggered = await evalTrigger(supabase, trigger, stateAbbr, yesterday);
          if (!triggered) continue;

          // Idempotent insert — unique (claim_id, state_abbr, fired_at)
          const { error: insErr } = await supabase
            .from('hunt_claim_fires')
            .upsert({
              claim_id: claim.id,
              state_abbr: stateAbbr,
              fired_at: yesterday,
              window_end: addDaysStr(yesterday, windowDays),
              evaluated: false,
              detail: { trigger_snapshot: trigger, fired_by: fnName },
            }, { onConflict: 'claim_id,state_abbr,fired_at', ignoreDuplicates: true });

          if (insErr) {
            console.error(`[${fnName}] Fire insert failed (${claim.name}/${stateAbbr}):`, insErr.message);
            errors++;
          } else {
            fired++;
            console.log(`[${fnName}] FIRE: ${claim.name} in ${stateAbbr} (${yesterday})`);
          }
        } catch (err) {
          console.error(`[${fnName}] Fire eval error (${claim.name}/${stateAbbr}):`, err);
          errors++;
        }
      }
    }

    // ---------------- GRADE phase ----------------
    const claimById = new Map(claims.map(c => [c.id, c]));
    const nowDate = new Date().toISOString().split('T')[0];

    const { data: dueFires, error: firesErr } = await supabase
      .from('hunt_claim_fires')
      .select('id, claim_id, state_abbr, fired_at, window_end')
      .eq('evaluated', false)
      .lt('window_end', nowDate)
      .order('window_end', { ascending: true })
      .limit(100);

    if (firesErr) {
      console.error(`[${fnName}] Due-fires query failed:`, firesErr.message);
      errors++;
    }

    for (const fire of ((dueFires ?? []) as Fire[])) {
      if (budgetLeft() <= 0) break;
      try {
        // Fetch retired claims too — old fires still deserve a verdict
        let claim = claimById.get(fire.claim_id);
        if (!claim) {
          const { data: c } = await supabase
            .from('hunt_claims')
            .select('id, name, status, trigger_def, outcome_def')
            .eq('id', fire.claim_id)
            .maybeSingle();
          if (c) {
            claim = c as Claim;
            claimById.set(claim.id, claim);
          }
        }
        if (!claim) {
          console.error(`[${fnName}] Fire ${fire.id} has no claim — skipping`);
          continue;
        }

        const outcome = claim.outcome_def ?? {};
        const conditions = Array.isArray(outcome.conditions) ? outcome.conditions : [];
        const mode = outcome.mode === 'all' ? 'all' : 'any';
        const windowDays = Math.max(1, Math.round((Date.parse(fire.window_end) - Date.parse(fire.fired_at)) / 86400000));
        // Outcome window starts the day AFTER the fire — the trigger day
        // itself must not confirm its own outcome.
        const outcomeStart = addDaysStr(fire.fired_at, 1);

        const hit = await evalConditionsOverWindow(supabase, conditions, mode, fire.state_abbr, outcomeStart, fire.window_end);

        // Matched controls: same state, same window length, random
        // non-overlapping dates in the live-data era.
        const controlStarts = pickControlStarts(fire.fired_at, fire.window_end, windowDays, CONTROL_N);
        let controlHits = 0;
        for (const start of controlStarts) {
          const ctrlHit = await evalConditionsOverWindow(supabase, conditions, mode, fire.state_abbr, start, addDaysStr(start, windowDays));
          if (ctrlHit) controlHits++;
        }
        const controlN = controlStarts.length;
        const lift = computeLift(hit, controlHits, controlN);

        const { error: updErr } = await supabase
          .from('hunt_claim_fires')
          .update({
            evaluated: true,
            hit,
            control_hits: controlHits,
            control_n: controlN,
            lift,
            graded_at: new Date().toISOString(),
            detail: {
              trigger_snapshot: claim.trigger_def,
              outcome_snapshot: outcome,
              outcome_window: [outcomeStart, fire.window_end],
              control_starts: controlStarts,
              control_rate: controlN > 0 ? Math.round((controlHits / controlN) * 1000) / 1000 : null,
              grade_version: 2,
            },
          })
          .eq('id', fire.id);

        if (updErr) {
          console.error(`[${fnName}] Grade update failed (${fire.id}):`, updErr.message);
          errors++;
        } else {
          graded++;
          console.log(`[${fnName}] GRADE: ${claim.name}/${fire.state_abbr} ${fire.fired_at} → hit=${hit} controls=${controlHits}/${controlN} lift=${lift}`);
        }
      } catch (err) {
        console.error(`[${fnName}] Grade error (${fire.id}):`, err);
        errors++;
      }
    }

    const summary = {
      active_claims: claims.length,
      fire_evals: firesEvaluatedStates,
      fired,
      graded,
      errors,
      run_at: new Date().toISOString(),
    };
    console.log(`[${fnName}] Done:`, JSON.stringify(summary));

    await logCronRun({
      functionName: fnName,
      status: errors > 0 ? 'partial' : 'success',
      summary,
      durationMs: Date.now() - startTime,
    });
    return cronResponse(summary);
  } catch (error) {
    console.error(`[${fnName}] Fatal error:`, error);
    await logCronRun({
      functionName: fnName,
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    return cronErrorResponse('Internal server error');
  }
});
