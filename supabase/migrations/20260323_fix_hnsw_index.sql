-- Fix HNSW index: increase maintenance_work_mem for index build
-- The partial index only got 12K tuples because work_mem was too low

-- First increase work_mem for this session
SET maintenance_work_mem = '512MB';

-- Drop and recreate the partial index with adequate memory
SET search_path = public, extensions;

DROP INDEX IF EXISTS idx_hunt_knowledge_embedding_no_du;

CREATE INDEX idx_hunt_knowledge_embedding_no_du
  ON hunt_knowledge USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE content_type != 'du_report';

RESET search_path;

-- Also rebuild the full index (it may also be degraded)
SET search_path = public, extensions;

DROP INDEX IF EXISTS idx_hunt_knowledge_embedding;

CREATE INDEX idx_hunt_knowledge_embedding
  ON hunt_knowledge USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

RESET search_path;

RESET maintenance_work_mem;
