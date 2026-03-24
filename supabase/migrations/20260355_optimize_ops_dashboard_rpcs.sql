-- Optimize ops dashboard: cache table for expensive stats on 2.4M+ row brain

-- Cache table for precomputed ops stats
CREATE TABLE IF NOT EXISTS hunt_ops_cache (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

-- BRIN index on created_at for time-range queries
CREATE INDEX IF NOT EXISTS idx_hunt_knowledge_created_at_brin
  ON hunt_knowledge USING brin (created_at);

-- Growth by day: reduce from 30 to 14 days
CREATE OR REPLACE FUNCTION hunt_ops_growth_by_day()
RETURNS TABLE(day date, count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT DATE(created_at) AS day, COUNT(*) AS count
  FROM hunt_knowledge
  WHERE created_at > NOW() - INTERVAL '14 days'
  GROUP BY DATE(created_at)
  ORDER BY day;
$$;

-- Content types: scope to last 90 days + top 20
CREATE OR REPLACE FUNCTION hunt_ops_content_types()
RETURNS TABLE(type text, count bigint, latest timestamptz)
LANGUAGE sql
STABLE
AS $$
  SELECT content_type AS type, COUNT(*) AS count, MAX(created_at) AS latest
  FROM hunt_knowledge
  WHERE created_at > NOW() - INTERVAL '90 days'
  GROUP BY content_type
  ORDER BY count DESC
  LIMIT 20;
$$;

-- RPC to refresh the ops cache (called by cron or on-demand)
CREATE OR REPLACE FUNCTION hunt_ops_refresh_cache()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_growth jsonb;
  v_types jsonb;
BEGIN
  -- Growth by day (14 days)
  SELECT jsonb_agg(row_to_json(r)) INTO v_growth
  FROM (
    SELECT DATE(created_at) AS day, COUNT(*) AS count
    FROM hunt_knowledge
    WHERE created_at > NOW() - INTERVAL '14 days'
    GROUP BY DATE(created_at)
    ORDER BY day
  ) r;

  -- Content types (90 days, top 20)
  SELECT jsonb_agg(row_to_json(r)) INTO v_types
  FROM (
    SELECT content_type AS type, COUNT(*) AS count, MAX(created_at) AS latest
    FROM hunt_knowledge
    WHERE created_at > NOW() - INTERVAL '90 days'
    GROUP BY content_type
    ORDER BY count DESC
    LIMIT 20
  ) r;

  -- Upsert cache
  INSERT INTO hunt_ops_cache (key, value, updated_at)
  VALUES ('growth_by_day', COALESCE(v_growth, '[]'::jsonb), NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

  INSERT INTO hunt_ops_cache (key, value, updated_at)
  VALUES ('content_types', COALESCE(v_types, '[]'::jsonb), NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
END;
$$;

-- Seed the cache with initial data
SELECT hunt_ops_refresh_cache();

-- Schedule hourly refresh via pg_cron
SELECT cron.schedule(
  'hunt-ops-cache-refresh',
  '17 * * * *',
  $cron$SELECT hunt_ops_refresh_cache()$cron$
);
