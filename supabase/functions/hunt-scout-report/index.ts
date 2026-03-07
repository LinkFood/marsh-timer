import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_NAMES } from '../_shared/states.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Score {
  state_abbr: string;
  score: number;
  reasoning: string;
  weather_component?: number;
  solunar_component?: number;
  migration_component?: number;
  pattern_component?: number;
}

interface SolunarDay {
  date: string;
  moon_phase: string;
  illumination_pct: number;
  is_prime: boolean;
  prime_reason: string | null;
}

interface NWSAlert {
  event_type: string;
  severity: string;
  headline: string;
  states: string[];
}

interface UserSettings {
  user_id: string;
  favorite_states: string[] | null;
  timezone: string | null;
  settings: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Brief Formatter
// ---------------------------------------------------------------------------

function formatBrief(params: {
  favoriteScores: Score[];
  top3: Score[];
  primeWindows: SolunarDay[];
  alerts: NWSAlert[];
  today: string;
}): string {
  const { favoriteScores, top3, primeWindows, alerts, today } = params;

  let brief = `DUCK COUNTDOWN SCOUT REPORT -- ${today}\n\n`;

  // Your states
  if (favoriteScores.length > 0) {
    brief += `YOUR STATES:\n`;
    for (const s of favoriteScores) {
      const indicator = s.score >= 70 ? '[HOT]' : s.score >= 40 ? '[WARM]' : '[COLD]';
      brief += `${indicator} ${STATE_NAMES[s.state_abbr] ?? s.state_abbr} -- ${s.score}/100\n`;
      brief += `   ${s.reasoning}\n\n`;
    }
  }

  // National hotspots
  if (top3.length > 0) {
    brief += `NATIONAL HOTSPOTS:\n`;
    for (const s of top3) {
      brief += `* ${STATE_NAMES[s.state_abbr] ?? s.state_abbr} -- ${s.score}/100: ${s.reasoning}\n`;
    }
    brief += `\n`;
  }

  // Moon windows
  if (primeWindows.length > 0) {
    brief += `UPCOMING PRIME WINDOWS:\n`;
    for (const p of primeWindows) {
      brief += `* ${p.date}: ${p.moon_phase} (${p.prime_reason ?? 'prime window'})\n`;
    }
    brief += `\n`;
  }

  // Active alerts
  const relevantAlerts = alerts.filter(a =>
    favoriteScores.some(s => a.states.includes(s.state_abbr))
  );
  if (relevantAlerts.length > 0) {
    brief += `ACTIVE WEATHER ALERTS:\n`;
    for (const a of relevantAlerts) {
      brief += `WARNING: ${a.event_type}: ${a.headline}\n`;
    }
    brief += `\n`;
  }

  brief += `Data from duckcountdown.com -- all insights based on historical patterns, not predictions.`;
  return brief;
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    const supabase = createSupabaseClient();
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const nextWeek = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

    console.log(`[hunt-scout-report] Generating briefs for ${today}`);

    // Fetch users with briefs enabled
    const { data: users } = await supabase
      .from('hunt_user_settings')
      .select('user_id, favorite_states, timezone, settings')
      .eq('brief_enabled', true);

    // Fetch national top 3 (used for all briefs)
    const { data: top3 } = await supabase
      .from('hunt_convergence_scores')
      .select('state_abbr, score, reasoning')
      .eq('date', today)
      .order('score', { ascending: false })
      .limit(3);

    // Fetch upcoming solunar prime windows (next 7 days)
    const { data: primeWindows } = await supabase
      .from('hunt_solunar_calendar')
      .select('date, moon_phase, illumination_pct, is_prime, prime_reason')
      .gte('date', today)
      .lte('date', nextWeek)
      .eq('is_prime', true);

    // Fetch active NWS alerts
    const { data: activeAlerts } = await supabase
      .from('hunt_nws_alerts')
      .select('event_type, severity, headline, states')
      .gte('expires', now.toISOString());

    const nationalTop3: Score[] = top3 ?? [];
    const solunarWindows: SolunarDay[] = primeWindows ?? [];
    const nwsAlerts: NWSAlert[] = activeAlerts ?? [];

    let briefsGenerated = 0;
    let briefsDelivered = 0;

    // Determine targets: users with briefs enabled, or a general brief
    const targets: Array<{ userId: string | null; favoriteStates: string[]; settings: Record<string, unknown> | null }> = [];

    if (users && users.length > 0) {
      for (const user of users as UserSettings[]) {
        const favStates = user.favorite_states && user.favorite_states.length > 0
          ? user.favorite_states
          : nationalTop3.slice(0, 5).map(s => s.state_abbr);
        targets.push({ userId: user.user_id, favoriteStates: favStates, settings: user.settings });
      }
    } else {
      // No users with briefs enabled — generate a general brief using top 5
      const topStates = nationalTop3.slice(0, 5).map(s => s.state_abbr);
      targets.push({ userId: null, favoriteStates: topStates, settings: null });
    }

    for (const target of targets) {
      // Fetch convergence scores for target's states
      const { data: scores } = await supabase
        .from('hunt_convergence_scores')
        .select('*')
        .eq('date', today)
        .in('state_abbr', target.favoriteStates)
        .order('score', { ascending: false });

      const favoriteScores: Score[] = scores ?? [];

      // Format the brief
      const briefText = formatBrief({
        favoriteScores,
        top3: nationalTop3,
        primeWindows: solunarWindows,
        alerts: nwsAlerts,
        today,
      });

      // Store the brief
      const { error: insertError } = await supabase
        .from('hunt_intel_briefs')
        .insert({
          user_id: target.userId,
          date: today,
          brief_text: briefText,
          scores: favoriteScores,
          data_sources: ['convergence_scores', 'solunar_calendar', 'nws_alerts'],
          delivered_via: 'stored',
        });

      if (insertError) {
        console.error(`[hunt-scout-report] Insert error for user ${target.userId}:`, insertError.message);
      } else {
        briefsGenerated++;
      }

      // Slack delivery (best-effort, never throw)
      try {
        const slackToken = Deno.env.get('SLACK_BOT_TOKEN');
        const channelId = target.settings?.slack_channel_id as string | undefined;
        if (slackToken && channelId) {
          const slackRes = await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${slackToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ channel: channelId, text: briefText }),
          });
          if (slackRes.ok) {
            briefsDelivered++;
            // Update delivery status
            await supabase
              .from('hunt_intel_briefs')
              .update({ delivered_via: 'slack' })
              .eq('user_id', target.userId)
              .eq('date', today)
              .order('created_at', { ascending: false })
              .limit(1);
          }
        }
      } catch { /* never throw from Slack code */ }
    }

    console.log(`[hunt-scout-report] Done: ${briefsGenerated} generated, ${briefsDelivered} delivered`);

    return successResponse(req, {
      briefs_generated: briefsGenerated,
      briefs_delivered: briefsDelivered,
    });
  } catch (err) {
    console.error('[hunt-scout-report] Fatal error:', err);
    return errorResponse(req, err instanceof Error ? err.message : 'Unknown error', 500);
  }
});
