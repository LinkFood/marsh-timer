CREATE TABLE IF NOT EXISTS hunt_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  feedback_type text NOT NULL CHECK (feedback_type IN ('scout_report', 'convergence_alert', 'convergence_score')),
  target_date date NOT NULL,
  state_abbr text,
  rating boolean NOT NULL,
  comment text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, feedback_type, target_date, state_abbr)
);

ALTER TABLE hunt_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own feedback" ON hunt_feedback
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role bypass
CREATE POLICY "Service role full access" ON hunt_feedback
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
