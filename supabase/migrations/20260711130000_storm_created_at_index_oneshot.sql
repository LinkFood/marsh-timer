-- Partial index for the link worker's storm-event recent-window gather —
-- SERVER-SIDE one-shot (same pattern as 20260707110000). The worker's
-- `.gte(created_at, bound).limit(n)` on the 3.5M-row storm-event lane 57014'd
-- every run (storm-event was dropped from its live list 2026-07-11, 3dff281).
-- This index makes the gather instant; the worker re-adds the lane after.

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.run_storm_created_idx()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_storm_created_at') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storm-created-idx-oneshot') THEN
      PERFORM cron.unschedule('storm-created-idx-oneshot');
    END IF;
    RETURN 'already built';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('storm-created-idx')) THEN
    RETURN 'another build is in progress';
  END IF;
  PERFORM set_config('maintenance_work_mem', '1GB', false);
  PERFORM set_config('lock_timeout', '55s', false);
  EXECUTE $ddl$
    CREATE INDEX idx_storm_created_at
    ON hunt_knowledge (created_at DESC)
    WHERE content_type = 'storm-event'
  $ddl$;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storm-created-idx-oneshot') THEN
    PERFORM cron.unschedule('storm-created-idx-oneshot');
  END IF;
  RETURN 'built';
END;
$fn$;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storm-created-idx-oneshot') THEN
    PERFORM cron.unschedule('storm-created-idx-oneshot');
  END IF;
  PERFORM cron.schedule(
    'storm-created-idx-oneshot',
    '30 seconds',
    $cron$ SET statement_timeout = 0; SET maintenance_work_mem = '1GB'; SELECT public.run_storm_created_idx(); $cron$
  );
END;
$do$;

RESET search_path;
