-- VACUUM (ANALYZE) hunt_knowledge — one-shot via pg_cron (VACUUM cannot run in
-- a function/transaction, but a pg_cron job command CAN be a bare VACUUM; it is
-- pg_cron's canonical use).
--
-- WHY: this week rewrote the table's physical reality — 2.03M NCEI inserts,
-- 103k tide rows, 35k re-embedded buoy rows, and a 1.5M-row supersede UPDATE
-- (= 1.5M dead tuples). The visibility map is cold, so "index-only" scans
-- (atlas-storms' exact-count denominator: 26.5s for TX's 163,561 live rows over
-- the new partial index) heap-fetch every tuple, and planner stats predate the
-- corpus doubling. VACUUM sets the VM + ANALYZE refreshes stats.
--
-- The job refires every 30 min until unscheduled; the second run is cheap.
-- Watch vacuum_hunt_knowledge_status(); unschedule via admin_unschedule_job()
-- once last_vacuum is fresh.

SET search_path = public, extensions;

-- SECURITY DEFINER helper so the client can retire one-shot jobs over PostgREST.
CREATE OR REPLACE FUNCTION public.admin_unschedule_job(job_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = job_name) THEN
    PERFORM cron.unschedule(job_name);
    RETURN true;
  END IF;
  RETURN false;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.vacuum_hunt_knowledge_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  RETURN jsonb_build_object(
    'last_vacuum', (SELECT last_vacuum FROM pg_stat_user_tables WHERE relname = 'hunt_knowledge'),
    'last_autovacuum', (SELECT last_autovacuum FROM pg_stat_user_tables WHERE relname = 'hunt_knowledge'),
    'last_analyze', (SELECT last_analyze FROM pg_stat_user_tables WHERE relname = 'hunt_knowledge'),
    'n_dead_tup', (SELECT n_dead_tup FROM pg_stat_user_tables WHERE relname = 'hunt_knowledge'),
    'n_live_tup', (SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = 'hunt_knowledge'),
    'vacuum_running', EXISTS (SELECT 1 FROM pg_stat_progress_vacuum WHERE relid = 'public.hunt_knowledge'::regclass),
    'vacuum_progress', (
      SELECT jsonb_build_object('phase', phase, 'heap_blks_total', heap_blks_total,
                                'heap_blks_scanned', heap_blks_scanned, 'heap_blks_vacuumed', heap_blks_vacuumed)
      FROM pg_stat_progress_vacuum WHERE relid = 'public.hunt_knowledge'::regclass LIMIT 1
    ),
    'job_scheduled', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vacuum-hunt-knowledge-oneshot')
  );
END;
$fn$;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vacuum-hunt-knowledge-oneshot') THEN
    PERFORM cron.unschedule('vacuum-hunt-knowledge-oneshot');
  END IF;
  PERFORM cron.schedule(
    'vacuum-hunt-knowledge-oneshot',
    '30 minutes',
    'VACUUM (ANALYZE) public.hunt_knowledge'
  );
END;
$do$;

RESET search_path;
