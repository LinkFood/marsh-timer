-- Kill the dead-question synthesis crons + refit the two IO hogs
-- (James's authorization 2026-07-17: "kill what you think needs to be killed";
-- executed on the read-only worthiness audit of the same night).
--
-- The 07-11 kill took the convergence SCORING layer. This takes the surviving
-- convergence-era SYNTHESIS layer — jobs whose only readers are each other,
-- the dev-only /ops page, or nothing (traced against the live surfaces:
-- porch/ledger/board, /date museum via useDayArchive, /court, /morning, /atlas).
--
-- KILLED (no live product reader):
--   hunt-narrator, hunt-arc-narrator        — Sonnet/Opus narratives nobody renders (~$3-4/mo LLM)
--   hunt-daily-digest, hunt-forecast-tracker — self-read only
--   hunt-correlation-engine                  — 103s/day IO for an /ops tile
--   hunt-synthesis-reviewer                  — already failing ("request closed")
--   hunt-scout-report                        — briefs_delivered: 0, no users
--   hunt-du-map, hunt-du-alerts              — /ops tiles only
--   hunt-web-curator                         — idle, chat-fallback only
--   hunt-movebank                            — fully broken (errors:7, embedded:0); fix-or-kill ruled kill
-- REFIT (live museum lanes, wrong cadence):
--   hunt-bio-correlator  hourly -> daily 06:45 (~26k knowledge-queries + 2,400 embeds/day -> ~4%)
--   hunt-pattern-link-worker */15 -> daily 07:20 (96 vector scans/day on 7.6M rows, links_written ~0)
-- KEPT: the entire ingest fleet (museum substrate, every lane read by useDayArchive),
-- the court loop, the board/porch feeds, anomaly/absence/disaster graders.

DO $do$
DECLARE
  r record;
  n int := 0;
BEGIN
  FOR r IN
    SELECT jobname FROM cron.job
    WHERE jobname ~ '(narrator|daily-digest|forecast-tracker|correlation-engine|synthesis-reviewer|scout-report|du-map|du-alerts|web-curator|movebank|bio-correlator|pattern-link-worker)'
  LOOP
    PERFORM cron.unschedule(r.jobname);
    n := n + 1;
    RAISE NOTICE 'unscheduled: %', r.jobname;
  END LOOP;
  RAISE NOTICE 'dead-synthesis crons unscheduled: %', n;

  -- Refit 1: bio-correlator at daily (museum lane stays alive at ~4% of the IO).
  PERFORM cron.schedule(
    'hunt-bio-correlator-daily',
    '45 6 * * *',
    $body$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-bio-correlator',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $body$
  );

  -- Refit 2: pattern-link-worker at daily (chat dispatcher keeps its lane at 1% of the scans).
  PERFORM cron.schedule(
    'hunt-pattern-link-worker-daily',
    '20 7 * * *',
    $body$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-pattern-link-worker',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $body$
  );
  RAISE NOTICE 'refits scheduled: hunt-bio-correlator-daily 06:45, hunt-pattern-link-worker-daily 07:20';
END;
$do$;
