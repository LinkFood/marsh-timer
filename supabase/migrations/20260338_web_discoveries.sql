CREATE TABLE IF NOT EXISTS hunt_web_discoveries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  query text NOT NULL,
  source_url text,
  title text,
  content text NOT NULL,
  content_type text,
  state_abbr text,
  species text,
  quality_score float,
  curator_decision text,
  curator_reasoning text,
  embedded_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE hunt_web_discoveries ENABLE ROW LEVEL SECURITY;

-- Service role has full access (edge functions use service role)
CREATE POLICY "service_role_full_access" ON hunt_web_discoveries
  FOR ALL USING (true);
