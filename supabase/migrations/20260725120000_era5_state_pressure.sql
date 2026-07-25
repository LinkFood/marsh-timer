-- ERA5 STATE PRESSURE — the frequency card's substrate (Amendment 1.3, Ruling 3).
--
-- The v1 card counts pressure falls. Nothing in the archive could answer it:
-- `ghcn-daily` carries no pressure field at all, and `hunt_weather_history
-- .pressure_avg_msl` begins 2020-09-01 — five years, against a §6 floor of ten.
-- ERA5 is a reanalysis, physically consistent and gridded, so it does not carry
-- the station-network inhomogeneity (6,121 → 7,771 stations) that sits underneath
-- the temperature analysis and that no downstream statistic can remove.
--
-- Written one-time by scripts/era5/backfill-era5-pressure.ts from
-- archive-api.open-meteo.com, 1979-forward, 50 states, five sample points per
-- state averaged. Service role writes; anon is read-only, matching
-- planting_climatology (20260717120000) verbatim.
--
-- ── WHY sampling_version IS IN THE PRIMARY KEY ───────────────────────────────
-- Ruling 3a: "If those points ever move, every historical number moves with them
-- and the archive silently stops being comparable to itself — invisible for a
-- year, then unfixable."
--
-- Making sampling_version part of the key is the structural answer to that. A v2
-- scheme cannot overwrite v1; it lands beside it, both tiers queryable, both
-- labelled, and a query that forgets to pin a version returns duplicate days
-- loudly instead of a silently blended series. The frozen coordinates themselves
-- live in era5_sampling_points below, and every row carries the scheme_hash they
-- were measured under, so a row can always be traced to the exact five
-- coordinates that produced it.
--
-- ── HONESTY (house law, and the words that will appear on the card) ──────────
-- "Maryland statewide" here means the mean of five ERA5 grid cells inside
-- Maryland, not a reading at one point and not every acre. `spread_hpa` is the
-- receipt: the max-minus-min across those five cells that day. Measured over MD
-- 1979 it runs median 1.1 hPa, p90 2.3, max 5.2 — five cells describing one
-- weather system, which is the condition under which the word "statewide" is
-- fair. `n_points` says how many of the five actually reported.

-- ── The frozen sampling scheme ───────────────────────────────────────────────
-- The coordinates, stored — not just the rule that generates them. A future run
-- can prove it used the same points instead of asserting it.
CREATE TABLE IF NOT EXISTS era5_sampling_points (
  sampling_version smallint         NOT NULL,
  state_abbr       text             NOT NULL,
  idx              smallint         NOT NULL,  -- 0..4, the rule's fixed candidate order
  role             text             NOT NULL,  -- C | NW | NE | SW | SE
  lon              double precision NOT NULL,  -- 4dp, exactly as sent to the API
  lat              double precision NOT NULL,
  resolution       text             NOT NULL,  -- pattern | repaired | fallback
  repair_rings     smallint         NOT NULL DEFAULT 0,
  scheme_hash      bigint           NOT NULL,  -- djb2 over all 250 points
  geometry_source  text             NOT NULL,
  rule_doc         text             NOT NULL DEFAULT 'docs/ERA5-SAMPLING-SCHEME.md',
  frozen_at        timestamptz      NOT NULL DEFAULT now(),
  PRIMARY KEY (sampling_version, state_abbr, idx),
  CONSTRAINT era5_sampling_points_role_ck
    CHECK (role IN ('C','NW','NE','SW','SE')),
  CONSTRAINT era5_sampling_points_resolution_ck
    CHECK (resolution IN ('pattern','repaired','fallback'))
);

-- ── The series ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS era5_state_pressure (
  state_abbr         text     NOT NULL,
  day                date     NOT NULL,
  sampling_version   smallint NOT NULL,

  pressure_msl_mean  real,               -- hPa, mean of the points' daily means
  pressure_msl_min   real,               -- hPa, mean of the points' daily minima
  pressure_msl_max   real,               -- hPa, mean of the points' daily maxima
  -- mean(day) − mean(day−1). THE v1 METRIC: a front is a pressure fall before it
  -- is anything else. NULL only where the prior day is genuinely absent; the
  -- backfill fetches one lead day per year chunk so January 1 is not a
  -- systematic hole 47 times over.
  pressure_delta_24h real,

  n_points           smallint NOT NULL,  -- of POINTS_PER_STATE that reported
  spread_hpa         real,               -- max−min across the points' daily means

  scheme_hash        bigint   NOT NULL,
  source             text     NOT NULL,
  source_url         text     NOT NULL,  -- the exact request, coordinates included
  source_event_id    text     NOT NULL,  -- era5-pressure:v{ver}:{ST}:{YYYY-MM-DD}
  fetched_at         timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (state_abbr, day, sampling_version),
  CONSTRAINT era5_state_pressure_n_points_ck CHECK (n_points > 0),
  -- 1979 floor, enforced in the database and not only in the script (Ruling 3).
  -- Lifting it is a deliberate migration, which is the point.
  CONSTRAINT era5_state_pressure_v1_floor_ck CHECK (day >= DATE '1979-01-01'),
  -- Surface pressure outside 850–1100 hPa is not weather, it is a parse bug.
  CONSTRAINT era5_state_pressure_plausible_ck CHECK (
    (pressure_msl_mean IS NULL OR pressure_msl_mean BETWEEN 850 AND 1100) AND
    (pressure_msl_min  IS NULL OR pressure_msl_min  BETWEEN 850 AND 1100) AND
    (pressure_msl_max  IS NULL OR pressure_msl_max  BETWEEN 850 AND 1100)
  )
);

-- The dedup key, unique in its own right so a second writer cannot duplicate a
-- day under a different route into the table.
CREATE UNIQUE INDEX IF NOT EXISTS era5_state_pressure_event_uq
  ON era5_state_pressure (source_event_id);

-- Cross-state reads for one day (the board's day-0 lane, the map).
CREATE INDEX IF NOT EXISTS era5_state_pressure_day_idx
  ON era5_state_pressure (day, sampling_version);

-- The card's actual query shape: one state's falls, ordered by depth.
CREATE INDEX IF NOT EXISTS era5_state_pressure_delta_idx
  ON era5_state_pressure (state_abbr, sampling_version, pressure_delta_24h)
  WHERE pressure_delta_24h IS NOT NULL;

-- ── Grants — read-only anon, copied from planting_climatology:37-40 ──────────
-- Writes come only from the service role, which bypasses RLS. Anon write grants
-- were revoked cluster-wide on 2026-07-25 (20260725001500); nothing below
-- reopens them.
ALTER TABLE era5_state_pressure  ENABLE ROW LEVEL SECURITY;
ALTER TABLE era5_sampling_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read era5_state_pressure" ON era5_state_pressure;
CREATE POLICY "Public read era5_state_pressure" ON era5_state_pressure FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read era5_sampling_points" ON era5_sampling_points;
CREATE POLICY "Public read era5_sampling_points" ON era5_sampling_points FOR SELECT USING (true);

GRANT SELECT ON era5_state_pressure  TO anon, authenticated;
GRANT SELECT ON era5_sampling_points TO anon, authenticated;

COMMENT ON TABLE era5_state_pressure IS
  'ERA5 (0.25°) daily MSL pressure per state, 1979+, five sample points averaged. '
  'Sampling scheme frozen and versioned — see docs/ERA5-SAMPLING-SCHEME.md and '
  'era5_sampling_points. Amendment 1.3 Rulings 3 and 3a.';
COMMENT ON TABLE era5_sampling_points IS
  'The frozen coordinates behind era5_state_pressure, per sampling_version. '
  'Ruling 3a: store the points, not only the rule.';
COMMENT ON COLUMN era5_state_pressure.spread_hpa IS
  'max-min across the sample points that day — the receipt for the word "statewide".';
