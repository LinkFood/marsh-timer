CREATE TABLE IF NOT EXISTS hunt_du_map_reports (
  report_id integer PRIMARY KEY,
  submit_date timestamptz NOT NULL,
  country text DEFAULT 'US',
  state text NOT NULL,
  state_abbr text,
  city text,
  zip text,
  latitude double precision,
  longitude double precision,
  activity_level text,
  activity_level_id smallint,
  classification text,
  time_of_day text,
  weather text,
  temp text,
  wind_speed text,
  wind_direction text,
  comments text,
  is_field_editor boolean DEFAULT false,
  flyway_id smallint,
  vote_up integer DEFAULT 0,
  vote_down integer DEFAULT 0,
  embedded_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_du_map_state ON hunt_du_map_reports(state_abbr);
CREATE INDEX IF NOT EXISTS idx_du_map_date ON hunt_du_map_reports(submit_date);

ALTER TABLE hunt_du_map_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON hunt_du_map_reports FOR ALL USING (true);
