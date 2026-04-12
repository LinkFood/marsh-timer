-- Schedule hunt-bio-correlator every hour
-- Builds the bridge layer (bio-environmental-correlation) that enables
-- cross-domain similarity in the embedding space.
SELECT cron.schedule(
  'hunt-bio-correlator',
  '15 * * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-bio-correlator',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
