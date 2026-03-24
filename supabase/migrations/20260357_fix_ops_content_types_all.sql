-- Fix: show ALL content types in ops dashboard, not just top 20 from last 90 days

-- Update the content types function to return all types (no LIMIT, no time filter)
CREATE OR REPLACE FUNCTION hunt_ops_content_types()
RETURNS TABLE(type text, count bigint, latest timestamptz)
LANGUAGE sql
STABLE
AS $$
  SELECT content_type AS type, COUNT(*) AS count, MAX(created_at) AS latest
  FROM hunt_knowledge
  GROUP BY content_type
  ORDER BY count DESC;
$$;

-- Update the cache refresh to use the updated function (no LIMIT 20)
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

  -- Content types (ALL types, full counts)
  SELECT jsonb_agg(row_to_json(r)) INTO v_types
  FROM (
    SELECT content_type AS type, COUNT(*) AS count, MAX(created_at) AS latest
    FROM hunt_knowledge
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

-- Refresh cache now with new logic
SELECT hunt_ops_refresh_cache();
