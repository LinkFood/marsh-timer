import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { cronResponse, cronErrorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { STATE_NAMES } from '../_shared/states.ts';
import { logCronRun } from '../_shared/cronLog.ts';

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
// Real-event counts per state (last 48h) — replaces the retired convergence score.
// Mirrors hunt-dispatcher getRecentEventContext (index.ts:185): ranks states by
// recent anomaly/migration/alert activity in the archive, not a predicted score.
// ---------------------------------------------------------------------------

async function getStateEventCounts(
  supabase: ReturnType<typeof createSupabaseClient>,
  stateFilter?: string[],
): Promise<Map<string, { count: number; samples: string[] }>> {
  const since = new Date(Date.now() - 48 * 3600000).toISOString();
  const TYPES = [
    'anomaly-alert', 'migration-spike', 'migration-spike-extreme',
    'migration-spike-significant', 'nws-alert', 'weather-event', 'disaster-watch',
  ];
  let q = supabase
    .from('hunt_knowledge')
    .select('title, state_abbr, created_at')
    .in('content_type', TYPES)
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1000);
  if (stateFilter && stateFilter.length > 0) q = q.in('state_abbr', stateFilter);
  const { data } = await q;
  const groups = new Map<string, { count: number; samples: string[] }>();
  for (const row of data || []) {
    const st = row.state_abbr;
    if (!st) continue;
    if (!groups.has(st)) groups.set(st, { count: 0, samples: [] });
    const g = groups.get(st)!;
    g.count++;
    if (g.samples.length < 2 && row.title) g.samples.push(row.title);
  }
  return groups;
}

function eventReasoning(g?: { count: number; samples: string[] }): string {
  if (!g || g.count === 0) return 'No notable events in the last 48h';
  return `${g.count} recent event${g.count === 1 ? '' : 's'} in the last 48h${g.samples.length ? `: ${g.samples.join('; ')}` : ''}`;
}

function countsToScores(groups: Map<string, { count: number; samples: string[] }>): Score[] {
  return Array.from(groups.entries())
    .map(([state_abbr, g]) => ({ state_abbr, score: g.count, reasoning: eventReasoning(g) }))
    .sort((a, b) => b.score - a.score);
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
  brainCountStr: string;
}): string {
  const { favoriteScores, top3, primeWindows, alerts, today, brainCountStr } = params;

  let brief = `ENVIRONMENTAL INTELLIGENCE BRIEF -- ${today}\n\n`;

  // Your states
  if (favoriteScores.length > 0) {
    brief += `WATCHED STATES:\n`;
    for (const s of favoriteScores) {
      const indicator = s.score >= 70 ? '[HOT]' : s.score >= 40 ? '[WARM]' : '[COLD]';
      brief += `${indicator} ${STATE_NAMES[s.state_abbr] ?? s.state_abbr} -- ${s.score}/100\n`;
      brief += `   ${s.reasoning}\n\n`;
    }
  }

  // National hotspots
  if (top3.length > 0) {
    brief += `STRONGEST SIGNALS:\n`;
    for (const s of top3) {
      brief += `* ${STATE_NAMES[s.state_abbr] ?? s.state_abbr} -- ${s.score}/100: ${s.reasoning}\n`;
    }
    brief += `\n`;
  }

  // Moon windows
  if (primeWindows.length > 0) {
    brief += `UPCOMING ACTIVITY WINDOWS:\n`;
    for (const p of primeWindows) {
      brief += `* ${p.date}: ${p.moon_phase} (${p.prime_reason ?? 'convergence window'})\n`;
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

  brief += `Data from duckcountdown.com -- environmental intelligence from ${brainCountStr} embedded data points. Sources: eBird, BirdCast, ASOS, NWS, USGS, NOAA, NASA POWER.`;
  return brief;
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
    const nextWeek = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

    console.log(`[hunt-scout-report] Generating briefs for ${today}`);

    // Dynamic brain count
    const { count: brainCount } = await supabase
      .from('hunt_knowledge')
      .select('*', { count: 'estimated', head: true });
    const brainCountStr = brainCount ? `${Math.round(brainCount / 1000)}K+` : '1M+';

    // Fetch users with briefs enabled
    const { data: users } = await supabase
      .from('hunt_user_settings')
      .select('user_id, favorite_states, timezone, settings')
      .eq('brief_enabled', true);

    // Fetch national top 3 by recent real-event activity (used for all briefs)
    const nationalCounts = await getStateEventCounts(supabase);

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

    const nationalTop3: Score[] = countsToScores(nationalCounts).slice(0, 3);
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
      // Fetch recent real-event counts for target's states
      const targetCounts = await getStateEventCounts(supabase, target.favoriteStates);
      const favoriteScores: Score[] = target.favoriteStates
        .map(st => ({ state_abbr: st, score: targetCounts.get(st)?.count ?? 0, reasoning: eventReasoning(targetCounts.get(st)) }))
        .sort((a, b) => b.score - a.score);

      // Format the brief
      const briefText = formatBrief({
        favoriteScores,
        top3: nationalTop3,
        primeWindows: solunarWindows,
        alerts: nwsAlerts,
        today,
        brainCountStr,
      });

      // Store the brief
      const { error: insertError } = await supabase
        .from('hunt_intel_briefs')
        .insert({
          user_id: target.userId,
          date: today,
          brief_text: briefText,
          scores: favoriteScores,
          data_sources: ['real_event_counts', 'solunar_calendar', 'nws_alerts'],
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

    const summary = {
      briefs_generated: briefsGenerated,
      briefs_delivered: briefsDelivered,
    };
    await logCronRun({
      functionName: 'hunt-scout-report',
      status: 'success',
      summary,
      durationMs: Date.now() - startTime,
    });
    return cronResponse(summary);
  } catch (err) {
    console.error('[hunt-scout-report] Fatal error:', err);
    await logCronRun({
      functionName: 'hunt-scout-report',
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    });
    return cronErrorResponse(err instanceof Error ? err.message : 'Unknown error', 500);
  }
});
