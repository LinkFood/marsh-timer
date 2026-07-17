-- Schedule hunt-formation-watch — every 6h at 01/07/13/19 UTC.
-- 07:00 sits after hunt-air-quality (06:15 UTC) so the smoke lead reads
-- today's AQI trend the same morning it lands. Idempotent
-- unschedule-then-schedule; both Authorization and apikey headers (the
-- gateway rewrites Authorization, apikey passes through).
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hunt-formation-watch') THEN
    PERFORM cron.unschedule('hunt-formation-watch');
  END IF;
  PERFORM cron.schedule(
    'hunt-formation-watch',
    '0 1,7,13,19 * * *',
    $body$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-formation-watch',
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
