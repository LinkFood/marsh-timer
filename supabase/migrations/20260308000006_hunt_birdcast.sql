SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS hunt_birdcast (
  id serial PRIMARY KEY,
  date date NOT NULL,
  state_abbr text NOT NULL,
  cumulative_birds integer,
  is_high boolean DEFAULT false,
  peak_num_aloft integer,
  avg_direction numeric,
  avg_speed numeric,
  mean_height numeric,
  raw_data jsonb,
  embedded_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(date, state_abbr)
);

CREATE INDEX idx_hunt_birdcast_date ON hunt_birdcast (date DESC);
CREATE INDEX idx_hunt_birdcast_state ON hunt_birdcast (state_abbr);

ALTER TABLE hunt_birdcast ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON hunt_birdcast FOR ALL USING (true) WITH CHECK (true);

RESET search_path;
