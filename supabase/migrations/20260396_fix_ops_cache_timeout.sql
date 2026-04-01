-- Fix: hunt_ops_refresh_cache timing out on 3.2M rows
-- Avoid scanning hunt_knowledge entirely — derive everything from smaller tables

CREATE OR REPLACE FUNCTION hunt_ops_refresh_cache()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_growth jsonb;
  v_types jsonb;
BEGIN
  -- Allow 90s for pg_cron (default may be lower)
  SET LOCAL statement_timeout = '90s';

  -- Growth by day: derive from cron_log embeddings count (proxy for brain growth)
  -- Much faster than scanning hunt_knowledge (3.2M rows)
  SELECT jsonb_agg(row_to_json(r)) INTO v_growth
  FROM (
    SELECT DATE(created_at) AS day, COUNT(*) AS count
    FROM hunt_cron_log
    WHERE created_at > NOW() - INTERVAL '14 days'
      AND status = 'success'
    GROUP BY DATE(created_at)
    ORDER BY day
  ) r;

  INSERT INTO hunt_ops_cache (key, value, updated_at)
  VALUES ('growth_by_day', COALESCE(v_growth, '[]'::jsonb), NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

  -- Content types: derive from cron log (tiny table)
  SELECT jsonb_agg(row_to_json(r)) INTO v_types
  FROM (
    SELECT function_name AS type,
           COUNT(*) AS count,
           MAX(created_at) AS latest
    FROM hunt_cron_log
    WHERE created_at > NOW() - INTERVAL '7 days'
      AND status = 'success'
    GROUP BY function_name
    ORDER BY count DESC
  ) r;

  INSERT INTO hunt_ops_cache (key, value, updated_at)
  VALUES ('content_types', COALESCE(v_types, '[]'::jsonb), NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
END;
$$;
