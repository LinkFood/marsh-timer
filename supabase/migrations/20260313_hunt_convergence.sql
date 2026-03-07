-- Phase 2: Convergence Engine tables

-- Hunt score per state per day (0-100)
CREATE TABLE hunt_convergence_scores (
  state_abbr text NOT NULL REFERENCES hunt_states(abbreviation),
  date date NOT NULL,
  score int NOT NULL CHECK (score >= 0 AND score <= 100),
  weather_component int NOT NULL DEFAULT 0, -- 0-30
  solunar_component int NOT NULL DEFAULT 0, -- 0-20
  migration_component int NOT NULL DEFAULT 0, -- 0-30
  pattern_component int NOT NULL DEFAULT 0, -- 0-20
  reasoning text NOT NULL,
  signals jsonb NOT NULL DEFAULT '{}',
  national_rank int, -- 1-50 rank among all states
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (state_abbr, date)
);

CREATE INDEX idx_hunt_convergence_date ON hunt_convergence_scores(date);
CREATE INDEX idx_hunt_convergence_score ON hunt_convergence_scores(score DESC);

-- Score change history (for re-scoring on NWS alerts)
CREATE TABLE hunt_score_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbr text NOT NULL REFERENCES hunt_states(abbreviation),
  scored_at timestamptz NOT NULL DEFAULT now(),
  score int NOT NULL,
  trigger text NOT NULL, -- 'daily', 'nws_alert', 'migration_spike'
  previous_score int,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_hunt_score_history_state ON hunt_score_history(state_abbr, scored_at DESC);

-- RLS
ALTER TABLE hunt_convergence_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE hunt_score_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON hunt_convergence_scores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON hunt_score_history FOR ALL USING (true) WITH CHECK (true);
