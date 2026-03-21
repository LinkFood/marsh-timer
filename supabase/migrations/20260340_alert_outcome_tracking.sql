-- Self-improving alert feedback loop: outcome tracking + calibration

-- Add outcome tracking columns to hunt_convergence_alerts
ALTER TABLE hunt_convergence_alerts
ADD COLUMN IF NOT EXISTS predicted_outcome jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS outcome_window_hours integer DEFAULT 72,
ADD COLUMN IF NOT EXISTS outcome_checked boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS outcome_grade text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS outcome_reasoning text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS outcome_checked_at timestamptz DEFAULT NULL;

-- Index for the grader to find ungraded alerts efficiently
CREATE INDEX IF NOT EXISTS idx_convergence_alerts_ungraded
ON hunt_convergence_alerts (outcome_checked, created_at)
WHERE outcome_checked = false;

-- Universal alert outcome tracker (all alert types)
CREATE TABLE IF NOT EXISTS hunt_alert_outcomes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_source text NOT NULL,
  alert_knowledge_id uuid,
  state_abbr text,
  alert_date date NOT NULL,
  predicted_outcome jsonb NOT NULL,
  outcome_window_hours integer DEFAULT 72,
  outcome_deadline timestamptz NOT NULL,
  outcome_checked boolean DEFAULT false,
  outcome_grade text,
  outcome_signals_found jsonb,
  outcome_reasoning text,
  grade_knowledge_id uuid,
  graded_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_outcomes_ungraded
ON hunt_alert_outcomes (outcome_checked, outcome_deadline)
WHERE outcome_checked = false;

CREATE INDEX IF NOT EXISTS idx_alert_outcomes_source
ON hunt_alert_outcomes (alert_source, state_abbr);

CREATE INDEX IF NOT EXISTS idx_alert_outcomes_grade
ON hunt_alert_outcomes (outcome_grade, alert_source);

ALTER TABLE hunt_alert_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access_outcomes" ON hunt_alert_outcomes FOR ALL USING (true);

-- Rolling calibration stats per alert type/state/window
CREATE TABLE IF NOT EXISTS hunt_alert_calibration (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_source text NOT NULL,
  state_abbr text,
  window_days integer NOT NULL,
  total_alerts integer NOT NULL,
  confirmed integer DEFAULT 0,
  partially_confirmed integer DEFAULT 0,
  missed integer DEFAULT 0,
  false_alarm integer DEFAULT 0,
  accuracy_rate numeric(5,4),
  precision_rate numeric(5,4),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(alert_source, state_abbr, window_days)
);

ALTER TABLE hunt_alert_calibration ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access_calibration" ON hunt_alert_calibration FOR ALL USING (true);
