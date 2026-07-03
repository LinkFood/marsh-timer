import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_NAMES } from '../_shared/states.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ConvergenceScore {
  state_abbr: string;
  date: string;
  score: number;
  reasoning: string;
}

interface ThrottleRecord {
  state_abbr: string;
  throttle_until: string | null;
}

interface AlertCandidate {
  state_abbr: string;
  alert_type: 'score_jump' | 'threshold_cross' | 'nws_severe';
  score: number;
  previous_score: number;
  change: number;
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCORE_JUMP_THRESHOLD = 30;    // Alert if score jumps 30+ points
const SCORE_CROSS_THRESHOLD = 75;   // Alert if score crosses above 75
const THROTTLE_HOURS = 48;          // Don't re-alert same state within 48 hours
const MAX_ALERTS_PER_USER_PER_DAY = 3;

// --- Honest suppression (grader v2 / matched-control grades) ---
// Suppression keys off DISCRIMINATING accuracy, not the raw accuracy_rate.
// Raw accuracy was tautological: always-on daily feeds auto-confirmed alerts.
// A v2-graded outcome counts as an honest hit only if it was graded
// confirmed/partially_confirmed AND its lift > 1 — i.e., the same detection
// fired LESS often on matched random control windows (the alert beat base
// rate). See hunt-alert-grader for the lift convention.
//
// UNITS: percent, 0-100. SUPPRESS_BELOW_PCT = 40 means 40 PERCENT — the value
// compared against it below is also 0-100. (Historic bug: hunt_alert_calibration
// accuracy_rate is stored 0-100 but was once compared as a 0-1 fraction. Keep
// everything at this comparison site in percentage units.)
const SUPPRESS_BELOW_PCT = 40;
const MIN_GRADED_FOR_SUPPRESSION = 5;
const SUPPRESSION_WINDOW_DAYS = 90;
// Grades written before grader v2 shipped are tautological — never use them
// for suppression decisions.
const GRADE_V2_EPOCH = '2026-07-02';

interface HonestAccuracy {
  pct: number;      // 0-100
  n: number;        // v2-graded outcomes considered
  hits: number;     // honest hits (graded hit AND lift > 1)
}

// Returns null when there is not enough v2-graded history — the sensible
// default is NOT suppressed (missing/null data must never silence a state).
async function getHonestAccuracy(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateAbbr: string,
): Promise<HonestAccuracy | null> {
  const windowCutoff = new Date(Date.now() - SUPPRESSION_WINDOW_DAYS * 86400000).toISOString();
  const cutoff = windowCutoff > GRADE_V2_EPOCH ? windowCutoff : GRADE_V2_EPOCH;

  const { data, error } = await supabase
    .from('hunt_alert_outcomes')
    .select('outcome_grade, outcome_signals_found')
    .eq('alert_source', 'convergence-alert')
    .eq('state_abbr', stateAbbr)
    .eq('outcome_checked', true)
    .gte('graded_at', cutoff)
    .limit(200);

  if (error || !data) return null;

  // Only rows carrying a v2 court block count; older rows (or rows whose
  // court block is missing for any reason) are ignored.
  const v2 = data.filter((r) => {
    const court = (r.outcome_signals_found as { court?: { grade_version?: number } } | null)?.court;
    return court?.grade_version === 2;
  });
  if (v2.length < MIN_GRADED_FOR_SUPPRESSION) return null;

  const hits = v2.filter((r) => {
    const graded = r.outcome_grade === 'confirmed' || r.outcome_grade === 'partially_confirmed';
    const lift = Number((r.outcome_signals_found as { court?: { lift?: number | null } }).court?.lift ?? 0);
    return graded && lift > 1;
  }).length;

  return { pct: (hits / v2.length) * 100, n: v2.length, hits };
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const startTime = Date.now();
  try {
    const supabase = createSupabaseClient();
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];
    const threeHoursAgo = new Date(now.getTime() - 3 * 3600000).toISOString();

    console.log(`[hunt-convergence-alerts] Checking alert conditions for ${today}`);

    // Fetch today's and yesterday's convergence scores
    const [todayResult, yesterdayResult] = await Promise.all([
      supabase
        .from('hunt_convergence_scores')
        .select('state_abbr, date, score, reasoning')
        .eq('date', today),
      supabase
        .from('hunt_convergence_scores')
        .select('state_abbr, date, score, reasoning')
        .eq('date', yesterday),
    ]);

    const todayScores: ConvergenceScore[] = todayResult.data ?? [];
    const yesterdayScores: ConvergenceScore[] = yesterdayResult.data ?? [];

    if (todayScores.length === 0) {
      console.log('[hunt-convergence-alerts] No scores for today, skipping');
      const summary = { alerts_triggered: 0, users_notified: 0, skipped: 'no scores for today' };
      await logCronRun({
        functionName: 'hunt-convergence-alerts',
        status: 'success',
        summary,
        durationMs: Date.now() - startTime,
      });
      return successResponse(req, summary);
    }

    // Build yesterday lookup
    const yesterdayMap = new Map<string, number>();
    for (const s of yesterdayScores) {
      yesterdayMap.set(s.state_abbr, s.score);
    }

    // Check throttle: get recent alerts per state
    const { data: recentAlerts } = await supabase
      .from('hunt_convergence_alerts')
      .select('state_abbr, throttle_until')
      .gte('throttle_until', now.toISOString());

    const throttledStates = new Set<string>();
    for (const a of (recentAlerts ?? []) as ThrottleRecord[]) {
      if (a.throttle_until && new Date(a.throttle_until) > now) {
        throttledStates.add(a.state_abbr);
      }
    }

    // Check for new severe NWS alerts (created in last 3 hours)
    const { data: newSevereAlerts } = await supabase
      .from('hunt_nws_alerts')
      .select('event_type, severity, headline, states')
      .in('severity', ['Severe', 'Extreme'])
      .gte('created_at', threeHoursAgo);

    const nwsSevereStates = new Set<string>();
    for (const alert of (newSevereAlerts ?? [])) {
      for (const st of (alert.states as string[] ?? [])) {
        nwsSevereStates.add(st);
      }
    }

    // Evaluate alert conditions for each state
    const candidates: AlertCandidate[] = [];

    for (const score of todayScores) {
      const { state_abbr, score: todayScore, reasoning } = score;

      // Skip throttled states
      if (throttledStates.has(state_abbr)) continue;

      const yesterdayScore = yesterdayMap.get(state_abbr) ?? 0;
      const change = todayScore - yesterdayScore;

      // Check: Score jump (30+ point increase)
      if (change >= SCORE_JUMP_THRESHOLD) {
        candidates.push({
          state_abbr,
          alert_type: 'score_jump',
          score: todayScore,
          previous_score: yesterdayScore,
          change,
          reasoning,
        });
        continue; // One alert per state
      }

      // Check: Threshold cross (crossed above 75)
      if (todayScore >= SCORE_CROSS_THRESHOLD && yesterdayScore < SCORE_CROSS_THRESHOLD) {
        candidates.push({
          state_abbr,
          alert_type: 'threshold_cross',
          score: todayScore,
          previous_score: yesterdayScore,
          change,
          reasoning,
        });
        continue;
      }

      // Check: NWS severe alert in state
      if (nwsSevereStates.has(state_abbr)) {
        candidates.push({
          state_abbr,
          alert_type: 'nws_severe',
          score: todayScore,
          previous_score: yesterdayScore,
          change,
          reasoning: `Severe weather alert issued. ${reasoning}`,
        });
      }
    }

    console.log(`[hunt-convergence-alerts] ${candidates.length} alert candidates found`);

    let alertsTriggered = 0;
    let usersNotified = 0;

    const throttleUntil = new Date(now.getTime() + THROTTLE_HOURS * 3600000).toISOString();

    for (const candidate of candidates) {
      // Check honest (discriminating, lift-verified) accuracy for this state.
      // Both sides of the comparison are in PERCENT (0-100) — see units note
      // on SUPPRESS_BELOW_PCT.
      const honest = await getHonestAccuracy(supabase, candidate.state_abbr);

      let confidenceModifier = '';
      if (honest) {
        if (honest.pct < SUPPRESS_BELOW_PCT) {
          console.log(`[hunt-convergence-alerts] Suppressing ${candidate.state_abbr} — 90d discriminating accuracy only ${honest.pct.toFixed(0)}% (${honest.hits}/${honest.n} beat matched controls)`);
          continue; // skip this alert
        } else if (honest.pct > 75) {
          confidenceModifier = `\nDiscriminating accuracy for this pattern in ${candidate.state_abbr}: ${honest.pct.toFixed(0)}% (${honest.hits}/${honest.n} alerts beat matched-control base rate).`;
        } else {
          confidenceModifier = `\nDiscriminating accuracy: ${honest.pct.toFixed(0)}% over ${honest.n} alerts (lift-verified against matched controls).`;
        }
      }
      // honest === null → not enough v2-graded history → default: not suppressed

      const enrichedReasoning = (candidate.reasoning || '') + confidenceModifier;

      // Find users with this state in favorite_states
      const { data: interestedUsers } = await supabase
        .from('hunt_user_settings')
        .select('user_id, settings, alert_delivery')
        .contains('favorite_states', [candidate.state_abbr]);

      const userIds = (interestedUsers ?? []).map((u: { user_id: string }) => u.user_id);

      // Insert alert record
      const { error: insertError } = await supabase
        .from('hunt_convergence_alerts')
        .insert({
          state_abbr: candidate.state_abbr,
          date: today,
          alert_type: candidate.alert_type,
          score: candidate.score,
          previous_score: candidate.previous_score,
          change: candidate.change,
          reasoning: enrichedReasoning,
          delivered_to: userIds,
          throttle_until: throttleUntil,
        });

      if (insertError) {
        console.error(`[hunt-convergence-alerts] Insert error for ${candidate.state_abbr}:`, insertError.message);
        continue;
      }

      alertsTriggered++;

      // Track outcome for grading
      const outcomeDeadline = new Date();
      outcomeDeadline.setUTCHours(outcomeDeadline.getUTCHours() + 72);

      try {
        const { error: outcomeErr } = await supabase.from('hunt_alert_outcomes').insert({
          alert_source: 'convergence-alert',
          state_abbr: candidate.state_abbr,
          alert_date: today,
          predicted_outcome: {
            claim: enrichedReasoning || `${candidate.alert_type} alert: score ${candidate.previous_score}→${candidate.score}`,
            expected_signals: ['migration-spike-extreme', 'migration-spike-significant', 'weather-event'],
            severity: candidate.alert_type,
            score: candidate.score,
            previous_score: candidate.previous_score,
            change: candidate.change,
          },
          outcome_window_hours: 72,
          outcome_deadline: outcomeDeadline.toISOString(),
        });
        if (outcomeErr) console.error('[hunt-convergence-alerts] Outcome insert failed:', outcomeErr.message);
      } catch (err) {
        console.error('[hunt-convergence-alerts] Outcome insert failed:', err);
      }

      // Deliver to users via Slack (best-effort)
      const stateName = STATE_NAMES[candidate.state_abbr] ?? candidate.state_abbr;
      const alertMessage = [
        `ENVIRONMENTAL ALERT -- ${stateName}`,
        `Score: ${candidate.score}/100 (was ${candidate.previous_score}/100)`,
        candidate.reasoning,
        ``,
        `Data from duckcountdown.com`,
      ].join('\n');

      for (const user of (interestedUsers ?? [])) {
        // Check per-user daily alert limit
        const { count } = await supabase
          .from('hunt_convergence_alerts')
          .select('id', { count: 'exact', head: true })
          .eq('date', today)
          .contains('delivered_to', [user.user_id]);

        if ((count ?? 0) > MAX_ALERTS_PER_USER_PER_DAY) {
          console.log(`[hunt-convergence-alerts] User ${user.user_id} exceeded daily alert limit`);
          continue;
        }

        // Only deliver if user has slack delivery configured
        if (user.alert_delivery !== 'slack') continue;

        const channelId = user.settings?.slack_channel_id as string | undefined;
        if (!channelId) continue;

        try {
          const slackToken = Deno.env.get('SLACK_BOT_TOKEN');
          if (slackToken) {
            await fetch('https://slack.com/api/chat.postMessage', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${slackToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ channel: channelId, text: alertMessage }),
            });
            usersNotified++;
          }
        } catch { /* never throw from Slack code */ }
      }
    }

    console.log(`[hunt-convergence-alerts] Done: ${alertsTriggered} alerts, ${usersNotified} users notified`);

    const summary = {
      alerts_triggered: alertsTriggered,
      users_notified: usersNotified,
    };
    await logCronRun({
      functionName: 'hunt-convergence-alerts',
      status: 'success',
      summary,
      durationMs: Date.now() - startTime,
    });
    return successResponse(req, summary);
  } catch (err) {
    console.error('[hunt-convergence-alerts] Fatal error:', err);
    await logCronRun({
      functionName: 'hunt-convergence-alerts',
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    });
    return errorResponse(req, err instanceof Error ? err.message : 'Unknown error', 500);
  }
});
