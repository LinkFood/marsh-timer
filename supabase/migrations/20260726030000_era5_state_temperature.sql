-- ERA5 STATE TEMPERATURE — widening era5_state_pressure to carry 2 m temperature.
--
-- ── THE DEFECT THIS EXISTS TO MAKE FIXABLE ──────────────────────────────────
-- The rarity map on `/` shades every state by how unusual today is against that
-- state's own record. It was ranking two different KINDS of measurement against
-- each other and calling the result a percentile:
--
--   • the live day-0 value is `hunt_weather_history.temp_high_f` — ONE
--     Open-Meteo grid point at the state's geographic centroid
--     (supabase/functions/_shared/states.ts);
--   • the pool it is ranked against is GHCN `avg_high_f` — a multi-station
--     statewide MEAN. Measured station counts: AK 362, NY 146, TX 424.
--
-- A point has far more variance than an areal mean, so it saturates the pool's
-- tails by construction. Measured 2026-07-23:
--
--   state   live centroid   GHCN statewide mean   72-yr pool range
--   AK          48.4 °F           61.8 °F           55.2 – 77.1
--   NY          69.2 °F           79.3 °F           69.3 – 95.6
--   TX         104.4 °F           95.1 °F           82.3 – 104.3
--
-- 26 of the last 30 days had at least one state pinned at depth exactly 1.0000.
-- The map reported "Alaska at the cold edge of its record" when what it had
-- detected is that a centroid is not a state.
--
-- A rank means something only when the live value and the pool are the same kind
-- of measurement. These columns are the pool side of that: a 1979+ per-state
-- daily temperature series built by the SAME frozen 5-point construction
-- (docs/ERA5-SAMPLING-SCHEME.md, sampling_version 1, scheme_hash 587429395) that
-- a live reading can be built with. This migration does not change what the map
-- reads. It makes the honest comparison possible; pointing the map at it is a
-- separate, deliberate change.
--
-- ── WHY IT COSTS NOTHING ────────────────────────────────────────────────────
-- Open-Meteo weights a call as locations × (days/14) × max(1, variables/10).
-- Three variables and six variables both weigh 1.0 — the surcharge starts past
-- TEN. The backfill's total is unchanged at ~310,000 weighted calls.
--
-- ── WHY THE TABLE IS STILL CALLED era5_state_pressure ───────────────────────
-- It is now a misnomer and that is the cheaper of two costs. A rename would
-- have to move through scripts/backup/dump-tables.ts, scripts/backup/
-- restore-drill.ts (whose LOAD_ORDER and whose DDL extractor scans migrations
-- for `CREATE TABLE <name>` — an ALTER ... RENAME is invisible to it),
-- docs/DISASTER-RECOVERY.md in three places, both era5 scripts, and every dump
-- already on disk under ~/dcd-backups, which is keyed by table name and would
-- silently stop matching. The restore drill has exactly one successful run
-- behind it. Trading a working restore path for a better name, while a write
-- pipe is about to restart against the table, is not a good trade. The table
-- COMMENT below carries the honest description instead. If the name is wanted,
-- the cheap moment is a `sampling_version` bump, or a one-line
-- `CREATE VIEW era5_state_daily AS SELECT * FROM era5_state_pressure` that costs
-- nothing and breaks nothing.

-- ── The columns ─────────────────────────────────────────────────────────────
-- Units are FAHRENHEIT, requested from the API as such
-- (`temperature_unit=fahrenheit`, verified live to leave pressure in hPa). Every
-- other temperature in this archive is already °F (`temp_high_f`,
-- `avg_high_f`), and the whole point of this widening is to take a unit
-- mismatch OUT of a comparison — putting a conversion back into one side of it
-- would be the same defect wearing a new coat. The unit lives in the column
-- name, which is the only place a CHECK constraint cannot help (see below).
ALTER TABLE era5_state_pressure
  -- The daily HIGH: the same quantity as the live `temp_high_f` and as GHCN's
  -- `avg_high_f`. This is THE column the rarity map needs.
  ADD COLUMN IF NOT EXISTS temp_2m_max_f    real,
  ADD COLUMN IF NOT EXISTS temp_2m_min_f    real,
  -- ERA5's true daily mean — the integral of the 24 hourly values, NOT
  -- (max+min)/2. The two differ by ~0.5–2 °F in a structured way, so the mean
  -- cannot be reconstructed from the other two later. Taking it now costs zero
  -- calls; taking it later costs the entire backfill again. That asymmetry is
  -- the whole argument for its presence.
  ADD COLUMN IF NOT EXISTS temp_2m_mean_f   real,
  -- max(day) − max(day−1). Same construction as pressure_delta_24h, on the
  -- metric the map ranks. NULL only where the prior day is genuinely absent.
  ADD COLUMN IF NOT EXISTS temp_delta_24h_f real,
  -- How many of the five points reported a daily high. Deliberately NULLABLE
  -- with no default, so the three states are distinguishable in the data:
  --   NULL → this row predates the temperature widening (should not survive;
  --          the backfill's varsVersion guard resets and re-fetches those units)
  --   0    → the widened pipe ran and no point reported
  --   1–5  → the honest denominator
  -- A DEFAULT 0 would have quietly erased the difference between "never asked"
  -- and "asked, got nothing", which is the class of silence this project keeps
  -- getting bitten by.
  ADD COLUMN IF NOT EXISTS n_points_temp    smallint,
  -- max−min across the five points' daily highs — the receipt for the word
  -- "statewide", and it matters far more here than for pressure. MSL pressure is
  -- a smooth synoptic field with no coastline or elevation discontinuity; 2 m
  -- temperature has both. Alaska's five points span 11° of latitude and one sits
  -- at 906 m on Unimak Island: 33.9 °F of spread measured on 2026-07-18.
  --
  -- That width does NOT invalidate the rank this series exists to serve, because
  -- the live reading it will be ranked against is built by the identical
  -- construction — whatever bias five points impose, they impose on both sides.
  -- It DOES mean these values must never be published as "Alaska's average high
  -- was X °F" against a climate-division number. Stored so a reader can see the
  -- width instead of inferring it. See docs/ERA5-SAMPLING-SCHEME.md §3.
  ADD COLUMN IF NOT EXISTS temp_spread_f    real;

-- Plausibility, in the spirit of the existing 850–1100 hPa guard: outside this
-- range is not weather, it is a parse bug. The US record extremes are −80 °F
-- (Prospect Creek AK, 1971) and 134 °F (Death Valley, 1913), and these are
-- five-point areal means which cannot reach either.
--
-- HONEST LIMIT: no range can catch a °C value stored in a °F column — 20 is
-- plausible in both units. That failure mode is guarded by the column name, by
-- `temperature_unit=fahrenheit` being explicit in the request URL (which every
-- row carries in `source_url`), and by --dry-run printing the API's own
-- `daily_units` block. Not by this constraint, and it would be dishonest to
-- imply otherwise.
--
-- Deliberately NOT added: a min ≤ mean ≤ max ordering check. These are three
-- independent means over point sets that are normally identical but need not be
-- (a point may report a max and not a min), so the ordering can legitimately
-- invert by a hair. A constraint that can abort an upsert mid-run on a rare data
-- edge is worse than the defect it guards, on a pipe that takes five weeks.
ALTER TABLE era5_state_pressure
  DROP CONSTRAINT IF EXISTS era5_state_pressure_temp_plausible_ck;
ALTER TABLE era5_state_pressure
  ADD CONSTRAINT era5_state_pressure_temp_plausible_ck CHECK (
    (temp_2m_max_f  IS NULL OR temp_2m_max_f  BETWEEN -120 AND 150) AND
    (temp_2m_min_f  IS NULL OR temp_2m_min_f  BETWEEN -120 AND 150) AND
    (temp_2m_mean_f IS NULL OR temp_2m_mean_f BETWEEN -120 AND 150) AND
    (n_points_temp  IS NULL OR n_points_temp  BETWEEN 0 AND 5) AND
    (temp_spread_f  IS NULL OR temp_spread_f  >= 0)
  );

-- The card's query shape for temperature, mirroring era5_state_pressure_delta_idx:
-- one state's daily highs, ordered by value.
CREATE INDEX IF NOT EXISTS era5_state_pressure_temp_idx
  ON era5_state_pressure (state_abbr, sampling_version, temp_2m_max_f)
  WHERE temp_2m_max_f IS NOT NULL;

COMMENT ON TABLE era5_state_pressure IS
  'ERA5 (0.25°) daily per-state surface series, 1979+, five sample points averaged: '
  'MSL pressure in hPa and 2 m temperature in °F. Name is historical — it carried '
  'pressure first. Sampling scheme frozen and versioned — see '
  'docs/ERA5-SAMPLING-SCHEME.md and era5_sampling_points. Amendment 1.3 Rulings 3 and 3a.';
COMMENT ON COLUMN era5_state_pressure.temp_2m_max_f IS
  'Daily high °F, mean of the sample points'' daily maxima. The pool half of the rarity '
  'map''s rank — the same quantity as the live temp_high_f, built the same way.';
COMMENT ON COLUMN era5_state_pressure.temp_2m_mean_f IS
  'ERA5 daily mean °F — the 24-hour integral, NOT (max+min)/2. Not reconstructible '
  'from the other two.';
COMMENT ON COLUMN era5_state_pressure.temp_spread_f IS
  'max-min across the sample points'' daily highs — the receipt for the word '
  '"statewide". Wide by design for temperature; see docs/ERA5-SAMPLING-SCHEME.md §3.';
COMMENT ON COLUMN era5_state_pressure.n_points_temp IS
  'How many sample points reported a daily high. NULL means the row predates the '
  'temperature widening; 0 means the widened pipe ran and got nothing.';
