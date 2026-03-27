CREATE TABLE IF NOT EXISTS hunt_state_briefs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  state_abbr text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  content text NOT NULL,
  score integer,
  component_breakdown jsonb,
  signals jsonb,
  pattern_links jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE(state_abbr, date)
);
ALTER TABLE hunt_state_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_state_briefs" ON hunt_state_briefs FOR SELECT USING (true);
CREATE POLICY "service_write_state_briefs" ON hunt_state_briefs FOR ALL USING (current_setting('role') = 'service_role');
