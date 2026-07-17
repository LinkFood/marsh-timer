-- PLANTING CLIMATOLOGY — the almanac's most-used table, done our way.
--
-- Per-state frost climatology computed one-time by scripts/frost-climatology.ts
-- from the ghcn-daily lane's state-day rows (metadata.min_temp_f = the coldest
-- station reading anywhere in the state that day, NOAA ACIS, 1950-2025 = 76
-- years). For each state-year: the LAST spring day <=32F before Jul 1 and the
-- FIRST fall day <=32F after Jul 1; then per-state distributions.
--
-- HONESTY (house law, rendered on /plant): state-level minima mean "somewhere
-- in the state froze" — a backyard in Baltimore thaws before Garrett County
-- does. Distributions, never a single date. Every number traceable to rows.
--
-- Writes come only from the service role (script upsert). Anon is read-only.

CREATE TABLE IF NOT EXISTS planting_climatology (
  state_abbr  text PRIMARY KEY,
  n_years     int NOT NULL,          -- state-years with ghcn-daily coverage
  spring      jsonb NOT NULL,        -- last spring freeze distribution:
                                     -- {n_freeze_years, no_freeze_years,
                                     --  median_doy, p10_doy, p90_doy,
                                     --  median_date, p10_date, p90_date,
                                     --  earliest_doy, earliest_date, earliest_year,
                                     --  latest_doy, latest_date, latest_year,
                                     --  pct_passed_by_p90}
  fall        jsonb NOT NULL,        -- first fall freeze distribution (same shape)
  season      jsonb NOT NULL,        -- growing-season length (days between the two):
                                     -- {n_years, median_days, p10_days, p90_days,
                                     --  shortest_days, shortest_year,
                                     --  longest_days, longest_year}
  source      text NOT NULL DEFAULT 'ghcn-daily state-day minima (NOAA ACIS), 1950-2025',
  computed_at timestamptz NOT NULL DEFAULT now()
);

-- Anon read exposure — /plant reads this table directly through the anon
-- client (mirrors morning_lines): a SELECT policy and a SELECT grant, nothing
-- else; writes come only from the service role (which bypasses RLS).
ALTER TABLE planting_climatology ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read planting_climatology" ON planting_climatology;
CREATE POLICY "Public read planting_climatology" ON planting_climatology FOR SELECT USING (true);
GRANT SELECT ON planting_climatology TO anon, authenticated;
