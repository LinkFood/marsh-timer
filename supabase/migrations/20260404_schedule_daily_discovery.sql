-- Schedule daily discovery engine
-- Runs at 11:00 AM UTC daily, after anomaly detector (9:30) and correlation engine (10:30)
-- so it has fresh candidates to rank

SELECT cron.schedule(
  'hunt-daily-discovery',
  '0 11 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/hunt-daily-discovery',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);
