-- Phase 1: Continuous Monitoring Tables
-- Weather forecasts, events, NWS alerts, solunar calendar, migration spikes, forum posts

-- 16-day weather forecast per state (overwritten daily)
CREATE TABLE hunt_weather_forecast (
  state_abbr text NOT NULL REFERENCES hunt_states(abbreviation),
  date date NOT NULL,
  temp_high_f float,
  temp_low_f float,
  wind_speed_max_mph float,
  wind_direction_dominant int,
  pressure_msl float,
  precipitation_mm float,
  weather_code int,
  cloud_cover_pct int,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (state_abbr, date)
);

-- Detected weather events (cold fronts, pressure drops, etc.)
CREATE TABLE hunt_weather_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbr text NOT NULL REFERENCES hunt_states(abbreviation),
  event_date date NOT NULL,
  event_type text NOT NULL, -- 'cold_front', 'pressure_drop', 'high_wind', 'first_freeze', 'heavy_precip'
  severity text NOT NULL DEFAULT 'medium', -- 'high', 'medium'
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hunt_weather_events_state_date ON hunt_weather_events(state_abbr, event_date);

-- NWS active alerts
CREATE TABLE hunt_nws_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id text UNIQUE NOT NULL,
  event_type text NOT NULL,
  severity text NOT NULL,
  headline text NOT NULL,
  description text,
  states text[] NOT NULL DEFAULT '{}',
  areas text,
  onset timestamptz,
  expires timestamptz,
  geometry jsonb, -- GeoJSON for future map overlay
  raw_ugc text[],
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hunt_nws_alerts_states ON hunt_nws_alerts USING gin(states);
CREATE INDEX idx_hunt_nws_alerts_expires ON hunt_nws_alerts(expires);

-- Precomputed solunar calendar (365 days)
CREATE TABLE hunt_solunar_calendar (
  date date PRIMARY KEY,
  moon_phase text NOT NULL, -- 'new', 'waxing_crescent', 'first_quarter', 'waxing_gibbous', 'full', 'waning_gibbous', 'last_quarter', 'waning_crescent'
  illumination_pct float NOT NULL,
  moon_age_days float NOT NULL,
  major_start_1 time,
  major_end_1 time,
  major_start_2 time,
  major_end_2 time,
  minor_start_1 time,
  minor_end_1 time,
  minor_start_2 time,
  minor_end_2 time,
  is_prime boolean NOT NULL DEFAULT false,
  prime_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Migration spike detection
CREATE TABLE hunt_migration_spikes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbr text NOT NULL REFERENCES hunt_states(abbreviation),
  date date NOT NULL,
  sighting_count int NOT NULL,
  baseline_avg float NOT NULL,
  deviation_pct float NOT NULL,
  species text NOT NULL DEFAULT 'duck',
  notable_locations jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hunt_migration_spikes_state_date ON hunt_migration_spikes(state_abbr, date);

-- Forum post extraction
CREATE TABLE hunt_forum_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL, -- 'reddit', 'forum_name'
  source_id text UNIQUE NOT NULL,
  subreddit text,
  title text NOT NULL,
  content text,
  author text,
  posted_at timestamptz,
  state_abbr text REFERENCES hunt_states(abbreviation),
  species text[],
  bird_count int,
  weather_notes text,
  location_hints text,
  tactics text,
  quality_score float,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hunt_forum_posts_state ON hunt_forum_posts(state_abbr);
CREATE INDEX idx_hunt_forum_posts_posted ON hunt_forum_posts(posted_at);

-- Add metadata column to hunt_knowledge for richer embedding context
ALTER TABLE hunt_knowledge ADD COLUMN IF NOT EXISTS metadata jsonb;
CREATE INDEX IF NOT EXISTS idx_hunt_knowledge_metadata ON hunt_knowledge USING gin(metadata);

-- Add state_abbr to hunt_knowledge for filtering by state
ALTER TABLE hunt_knowledge ADD COLUMN IF NOT EXISTS state_abbr text REFERENCES hunt_states(abbreviation);
CREATE INDEX IF NOT EXISTS idx_hunt_knowledge_state ON hunt_knowledge(state_abbr);
CREATE INDEX IF NOT EXISTS idx_hunt_knowledge_type ON hunt_knowledge(content_type);

-- Add NASA data column to hunt_weather_history
ALTER TABLE hunt_weather_history ADD COLUMN IF NOT EXISTS nasa_data jsonb;

-- RLS policies: enable RLS, allow service role bypass
ALTER TABLE hunt_weather_forecast ENABLE ROW LEVEL SECURITY;
ALTER TABLE hunt_weather_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hunt_nws_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE hunt_solunar_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE hunt_migration_spikes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hunt_forum_posts ENABLE ROW LEVEL SECURITY;

-- Service role bypass policies (all monitoring tables are internal-only)
CREATE POLICY "Service role full access" ON hunt_weather_forecast FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON hunt_weather_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON hunt_nws_alerts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON hunt_solunar_calendar FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON hunt_migration_spikes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON hunt_forum_posts FOR ALL USING (true) WITH CHECK (true);
