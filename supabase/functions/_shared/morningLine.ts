// Shared morning_lines row builder — used by hunt-morning-line (persisting the
// published current-day line) and hunt-morning-grader (backfilling past days
// through the dated recompute path).
//
// THE LINEUP CLAIM LANE IS RETIRED (gate 1, retrodiction 2026-07-17 —
// scripts/mine/out/LINEUP-RETRO-REPORT.md: Δ_obs = −0.19pp over 1,349,945
// paired days vs 64 calendar rotations, no lift). Rows persisted from
// 2026-07-17 forward carry lineup_claim NULL: the line publishes no
// falsifiable precedent claim, and the grader's NO_CLAIM path rules on such
// rows. HISTORICAL rows keep their structured LineupClaim JSON untouched —
// the grader's precedent path still grades those already-published claims
// (never strand old rows); it just never sees a new one.

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
  /** NULL for every row written 2026-07-17+ — the lineup claim lane is retired. */
  lineup_claim: LineupClaim | null;
  basis: 'published' | 'recomputed';
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

  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;

  return {
    day,
    state_abbr: state,
    headline,
    lede,
    control_line: typeof payload.control_line === 'string' ? payload.control_line : null,
    quoted_temp_f: num(anomaly?.value),
    anomaly_sigma: num(anomaly?.z),
    day0_source: typeof anomaly?.day0_source === 'string' ? (anomaly.day0_source as string) : 'archive',
    // Retired 2026-07-17: the line makes no lineup precedent claim, so no
    // claim is persisted. The grader's NO_CLAIM path rules on null.
    lineup_claim: null,
    basis,
  };
}
