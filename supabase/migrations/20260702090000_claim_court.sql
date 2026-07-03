-- Court v2: the claim registry ("docket") + matched-control grading loop.
--
-- Tonight's postmortems proved the shipped self-grading was tautological —
-- alerts were graded "did the outcome-signal occur in the window" with no
-- base-rate comparison, and always-on daily feeds auto-confirmed. The honest
-- method: grade every claim against MATCHED CONTROL windows (same state,
-- same window length, random non-overlapping dates) and score as LIFT.
--
-- DO NOT `db push` while the IVFFlat rebuild holds the hunt_knowledge write
-- lock — see docs/REACTIVATION-RUNBOOK.md ("Court v2" section).

-- ---------------------------------------------------------------------------
-- hunt_claims: the docket. Every hypothesis the brain is willing to be
-- judged on, in plain language plus a machine-evaluable trigger/outcome pair.
-- trigger_def / outcome_def vocabulary is documented in
-- supabase/functions/hunt-claim-court/index.ts (header comment).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hunt_claims (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  hypothesis text NOT NULL,
  trigger_def jsonb NOT NULL,
  outcome_def jsonb NOT NULL,
  status text NOT NULL DEFAULT 'active',   -- active | retired
  source text,                             -- how the claim was discovered
  registered_at timestamptz DEFAULT now(),
  notes text
);

ALTER TABLE hunt_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access_claims" ON hunt_claims FOR ALL USING (true);

-- ---------------------------------------------------------------------------
-- hunt_claim_fires: one row per (claim, state, day) the trigger fired.
-- Graded after window_end passes: hit + matched-control counts + lift.
-- Lift convention (grade_version 2, same as hunt-alert-grader):
--   control_rate = control_hits / control_n
--   lift = hit ? 1 / max(control_rate, 1/(2*control_n)) : 0
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS hunt_claim_fires (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  claim_id uuid NOT NULL REFERENCES hunt_claims(id) ON DELETE CASCADE,
  state_abbr text NOT NULL,
  fired_at date NOT NULL,
  window_end date NOT NULL,
  evaluated boolean NOT NULL DEFAULT false,
  hit boolean,
  control_hits int,
  control_n int,
  lift numeric,
  graded_at timestamptz,
  detail jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE (claim_id, state_abbr, fired_at)   -- idempotent daily FIRE phase
);

CREATE INDEX IF NOT EXISTS idx_claim_fires_due
ON hunt_claim_fires (evaluated, window_end)
WHERE evaluated = false;

CREATE INDEX IF NOT EXISTS idx_claim_fires_claim
ON hunt_claim_fires (claim_id, fired_at);

ALTER TABLE hunt_claim_fires ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access_claim_fires" ON hunt_claim_fires FOR ALL USING (true);

-- ---------------------------------------------------------------------------
-- Daily court session: 09:00 UTC. Idempotent unschedule-then-schedule.
-- The function tolerates running before any claims exist.
-- ---------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hunt-claim-court-daily') THEN
    PERFORM cron.unschedule('hunt-claim-court-daily');
  END IF;
  PERFORM cron.schedule(
    'hunt-claim-court-daily',
    '0 9 * * *',
    $body$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-claim-court',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $body$
  );
END
$cron$;

-- ---------------------------------------------------------------------------
-- Seed the docket: the first four claims.
-- Two discovered hypotheses + two KNOWN-PHYSICS BENCHMARKS. The benchmarks
-- are yardsticks: if the court cannot confirm known physics (tide surge ->
-- coastal flood; overcast collapse -> flood), the court itself is broken.
-- They are positive controls for the grading machinery, not discoveries.
-- ---------------------------------------------------------------------------

INSERT INTO hunt_claims (name, hypothesis, trigger_def, outcome_def, status, source, notes) VALUES
(
  'drought-heat-amplification',
  'When a state is in worsening D2+ drought, a coastal SST anomaly is present, and a bio-absence signal fired within 5 days, an extreme heat day (max-temp z >= +3 vs trailing 60-day baseline) follows within 14 days.',
  '{
    "scope": "all",
    "mode": "all",
    "conditions": [
      { "kind": "presence", "content_type": "drought-weekly", "lookback_days": 10,
        "metadata_num": [
          { "path": "d2_pct", "op": "gte", "value": 5 },
          { "path": "week_change.d2", "op": "gt", "value": 0 } ] },
      { "kind": "presence", "content_type": "bio-absence-signal", "lookback_days": 5 },
      { "kind": "metadata_z", "content_type": "ocean-buoy", "path": "sst_c",
        "op": "gte", "z": 1.0, "baseline_days": 45, "lookback_days": 3 }
    ]
  }'::jsonb,
  '{
    "window_days": 14,
    "mode": "any",
    "conditions": [
      { "kind": "weather_z", "metric": "temp_high_f", "op": "gte", "z": 3.0, "baseline_days": 60 }
    ]
  }'::jsonb,
  'active',
  '2026-07-02 heat-wave retrodiction',
  'Heat outcome encoded as temp_high_f z >= +3 vs trailing 60-day per-state baseline from hunt_weather_history (updated daily by hunt-weather-watchdog). Chosen over a GHCN top-2% seasonal percentile because GHCN is backfill-era only and not live-computable; document a swap if a seasonal baseline lands. SST anomaly = daily-mean ocean-buoy sst_c z >= +1 vs 45-day baseline; inland states have no ocean-buoy data so the trigger self-scopes to coastal states.'
),
(
  'bio-absence-leads-heat',
  'A bio-absence signal of >= 80 percent activity drop in a state precedes a z >= +2.5 heat day within 14 days.',
  '{
    "scope": "all",
    "mode": "all",
    "conditions": [
      { "kind": "presence", "content_type": "bio-absence-signal", "lookback_days": 1,
        "metadata_num": [ { "path": "drop_pct", "op": "gte", "value": 80 } ] }
    ]
  }'::jsonb,
  '{
    "window_days": 14,
    "mode": "any",
    "conditions": [
      { "kind": "weather_z", "metric": "temp_high_f", "op": "gte", "z": 2.5, "baseline_days": 60 }
    ]
  }'::jsonb,
  'active',
  '2026-07-02 heat-wave retrodiction (n=1 observation)',
  'Single-observation hypothesis — the court exists precisely to find out whether this generalizes or dies. Expect low prior.'
),
(
  'tide-surge-coastal-flood',
  'When tidal range runs z >= +1.5 above its station baseline, a flood or coastal-flood event follows within 3 days.',
  '{
    "scope": "all",
    "mode": "all",
    "conditions": [
      { "kind": "metadata_z", "content_type": "noaa-tide", "path": "avg_tidal_range_ft",
        "op": "gte", "z": 1.5, "baseline_days": 90, "lookback_days": 7 }
    ]
  }'::jsonb,
  '{
    "window_days": 3,
    "mode": "any",
    "conditions": [
      { "kind": "presence", "content_type": "nws-alert", "text_any": ["flood"] },
      { "kind": "presence", "content_type": "weather-event", "text_any": ["flood"] },
      { "kind": "presence", "content_type": "storm-event", "text_any": ["flood"] }
    ]
  }'::jsonb,
  'active',
  '2026-07-02 formula-discovery mining survivor',
  'KNOWN-PHYSICS BENCHMARK (positive control). Elevated tidal range preceding coastal flooding is established physics — this claim is a yardstick for the court itself: if the court cannot confirm it with lift > 1, the court (or the tide/flood data feeding it) is broken. Do not count it as a discovery. Tide residual proxied by noaa-tide avg_tidal_range_ft z (entries are weekly, hence lookback 7).'
),
(
  'overcast-collapse-flood',
  'When diurnal temperature range collapses (z <= -2.5 vs trailing baseline, i.e., persistent overcast/saturated air), a flood event follows within 3 days.',
  '{
    "scope": "all",
    "mode": "all",
    "conditions": [
      { "kind": "weather_z", "metric": "diurnal_range_f", "op": "lte", "z": -2.5, "baseline_days": 60, "lookback_days": 1 }
    ]
  }'::jsonb,
  '{
    "window_days": 3,
    "mode": "any",
    "conditions": [
      { "kind": "presence", "content_type": "nws-alert", "text_any": ["flood"] },
      { "kind": "presence", "content_type": "weather-event", "text_any": ["flood"] },
      { "kind": "presence", "content_type": "storm-event", "text_any": ["flood"] }
    ]
  }'::jsonb,
  'active',
  '2026-07-02 formula-discovery mining survivor',
  'KNOWN-PHYSICS BENCHMARK (positive control). Collapsed diurnal range means thick cloud/saturated columns — a well-understood flood precursor. Yardstick for the court: failure to confirm with lift > 1 indicts the grading machinery, not the physics.'
)
ON CONFLICT (name) DO NOTHING;
