-- v3: SET LOCAL ivfflat.probes to a lower value for speed.
-- Default is 40 in search_hunt_knowledge_v3 — too slow on 7M rows.
-- Lower probes = faster search but less accurate (can miss real neighbors).
-- Better than nothing while we wait for full index rebuild.

SET search_path = public, extensions;

DROP FUNCTION IF EXISTS simple_vector_search(vector, int, text, uuid);

CREATE OR REPLACE FUNCTION simple_vector_search(
  query_embedding vector(512),
  match_count int DEFAULT 10,
  filter_state_abbr text DEFAULT NULL,
  exclude_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  content_type text,
  state_abbr text,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  SET LOCAL ivfflat.probes = 5;
  SET LOCAL statement_timeout = '15s';

  RETURN QUERY
  SELECT
    hk.id,
    hk.content_type,
    hk.state_abbr,
    1 - (hk.embedding <=> query_embedding) as similarity
  FROM hunt_knowledge hk
  WHERE hk.embedding IS NOT NULL
    AND (filter_state_abbr IS NULL OR hk.state_abbr = filter_state_abbr)
    AND (exclude_id IS NULL OR hk.id != exclude_id)
  ORDER BY hk.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

GRANT EXECUTE ON FUNCTION simple_vector_search(vector, int, text, uuid) TO anon, authenticated, service_role;

RESET search_path;
