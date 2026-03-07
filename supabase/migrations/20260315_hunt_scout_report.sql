-- Phase 3: Scout Report + Alert infrastructure

-- User preferences for alerts and briefs
ALTER TABLE hunt_user_settings ADD COLUMN IF NOT EXISTS favorite_states text[] DEFAULT '{}';
ALTER TABLE hunt_user_settings ADD COLUMN IF NOT EXISTS brief_enabled boolean DEFAULT true;
ALTER TABLE hunt_user_settings ADD COLUMN IF NOT EXISTS alert_delivery text DEFAULT 'none'; -- 'none', 'slack'
ALTER TABLE hunt_user_settings ADD COLUMN IF NOT EXISTS timezone text DEFAULT 'America/New_York';

-- Update hunt_intel_briefs to support new brief format
-- The table already exists from bootstrap migration with: id, species_id, state_abbr, zone_slug, date, brief_text, data_sources, created_at
-- Add user_id and delivery tracking
ALTER TABLE hunt_intel_briefs ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE hunt_intel_briefs ADD COLUMN IF NOT EXISTS scores jsonb;
ALTER TABLE hunt_intel_briefs ADD COLUMN IF NOT EXISTS delivered_via text;
-- Drop the old unique constraint if it exists, add new one
ALTER TABLE hunt_intel_briefs DROP CONSTRAINT IF EXISTS hunt_intel_briefs_species_id_state_abbr_zone_slug_date_key;

-- Convergence alerts table
CREATE TABLE hunt_convergence_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbr text NOT NULL REFERENCES hunt_states(abbreviation),
  date date NOT NULL,
  alert_type text NOT NULL, -- 'score_jump', 'threshold_cross', 'nws_severe'
  score int NOT NULL,
  previous_score int,
  change int,
  reasoning text NOT NULL,
  delivered_to uuid[], -- user_ids who were notified
  throttle_until timestamptz, -- don't re-alert this state until this time
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hunt_convergence_alerts_state ON hunt_convergence_alerts(state_abbr, date);
CREATE INDEX idx_hunt_convergence_alerts_date ON hunt_convergence_alerts(date);

ALTER TABLE hunt_convergence_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON hunt_convergence_alerts FOR ALL USING (true) WITH CHECK (true);
