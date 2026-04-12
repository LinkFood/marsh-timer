-- Unschedule the old single drought monitor cron
SELECT cron.unschedule('hunt-drought-monitor');

-- Schedule 5 batched crons, 3 minutes apart on Tuesdays 7:00-7:12 AM UTC
-- Each batch processes 10 states (50 states / 5 batches)

SELECT cron.schedule(
  'hunt-drought-batch1',
  '0 7 * * 2',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-drought-monitor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"batch": 1}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'hunt-drought-batch2',
  '3 7 * * 2',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-drought-monitor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"batch": 2}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'hunt-drought-batch3',
  '6 7 * * 2',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-drought-monitor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"batch": 3}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'hunt-drought-batch4',
  '9 7 * * 2',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-drought-monitor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"batch": 4}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'hunt-drought-batch5',
  '12 7 * * 2',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-drought-monitor',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"batch": 5}'::jsonb
  );
  $cron$
);
