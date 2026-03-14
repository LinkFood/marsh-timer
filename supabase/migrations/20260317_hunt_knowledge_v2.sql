-- hunt_knowledge v2: species + effective_date columns, new indexes, v2 search RPC
-- Backwards-compatible: all new columns nullable, old RPC preserved as wrapper

-- 1. New columns
ALTER TABLE hunt_knowledge ADD COLUMN IF NOT EXISTS species text;
ALTER TABLE hunt_knowledge ADD COLUMN IF NOT EXISTS effective_date date;

-- 2. New indexes
CREATE INDEX IF NOT EXISTS idx_hunt_knowledge_species ON hunt_knowledge (species);
CREATE INDEX IF NOT EXISTS idx_hunt_knowledge_effective_date ON hunt_knowledge (effective_date);
CREATE INDEX IF NOT EXISTS idx_hunt_knowledge_tags ON hunt_knowledge USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_hunt_knowledge_type_state ON hunt_knowledge (content_type, state_abbr);

-- 3. New RPC: search_hunt_knowledge_v2
SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION search_hunt_knowledge_v2(
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
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  SET LOCAL hnsw.ef_search = 80;

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
    CASE
      WHEN recency_weight > 0 AND hk.effective_date IS NOT NULL THEN
        (1 - (hk.embedding <=> query_embedding)) * (1 + recency_weight * exp(-1.0 * EXTRACT(EPOCH FROM (CURRENT_DATE - hk.effective_date)) / (30 * 86400)))
      ELSE
        1 - (hk.embedding <=> query_embedding)
    END AS similarity
  FROM hunt_knowledge hk
  WHERE
    (1 - (hk.embedding <=> query_embedding)) > match_threshold
    AND (filter_content_types IS NULL OR hk.content_type = ANY(filter_content_types))
    AND (filter_state_abbr IS NULL OR hk.state_abbr = filter_state_abbr)
    AND (filter_species IS NULL OR hk.species = filter_species)
    AND (filter_date_from IS NULL OR hk.effective_date >= filter_date_from)
    AND (filter_date_to IS NULL OR hk.effective_date <= filter_date_to)
    AND (NOT exclude_du_report OR hk.content_type != 'du_report')
  ORDER BY similarity DESC
  LIMIT match_count;
END;
$$;

RESET search_path;

-- 4. Old RPC wrapper (preserves existing callers)
SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION search_hunt_knowledge_by_embedding(
  query_embedding vector(512),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  title text,
  content text,
  content_type text,
  tags text[],
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    v2.id,
    v2.title,
    v2.content,
    v2.content_type,
    v2.tags,
    v2.similarity
  FROM search_hunt_knowledge_v2(
    query_embedding := query_embedding,
    match_threshold := match_threshold,
    match_count := match_count
  ) v2;
END;
$$;

RESET search_path;
