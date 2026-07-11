-- Kill the dead-thesis convergence-predictor crons (James's authorization,
-- 2026-07-10/11; executed after the read-only dependency audit).
--
-- The convergence index was proven signal-free and demolished 2026-07-02; its
-- crons kept scoring 50 states daily (~$2-3/day API + IO) for a number nobody
-- reads. Audit confirmed: no frontend reads hunt_convergence_scores/_alerts;
-- the court (hunt_claims/hunt_claim_fires) is fully independent; the grader
-- loop (hunt_alert_outcomes) is multi-source — anomaly-detector,
-- absence-detector, and disaster-watch keep feeding it.
--
-- KILLED: convergence-engine (5 batches), convergence-alerts(+pm),
-- convergence-scan, convergence-report-card, brain-synthesizer (5 batches),
-- murmuration-index + migration-report-card (both consume only the dead score).
-- KEPT: hunt-disaster-watch (live /ops Disaster tab + grader feeder),
-- everything else.

DO $do$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT jobname FROM cron.job
    WHERE jobname ~ '(convergence-engine|convergence-alerts|convergence-scan|convergence-report-card|brain-synthesizer|murmuration-index|migration-report-card)'
  LOOP
    PERFORM cron.unschedule(r.jobname);
    n := n + 1;
    RAISE NOTICE 'unscheduled: %', r.jobname;
  END LOOP;
  RAISE NOTICE 'dead-thesis crons unscheduled: %', n;
END;
$do$;
