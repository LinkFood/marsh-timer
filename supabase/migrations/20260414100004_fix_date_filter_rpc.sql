-- Fix date-filtered vector search timeouts on 7M-row brain.
-- Problem: date filters in the inner subquery force IVFFlat to scan
-- then filter, causing timeouts. Fix: move date filters to the outer
-- query and widen the inner LIMIT when date filters are present.
-- The inner query does pure vector search (fast via IVFFlat), returns
-- more candidates, and the outer query narrows by date + similarity.

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
DECLARE
  inner_limit int;
BEGIN
  SET LOCAL statement_timeout = '30s';
  SET LOCAL ivfflat.probes = 40;

  -- Widen inner scan when date filters are present, since most
  -- nearest-vector candidates won't fall in the target date range
  IF filter_date_from IS NOT NULL OR filter_date_to IS NOT NULL THEN
    inner_limit := match_count * 40;
  ELSE
    inner_limit := match_count * 4;
  END IF;

  RETURN QUERY
  SELECT
    sub.id,
    sub.title,
    sub.content,
    sub.content_type,
    sub.tags,
    sub.state_abbr,
    sub.species,
    sub.effective_date,
    sub.metadata,
    sub.similarity,
    sub.signal_weight
  FROM (
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
      COALESCE(hk.signal_weight, 1.0) AS signal_weight,
      (1 - (hk.embedding <=> query_embedding)) AS raw_similarity,
      CASE WHEN recency_weight > 0 AND hk.effective_date IS NOT NULL
        THEN (1.0 + recency_weight * exp(-1.0 * LEAST((CURRENT_DATE - hk.effective_date)::float, 365.0) / 30.0))
        ELSE 1.0
      END AS recency_boost
    FROM hunt_knowledge hk
    WHERE
      hk.embedding IS NOT NULL
      AND (filter_content_types IS NULL OR hk.content_type = ANY(filter_content_types))
      AND (filter_state_abbr IS NULL OR hk.state_abbr = filter_state_abbr)
      AND (filter_species IS NULL OR hk.species = filter_species)
      AND (NOT exclude_du_report OR hk.content_type NOT IN ('du_report', 'du_alert'))
    ORDER BY hk.embedding <=> query_embedding
    LIMIT inner_limit
  ) sub
  WHERE sub.raw_similarity > match_threshold
    AND (filter_date_from IS NULL OR sub.effective_date >= filter_date_from)
    AND (filter_date_to IS NULL OR sub.effective_date <= filter_date_to)
  ORDER BY sub.similarity * sub.recency_boost DESC
  LIMIT match_count;
END;
$$;

RESET search_path;
