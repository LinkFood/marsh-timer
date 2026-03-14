-- Rebuild HNSW index with smaller parameters that fit in memory
-- Table is now ~80K rows (was 110K), should be manageable

SET statement_timeout = '300s';
SET maintenance_work_mem = '64MB';
SET search_path = public, extensions;

-- Drop all existing vector indexes
DROP INDEX IF EXISTS idx_hunt_knowledge_embedding;
DROP INDEX IF EXISTS idx_hunt_knowledge_embedding_no_du;

-- Rebuild with conservative params (m=8 uses less memory than m=16)
CREATE INDEX idx_hunt_knowledge_embedding
  ON hunt_knowledge USING hnsw (embedding vector_cosine_ops)
  WITH (m = 8, ef_construction = 32);

RESET search_path;
RESET maintenance_work_mem;
RESET statement_timeout;
