-- Temporary helper to check index status via REST API
CREATE OR REPLACE FUNCTION check_pg_indexes(table_name_filter text DEFAULT 'hunt_knowledge')
RETURNS TABLE (
  indexname text,
  indexdef text,
  idx_size text
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    i.indexname::text,
    i.indexdef::text,
    pg_size_pretty(pg_relation_size(i.indexname::regclass))::text AS idx_size
  FROM pg_indexes i
  WHERE i.tablename = table_name_filter
  ORDER BY i.indexname;
$$;
