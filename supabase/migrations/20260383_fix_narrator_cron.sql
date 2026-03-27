-- Fix narrator cron registration (20260381 used broken $body$ auth)
-- Unschedule the broken one, re-register with vault pattern

SELECT cron.unschedule('hunt-arc-narrator');

SELECT cron.schedule(
  'hunt-arc-narrator',
  '0 9 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-arc-narrator',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"trigger": "daily_sweep"}'::jsonb
  );
  $cron$
);
