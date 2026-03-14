-- Move du_report entries to dedicated table to keep hunt_knowledge lean and fast
-- DU reports are valuable but 58K pins drowning out 40K of behavioral/weather/water knowledge

-- 1. Create dedicated DU table (same schema)
CREATE TABLE IF NOT EXISTS hunt_knowledge_du (LIKE hunt_knowledge INCLUDING ALL);

-- 2. Move du_report rows
INSERT INTO hunt_knowledge_du
SELECT * FROM hunt_knowledge WHERE content_type = 'du_report';

-- 3. Delete from main table
DELETE FROM hunt_knowledge WHERE content_type = 'du_report';

-- 4. HNSW index on DU table (separate, won't interfere)
SET search_path = public, extensions;
CREATE INDEX IF NOT EXISTS idx_hunt_knowledge_du_embedding
  ON hunt_knowledge_du USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
RESET search_path;

-- 5. Rebuild main table index (now only ~40K rows, will be fast)
SET search_path = public, extensions;
REINDEX INDEX idx_hunt_knowledge_embedding;
RESET search_path;

-- 6. RLS on new table
ALTER TABLE hunt_knowledge_du ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access du" ON hunt_knowledge_du FOR ALL USING (true);

-- 7. Drop the partial index (no longer needed — main table has no du_reports)
DROP INDEX IF EXISTS idx_hunt_knowledge_embedding_no_du;
