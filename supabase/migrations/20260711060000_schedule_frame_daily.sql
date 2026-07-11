-- Schedule hunt-frame-daily — THE BOARD's live edge (spine §5.1).
--
-- Upserts today's board_frames row (and re-finalizes yesterday) once a day, after
-- the morning data crons have landed day-0. A one-row daily maintenance write,
-- exempt from the big-pipe doctrine (§5.1) — not a backfill.
--
-- 11:45 UTC — after hunt-weather-watchdog / the climate-index job / the morning
-- data crons (CLAUDE.md cron table) so the band reads see the freshest day-0.
--
-- Idempotent unschedule-then-schedule. Both Authorization and apikey headers — the
-- Supabase gateway rewrites Authorization to an ES256 JWT but passes apikey through
-- unmodified, so isServiceRoleRequest needs apikey present.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hunt-frame-daily') THEN
    PERFORM cron.unschedule('hunt-frame-daily');
  END IF;
  PERFORM cron.schedule(
    'hunt-frame-daily',
    '45 11 * * *',
    $body$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-frame-daily',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $body$
  );
END
$cron$;
