SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS hunt_state_arcs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  state_abbr TEXT NOT NULL,
  arc_id UUID DEFAULT gen_random_uuid() NOT NULL,
  current_act TEXT NOT NULL CHECK (current_act IN ('buildup', 'recognition', 'outcome', 'grade', 'closed')),
  act_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,

  buildup_signals JSONB DEFAULT '{}',
  recognition_claim JSONB DEFAULT '{}',
  recognition_alert_id UUID,
  outcome_deadline TIMESTAMPTZ,
  outcome_signals JSONB DEFAULT '[]',
  grade TEXT CHECK (grade IS NULL OR grade IN ('confirmed', 'partially_confirmed', 'missed', 'false_alarm')),
  grade_reasoning TEXT,
  precedent_accuracy FLOAT,
  narrative TEXT,
  fingerprint_embedding extensions.vector(512),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_state_arcs_state ON hunt_state_arcs(state_abbr);
CREATE INDEX idx_state_arcs_active ON hunt_state_arcs(current_act) WHERE current_act != 'closed';
CREATE INDEX idx_state_arcs_open ON hunt_state_arcs(state_abbr, current_act) WHERE current_act != 'closed';

CREATE OR REPLACE FUNCTION update_state_arcs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER state_arcs_updated_at
  BEFORE UPDATE ON hunt_state_arcs
  FOR EACH ROW EXECUTE FUNCTION update_state_arcs_updated_at();

ALTER TABLE hunt_state_arcs REPLICA IDENTITY FULL;

ALTER TABLE hunt_state_arcs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_arcs" ON hunt_state_arcs FOR SELECT USING (true);
CREATE POLICY "service_write_arcs" ON hunt_state_arcs FOR ALL USING (current_setting('role') = 'service_role');
