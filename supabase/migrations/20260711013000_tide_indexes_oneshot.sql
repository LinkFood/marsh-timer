-- Tide-gauge serving indexes — SERVER-SIDE via one-shot pg_cron job
-- (same self-unscheduling pattern as 20260707110000_storm_partial_index_oneshot.sql).
--
-- WHY: tide-gauge grew to ~747k rows (pipes 3 + MD roster). hunt-atlas-spot's
-- tide-now read had NO index serving (content_type, state_abbr, effective_date)
-- — ORDER BY effective_date DESC scans hit 57014 and the block now runs on a 2s
-- time budget, degrading roster states to tide:null. The board bake also hit
-- unindexed station_id pool reads. Two partial indexes, keyed the way readers ask:
--   1. by state, newest first (spot tide-now, dossier tide lines)
--   2. by station, newest first (roster reads, board bakes, per-gauge pools)
-- Plain CREATE INDEX (plpgsql runs in a transaction): hunt_knowledge writes pause
-- ~minutes per build; crons retry. Advisory lock + exists-checks make repeats no-ops.

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.run_tide_indexes()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  built text := '';
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('tide-indexes')) THEN
    RETURN 'another build is in progress';
  END IF;

  PERFORM set_config('maintenance_work_mem', '1GB', false);
  PERFORM set_config('lock_timeout', '55s', false);

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_tide_state_date') THEN
    EXECUTE $ddl$
      CREATE INDEX idx_tide_state_date
      ON hunt_knowledge (state_abbr, effective_date DESC)
      WHERE content_type = 'tide-gauge'
    $ddl$;
    built := built || ' idx_tide_state_date';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_tide_station_date') THEN
    EXECUTE $ddl$
      CREATE INDEX idx_tide_station_date
      ON hunt_knowledge ((metadata->>'station_id'), effective_date DESC)
      WHERE content_type = 'tide-gauge'
    $ddl$;
    built := built || ' idx_tide_station_date';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_tide_state_date')
     AND EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_tide_station_date') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tide-indexes-oneshot') THEN
      PERFORM cron.unschedule('tide-indexes-oneshot');
    END IF;
  END IF;

  RETURN CASE WHEN built = '' THEN 'already built' ELSE 'built:' || built END;
END;
$fn$;

-- Poll this over PostgREST to watch the build land.
CREATE OR REPLACE FUNCTION public.tide_indexes_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  idx1 regclass := to_regclass('public.idx_tide_state_date');
  idx2 regclass := to_regclass('public.idx_tide_station_date');
BEGIN
  RETURN jsonb_build_object(
    'state_date_exists', idx1 IS NOT NULL,
    'state_date_size', CASE WHEN idx1 IS NOT NULL THEN pg_size_pretty(pg_relation_size(idx1)) END,
    'station_date_exists', idx2 IS NOT NULL,
    'station_date_size', CASE WHEN idx2 IS NOT NULL THEN pg_size_pretty(pg_relation_size(idx2)) END,
    'job_scheduled', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tide-indexes-oneshot'),
    'recent_runs', (
      SELECT jsonb_agg(jsonb_build_object(
        'status', d.status, 'start', d.start_time, 'end', d.end_time, 'msg', left(d.return_message, 200)
      ) ORDER BY d.start_time DESC)
      FROM (
        SELECT dd.status, dd.start_time, dd.end_time, dd.return_message
        FROM cron.job_run_details dd
        JOIN cron.job j ON j.jobid = dd.jobid
        WHERE j.jobname = 'tide-indexes-oneshot'
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
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tide-indexes-oneshot') THEN
    PERFORM cron.unschedule('tide-indexes-oneshot');
  END IF;
  PERFORM cron.schedule(
    'tide-indexes-oneshot',
    '30 seconds',
    $cron$ SET statement_timeout = 0; SET maintenance_work_mem = '1GB'; SELECT public.run_tide_indexes(); $cron$
  );
END;
$do$;

RESET search_path;
