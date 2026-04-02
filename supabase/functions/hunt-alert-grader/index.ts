import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { generateEmbedding } from '../_shared/embedding.ts';
import { enrichWithPatternScan } from '../_shared/brainScan.ts';
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
    [key: string]: unknown;
  };
  outcome_window_hours: number;
  outcome_deadline: string;
}

type Grade = 'confirmed' | 'partially_confirmed' | 'false_alarm' | 'missed';

interface SignalFound {
  id: string;
  title: string;
  content_type: string;
  source: 'vector' | 'direct';
  similarity?: number;
  effective_date?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PER_RUN = 5; // Each alert needs embedding + vector search — keep under 150s

const DIRECT_QUERY_CONTENT_TYPES = [
  'migration-spike-extreme',
  'migration-spike-significant',
  'migration-spike-moderate',
  'weather-event',
  'nws-alert',
  'anomaly-alert',
  'convergence-score',
];

// ---------------------------------------------------------------------------
// Grading logic
// ---------------------------------------------------------------------------

function gradeAlert(
  vectorMatches: { id: string; title: string; content_type: string; similarity: number }[],
  directMatches: { id: string; title: string; content_type: string; effective_date?: string }[],
  severity: string | undefined,
): { grade: Grade; reasoning: string } {
  const highRelevanceVector = vectorMatches.filter(m => m.similarity > 0.7);
  const midRelevanceVector = vectorMatches.filter(m => m.similarity > 0.5 && m.similarity <= 0.7);
  const directCount = directMatches.length;
  const totalSignals = directCount;

  // confirmed: 3+ matching signals OR 1+ vector matches with similarity > 0.7
  if (totalSignals >= 3 || highRelevanceVector.length >= 1) {
    return {
      grade: 'confirmed',
      reasoning: `Found ${totalSignals} direct signal(s) and ${highRelevanceVector.length} high-relevance vector match(es). Pattern validated.`,
    };
  }

  // partially_confirmed: 1-2 matching signals OR vector matches 0.5-0.7
  if (totalSignals >= 1 || midRelevanceVector.length >= 1) {
    return {
      grade: 'partially_confirmed',
      reasoning: `Found ${totalSignals} direct signal(s) and ${midRelevanceVector.length} mid-relevance vector match(es). Partial confirmation.`,
    };
  }

  // false_alarm: 0 signals AND alert was high severity
  const isHighSeverity = severity === 'high' || severity === 'extreme' || severity === 'spike' || severity === 'threshold_crossed';
  if (isHighSeverity) {
    return {
      grade: 'false_alarm',
      reasoning: `No matching signals found in outcome window. Alert was ${severity} severity — classifying as false alarm.`,
    };
  }

  // missed: 0 signals AND alert was low/medium severity
  return {
    grade: 'missed',
    reasoning: `No matching signals found in outcome window. Alert was ${severity || 'unknown'} severity — no predicted activity materialized.`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();

  try {
    const supabase = createSupabaseClient();
    const now = new Date().toISOString();

    console.log('[hunt-alert-grader] Starting alert grading run');

    // -----------------------------------------------------------------
    // 1. Query ungraded alerts past their deadline
    // -----------------------------------------------------------------
    const { data: ungradedAlerts, error: queryErr } = await supabase
      .from('hunt_alert_outcomes')
      .select('id, alert_source, alert_knowledge_id, state_abbr, alert_date, predicted_outcome, outcome_window_hours, outcome_deadline')
      .eq('outcome_checked', false)
      .lt('outcome_deadline', now)
      .order('outcome_deadline', { ascending: true })
      .limit(MAX_PER_RUN);

    if (queryErr) {
      console.error('[hunt-alert-grader] Query error:', queryErr);
      await logCronRun({
        functionName: 'hunt-alert-grader',
        status: 'error',
        errorMessage: queryErr.message,
        durationMs: Date.now() - startTime,
      });
      return errorResponse(req, 'Query failed', 500);
    }

    if (!ungradedAlerts || ungradedAlerts.length === 0) {
      console.log('[hunt-alert-grader] No alerts to grade');
      const summary = { graded: 0, message: 'No alerts past deadline to grade' };
      await logCronRun({
        functionName: 'hunt-alert-grader',
        status: 'success',
        summary,
        durationMs: Date.now() - startTime,
      });
      return successResponse(req, summary);
    }

    console.log(`[hunt-alert-grader] Found ${ungradedAlerts.length} alerts to grade`);

    // -----------------------------------------------------------------
    // 2. Grade each alert
    // -----------------------------------------------------------------
    const gradeCounts: Record<Grade, number> = {
      confirmed: 0,
      partially_confirmed: 0,
      false_alarm: 0,
      missed: 0,
    };
    let errors = 0;

    for (const alert of ungradedAlerts as AlertOutcome[]) {
      try {
        console.log(`[hunt-alert-grader] Grading ${alert.id} (${alert.alert_source} / ${alert.state_abbr || 'national'} / ${alert.alert_date})`);

        // 2a. Read original alert from hunt_knowledge (if available)
        let originalClaim = alert.predicted_outcome?.claim || 'Unknown alert';
        if (alert.alert_knowledge_id) {
          const { data: origEntry } = await supabase
            .from('hunt_knowledge')
            .select('title, content')
            .eq('id', alert.alert_knowledge_id)
            .single();

          if (origEntry) {
            originalClaim = origEntry.content || origEntry.title || originalClaim;
          }
        }

        // 2b. Generate embedding for search query
        const deadlineDate = new Date(alert.outcome_deadline).toISOString().split('T')[0];
        const searchText = `What happened in ${alert.state_abbr || 'the US'} between ${alert.alert_date} and ${deadlineDate}?`;
        const queryEmbedding = await generateEmbedding(searchText, 'query');

        // 2c. Vector search via search_hunt_knowledge_v3
        const expectedSignals = Array.isArray(alert.predicted_outcome?.expected_signals)
          ? alert.predicted_outcome.expected_signals
          : null;

        const { data: vectorResults } = await supabase.rpc('search_hunt_knowledge_v3', {
          query_embedding: queryEmbedding,
          match_threshold: 0.25,
          match_count: 10,
          filter_state_abbr: alert.state_abbr || null,
          filter_content_types: expectedSignals,
          filter_species: null,
          filter_date_from: alert.alert_date,
          filter_date_to: deadlineDate,
          recency_weight: 0.1,
          exclude_du_report: true,
        });

        const vectorMatches = (vectorResults || []).map((r: { id: string; title: string; content_type: string; similarity: number }) => ({
          id: r.id,
          title: r.title,
          content_type: r.content_type,
          similarity: r.similarity,
        }));

        // 2d. Direct query for recent activity in state/date window
        let directQuery = supabase
          .from('hunt_knowledge')
          .select('id, title, content_type, effective_date')
          .in('content_type', DIRECT_QUERY_CONTENT_TYPES)
          .gte('created_at', alert.alert_date)
          .lte('created_at', alert.outcome_deadline)
          .order('created_at', { ascending: false })
          .limit(20);

        if (alert.state_abbr) {
          directQuery = directQuery.eq('state_abbr', alert.state_abbr);
        }

        const { data: directResults } = await directQuery;

        const directMatches = (directResults || []).map((r: { id: string; title: string; content_type: string; effective_date?: string }) => ({
          id: r.id,
          title: r.title,
          content_type: r.content_type,
          effective_date: r.effective_date,
        }));

        // 2e. Grade
        const severity = alert.predicted_outcome?.severity as string | undefined;
        const { grade, reasoning } = gradeAlert(vectorMatches, directMatches, severity);
        gradeCounts[grade]++;

        // Build signals found list (deduplicate by id)
        const seenIds = new Set<string>();
        const signalsFound: SignalFound[] = [];
        for (const m of vectorMatches) {
          if (!seenIds.has(m.id)) {
            seenIds.add(m.id);
            signalsFound.push({ id: m.id, title: m.title, content_type: m.content_type, source: 'vector', similarity: m.similarity });
          }
        }
        for (const m of directMatches) {
          if (!seenIds.has(m.id)) {
            seenIds.add(m.id);
            signalsFound.push({ id: m.id, title: m.title, content_type: m.content_type, source: 'direct', effective_date: m.effective_date });
          }
        }

        // 2f. Build grade text for embedding
        const signalList = signalsFound.length > 0
          ? signalsFound.map(s => `- [${s.content_type}] ${s.title}${s.similarity ? ` (sim: ${s.similarity.toFixed(2)})` : ''}`).join('\n')
          : 'None found.';

        let gradeContent = `On ${alert.alert_date}, ${alert.alert_source} fired for ${alert.state_abbr || 'national'}: '${originalClaim.slice(0, 500)}'.\n`;
        gradeContent += `Outcome window: ${alert.alert_date} to ${deadlineDate}.\n`;
        gradeContent += `Signals found:\n${signalList}\n`;
        gradeContent += `Grade: ${grade}. Reasoning: ${reasoning}`;

        if (grade === 'false_alarm') {
          gradeContent += `\nConditions that were present but did NOT lead to predicted outcome. This suggests the ${alert.alert_source} threshold may need adjustment for ${alert.state_abbr || 'this region'}.`;
        } else if (grade === 'confirmed') {
          gradeContent += `\nPattern validated. Conditions that preceded this outcome are reinforced as reliable predictors.`;
        }

        const gradeTitle = `Alert Grade: ${grade} — ${alert.state_abbr || 'national'} ${alert.alert_date}`;

        // 2g. Embed grade text into hunt_knowledge
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
              signals_found: signalsFound.slice(0, 10),
              alert_knowledge_id: alert.alert_knowledge_id,
              accuracy_context: reasoning,
            },
          })
          .select('id')
          .single();

        if (insertErr) {
          console.error(`[hunt-alert-grader] Knowledge insert error for ${alert.id}:`, insertErr);
          errors++;
          continue;
        }

        const gradeKnowledgeId = insertedGrade?.id || null;

        // 2h. Enrich with pattern scan
        if (gradeKnowledgeId) {
          await enrichWithPatternScan(gradeKnowledgeId, gradeEmbedding, {
            state_abbr: alert.state_abbr || undefined,
            exclude_content_type: 'alert-grade',
          });
        }

        // 2i. Update hunt_alert_outcomes
        const { error: updateErr } = await supabase
          .from('hunt_alert_outcomes')
          .update({
            outcome_checked: true,
            outcome_grade: grade,
            outcome_signals_found: signalsFound,
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

        // === ARC REACTOR: Transition arc to grade ===
        try {
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
            fireNarrator(alert.state_abbr || 'US', 'grade_assigned', { arc_id: linkedArc.id, use_opus: true });
          }
        } catch (arcErr) {
          console.error('[hunt-alert-grader] Arc reactor error:', arcErr);
        }
      } catch (alertErr) {
        console.error(`[hunt-alert-grader] Error grading ${alert.id}:`, alertErr);
        errors++;
      }
    }

    // -----------------------------------------------------------------
    // 3. Log summary
    // -----------------------------------------------------------------
    const totalGraded = gradeCounts.confirmed + gradeCounts.partially_confirmed + gradeCounts.false_alarm + gradeCounts.missed;
    const summary = {
      graded: totalGraded,
      confirmed: gradeCounts.confirmed,
      partially_confirmed: gradeCounts.partially_confirmed,
      false_alarm: gradeCounts.false_alarm,
      missed: gradeCounts.missed,
      errors,
      run_at: new Date().toISOString(),
    };

    console.log(`[hunt-alert-grader] Graded ${totalGraded} alerts. Confirmed: ${gradeCounts.confirmed}, Partial: ${gradeCounts.partially_confirmed}, False alarm: ${gradeCounts.false_alarm}, Missed: ${gradeCounts.missed}, Errors: ${errors}`);

    await logCronRun({
      functionName: 'hunt-alert-grader',
      status: errors > 0 ? 'partial' : 'success',
      summary,
      durationMs: Date.now() - startTime,
    });

    return successResponse(req, summary);
  } catch (error) {
    console.error('[hunt-alert-grader] Fatal error:', error);
    await logCronRun({
      functionName: 'hunt-alert-grader',
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startTime,
    });
    return errorResponse(req, 'Internal server error', 500);
  }
});
