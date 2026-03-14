-- Historical migration + weather data for pattern extraction
-- Cross-reference eBird sightings with weather to find hunting intelligence patterns

-- eBird sighting density per state per day
CREATE TABLE hunt_migration_history (
  state_abbr text NOT NULL REFERENCES hunt_states(abbreviation),
  species text NOT NULL,
  date date NOT NULL,
  sighting_count int NOT NULL,
  location_count int NOT NULL,
  notable_locations jsonb,
  PRIMARY KEY (state_abbr, species, date)
);

-- Weather per state per day (daily aggregates from Open-Meteo archive)
CREATE TABLE hunt_weather_history (
  state_abbr text NOT NULL REFERENCES hunt_states(abbreviation),
  date date NOT NULL,
  temp_high_f float,
  temp_low_f float,
  temp_avg_f float,
  wind_speed_avg_mph float,
  wind_speed_max_mph float,
  wind_direction_dominant int,
  pressure_avg_msl float,
  pressure_change_12h float,
  precipitation_total_mm float,
  cloud_cover_avg int,
  PRIMARY KEY (state_abbr, date)
);

-- Indexes for pattern extraction joins
CREATE INDEX idx_hunt_migration_species_date ON hunt_migration_history(species, date);
CREATE INDEX idx_hunt_migration_state_date ON hunt_migration_history(state_abbr, date);
CREATE INDEX idx_hunt_weather_state_date ON hunt_weather_history(state_abbr, date);
