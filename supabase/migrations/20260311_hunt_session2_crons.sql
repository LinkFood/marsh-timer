-- pg_cron jobs for Session 2: NASA POWER + Solunar Precompute

-- NASA POWER batch 1 (first 25 states): daily at 6:30 AM UTC
SELECT cron.schedule(
  'hunt-nasa-power-batch1',
  '30 6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-nasa-power',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 1}'::jsonb
  );
  $cron$
);

-- NASA POWER batch 2 (last 25 states): daily at 6:33 AM UTC (3 min after batch 1)
SELECT cron.schedule(
  'hunt-nasa-power-batch2',
  '33 6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-nasa-power',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 2}'::jsonb
  );
  $cron$
);

-- Solunar precompute: every Sunday at 6 AM UTC
SELECT cron.schedule(
  'hunt-solunar-precompute',
  '0 6 * * 0',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-solunar-precompute',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
