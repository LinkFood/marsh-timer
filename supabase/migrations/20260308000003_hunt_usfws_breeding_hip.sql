SET search_path = public, extensions;

CREATE TABLE IF NOT EXISTS hunt_usfws_breeding (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year integer NOT NULL,
  species text NOT NULL,
  population_estimate bigint,
  standard_error bigint,
  trend text,
  percent_change numeric,
  survey_area text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(year, species, survey_area)
);

CREATE INDEX idx_hunt_usfws_breeding_species ON hunt_usfws_breeding (species, year);

CREATE TABLE IF NOT EXISTS hunt_usfws_hip (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  year integer NOT NULL,
  state_abbr text NOT NULL,
  species_group text NOT NULL,
  harvest integer,
  active_hunters integer,
  days_afield integer,
  created_at timestamptz DEFAULT now(),
  UNIQUE(year, state_abbr, species_group)
);

CREATE INDEX idx_hunt_usfws_hip_state ON hunt_usfws_hip (state_abbr, year);

ALTER TABLE hunt_usfws_breeding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON hunt_usfws_breeding FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE hunt_usfws_hip ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON hunt_usfws_hip FOR ALL USING (true) WITH CHECK (true);

RESET search_path;
