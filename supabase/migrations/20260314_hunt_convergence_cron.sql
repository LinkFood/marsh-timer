-- pg_cron job for Phase 2: Convergence Engine
-- Runs daily at 8 AM UTC (after all Phase 1 jobs complete)

SELECT cron.schedule(
  'hunt-convergence-engine',
  '0 8 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-convergence-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"trigger": "daily"}'::jsonb
  );
  $cron$
);
