-- pg_cron jobs for Phase 3: Scout Report + Convergence Alerts

-- Scout report: daily at 9 AM UTC (after convergence engine at 8 AM)
SELECT cron.schedule(
  'hunt-scout-report',
  '0 9 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-scout-report',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Convergence alerts: runs 15 min after convergence engine daily, also after each NWS monitor run
SELECT cron.schedule(
  'hunt-convergence-alerts-daily',
  '15 8 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-convergence-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
