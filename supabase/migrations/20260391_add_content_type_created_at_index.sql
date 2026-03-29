-- Add compound index on (content_type, created_at) for hunt_knowledge
-- This makes content_type + date range queries fast (used by brain journal, collision feed)
-- Without this, every query on 3.2M rows requires a sequential scan

SET statement_timeout = '600s';

-- Drop potentially invalid index from interrupted CONCURRENTLY build
DROP INDEX IF EXISTS idx_hunt_knowledge_type_created;

-- Recreate non-concurrently (brief table lock, but completes reliably)
CREATE INDEX idx_hunt_knowledge_type_created
  ON hunt_knowledge (content_type, created_at DESC);

RESET statement_timeout;
