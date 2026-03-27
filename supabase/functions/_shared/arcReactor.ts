import { createSupabaseClient } from './supabase.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://rvhyotvklfowklzjahdd.supabase.co';

export interface ArcData {
  buildup_signals?: Record<string, unknown>;
  recognition_claim?: Record<string, unknown>;
  recognition_alert_id?: string;
  outcome_deadline?: string;
  outcome_signals?: unknown[];
  grade?: string;
  grade_reasoning?: string;
  precedent_accuracy?: number;
  narrative?: string;
}

export async function getOpenArc(supabase: ReturnType<typeof createSupabaseClient>, state_abbr: string) {
  const { data } = await supabase
    .from('hunt_state_arcs')
    .select('*')
    .eq('state_abbr', state_abbr)
    .neq('current_act', 'closed')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function createArc(
  supabase: ReturnType<typeof createSupabaseClient>,
  state_abbr: string,
  act: string,
  data: ArcData,
) {
  const { data: arc, error } = await supabase
    .from('hunt_state_arcs')
    .insert({
      state_abbr,
      current_act: act,
      ...data,
    })
    .select('id')
    .single();
  if (error) console.error('[arcReactor] createArc error:', error.message);
  return arc;
}

export async function transitionArc(
  supabase: ReturnType<typeof createSupabaseClient>,
  arcId: string,
  newAct: string,
  data: ArcData = {},
) {
  const { error } = await supabase
    .from('hunt_state_arcs')
    .update({
      current_act: newAct,
      act_started_at: new Date().toISOString(),
      ...data,
    })
    .eq('id', arcId);
  if (error) console.error('[arcReactor] transitionArc error:', error.message);
}

export async function addOutcomeSignal(
  supabase: ReturnType<typeof createSupabaseClient>,
  arcId: string,
  signal: Record<string, unknown>,
  currentSignals: unknown[] = [],
) {
  const updatedSignals = [...currentSignals, signal];
  const { error } = await supabase
    .from('hunt_state_arcs')
    .update({
      current_act: 'outcome',
      outcome_signals: updatedSignals,
    })
    .eq('id', arcId);
  if (error) console.error('[arcReactor] addOutcomeSignal error:', error.message);
}

export function fireNarrator(
  state_abbr: string,
  trigger: string,
  opts?: { arc_id?: string; use_opus?: boolean },
) {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  fetch(`${SUPABASE_URL}/functions/v1/hunt-arc-narrator`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      state_abbr,
      trigger,
      arc_id: opts?.arc_id,
      use_opus: opts?.use_opus,
    }),
  }).catch(() => {}); // fire-and-forget
}
