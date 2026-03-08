-- Daily BirdCast scraper cron — runs at 10 AM UTC (after overnight migration)
-- Only active during migration season (function handles season check internally)
SELECT cron.schedule(
  'hunt-birdcast-daily',
  '0 10 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1) || '/functions/v1/hunt-birdcast',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
