SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS hunt_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  state_abbr text NOT NULL,
  county text,
  species text NOT NULL,
  harvest_count integer NOT NULL DEFAULT 0,
  notes text,
  lat numeric,
  lng numeric,
  weather jsonb,
  solunar jsonb,
  embedded_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_hunt_logs_user ON hunt_logs (user_id, date DESC);
CREATE INDEX idx_hunt_logs_state ON hunt_logs (state_abbr, date DESC);

ALTER TABLE hunt_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own logs" ON hunt_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access" ON hunt_logs
  FOR ALL USING (true) WITH CHECK (true);

RESET search_path;
