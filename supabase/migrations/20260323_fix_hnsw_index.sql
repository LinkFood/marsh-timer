-- Fix HNSW index: partial index built successfully with 47K tuples
-- Full index rebuild skipped (times out on this plan — needs Supabase Pro for larger work_mem)
-- The partial index covers all non-du_report rows which is the primary search path

-- Mark as applied — the partial index was already created in the previous attempt
-- The full index (idx_hunt_knowledge_embedding) was dropped but the partial index
-- (idx_hunt_knowledge_embedding_no_du) handles the exclude_du_report=true path

-- Recreate full index with smaller ef_construction to fit in memory
SET maintenance_work_mem = '128MB';
SET search_path = public, extensions;

CREATE INDEX IF NOT EXISTS idx_hunt_knowledge_embedding
  ON hunt_knowledge USING hnsw (embedding vector_cosine_ops)
  WITH (m = 8, ef_construction = 32);

RESET search_path;
RESET maintenance_work_mem;
