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
          reasoning: candidate.reasoning,
          delivered_to: userIds,
          throttle_until: throttleUntil,
        });

      if (insertError) {
        console.error(`[hunt-convergence-alerts] Insert error for ${candidate.state_abbr}:`, insertError.message);
        continue;
      }

      alertsTriggered++;

      // Deliver to users via Slack (best-effort)
      const stateName = STATE_NAMES[candidate.state_abbr] ?? candidate.state_abbr;
      const alertMessage = [
        `DUCK COUNTDOWN ALERT -- ${stateName}`,
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
