-- Add a second daily run for hunt-alert-grader at 17:00 UTC.
-- With MAX_PER_RUN raised to 15, two runs per day = 30 graded/day.
-- Clears the 1,132 alert backlog in ~38 days instead of 377.

SELECT cron.schedule(
  'hunt-alert-grader-afternoon',
  '0 17 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-alert-grader',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
