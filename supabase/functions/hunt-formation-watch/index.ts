import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { batchEmbed } from '../_shared/embedding.ts';
import { STATE_NAMES } from '../_shared/states.ts';

// ---------------------------------------------------------------------------
// hunt-formation-watch — THE FORMATION LAYER v1 (docs/THE-WEEK.md 2026-07-17
// pre-dawn doctrine). Cron every 6h + on-demand GET.
//
// Two KNOWN-PHYSICS LEADS, fired by LIVE data, receipts from the archive:
//
//   flood-forming — a state has >=1 unexpired NWS Flood Watch on the live
//     alert table. Lead time is 1-3 DAYS (the court's own retrodiction:
//     watch->warning <=3d, 82% vs 28% control in the claim's 13 scoped
//     states). Precedent = the live nws-alert lane since 2026-03-08: of the
//     days a Flood Watch stood on this ground, how many saw a Flood Warning
//     within 3 days. In the claim's scope the fire links to the court's own
//     hunt_claim_fires row where one exists — this function NEVER inserts
//     into the court's tables.
//
//   smoke-forming — the state's modeled AQI (air-quality lane, dedup by day,
//     max_aqi) rose across >=2 consecutive days inside the last-4-day window
//     with the latest reading >=100, OR the latest reading is >=150 (step
//     jumps like NY 2023-06-06, 73->154 overnight). Lead time is DAYS, never
//     weeks. Fire-perimeter upwind context only when a wildfire-perimeter row
//     landed within 48h — the lane is currently dead, so v1's default copy
//     carries no fire clause.
//
// Watch lifecycle in formation_watches (idempotent):
//   fired + no open watch  -> open (opened_at = today) + EMBED (embedding law)
//   fired + open watch     -> refresh evidence/copy/last_seen, keep opened_at
//   open watch + not fired -> status='faded', faded_at = today
//
// Copy law: fact-only, lead-time honest, "forming" + the historical record,
// NEVER "will". The history book recognizes, it never predicts.
// ---------------------------------------------------------------------------

const FN = 'hunt-formation-watch';
const FLOOD_CLAIM_NAME = 'nws-flood-watch-verifies';
const NWS_HISTORY_START = '2026-03-08'; // earliest persistent nws-alert row on file
const AQI_TREND_DAYS = 4;               // 72h trend window + today
const MIN_FLOOD_PRECEDENT_DAYS = 3;     // below this, precedents = null (honest)

type Supa = ReturnType<typeof createSupabaseClient>;

interface FiredLead {
  lead_id: 'flood-forming' | 'smoke-forming';
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

/** Per-state AQI trend over the last AQI_TREND_DAYS days. One bounded query
 *  for all states; backfill-era duplicate rows collapse via max-per-day. */
async function aqiTrends(supabase: Supa, today: string): Promise<Map<string, AqiTrend>> {
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

  const out = new Map<string, AqiTrend>();
  for (const [state, dayMap] of byState) {
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

    // ---------------- SMOKE-FORMING ----------------
    const trends = await aqiTrends(supabase, today);
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
