import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FireResult {
  title: string;
  body: string;
  data?: Record<string, unknown>;
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

    // 1. Fetch all enabled alerts
    const { data: alerts, error: alertError } = await supabase
      .from('hunt_user_alerts')
      .select('*')
      .eq('enabled', true);

    if (alertError) throw alertError;

    if (!alerts || alerts.length === 0) {
      const summary = { checked: 0, fired: 0 };
      await logCronRun({
        functionName: 'hunt-check-user-alerts',
        status: 'success',
        summary,
        durationMs: Date.now() - startTime,
      });
      return successResponse(req, summary);
    }

    let fired = 0;

    for (const alert of alerts) {
      const result = await evaluateAlert(supabase, alert);
      if (result) {
        // Insert notification
        await supabase.from('hunt_user_alert_history').insert({
          alert_id: alert.id,
          user_id: alert.user_id,
          title: result.title,
          body: result.body,
          data: result.data || {},
        });

        // Update last_fired_at
        await supabase
          .from('hunt_user_alerts')
          .update({ last_fired_at: new Date().toISOString() })
          .eq('id', alert.id);

        fired++;
      }
    }

    console.log(`[hunt-check-user-alerts] Checked ${alerts.length} alerts, fired ${fired}`);

    const summary = { checked: alerts.length, fired };
    await logCronRun({
      functionName: 'hunt-check-user-alerts',
      status: 'success',
      summary,
      durationMs: Date.now() - startTime,
    });
    return successResponse(req, summary);
  } catch (err) {
    console.error('[hunt-check-user-alerts] Fatal error:', err);
    await logCronRun({
      functionName: 'hunt-check-user-alerts',
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    });
    return errorResponse(req, err instanceof Error ? err.message : 'Unknown error', 500);
  }
});

// ---------------------------------------------------------------------------
// Alert Evaluation
// ---------------------------------------------------------------------------

async function evaluateAlert(supabase: any, alert: any): Promise<FireResult | null> {
  // Don't fire if fired recently (within check_interval)
  if (alert.last_fired_at) {
    const lastFired = new Date(alert.last_fired_at);
    const intervalMs = parseInterval(alert.check_interval || '3hr');
    if (Date.now() - lastFired.getTime() < intervalMs) return null;
  }

  switch (alert.trigger_type) {
    case 'score_spike':
      return await checkScoreSpike(supabase, alert);
    case 'weather_event':
      return await checkWeatherEvent(supabase, alert);
    case 'threshold':
      return await checkThreshold(supabase, alert);
    case 'new_data':
      return await checkNewData(supabase, alert);
    default:
      return null;
  }
}

function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)(min|hr|h|d)$/);
  if (!match) return 3 * 60 * 60 * 1000; // default 3hr
  const [, num, unit] = match;
  const n = parseInt(num);
  switch (unit) {
    case 'min': return n * 60 * 1000;
    case 'hr': case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return 3 * 60 * 60 * 1000;
  }
}

// ---------------------------------------------------------------------------
// Trigger Checkers
// ---------------------------------------------------------------------------

async function checkScoreSpike(supabase: any, alert: any): Promise<FireResult | null> {
  const minChange = alert.config?.min_change || 15;
  const minScore = alert.config?.min_score || 60;
  const since = alert.last_fired_at || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: spikes } = await supabase
    .from('hunt_convergence_alerts')
    .select('state_abbr, score, previous_score, alert_type')
    .gt('created_at', since)
    .gte('score', minScore);

  if (!spikes || spikes.length === 0) return null;

  // Filter by state if specified
  const filtered = alert.states
    ? spikes.filter((s: any) => alert.states.includes(s.state_abbr))
    : spikes;

  // Filter by minimum change
  const significant = filtered.filter((s: any) => Math.abs(s.score - s.previous_score) >= minChange);

  if (significant.length === 0) return null;

  const top = significant[0];
  return {
    title: `Score spike: ${top.state_abbr} ${top.previous_score} -> ${top.score}`,
    body: `${significant.length} state(s) showed convergence score spikes above ${minScore}`,
    data: { states: significant.map((s: any) => s.state_abbr) },
  };
}

async function checkWeatherEvent(supabase: any, alert: any): Promise<FireResult | null> {
  const eventTypes = alert.config?.event_types || ['cold_front', 'pressure_drop'];
  const since = alert.last_fired_at || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: events } = await supabase
    .from('hunt_weather_events')
    .select('event_type, states, severity, created_at')
    .gt('created_at', since)
    .in('event_type', eventTypes);

  if (!events || events.length === 0) return null;

  // Filter by state if specified
  const filtered = alert.states
    ? events.filter((e: any) => {
        const eventStates = Array.isArray(e.states) ? e.states : [e.states];
        return eventStates.some((s: string) => alert.states.includes(s));
      })
    : events;

  if (filtered.length === 0) return null;

  return {
    title: `Weather: ${filtered.length} ${eventTypes.join('/')} event(s)`,
    body: filtered.map((e: any) => `${e.event_type} - ${Array.isArray(e.states) ? e.states.join(', ') : e.states}`).join('; '),
    data: { events: filtered },
  };
}

async function checkThreshold(supabase: any, alert: any): Promise<FireResult | null> {
  const field = alert.config?.field || 'score';
  const operator = alert.config?.operator || '>=';
  const value = alert.config?.value || 75;

  let query = supabase.from('hunt_convergence_scores').select('state_abbr, score, updated_at');

  if (operator === '>=') query = query.gte(field, value);
  else if (operator === '<=') query = query.lte(field, value);
  else if (operator === '>') query = query.gt(field, value);
  else if (operator === '<') query = query.lt(field, value);

  // Filter states
  if (alert.states) query = query.in('state_abbr', alert.states);

  const { data: matches } = await query;
  if (!matches || matches.length === 0) return null;

  return {
    title: `Threshold: ${matches.length} state(s) ${field} ${operator} ${value}`,
    body: matches.map((m: any) => `${m.state_abbr}: ${m[field]}`).join(', '),
    data: { matches },
  };
}

async function checkNewData(supabase: any, alert: any): Promise<FireResult | null> {
  const contentType = alert.config?.content_type || 'migration-spike';
  const since = alert.last_fired_at || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: entries, count } = await supabase
    .from('hunt_knowledge')
    .select('content_type, state, created_at', { count: 'estimated' })
    .eq('content_type', contentType)
    .gt('created_at', since)
    .limit(5);

  if (!count || count === 0) return null;

  return {
    title: `New data: ${count} ${contentType} entries`,
    body: `${count} new ${contentType} entries since last check`,
    data: { count, sample: entries },
  };
}
