-- Hunt tables bootstrap for DuckCountdown
-- Shares Supabase project rvhyotvklfowklzjahdd with JAC Agent OS
-- All tables prefixed with hunt_ to avoid collisions

-- hunt_species (reference table)
CREATE TABLE hunt_species (
  id text PRIMARY KEY,
  label text NOT NULL,
  emoji text NOT NULL,
  season_types text[] NOT NULL,
  colors jsonb NOT NULL,
  display_order int NOT NULL DEFAULT 0
);

-- hunt_states (reference table with centroids)
CREATE TABLE hunt_states (
  abbreviation text PRIMARY KEY,
  name text NOT NULL,
  fips text UNIQUE,
  centroid_lat double precision,
  centroid_lng double precision,
  flyway text,
  region text
);

-- hunt_seasons (main data - migrated from static TS)
CREATE TABLE hunt_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  species_id text NOT NULL REFERENCES hunt_species(id),
  state_abbr text NOT NULL REFERENCES hunt_states(abbreviation),
  state_name text NOT NULL,
  season_type text NOT NULL,
  zone text NOT NULL DEFAULT 'Statewide',
  zone_slug text NOT NULL DEFAULT 'statewide',
  dates jsonb NOT NULL,
  bag_limit int NOT NULL DEFAULT 0,
  flyway text,
  weapon text,
  notes text,
  verified boolean NOT NULL DEFAULT false,
  source_url text,
  season_year text NOT NULL DEFAULT '2025-2026',
  UNIQUE(species_id, state_abbr, season_type, zone_slug, season_year)
);

-- hunt_zones (zone-to-county FIPS mapping)
CREATE TABLE hunt_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  species_id text NOT NULL REFERENCES hunt_species(id),
  state_abbr text NOT NULL REFERENCES hunt_states(abbreviation),
  zone_slug text NOT NULL,
  zone_name text NOT NULL,
  county_fips text[] NOT NULL DEFAULT '{}',
  UNIQUE(species_id, state_abbr, zone_slug)
);

-- hunt_state_facts (3 facts per species/state)
CREATE TABLE hunt_state_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  species_id text NOT NULL REFERENCES hunt_species(id),
  state_name text NOT NULL,
  facts text[] NOT NULL DEFAULT '{}',
  UNIQUE(species_id, state_name)
);

-- hunt_regulation_links (state DNR URLs per species)
CREATE TABLE hunt_regulation_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  species_id text NOT NULL REFERENCES hunt_species(id),
  state_abbr text NOT NULL REFERENCES hunt_states(abbreviation),
  url text NOT NULL,
  UNIQUE(species_id, state_abbr)
);

-- hunt_weather_cache (future - schema now)
CREATE TABLE hunt_weather_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_abbr text NOT NULL,
  zone_slug text,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  forecast jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(state_abbr, zone_slug)
);

-- hunt_solunar_cache (future - schema now)
CREATE TABLE hunt_solunar_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  date date NOT NULL,
  data jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lat, lng, date)
);

-- hunt_intel_briefs (future)
CREATE TABLE hunt_intel_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  species_id text REFERENCES hunt_species(id),
  state_abbr text REFERENCES hunt_states(abbreviation),
  zone_slug text,
  date date NOT NULL,
  brief_text text NOT NULL,
  data_sources text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(species_id, state_abbr, zone_slug, date)
);

-- hunt_user_locations (future, needs RLS)
CREATE TABLE hunt_user_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  state_abbr text REFERENCES hunt_states(abbreviation),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- hunt_knowledge (future, vector embeddings)
SET search_path = public, extensions;
CREATE TABLE hunt_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  content text NOT NULL,
  content_type text NOT NULL DEFAULT 'article',
  tags text[] NOT NULL DEFAULT '{}',
  embedding vector(512),
  created_at timestamptz NOT NULL DEFAULT now()
);
RESET search_path;

-- Indexes
CREATE INDEX idx_hunt_seasons_species ON hunt_seasons(species_id);
CREATE INDEX idx_hunt_seasons_state ON hunt_seasons(state_abbr);
CREATE INDEX idx_hunt_seasons_species_state ON hunt_seasons(species_id, state_abbr);
CREATE INDEX idx_hunt_weather_cache_fetched ON hunt_weather_cache(fetched_at);
CREATE INDEX idx_hunt_solunar_cache_date ON hunt_solunar_cache(date);
