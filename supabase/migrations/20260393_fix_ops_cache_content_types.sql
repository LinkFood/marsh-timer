-- Fix: hunt_ops_refresh_cache times out scanning all 3.2M+ rows for content type counts
-- Change to last 30 days only (still shows all active types, much faster with index)

CREATE OR REPLACE FUNCTION hunt_ops_refresh_cache()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_growth jsonb;
  v_types jsonb;
BEGIN
  -- Growth by day (14 days) — uses index on created_at
  SELECT jsonb_agg(row_to_json(r)) INTO v_growth
  FROM (
    SELECT DATE(created_at) AS day, COUNT(*) AS count
    FROM hunt_knowledge
    WHERE created_at > NOW() - INTERVAL '14 days'
    GROUP BY DATE(created_at)
    ORDER BY day
  ) r;

  -- Content types (last 30 days, not ALL time — uses compound index)
  SELECT jsonb_agg(row_to_json(r)) INTO v_types
  FROM (
    SELECT content_type AS type, COUNT(*) AS count, MAX(created_at) AS latest
    FROM hunt_knowledge
    WHERE created_at > NOW() - INTERVAL '30 days'
    GROUP BY content_type
    ORDER BY count DESC
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
