-- Fast entries_today RPC using created_at index
-- The estimated count with date filter takes 23s because it scans too many rows.
-- This uses the index directly for a ballpark count.

CREATE OR REPLACE FUNCTION hunt_entries_today()
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT count(*)::bigint
  FROM hunt_knowledge
  WHERE created_at >= date_trunc('day', now());
$$;

GRANT EXECUTE ON FUNCTION hunt_entries_today() TO anon, authenticated, service_role;
