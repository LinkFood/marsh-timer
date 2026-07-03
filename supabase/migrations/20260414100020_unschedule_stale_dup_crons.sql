-- Unschedule stale duplicate cron jobs (2026-07-02 mining audit).
--
-- Root cause: crons were renamed in later migrations but the old names were
-- never unscheduled, so BOTH fired — double-running the functions and
-- double-inserting their hunt_knowledge output:
--   hunt-anomaly-detector-daily   (20260333) superseded by hunt-anomaly-detector   (20260341/20260348)
--   hunt-correlation-engine-daily (20260334) superseded by hunt-correlation-engine (20260341/20260348)
--   hunt-du-map-weekly            (20260308000011/20260348) superseded by hunt-du-map (20260351)
--
-- Idempotent: bare cron.unschedule() throws if the job doesn't exist, so each
-- is guarded with an existence check (house pattern).

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hunt-anomaly-detector-daily') THEN
    PERFORM cron.unschedule('hunt-anomaly-detector-daily');
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hunt-correlation-engine-daily') THEN
    PERFORM cron.unschedule('hunt-correlation-engine-daily');
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hunt-du-map-weekly') THEN
    PERFORM cron.unschedule('hunt-du-map-weekly');
  END IF;
END
$do$;
