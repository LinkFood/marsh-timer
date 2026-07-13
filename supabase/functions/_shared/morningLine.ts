// Shared morning_lines row builder — used by hunt-morning-line (persisting the
// published current-day line) and hunt-morning-grader (backfilling past days
// through the dated recompute path). ONE parser so the grader never
// string-parses a headline: the claim is structured at write time.
//
// The Morning Line's falsifiable content is its lineup precedent: "the last
// time the moon, the tide, and the temperature lined up like this here:
// <date> — it cooled 12°F within 5 days." That aftermath string comes from
// hunt-atlas-spot's aftermathFor() in exactly four shapes:
//   "cooled X°F within N days"  |  "warmed X°F within N days"
//   "held steady through the week (within X°F)"
//   "only N recorded days follow on file"
// Never-lined-up lines (n_matches = 0) make no falsifiable claim at all —
// the grader grades the anomaly's own persistence instead, and says so.

export interface LineupClaim {
  // 'precedent'      — a real outcome claim (verb/magnitude/window filled)
  // 'never_lined_up' — n_matches = 0; no claim, anomaly-followup graded instead
  // 'thin'           — precedent exists but its aftermath was too thin to state
  // 'none'           — no lineup block at all (dossier read failed)
  kind: 'precedent' | 'never_lined_up' | 'thin' | 'none';
  verb: 'cooled' | 'warmed' | 'held' | null;
  magnitude_f: number | null;
  window_days: number | null;   // days the precedent took; 7 for "held"
  mode: string | null;          // moon_tide_temp | moon_temp
  last_date: string | null;
  last_outcome: string | null;  // the raw published aftermath string
  n_matches: number | null;
  n_years: number | null;
  n_days_searched: number | null;
  // Anomaly context — the NO_CLAIM path grades whether the quoted anomaly
  // persisted or broke, which needs the baseline the σ was measured against.
  anomaly_direction: 'warm' | 'cold' | null;
  baseline_mean_f: number | null;
  // The control line's own denominators, kept beside the claim so a grade can
  // quote the base rate the line itself published.
  control: {
    all_n: number | null;
    all_outcome_n: number | null;
    matched_n: number | null;
    matched_outcome_n: number | null;
  } | null;
}

export interface MorningLineRow {
  day: string;
  state_abbr: string;
  headline: string;
  lede: string;
  control_line: string | null;
  quoted_temp_f: number | null;
  anomaly_sigma: number | null;
  day0_source: string;
  lineup_claim: LineupClaim;
  basis: 'published' | 'recomputed';
}

/** Parse hunt-atlas-spot's aftermath outcome string into a structured claim. */
export function parseOutcomeString(outcome: string | null): {
  verb: LineupClaim['verb']; magnitude_f: number | null; window_days: number | null; thin: boolean;
} {
  const s = String(outcome ?? '').trim();
  let m = s.match(/^cooled (\d+(?:\.\d+)?)°F within (\d+) days?$/);
  if (m) return { verb: 'cooled', magnitude_f: Number(m[1]), window_days: Number(m[2]), thin: false };
  m = s.match(/^warmed (\d+(?:\.\d+)?)°F within (\d+) days?$/);
  if (m) return { verb: 'warmed', magnitude_f: Number(m[1]), window_days: Number(m[2]), thin: false };
  m = s.match(/^held steady through the week \(within (\d+(?:\.\d+)?)°F\)$/);
  if (m) return { verb: 'held', magnitude_f: Number(m[1]), window_days: 7, thin: false };
  if (/^only \d+ recorded days? follow on file$/.test(s)) {
    return { verb: null, magnitude_f: null, window_days: null, thin: true };
  }
  return { verb: null, magnitude_f: null, window_days: null, thin: false };
}

/**
 * Build a morning_lines row from a hunt-morning-line response payload.
 * Returns null when the payload published no line (headline absent — the
 * honest-empty "no scoreable reading" case writes nothing).
 * NOTE: the payload's top-level fields are `headline`/`lede`, not `line`.
 */
export function buildMorningLineRow(
  payload: Record<string, unknown>,
  basis: 'published' | 'recomputed',
): MorningLineRow | null {
  const headline = typeof payload.headline === 'string' ? payload.headline : null;
  const lede = typeof payload.lede === 'string' ? payload.lede : null;
  const day = typeof payload.date === 'string' ? payload.date : null;
  const state = typeof payload.state === 'string' ? payload.state : null;
  if (!headline || !lede || !day || !state) return null;

  const parts = (payload.parts ?? {}) as Record<string, unknown>;
  const anomaly = (parts.anomaly ?? null) as Record<string, unknown> | null;
  const lineup = (parts.lineup ?? null) as Record<string, unknown> | null;
  const control = (parts.control ?? null) as Record<string, unknown> | null;

  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const z = num(anomaly?.z);

  let claim: LineupClaim;
  const base = {
    mode: typeof lineup?.mode === 'string' ? (lineup.mode as string) : null,
    last_date: typeof lineup?.last_date === 'string' ? (lineup.last_date as string) : null,
    last_outcome: typeof lineup?.last_outcome === 'string' ? (lineup.last_outcome as string) : null,
    n_matches: num(lineup?.n_matches),
    n_years: num(lineup?.n_years),
    n_days_searched: num(lineup?.n_days_searched),
    anomaly_direction: z === null ? null : (z >= 0 ? 'warm' as const : 'cold' as const),
    baseline_mean_f: num(anomaly?.baseline_mean),
    control: control ? {
      all_n: num(control.all_n),
      all_outcome_n: num(control.all_outcome_n),
      matched_n: num(control.matched_n),
      matched_outcome_n: num(control.matched_outcome_n),
    } : null,
  };

  if (!lineup) {
    claim = { kind: 'none', verb: null, magnitude_f: null, window_days: null, ...base };
  } else if ((base.n_matches ?? 0) === 0) {
    claim = { kind: 'never_lined_up', verb: null, magnitude_f: null, window_days: null, ...base };
  } else {
    const parsed = parseOutcomeString(base.last_outcome);
    claim = parsed.verb
      ? { kind: 'precedent', verb: parsed.verb, magnitude_f: parsed.magnitude_f, window_days: parsed.window_days, ...base }
      : { kind: 'thin', verb: null, magnitude_f: null, window_days: null, ...base };
  }

  return {
    day,
    state_abbr: state,
    headline,
    lede,
    control_line: typeof payload.control_line === 'string' ? payload.control_line : null,
    quoted_temp_f: num(anomaly?.value),
    anomaly_sigma: z,
    day0_source: typeof anomaly?.day0_source === 'string' ? (anomaly.day0_source as string) : 'archive',
    lineup_claim: claim,
    basis,
  };
}
