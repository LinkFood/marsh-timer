-- Real-time weather monitoring: every 15 minutes
-- Scans ~130 ASOS stations for front passages, temp drops, wind shifts, pressure changes
SELECT cron.schedule(
  'hunt-weather-realtime',
  '*/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-weather-realtime',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Forecast accuracy tracker: daily at 10am (after weather watchdog embeds actuals at 6am)
SELECT cron.schedule(
  'hunt-forecast-tracker',
  '0 10 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-forecast-tracker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
