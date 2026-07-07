-- Partial index for the LIVE storm layer — SERVER-SIDE via one-shot pg_cron job
-- (same self-unscheduling pattern as 20260705110000_rebuild_ivfflat_for_7m.sql).
--
-- WHY: the storm-event corpus doubled (1.5M superseded v1 + 2.03M live v2) and
-- every reader now filters `metadata->'superseded' IS NULL`. atlas-storms'
-- exact-count denominator (the honesty law) went from <0.7s index-supported to
-- 30s statement timeouts because the jsonb predicate forces heap checks across
-- the full doubled corpus. This index contains ONLY live storm rows, keyed the
-- way every reader asks: state, then date. Predicate uses the `->` form to match
-- PostgREST's `.is('metadata->superseded', null)` exactly (planner implication).
--
-- Plain CREATE INDEX (not CONCURRENTLY — plpgsql runs in a transaction): writes
-- to hunt_knowledge pause for the build (~minutes for a partial btree); crons
-- retry. Advisory lock + exists-check make repeat firings no-ops.

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.run_storm_partial_index()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_storm_live_state_date') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storm-partial-index-oneshot') THEN
      PERFORM cron.unschedule('storm-partial-index-oneshot');
    END IF;
    RETURN 'already built';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('storm-partial-index')) THEN
    RETURN 'another build is in progress';
  END IF;

  PERFORM set_config('maintenance_work_mem', '1GB', false);
  PERFORM set_config('lock_timeout', '55s', false);

  EXECUTE $ddl$
    CREATE INDEX idx_storm_live_state_date
    ON hunt_knowledge (state_abbr, effective_date)
    WHERE content_type = 'storm-event' AND (metadata->'superseded') IS NULL
  $ddl$;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storm-partial-index-oneshot') THEN
    PERFORM cron.unschedule('storm-partial-index-oneshot');
  END IF;
  RETURN 'built';
END;
$fn$;

-- Poll this over PostgREST to watch the build land.
CREATE OR REPLACE FUNCTION public.storm_partial_index_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  idx regclass := to_regclass('public.idx_storm_live_state_date');
BEGIN
  RETURN jsonb_build_object(
    'index_exists', idx IS NOT NULL,
    'index_size', CASE WHEN idx IS NOT NULL THEN pg_size_pretty(pg_relation_size(idx)) END,
    'job_scheduled', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storm-partial-index-oneshot'),
    'recent_runs', (
      SELECT jsonb_agg(jsonb_build_object(
        'status', d.status, 'start', d.start_time, 'end', d.end_time, 'msg', left(d.return_message, 200)
      ) ORDER BY d.start_time DESC)
      FROM (
        SELECT dd.status, dd.start_time, dd.end_time, dd.return_message
        FROM cron.job_run_details dd
        JOIN cron.job j ON j.jobid = dd.jobid
        WHERE j.jobname = 'storm-partial-index-oneshot'
        ORDER BY dd.start_time DESC
        LIMIT 5
      ) d
    )
  );
END;
$fn$;

-- Arm the one-shot job. Idempotent unschedule-then-schedule.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'storm-partial-index-oneshot') THEN
    PERFORM cron.unschedule('storm-partial-index-oneshot');
  END IF;
  PERFORM cron.schedule(
    'storm-partial-index-oneshot',
    '30 seconds',
    $cron$ SET statement_timeout = 0; SET maintenance_work_mem = '1GB'; SELECT public.run_storm_partial_index(); $cron$
  );
END;
$do$;

RESET search_path;
