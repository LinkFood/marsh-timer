SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS hunt_usfws_harvest (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  flyway text NOT NULL,
  year integer NOT NULL,
  state_abbr text NOT NULL,
  species_group text NOT NULL,
  harvest integer,
  hunters integer,
  days_hunted integer,
  created_at timestamptz DEFAULT now(),
  UNIQUE(flyway, year, state_abbr, species_group)
);

CREATE INDEX idx_hunt_usfws_harvest_state ON hunt_usfws_harvest (state_abbr, year);
CREATE INDEX idx_hunt_usfws_harvest_flyway ON hunt_usfws_harvest (flyway, year);

ALTER TABLE hunt_usfws_harvest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON hunt_usfws_harvest FOR ALL USING (true) WITH CHECK (true);

RESET search_path;
