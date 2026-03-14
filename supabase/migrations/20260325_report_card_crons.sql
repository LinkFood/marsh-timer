-- Report card crons: the brain grades itself

-- Migration report card: daily at 11am (after convergence engine + migration monitor)
SELECT cron.schedule(
  'hunt-migration-report-card',
  '0 11 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-migration-report-card',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Convergence report card: weekly on Sunday at noon
SELECT cron.schedule(
  'hunt-convergence-report-card',
  '0 12 * * 0',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-convergence-report-card',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
