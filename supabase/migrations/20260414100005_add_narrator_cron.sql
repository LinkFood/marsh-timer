-- Schedule hunt-narrator to run daily at 12:00 UTC
-- After convergence engine (8:00), alert grader (11:30), and convergence alerts (8:15)
-- So it has fresh pattern links, graded arcs, and convergence data to narrate

SELECT cron.schedule(
  'hunt-narrator-daily',
  '0 12 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-narrator',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
