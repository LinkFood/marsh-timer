-- Move du_report entries to dedicated table to keep hunt_knowledge lean and fast
-- Using statement_timeout override for bulk operations

SET statement_timeout = '120s';

-- 1. Create dedicated DU table (same schema)
CREATE TABLE IF NOT EXISTS hunt_knowledge_du (LIKE hunt_knowledge INCLUDING ALL);

-- 2. Move du_report rows in batches using a loop
DO $$
DECLARE
  batch_size INT := 5000;
  moved INT := 0;
  total INT;
BEGIN
  SELECT count(*) INTO total FROM hunt_knowledge WHERE content_type = 'du_report';
  RAISE NOTICE 'Moving % du_report rows in batches of %', total, batch_size;

  LOOP
    WITH to_move AS (
      SELECT id FROM hunt_knowledge
      WHERE content_type = 'du_report'
      LIMIT batch_size
    ),
    inserted AS (
      INSERT INTO hunt_knowledge_du
      SELECT hk.* FROM hunt_knowledge hk
      JOIN to_move tm ON hk.id = tm.id
      RETURNING 1
    )
    DELETE FROM hunt_knowledge
    WHERE id IN (SELECT id FROM to_move);

    GET DIAGNOSTICS moved = ROW_COUNT;
    EXIT WHEN moved = 0;

    RAISE NOTICE 'Moved batch of % rows', moved;
  END LOOP;
END $$;

-- 3. RLS on new table
ALTER TABLE hunt_knowledge_du ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access du" ON hunt_knowledge_du FOR ALL USING (true);

-- 4. Drop the partial index (no longer needed)
DROP INDEX IF EXISTS idx_hunt_knowledge_embedding_no_du;

-- 5. HNSW index on DU table
SET search_path = public, extensions;
SET maintenance_work_mem = '128MB';
CREATE INDEX IF NOT EXISTS idx_hunt_knowledge_du_embedding
  ON hunt_knowledge_du USING hnsw (embedding vector_cosine_ops)
  WITH (m = 8, ef_construction = 32);
RESET search_path;
RESET maintenance_work_mem;

RESET statement_timeout;
