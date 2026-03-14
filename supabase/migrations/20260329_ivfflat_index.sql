-- Switch from HNSW to IVFFlat — uses far less memory to build
-- IVFFlat is slightly less accurate but builds reliably at any table size

SET statement_timeout = '300s';
SET maintenance_work_mem = '64MB';
SET search_path = public, extensions;

-- Drop the broken HNSW index
DROP INDEX IF EXISTS idx_hunt_knowledge_embedding;

-- Create IVFFlat index with 100 lists (good for 80K-500K rows)
-- Rule of thumb: lists = sqrt(rows), so sqrt(80000) ≈ 283, but 100 is fine for our size
CREATE INDEX idx_hunt_knowledge_embedding
  ON hunt_knowledge USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

RESET search_path;
RESET maintenance_work_mem;
RESET statement_timeout;
