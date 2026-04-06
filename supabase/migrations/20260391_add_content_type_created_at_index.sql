-- Use pg_cron to build the index asynchronously (avoids migration timeout on 3.2M rows)
-- The cron job runs once, creates the index, then unschedules itself

SELECT cron.schedule(
  'build-content-type-index',
  '* * * * *',
  $cron$
  DO $$
  BEGIN
    -- Drop invalid index if exists from interrupted CONCURRENTLY build
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hunt_knowledge_type_created') THEN
      EXECUTE 'DROP INDEX idx_hunt_knowledge_type_created';
    END IF;
    -- Build the index
    EXECUTE 'CREATE INDEX idx_hunt_knowledge_type_created ON hunt_knowledge (content_type, created_at DESC)';
    -- Unschedule this job after success
    PERFORM cron.unschedule('build-content-type-index');
  END $$;
  $cron$
);
