-- Check IVFFlat index status — was it built or is it broken?
CREATE OR REPLACE FUNCTION check_hunt_knowledge_index()
RETURNS TABLE (
  index_name text,
  index_def text,
  is_valid boolean,
  is_ready boolean,
  size_bytes bigint
)
LANGUAGE sql
AS $$
  SELECT
    i.relname::text as index_name,
    pg_get_indexdef(i.oid)::text as index_def,
    ix.indisvalid as is_valid,
    ix.indisready as is_ready,
    pg_relation_size(i.oid) as size_bytes
  FROM pg_class t
  JOIN pg_index ix ON t.oid = ix.indrelid
  JOIN pg_class i ON ix.indexrelid = i.oid
  WHERE t.relname = 'hunt_knowledge'
    AND i.relname LIKE '%embedding%';
$$;

GRANT EXECUTE ON FUNCTION check_hunt_knowledge_index() TO anon, authenticated, service_role;
