-- Cron schedules for wave 3 data source functions (2026-03-19 night)
-- Power outage: every 6 hours (real-time data, correlates with severe weather)
-- Historical news: weekly Saturday 08:00 UTC (archival, no urgency)
-- Query signal: daily 23:00 UTC (end of day user activity summary)
-- SNOTEL: daily 08:00 UTC (snow water equivalent + soil temp)

SELECT cron.schedule(
  'hunt-power-outage-6h',
  '0 */6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-power-outage',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'hunt-historical-news-weekly',
  '0 8 * * 6',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-historical-news',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'hunt-query-signal-daily',
  '0 23 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-query-signal',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'hunt-snotel-daily',
  '0 8 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-snotel',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
