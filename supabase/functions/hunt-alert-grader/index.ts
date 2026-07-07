import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';
import { logCronRun } from '../_shared/cronLog.ts';
import { transitionArc, fireNarrator } from '../_shared/arcReactor.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlertOutcome {
  id: string;
  alert_source: string;
  alert_knowledge_id: string | null;
  state_abbr: string | null;
  alert_date: string;
  predicted_outcome: {
    claim?: string;
    expected_signals?: string[];
    severity?: string;
    converging_domains?: number;
    [key: string]: unknown;
  };
  outcome_window_hours: number;
  outcome_deadline: string;
}

type Grade = 'confirmed' | 'partially_confirmed' | 'false_alarm' | 'missed';

interface DomainResult {
  domain: string;
  content_types_checked: string[];
  signals_found: number;
  confirmed: boolean;
  samples: { id: string; title: string; content_type: string }[];
}

interface SignalFound {
  id: string;
  title: string;
  content_type: string;
  source: 'direct';
  domain: string;
}

// ---------------------------------------------------------------------------
// Domain → Content Type Mapping
//
// Maps the domain names used in convergence claims to the actual content_types
// in hunt_knowledge that represent real external signals for that domain.
// ---------------------------------------------------------------------------

//
// Only conditional/discriminating signal types are allowed.
// Daily-always-present types (birdcast-daily, migration-daily, weather-realtime)
// are EXCLUDED — they confirm nothing because they always exist.
const DOMAIN_CONTENT_TYPES: Record<string, string[]> = {
  // Weather — real events and NWS alerts only. weather-realtime is a metar dump
  // that exists constantly; excluding it forces the grader to see actual weather.
  weather: ['weather-event', 'nws-alert', 'storm-event'],
  // Biological — only migration SPIKES count. Daily birdcast/migration entries
  // are tautologies (they exist every day for every state).
  birds: ['migration-spike-extreme', 'migration-spike-significant', 'migration-spike-moderate'],
  biological: ['migration-spike-extreme', 'migration-spike-significant', 'migration-spike-moderate'],
  // Water — USGS stream gauges + river discharge
  water: ['usgs-water', 'river-discharge'],
  // Drought — weekly drought monitor
  drought: ['drought-weekly'],
  // Climate — climate indices (NAO, AO, ENSO, etc.) — NATIONAL
  climate: ['climate-index'],
  // Air Quality — EPA AQI + pollen
  air_quality: ['air-quality'],
  air: ['air-quality'],
  // Soil — moisture and temperature
  soil: ['soil-conditions'],
  // Ocean — NOAA buoy data
  ocean: ['ocean-buoy'],
  // Space Weather — geomagnetic/solar — NATIONAL
  space_weather: ['space-weather'],
  space: ['space-weather'],
  // Lunar cycle — NATIONAL
  lunar: ['solunar-weekly'],
  solunar: ['solunar-weekly'],
  // Photoperiod — day length — NATIONAL
  photoperiod: ['photoperiod'],
  // Tide — NOAA tidal stations
  tide: ['noaa-tide'],
  // NWS (used in some convergence-alert claims)
  nws: ['nws-alert', 'weather-event', 'storm-event'],
};

// Domains whose source data has NO state_abbr (national/global signals).
// For these, don't filter by state when counting signals.
const NATIONAL_DOMAINS = new Set([
  'climate',
  'space_weather', 'space',
  'lunar', 'solunar',
  'photoperiod',
]);

// "convergence" appears as a claimed domain but it's self-referential —
// a convergence score changing IS the claim, not something to confirm externally.
// We skip it in domain checks.
const SKIP_DOMAINS = new Set(['convergence']);

// Domains that confirm on essentially ANY random window. Measured 2026-07-02
// against matched random control windows: water, nws, weather, air_quality,
// space_weather, ocean, and soil confirm 91-100% of the time regardless of
// prediction quality — their feeds are always-on daily ingestion, so "signal
// present in window" carries no information. They are still CHECKED and
// reported, but they are EXCLUDED from the primary (discriminating) grade.
// The old all-domains grade is preserved in metadata as grade_legacy.
const ALWAYS_ON_DOMAINS = new Set([
  'water', 'nws', 'weather',
  'air_quality', 'air',
  'space_weather', 'space',
  'ocean', 'soil',
]);

// Domain-specific confirmation thresholds.
// Weekly/monthly signals can only produce 1 entry in a 7-day window — force
// threshold of 1 or they're unconfirmable by design.
const DOMAIN_THRESHOLDS: Record<string, number> = {
  drought: 1,    // drought monitor releases weekly
  climate: 1,    // climate indices release monthly
  solunar: 1,
  lunar: 1,
  photoperiod: 1,
  space_weather: 1,
  space: 1,
};
const DEFAULT_DOMAIN_THRESHOLD = 2;
function thresholdFor(domain: string): number {
  return DOMAIN_THRESHOLDS[domain] ?? DEFAULT_DOMAIN_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Parse domains from claim text
// ---------------------------------------------------------------------------

function parseClaimedDomains(claim: string): string[] {
  // Format: "5 domains converging in SD: drought, birds, water, climate, convergence"
  // or: "Score 63/100. Weather active: pressure drop, high wind."
  const colonIdx = claim.indexOf(':');
  if (colonIdx === -1) return [];

  const prefix = claim.slice(0, colonIdx).toLowerCase();
  // Only parse domain lists from "N domains converging" style claims
  if (!prefix.includes('domain')) return [];

  const domainPart = claim.slice(colonIdx + 1).trim();
  return domainPart
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(d => d.length > 0 && d.length < 30); // sanity filter
}

// ---------------------------------------------------------------------------
// Per-domain grading
// ---------------------------------------------------------------------------

async function checkDomain(
  supabase: ReturnType<typeof createSupabaseClient>,
  domain: string,
  contentTypes: string[],
  stateAbbr: string | null,
  dateFrom: string,
  dateTo: string,
): Promise<DomainResult> {
  // Filter by effective_date (when the signal occurred in the real world),
  // NOT created_at (when the backfill happened to land in the DB).
  // This fixes the climate/drought 0% bug — those content types are bulk-loaded
  // so created_at has no temporal meaning.
  let query = supabase
    .from('hunt_knowledge')
    .select('id, title, content_type, effective_date')
    .in('content_type', contentTypes)
    .is('metadata->superseded', null)
    .gte('effective_date', dateFrom)
    .lte('effective_date', dateTo)
    .not('effective_date', 'is', null)
    .order('effective_date', { ascending: false })
    .limit(10);

  // National-scope domains (climate indices, space weather, lunar, photoperiod)
  // have state_abbr=null by design — filtering by state zeros them out.
  const isNational = NATIONAL_DOMAINS.has(domain);
  if (stateAbbr && !isNational) {
    query = query.eq('state_abbr', stateAbbr);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`[hunt-alert-grader] Domain check failed for ${domain}:`, error.message);
  }

  const signals = data || [];
  const threshold = thresholdFor(domain);
  return {
    domain,
    content_types_checked: contentTypes,
    signals_found: signals.length,
    confirmed: signals.length >= threshold,
    samples: signals.slice(0, 3).map(s => ({ id: s.id, title: s.title, content_type: s.content_type })),
  };
}

// ---------------------------------------------------------------------------
// Grading logic — per-domain confirmation ratio
// ---------------------------------------------------------------------------

function gradeFromDomainResults(
  domainResults: DomainResult[],
  severity: string | undefined,
): { grade: Grade; reasoning: string } {
  const total = domainResults.length;
  if (total === 0) {
    return {
      grade: severity === 'high' || severity === 'extreme' ? 'false_alarm' : 'missed',
      reasoning: 'No testable domains found in claim.',
    };
  }

  const confirmedDomains = domainResults.filter(d => d.confirmed);
  const confirmedCount = confirmedDomains.length;
  const ratio = confirmedCount / total;

  const breakdown = domainResults
    .map(d => `${d.domain}: ${d.signals_found} signal${d.signals_found !== 1 ? 's' : ''} (${d.confirmed ? 'CONFIRMED' : 'MISSED'})`)
    .join('; ');

  // 80%+ domains confirmed = CONFIRMED
  if (ratio >= 0.8) {
    return {
      grade: 'confirmed',
      reasoning: `${confirmedCount}/${total} domains confirmed (${Math.round(ratio * 100)}%). ${breakdown}`,
    };
  }

  // 40-79% = PARTIAL
  if (ratio >= 0.4) {
    return {
      grade: 'partially_confirmed',
      reasoning: `${confirmedCount}/${total} domains confirmed (${Math.round(ratio * 100)}%). ${breakdown}`,
    };
  }

  // <40% + high severity = FALSE ALARM
  const isHighSeverity = severity === 'high' || severity === 'extreme' || severity === 'spike' || severity === 'threshold_crossed';
  if (isHighSeverity) {
    return {
      grade: 'false_alarm',
      reasoning: `Only ${confirmedCount}/${total} domains confirmed (${Math.round(ratio * 100)}%). ${breakdown}. High-severity claim with weak outcome.`,
    };
  }

  // <40% + low severity = MISSED
  return {
    grade: 'missed',
    reasoning: `Only ${confirmedCount}/${total} domains confirmed (${Math.round(ratio * 100)}%). ${breakdown}`,
  };
}

// ---------------------------------------------------------------------------
// Grader v2 — matched-control evaluation
//
// The v1 grades were tautological: "did the outcome signal occur in the
// window" with no base-rate comparison. Always-on daily feeds auto-confirmed.
// v2 evaluates the SAME detection over N=10 matched control windows (same
// state, same window length, random start dates within the live-data era,
// non-overlapping with the alert's own window) and scores the alert as LIFT
// over base rate, not raw hit rate.
//
// Lift convention (grade_version 2):
//   control_rate = control_hits / control_n
//   lift = alert_hit ? 1 / max(control_rate, 1/(2*control_n)) : 0
// The 1/(2N) floor ("half a hit") keeps lift finite when controls are clean:
// with N=10 the max lift is 20. lift = 0 means the alert itself missed;
// lift <= 1 means the outcome fires at least as often on random matched
// windows (tautology); lift > 1 means the alert beat base rate.
// ---------------------------------------------------------------------------

// Continuous multi-domain ingestion starts here — control windows are only
// sampled from the live-data era so "no signal" means absence, not no-feed.
const LIVE_ERA_START = '2026-03-15';
const CONTROL_N = 10;

interface CourtResult {
  grade_version: 2;
  grade_legacy: Grade;
  alert_hit: boolean;
  control_hits: number;
  control_n: number;
  control_rate: number | null;
  lift: number | null;
  control_window_days: number;
  control_starts: string[];
  control_detection: 'domain' | 'direct-only' | 'none';
}

function isGradeHit(grade: Grade): boolean {
  return grade === 'confirmed' || grade === 'partially_confirmed';
}

function addDaysStr(dateStr: string, n: number): string {
  return new Date(Date.parse(dateStr) + n * 86400000).toISOString().split('T')[0];
}

// Random non-overlapping control window start dates: same window length,
// uniform over [LIVE_ERA_START, today - windowDays], rejecting any window
// that overlaps the alert's own window. Deduped; may return < n if the era
// is too short.
function pickControlStarts(alertStart: string, alertEnd: string, windowDays: number, n: number): string[] {
  const eraStartMs = Date.parse(LIVE_ERA_START);
  const latestStartMs = Date.now() - windowDays * 86400000;
  if (latestStartMs <= eraStartMs) return [];
  const dayRange = Math.floor((latestStartMs - eraStartMs) / 86400000);
  const alertStartMs = Date.parse(alertStart);
  const alertEndMs = Date.parse(alertEnd);
  const starts = new Set<string>();
  let attempts = 0;
  while (starts.size < n && attempts < n * 8) {
    attempts++;
    const startMs = eraStartMs + Math.floor(Math.random() * (dayRange + 1)) * 86400000;
    const endMs = startMs + windowDays * 86400000;
    if (startMs <= alertEndMs && endMs >= alertStartMs) continue; // overlaps alert window
    starts.add(new Date(startMs).toISOString().split('T')[0]);
  }
  return [...starts];
}

function computeLift(alertHit: boolean, controlHits: number, controlN: number): number | null {
  if (controlN === 0) return alertHit ? null : 0; // no controls available — lift undefined for hits
  const controlRate = controlHits / controlN;
  if (!alertHit) return 0;
  return Math.round((1 / Math.max(controlRate, 1 / (2 * controlN))) * 100) / 100;
}

// Compound-risk control detection: identical machinery to the alert's own
// primary grade — checkDomain over the same DISCRIMINATING domains, graded
// with gradeFromDomainResults.
async function controlHitCompound(
  supabase: ReturnType<typeof createSupabaseClient>,
  discDomains: string[],
  stateAbbr: string | null,
  start: string,
  end: string,
  severity: string | undefined,
): Promise<boolean> {
  const results = await Promise.all(
    discDomains.map(d => checkDomain(supabase, d, DOMAIN_CONTENT_TYPES[d], stateAbbr, start, end))
  );
  return isGradeHit(gradeFromDomainResults(results, severity).grade);
}

// Signal-count control detection: direct-only — one bounded query per control
// window over the same content types; hit = >= 2 direct signals (the
// partially_confirmed threshold). Controls omit the vector channel (that
// would cost CONTROL_N Voyage embeddings per alert); recorded as
// control_detection: 'direct-only'. This can slightly UNDERSTATE control
// rate vs the alert's full detection — i.e., it is generous to the alert;
// interpret lift near 1 accordingly.
async function controlHitDirect(
  supabase: ReturnType<typeof createSupabaseClient>,
  contentTypes: string[],
  stateAbbr: string | null,
  start: string,
  end: string,
): Promise<boolean> {
  let q = supabase
    .from('hunt_knowledge')
    .select('id')
    .in('content_type', contentTypes)
    .is('metadata->superseded', null)
    .not('effective_date', 'is', null)
    .gte('effective_date', start)
    .lte('effective_date', end)
    .limit(3);
  if (stateAbbr) q = q.eq('state_abbr', stateAbbr);
  const { data, error } = await q;
  if (error) console.error('[hunt-alert-grader] Control window query failed:', error.message);
  return (data ?? []).length >= 2;
}

// ---------------------------------------------------------------------------
// Fallback: convergence-alert and anomaly-alert grading
// These don't have structured domain claims — use the old expected_signals approach
// but with stricter thresholds and no blanket limit(20)
// ---------------------------------------------------------------------------

function gradeFromSignalCount(
  directCount: number,
  vectorHighCount: number,
  severity: string | undefined,
): { grade: Grade; reasoning: string } {
  // Confirmed: 5+ direct signals OR 2+ high-relevance vector matches
  if (directCount >= 5 || vectorHighCount >= 2) {
    return {
      grade: 'confirmed',
      reasoning: `Found ${directCount} direct signal(s) and ${vectorHighCount} high-relevance vector match(es) (>0.6).`,
    };
  }

  // Partial: 2-4 direct signals
  if (directCount >= 2) {
    return {
      grade: 'partially_confirmed',
      reasoning: `Found ${directCount} direct signal(s) and ${vectorHighCount} high-relevance match(es). Partial confirmation.`,
    };
  }

  const isHighSeverity = severity === 'high' || severity === 'extreme' || severity === 'spike' || severity === 'threshold_crossed';
  if (isHighSeverity) {
    return {
      grade: 'false_alarm',
      reasoning: `Only ${directCount} direct signal(s). High-severity claim with weak outcome.`,
    };
  }

  return {
    grade: 'missed',
    reasoning: `Only ${directCount} direct signal(s). No predicted activity materialized.`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Throughput: ~50 new alerts/day. A fixed cap of 15/run fell permanently
// behind (~1,300 backlog). Grade oldest-first in batches until the wall-clock
// budget is spent. Per-alert grading semantics are UNCHANGED.
const BATCH_SIZE = 25;
const TIME_BUDGET_MS = 120_000; // well under the 400s edge wall limit; the
// function keeps executing even if the cron caller disconnects at 60s.

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();

    console.log('[hunt-alert-grader] Starting alert grading run');

    const gradeCounts: Record<Grade, number> = { confirmed: 0, partially_confirmed: 0, false_alarm: 0, missed: 0 };
    let errors = 0;
    let noAlertsAtAll = false;
    // IDs attempted this run — excluded from refetch so an alert whose grading
    // errored (and stayed outcome_checked=false) can't loop within one run.
    const attemptedIds = new Set<string>();

    // 1+2. Fetch and grade oldest-first batches until the time budget is spent
    while (Date.now() - startTime < TIME_BUDGET_MS) {
      const now = new Date().toISOString();

      let batchQuery = supabase
        .from('hunt_alert_outcomes')
        .select('id, alert_source, alert_knowledge_id, state_abbr, alert_date, predicted_outcome, outcome_window_hours, outcome_deadline')
        .eq('outcome_checked', false)
        .lt('outcome_deadline', now)
        .order('outcome_deadline', { ascending: true })
        .limit(BATCH_SIZE);
      if (attemptedIds.size > 0) {
        batchQuery = batchQuery.not('id', 'in', `(${[...attemptedIds].join(',')})`);
      }
      const { data: ungradedAlerts, error: queryErr } = await batchQuery;

      if (queryErr) {
        console.error('[hunt-alert-grader] Query error:', queryErr);
        if (attemptedIds.size === 0) {
          await logCronRun({ functionName: 'hunt-alert-grader', status: 'error', errorMessage: queryErr.message, durationMs: Date.now() - startTime });
          return cronErrorResponse('Query failed');
        }
        errors++;
        break;
      }

      if (!ungradedAlerts || ungradedAlerts.length === 0) {
        noAlertsAtAll = attemptedIds.size === 0;
        break;
      }

      console.log(`[hunt-alert-grader] Found ${ungradedAlerts.length} alerts to grade (${attemptedIds.size} attempted so far)`);

      for (const alert of ungradedAlerts as AlertOutcome[]) {
        if (Date.now() - startTime >= TIME_BUDGET_MS) break;
        attemptedIds.add(alert.id);
        try {
          const claim = alert.predicted_outcome?.claim || '';
          const severity = alert.predicted_outcome?.severity as string | undefined;
          const deadlineDate = new Date(alert.outcome_deadline).toISOString().split('T')[0];

          console.log(`[hunt-alert-grader] Grading ${alert.id} (${alert.alert_source} / ${alert.state_abbr || 'national'} / ${alert.alert_date})`);

          let grade: Grade;
          let gradeLegacy: Grade;
          let reasoning: string;
          let signalsFound: SignalFound[] = [];
          let domainResults: DomainResult[] = [];
          // Inputs for the matched-control (court) evaluation below
          let discDomainNames: string[] = [];
          let controlContentTypes: string[] = [];

          // --- COMPOUND-RISK: Per-domain grading ---
          if (alert.alert_source === 'compound-risk') {
            const claimedDomains = parseClaimedDomains(claim);
            const testable = claimedDomains.filter(d => !SKIP_DOMAINS.has(d) && DOMAIN_CONTENT_TYPES[d]);

            if (testable.length === 0) {
              // Can't parse domains — fall back to generic check
              console.log(`[hunt-alert-grader] No parseable domains in claim: "${claim.slice(0, 80)}"`);
              grade = 'missed';
              gradeLegacy = 'missed';
              reasoning = `Could not parse testable domains from claim. Raw claim: "${claim.slice(0, 120)}"`;
            } else {
              // Check each domain independently
              domainResults = await Promise.all(
                testable.map(domain =>
                  checkDomain(supabase, domain, DOMAIN_CONTENT_TYPES[domain], alert.state_abbr, alert.alert_date, deadlineDate)
                )
              );

              // LEGACY grade: all claimed domains, including always-on ones —
              // this is the tautological v1 judgment, preserved for continuity.
              gradeLegacy = gradeFromDomainResults(domainResults, severity).grade;

              // PRIMARY grade: discriminating domains only. Always-on domains
              // (water/nws/weather/air_quality/space_weather/ocean/soil)
              // confirm 91-100% on random windows so they cannot support a
              // grade — only domains that can actually miss count.
              const discResults = domainResults.filter(d => !ALWAYS_ON_DOMAINS.has(d.domain));
              discDomainNames = discResults.map(d => d.domain);
              const excludedNames = domainResults.filter(d => ALWAYS_ON_DOMAINS.has(d.domain)).map(d => d.domain);
              const primary = gradeFromDomainResults(discResults, severity);
              grade = primary.grade;
              reasoning = discResults.length === 0
                ? `All ${domainResults.length} claimed domain(s) are always-on (${excludedNames.join(', ')}) — they confirm on any random window, so the claim has no discriminating content. ${primary.reasoning}`
                : `${primary.reasoning}${excludedNames.length > 0 ? ` [Always-on domains excluded from grade: ${excludedNames.join(', ')}]` : ''}`;

              // Collect signals from all domains
              for (const dr of domainResults) {
                for (const s of dr.samples) {
                  signalsFound.push({ id: s.id, title: s.title, content_type: s.content_type, source: 'direct', domain: dr.domain });
                }
              }
            }
          }
          // --- CONVERGENCE-ALERT / ANOMALY-ALERT: Signal-count grading ---
          else {
            const queryContentTypes = Array.isArray(alert.predicted_outcome?.expected_signals) && alert.predicted_outcome.expected_signals.length > 0
              ? alert.predicted_outcome.expected_signals
              : ['migration-spike-extreme', 'migration-spike-significant', 'weather-event', 'nws-alert'];

            // Direct query — limit per content type to avoid weather flooding.
            // Use effective_date to match the real-world date, consistent with
            // checkDomain fix (same bug: created_at ≠ when signal occurred).
            const directMatches: { id: string; title: string; content_type: string }[] = [];
            for (const ct of queryContentTypes) {
              let q = supabase
                .from('hunt_knowledge')
                .select('id, title, content_type')
                .eq('content_type', ct)
                .is('metadata->superseded', null)
                .not('effective_date', 'is', null)
                .gte('effective_date', alert.alert_date)
                .lte('effective_date', deadlineDate)
                .order('effective_date', { ascending: false })
                .limit(5);

              if (alert.state_abbr) q = q.eq('state_abbr', alert.state_abbr);
              const { data } = await q;
              if (data) directMatches.push(...data);
            }

            // Vector search for broader signal detection
            const searchText = `What happened in ${alert.state_abbr || 'the US'} between ${alert.alert_date} and ${deadlineDate}?`;
            const queryEmbedding = await generateEmbedding(searchText, 'query');

            const { data: vectorResults } = await supabase.rpc('search_hunt_knowledge_v3', {
              query_embedding: queryEmbedding,
              match_threshold: 0.40,
              match_count: 10,
              filter_state_abbr: alert.state_abbr || null,
              filter_content_types: queryContentTypes,
              filter_species: null,
              filter_date_from: alert.alert_date,
              filter_date_to: deadlineDate,
              recency_weight: 0.1,
              exclude_du_report: true,
            });

            const highRelevanceVector = (vectorResults || [])
              .filter((r: any) => r?.metadata?.superseded !== true)
              .filter((r: { similarity: number }) => r.similarity > 0.6);

            const result = gradeFromSignalCount(directMatches.length, highRelevanceVector.length, severity);
            grade = result.grade;
            gradeLegacy = result.grade; // no domain split on this path — legacy = primary
            reasoning = result.reasoning;
            controlContentTypes = queryContentTypes;

            const seenIds = new Set<string>();
            for (const m of directMatches) {
              if (!seenIds.has(m.id)) {
                seenIds.add(m.id);
                signalsFound.push({ id: m.id, title: m.title, content_type: m.content_type, source: 'direct', domain: 'general' });
              }
            }
          }

          gradeCounts[grade]++;

          // --- Grader v2: matched-control (court) evaluation ---
          // Evaluate the SAME detection over CONTROL_N random windows of the
          // same length in the same state, and score the alert as lift.
          const windowDays = Math.max(1, Math.round((Date.parse(deadlineDate) - Date.parse(alert.alert_date)) / 86400000));
          const alertHit = isGradeHit(grade);
          let controlStarts: string[] = [];
          let controlHits = 0;
          let controlDetection: CourtResult['control_detection'] = 'none';

          if (alert.alert_source === 'compound-risk' && discDomainNames.length > 0) {
            controlDetection = 'domain';
            controlStarts = pickControlStarts(alert.alert_date, deadlineDate, windowDays, CONTROL_N);
            const hits = await Promise.all(controlStarts.map(start =>
              controlHitCompound(supabase, discDomainNames, alert.state_abbr, start, addDaysStr(start, windowDays), severity)
            ));
            controlHits = hits.filter(Boolean).length;
          } else if (alert.alert_source !== 'compound-risk' && controlContentTypes.length > 0) {
            controlDetection = 'direct-only';
            controlStarts = pickControlStarts(alert.alert_date, deadlineDate, windowDays, CONTROL_N);
            const hits = await Promise.all(controlStarts.map(start =>
              controlHitDirect(supabase, controlContentTypes, alert.state_abbr, start, addDaysStr(start, windowDays))
            ));
            controlHits = hits.filter(Boolean).length;
          }
          // else: no evaluable detection (unparseable compound claim) — no controls

          const controlN = controlStarts.length;
          const controlRate = controlN > 0 ? Math.round((controlHits / controlN) * 1000) / 1000 : null;
          const lift = computeLift(alertHit, controlHits, controlN);

          const court: CourtResult = {
            grade_version: 2,
            grade_legacy: gradeLegacy,
            alert_hit: alertHit,
            control_hits: controlHits,
            control_n: controlN,
            control_rate: controlRate,
            lift,
            control_window_days: windowDays,
            control_starts: controlStarts,
            control_detection: controlDetection,
          };

          // Build grade text for embedding
          let originalClaim = claim;
          if (alert.alert_knowledge_id) {
            const { data: origEntry } = await supabase
              .from('hunt_knowledge')
              .select('title, content')
              .eq('id', alert.alert_knowledge_id)
              .single();
            if (origEntry) originalClaim = origEntry.content || origEntry.title || originalClaim;
          }

          const domainBreakdown = domainResults.length > 0
            ? `\nDomain breakdown:\n${domainResults.map(d => `  ${d.domain}: ${d.signals_found} signals — ${d.confirmed ? 'CONFIRMED' : 'MISSED'} (checked: ${d.content_types_checked.join(', ')})`).join('\n')}`
            : '';

          let gradeContent = `On ${alert.alert_date}, ${alert.alert_source} fired for ${alert.state_abbr || 'national'}: '${originalClaim.slice(0, 500)}'.\n`;
          gradeContent += `Outcome window: ${alert.alert_date} to ${deadlineDate}.\n`;
          gradeContent += `Grade: ${grade}. ${reasoning}${domainBreakdown}`;
          gradeContent += `\nMatched controls: ${controlHits}/${controlN} random same-length windows also hit (control rate ${controlRate ?? 'n/a'}). Lift: ${lift ?? 'n/a'}${lift !== null && lift > 1 ? ' — beat base rate' : lift !== null && lift > 0 ? ' — did NOT beat base rate' : ''}. Legacy (all-domains) grade: ${gradeLegacy}.`;

          if (grade === 'false_alarm') {
            gradeContent += `\nHigh-severity claim did not materialize. The ${alert.alert_source} threshold may need adjustment for ${alert.state_abbr || 'this region'}.`;
          } else if (grade === 'confirmed' && lift !== null && lift > 1) {
            gradeContent += `\nPattern validated across discriminating domains AND beat matched-control base rate.`;
          } else if (grade === 'confirmed') {
            gradeContent += `\nDiscriminating domains confirmed, but the same detection also fires on random windows — treat as base rate, not skill.`;
          }

          // Knowledge write-back is NON-FATAL: hunt_knowledge writes can fail
          // (e.g., during IVFFlat index rebuilds, which lock writes). The
          // grade itself lives in hunt_alert_outcomes — losing the embedded
          // copy must not leave the alert ungraded and re-attempted forever.
          let gradeKnowledgeId: string | null = null;
          try {
            const gradeTitle = `Alert Grade: ${grade} — ${alert.state_abbr || 'national'} ${alert.alert_date}`;
            const gradeEmbedding = await generateEmbedding(gradeContent, 'document');

            const { data: insertedGrade, error: insertErr } = await supabase
              .from('hunt_knowledge')
              .insert({
                title: gradeTitle,
                content: gradeContent,
                content_type: 'alert-grade',
                tags: [alert.alert_source, grade, alert.state_abbr || 'national'],
                state_abbr: alert.state_abbr || null,
                species: null,
                effective_date: alert.alert_date,
                embedding: gradeEmbedding,
                metadata: {
                  alert_source: alert.alert_source,
                  outcome_grade: grade,
                  original_claim: originalClaim.slice(0, 500),
                  signals_found_count: signalsFound.length,
                  signals_found: signalsFound.slice(0, 15),
                  domain_results: domainResults.length > 0 ? domainResults.map(d => ({
                    domain: d.domain,
                    signals_found: d.signals_found,
                    confirmed: d.confirmed,
                    always_on: ALWAYS_ON_DOMAINS.has(d.domain),
                  })) : undefined,
                  // Split grades: "discriminating" domains (birds, climate, drought, etc.)
                  // vs "always-on" domains so the digest can report both.
                  discriminating: domainResults.length > 0 ? (() => {
                    const disc = domainResults.filter(d => !ALWAYS_ON_DOMAINS.has(d.domain));
                    return {
                      confirmed: disc.filter(d => d.confirmed).length,
                      total: disc.length,
                    };
                  })() : undefined,
                  // Matched-control verdict (see lift convention at top of file)
                  ...court,
                  alert_knowledge_id: alert.alert_knowledge_id,
                },
              })
              .select('id')
              .single();

            if (insertErr) {
              console.error(`[hunt-alert-grader] Knowledge insert error for ${alert.id} (non-fatal):`, insertErr);
            } else {
              gradeKnowledgeId = insertedGrade?.id || null;
            }
          } catch (knErr) {
            console.error(`[hunt-alert-grader] Knowledge write-back failed for ${alert.id} (non-fatal):`, knErr);
          }

          // Update hunt_alert_outcomes. outcome_signals_found carries both the
          // matched signals and the court block ({ signals, court }) — the
          // table has no metadata column and schema changes are frozen; the
          // grader is this column's only writer and downstream readers select
          // outcome_grade/graded_at only.
          const { error: updateErr } = await supabase
            .from('hunt_alert_outcomes')
            .update({
              outcome_checked: true,
              outcome_grade: grade,
              outcome_signals_found: { signals: signalsFound, court },
              outcome_reasoning: reasoning,
              grade_knowledge_id: gradeKnowledgeId,
              graded_at: new Date().toISOString(),
            })
            .eq('id', alert.id);

          if (updateErr) {
            console.error(`[hunt-alert-grader] Update error for ${alert.id}:`, updateErr);
            errors++;
          } else {
            console.log(`[hunt-alert-grader] Graded ${alert.id}: ${grade}`);
          }

          // Arc reactor: transition arc to grade
          try {
            if (alert.state_abbr) {
              const { data: linkedArc } = await supabase
                .from('hunt_state_arcs')
                .select('id, current_act')
                .eq('state_abbr', alert.state_abbr)
                .in('current_act', ['recognition', 'outcome'])
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();

              if (linkedArc) {
                await transitionArc(supabase, linkedArc.id, 'grade', { grade });
                fireNarrator(alert.state_abbr, 'grade_assigned', { arc_id: linkedArc.id, use_opus: true });
              }
            }
          } catch (arcErr) {
            console.error('[hunt-alert-grader] Arc reactor error:', arcErr);
          }
        } catch (alertErr) {
          console.error(`[hunt-alert-grader] Error grading ${alert.id}:`, alertErr);
          errors++;
        }
      }
    }

    if (noAlertsAtAll) {
      console.log('[hunt-alert-grader] No alerts to grade');
      await logCronRun({ functionName: 'hunt-alert-grader', status: 'success', summary: { graded: 0, message: 'No alerts past deadline' }, durationMs: Date.now() - startTime });
      return cronResponse({ graded: 0, message: 'No alerts past deadline' });
    }

    // 3. Log summary
    const totalGraded = gradeCounts.confirmed + gradeCounts.partially_confirmed + gradeCounts.false_alarm + gradeCounts.missed;
    const summary = {
      graded: totalGraded,
      attempted: attemptedIds.size,
      ...gradeCounts,
      errors,
      run_at: new Date().toISOString(),
    };

    console.log(`[hunt-alert-grader] Graded ${totalGraded}. Confirmed: ${gradeCounts.confirmed}, Partial: ${gradeCounts.partially_confirmed}, False alarm: ${gradeCounts.false_alarm}, Missed: ${gradeCounts.missed}, Errors: ${errors}`);

    await logCronRun({
      functionName: 'hunt-alert-grader',
      status: errors > 0 ? 'partial' : 'success',
      summary,
      durationMs: Date.now() - startTime,
    });

    return cronResponse(summary);
  } catch (error) {
    console.error('[hunt-alert-grader] Fatal error:', error);
    await logCronRun({
      functionName: 'hunt-alert-grader',
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    return cronErrorResponse('Internal server error');
  }
});
