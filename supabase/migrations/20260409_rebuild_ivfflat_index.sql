-- Rebuild IVFFlat index for ~6.95M rows
-- Old: lists=100 (tuned for 80K-500K). New: lists=2636 (sqrt(6.95M)), probes=51 (sqrt(2636))
-- Index rebuild will cause brief slower vector searches during build

SET statement_timeout = '0';
SET maintenance_work_mem = '512MB';
SET search_path = public, extensions;

-- Drop and recreate with correct lists for current brain size
-- Previous DROP already ran (migration partially applied), but IF EXISTS makes it safe
DROP INDEX IF EXISTS idx_hunt_knowledge_embedding;

CREATE INDEX idx_hunt_knowledge_embedding
  ON hunt_knowledge USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 2636);

-- Update v3 RPC with new probes value (sqrt(2636) = 51)
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
  SET LOCAL ivfflat.probes = 51;

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
    -- Inner query: IVFFlat index scan via ORDER BY embedding <=> query_embedding
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
      AND (filter_date_from IS NULL OR hk.effective_date >= filter_date_from)
      AND (filter_date_to IS NULL OR hk.effective_date <= filter_date_to)
      AND (NOT exclude_du_report OR hk.content_type NOT IN ('du_report', 'du_alert'))
    ORDER BY hk.embedding <=> query_embedding
    LIMIT match_count * 4
  ) sub
  WHERE sub.raw_similarity > match_threshold
  ORDER BY sub.similarity * sub.recency_boost DESC
  LIMIT match_count;
END;
$$;

RESET search_path;
RESET maintenance_work_mem;
RESET statement_timeout;
