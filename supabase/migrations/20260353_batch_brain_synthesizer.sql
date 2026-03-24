-- Batch hunt-brain-synthesizer into 5 cron jobs (10 states each)
-- to avoid 150s edge function timeout.
-- Original: daily at 12:00 PM UTC. New: 5 batches at 12:00-12:08 UTC.

-- Unschedule old single-call cron
SELECT cron.unschedule('hunt-brain-synthesizer');

-- Batch 1 (states 1-10: AL through GA)
SELECT cron.schedule(
  'hunt-brain-synthesizer-b1',
  '0 12 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-brain-synthesizer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 1}'::jsonb
  );
  $cron$
);

-- Batch 2 (states 11-20: HI through KY)
SELECT cron.schedule(
  'hunt-brain-synthesizer-b2',
  '2 12 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-brain-synthesizer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 2}'::jsonb
  );
  $cron$
);

-- Batch 3 (states 21-30: MA through NJ)
SELECT cron.schedule(
  'hunt-brain-synthesizer-b3',
  '4 12 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-brain-synthesizer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 3}'::jsonb
  );
  $cron$
);

-- Batch 4 (states 31-40: NM through SC)
SELECT cron.schedule(
  'hunt-brain-synthesizer-b4',
  '6 12 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-brain-synthesizer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 4}'::jsonb
  );
  $cron$
);

-- Batch 5 (states 41-50: SD through WY)
SELECT cron.schedule(
  'hunt-brain-synthesizer-b5',
  '8 12 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-brain-synthesizer',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 5}'::jsonb
  );
  $cron$
);
