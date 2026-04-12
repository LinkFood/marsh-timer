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

const DOMAIN_CONTENT_TYPES: Record<string, string[]> = {
  // Weather — ASOS observations, NWS warnings, detected weather events, storm reports
  weather: ['weather-event', 'nws-alert', 'weather-realtime', 'storm-event'],
  // Biological — all bird/migration data (eBird, BirdCast)
  birds: ['birdcast-daily', 'migration-spike-extreme', 'migration-spike-significant', 'migration-spike-moderate', 'migration-daily'],
  biological: ['birdcast-daily', 'migration-spike-extreme', 'migration-spike-significant', 'migration-spike-moderate', 'migration-daily'],
  // Water — USGS stream gauges + river discharge
  water: ['usgs-water', 'river-discharge'],
  // Drought — weekly drought monitor data
  drought: ['drought-weekly'],
  // Climate — climate indices (NAO, AO, ENSO, etc.)
  climate: ['climate-index'],
  // Air Quality — EPA AQI + pollen
  air_quality: ['air-quality'],
  air: ['air-quality'],
  // Soil — moisture and temperature
  soil: ['soil-conditions'],
  // Ocean — NOAA buoy data
  ocean: ['ocean-buoy'],
  // Space Weather — geomagnetic/solar
  space_weather: ['space-weather'],
  space: ['space-weather'],
  // Lunar cycle (was solunar)
  lunar: ['solunar-weekly'],
  solunar: ['solunar-weekly'],
  // Photoperiod — day length
  photoperiod: ['photoperiod'],
  // Tide — NOAA tidal stations
  tide: ['noaa-tide'],
  // NWS (used in some convergence-alert claims)
  nws: ['nws-alert', 'weather-event', 'storm-event'],
};

// "convergence" appears as a claimed domain but it's self-referential —
// a convergence score changing IS the claim, not something to confirm externally.
// We skip it in domain checks.
const SKIP_DOMAINS = new Set(['convergence']);

// Minimum signals per domain to count it as confirmed
const DOMAIN_CONFIRM_THRESHOLD = 2;

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
  let query = supabase
    .from('hunt_knowledge')
    .select('id, title, content_type')
    .in('content_type', contentTypes)
    .gte('created_at', dateFrom)
    .lte('created_at', dateTo)
    .order('created_at', { ascending: false })
    .limit(5);

  if (stateAbbr) {
    query = query.eq('state_abbr', stateAbbr);
  }

  const { data, error } = await query;
  if (error) {
    console.error(`[hunt-alert-grader] Domain check failed for ${domain}:`, error.message);
  }

  const signals = data || [];
  return {
    domain,
    content_types_checked: contentTypes,
    signals_found: signals.length,
    confirmed: signals.length >= DOMAIN_CONFIRM_THRESHOLD,
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

const MAX_PER_RUN = 15;

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const now = new Date().toISOString();

    console.log('[hunt-alert-grader] Starting alert grading run');

    // 1. Query ungraded alerts past their deadline
    const { data: ungradedAlerts, error: queryErr } = await supabase
      .from('hunt_alert_outcomes')
      .select('id, alert_source, alert_knowledge_id, state_abbr, alert_date, predicted_outcome, outcome_window_hours, outcome_deadline')
      .eq('outcome_checked', false)
      .lt('outcome_deadline', now)
      .order('outcome_deadline', { ascending: true })
      .limit(MAX_PER_RUN);

    if (queryErr) {
      console.error('[hunt-alert-grader] Query error:', queryErr);
      await logCronRun({ functionName: 'hunt-alert-grader', status: 'error', errorMessage: queryErr.message, durationMs: Date.now() - startTime });
      return cronErrorResponse('Query failed');
    }

    if (!ungradedAlerts || ungradedAlerts.length === 0) {
      console.log('[hunt-alert-grader] No alerts to grade');
      await logCronRun({ functionName: 'hunt-alert-grader', status: 'success', summary: { graded: 0, message: 'No alerts past deadline' }, durationMs: Date.now() - startTime });
      return cronResponse({ graded: 0, message: 'No alerts past deadline' });
    }

    console.log(`[hunt-alert-grader] Found ${ungradedAlerts.length} alerts to grade`);

    // 2. Grade each alert
    const gradeCounts: Record<Grade, number> = { confirmed: 0, partially_confirmed: 0, false_alarm: 0, missed: 0 };
    let errors = 0;

    for (const alert of ungradedAlerts as AlertOutcome[]) {
      try {
        const claim = alert.predicted_outcome?.claim || '';
        const severity = alert.predicted_outcome?.severity as string | undefined;
        const deadlineDate = new Date(alert.outcome_deadline).toISOString().split('T')[0];

        console.log(`[hunt-alert-grader] Grading ${alert.id} (${alert.alert_source} / ${alert.state_abbr || 'national'} / ${alert.alert_date})`);

        let grade: Grade;
        let reasoning: string;
        let signalsFound: SignalFound[] = [];
        let domainResults: DomainResult[] = [];

        // --- COMPOUND-RISK: Per-domain grading ---
        if (alert.alert_source === 'compound-risk') {
          const claimedDomains = parseClaimedDomains(claim);
          const testable = claimedDomains.filter(d => !SKIP_DOMAINS.has(d) && DOMAIN_CONTENT_TYPES[d]);

          if (testable.length === 0) {
            // Can't parse domains — fall back to generic check
            console.log(`[hunt-alert-grader] No parseable domains in claim: "${claim.slice(0, 80)}"`);
            grade = 'missed';
            reasoning = `Could not parse testable domains from claim. Raw claim: "${claim.slice(0, 120)}"`;
          } else {
            // Check each domain independently
            domainResults = await Promise.all(
              testable.map(domain =>
                checkDomain(supabase, domain, DOMAIN_CONTENT_TYPES[domain], alert.state_abbr, alert.alert_date, deadlineDate)
              )
            );

            const result = gradeFromDomainResults(domainResults, severity);
            grade = result.grade;
            reasoning = result.reasoning;

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

          // Direct query — limit per content type to avoid weather flooding
          const directMatches: { id: string; title: string; content_type: string }[] = [];
          for (const ct of queryContentTypes) {
            let q = supabase
              .from('hunt_knowledge')
              .select('id, title, content_type')
              .eq('content_type', ct)
              .gte('created_at', alert.alert_date)
              .lte('created_at', alert.outcome_deadline)
              .order('created_at', { ascending: false })
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

          const highRelevanceVector = (vectorResults || []).filter((r: { similarity: number }) => r.similarity > 0.6);

          const result = gradeFromSignalCount(directMatches.length, highRelevanceVector.length, severity);
          grade = result.grade;
          reasoning = result.reasoning;

          const seenIds = new Set<string>();
          for (const m of directMatches) {
            if (!seenIds.has(m.id)) {
              seenIds.add(m.id);
              signalsFound.push({ id: m.id, title: m.title, content_type: m.content_type, source: 'direct', domain: 'general' });
            }
          }
        }

        gradeCounts[grade]++;

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

        if (grade === 'false_alarm') {
          gradeContent += `\nHigh-severity claim did not materialize. The ${alert.alert_source} threshold may need adjustment for ${alert.state_abbr || 'this region'}.`;
        } else if (grade === 'confirmed') {
          gradeContent += `\nPattern validated across claimed domains. Conditions reinforced as reliable predictors.`;
        }

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
              })) : undefined,
              alert_knowledge_id: alert.alert_knowledge_id,
            },
          })
          .select('id')
          .single();

        if (insertErr) {
          console.error(`[hunt-alert-grader] Knowledge insert error for ${alert.id}:`, insertErr);
          errors++;
          continue;
        }

        // Update hunt_alert_outcomes
        const { error: updateErr } = await supabase
          .from('hunt_alert_outcomes')
          .update({
            outcome_checked: true,
            outcome_grade: grade,
            outcome_signals_found: signalsFound,
            outcome_reasoning: reasoning,
            grade_knowledge_id: insertedGrade?.id || null,
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

    // 3. Log summary
    const totalGraded = gradeCounts.confirmed + gradeCounts.partially_confirmed + gradeCounts.false_alarm + gradeCounts.missed;
    const summary = {
      graded: totalGraded,
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
