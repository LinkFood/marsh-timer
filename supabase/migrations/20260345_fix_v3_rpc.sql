-- Fix v3 RPC: remove hnsw.ef_search (we use IVFFlat, not HNSW)
SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION search_hunt_knowledge_v3(
  query_embedding vector(512),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10,
  filter_content_types text[] DEFAULT NULL,
  filter_state_abbr text DEFAULT NULL,
  filter_species text DEFAULT NULL,
  filter_date_from date DEFAULT NULL,
  filter_date_to date DEFAULT NULL,
  recency_weight float DEFAULT 0.0,
  exclude_du_report boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  content_type text,
  tags text[],
  state_abbr text,
  species text,
  effective_date date,
  metadata jsonb,
  similarity float,
  signal_weight float
)
LANGUAGE plpgsql
AS $$
BEGIN
  SET LOCAL statement_timeout = '30s';

  RETURN QUERY
  SELECT
    hk.id,
    hk.title,
    hk.content,
    hk.content_type,
    hk.tags,
    hk.state_abbr,
    hk.species,
    hk.effective_date,
    hk.metadata,
    (1 - (hk.embedding <=> query_embedding)) * COALESCE(hk.signal_weight, 1.0) AS similarity,
    COALESCE(hk.signal_weight, 1.0) AS signal_weight
  FROM hunt_knowledge hk
  WHERE
    hk.embedding IS NOT NULL
    AND (1 - (hk.embedding <=> query_embedding)) > match_threshold
    AND (filter_content_types IS NULL OR hk.content_type = ANY(filter_content_types))
    AND (filter_state_abbr IS NULL OR hk.state_abbr = filter_state_abbr)
    AND (filter_species IS NULL OR hk.species = filter_species)
    AND (filter_date_from IS NULL OR hk.effective_date >= filter_date_from)
    AND (filter_date_to IS NULL OR hk.effective_date <= filter_date_to)
    AND (NOT exclude_du_report OR hk.content_type NOT IN ('du_report', 'du_alert'))
  ORDER BY
    (1 - (hk.embedding <=> query_embedding)) * COALESCE(hk.signal_weight, 1.0) *
    CASE WHEN recency_weight > 0 AND hk.effective_date IS NOT NULL
      THEN (1.0 + recency_weight * exp(-1.0 * (CURRENT_DATE - hk.effective_date)::float / 30.0))
      ELSE 1.0
    END
    DESC
  LIMIT match_count;
END;
$$;

RESET search_path;
