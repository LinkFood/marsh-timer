-- Schedule IVFFlat index rebuild via pg_cron (runs inside DB, no proxy timeout)
-- Brain is currently unindexed after failed migration dropped the old one
-- lists=1000 with probes=40 gives good recall at 6.95M rows

-- One-shot cron job: runs in 1 minute, then auto-unschedules
SELECT cron.schedule(
  'rebuild-ivfflat-index',
  '* * * * *',
  $cron$
    SET maintenance_work_mem = '1GB';
    SET search_path = public, extensions;
    DROP INDEX IF EXISTS idx_hunt_knowledge_embedding;
    CREATE INDEX idx_hunt_knowledge_embedding
      ON hunt_knowledge USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 1000);
    RESET search_path;
    RESET maintenance_work_mem;
    SELECT cron.unschedule('rebuild-ivfflat-index');
  $cron$
);
