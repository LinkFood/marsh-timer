-- Minimal vector search RPC for pattern-link-worker.
-- search_hunt_knowledge_v3 has wrapping logic (recency boost, signal_weight)
-- that adds overhead and times out on 7M-row brain. This is the bare minimum:
-- IVFFlat ORDER BY <=> with simple filters.

SET search_path = public, extensions;

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
LANGUAGE sql
STABLE
AS $$
  SELECT
    hk.id,
    hk.content_type,
    hk.state_abbr,
    1 - (hk.embedding <=> query_embedding) as similarity
  FROM hunt_knowledge hk
  WHERE hk.embedding IS NOT NULL
    AND (filter_state_abbr IS NULL OR hk.state_abbr = filter_state_abbr)
    AND (exclude_id IS NULL OR hk.id != exclude_id)
    AND hk.content_type NOT IN (
      'alert-grade', 'convergence-score', 'compound-risk-alert',
      'arc-fingerprint', 'arc-grade-reasoning', 'alert-calibration',
      'anomaly-alert', 'state-brief', 'brain-narrative',
      'daily-discovery', 'daily-digest', 'du_report', 'du_alert',
      'multi-species-convergence', 'forecast-accuracy',
      'convergence-report-card', 'migration-report-card', 'ai-synthesis'
    )
  ORDER BY hk.embedding <=> query_embedding
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION simple_vector_search(vector, int, text, uuid) TO anon, authenticated, service_role;

RESET search_path;
