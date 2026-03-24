-- Fix 504 timeouts for hunt-weather-watchdog, hunt-convergence-engine, hunt-birdcast
-- by splitting each into 5 batched cron jobs (10 states each).
-- Also unschedule the old single-call crons.

-- ============================================================================
-- 1. hunt-weather-watchdog: was 6:00 AM UTC, now 5 batches at 6:00-6:08
-- ============================================================================

-- Unschedule old single-call cron
SELECT cron.unschedule('hunt-weather-watchdog');

-- Batch 1 (states 1-10)
SELECT cron.schedule(
  'hunt-weather-watchdog-b1',
  '0 6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-weather-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 1}'::jsonb
  );
  $cron$
);

-- Batch 2 (states 11-20)
SELECT cron.schedule(
  'hunt-weather-watchdog-b2',
  '2 6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-weather-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 2}'::jsonb
  );
  $cron$
);

-- Batch 3 (states 21-30)
SELECT cron.schedule(
  'hunt-weather-watchdog-b3',
  '4 6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-weather-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 3}'::jsonb
  );
  $cron$
);

-- Batch 4 (states 31-40)
SELECT cron.schedule(
  'hunt-weather-watchdog-b4',
  '6 6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-weather-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 4}'::jsonb
  );
  $cron$
);

-- Batch 5 (states 41-50)
SELECT cron.schedule(
  'hunt-weather-watchdog-b5',
  '8 6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-weather-watchdog',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 5}'::jsonb
  );
  $cron$
);

-- ============================================================================
-- 2. hunt-convergence-engine: was 8:00 AM UTC, now 5 batches at 8:00-8:08
-- ============================================================================

-- Unschedule old single-call cron
SELECT cron.unschedule('hunt-convergence-engine');

-- Batch 1
SELECT cron.schedule(
  'hunt-convergence-engine-b1',
  '0 8 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-convergence-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 1}'::jsonb
  );
  $cron$
);

-- Batch 2
SELECT cron.schedule(
  'hunt-convergence-engine-b2',
  '2 8 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-convergence-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 2}'::jsonb
  );
  $cron$
);

-- Batch 3
SELECT cron.schedule(
  'hunt-convergence-engine-b3',
  '4 8 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-convergence-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 3}'::jsonb
  );
  $cron$
);

-- Batch 4
SELECT cron.schedule(
  'hunt-convergence-engine-b4',
  '6 8 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-convergence-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 4}'::jsonb
  );
  $cron$
);

-- Batch 5
SELECT cron.schedule(
  'hunt-convergence-engine-b5',
  '8 8 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-convergence-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 5}'::jsonb
  );
  $cron$
);

-- ============================================================================
-- 3. hunt-birdcast: was 10:00 AM UTC, now 5 batches at 10:00-10:08
-- ============================================================================

-- Unschedule old single-call cron (registered as 'hunt-birdcast-daily')
SELECT cron.unschedule('hunt-birdcast-daily');

-- Batch 1
SELECT cron.schedule(
  'hunt-birdcast-b1',
  '0 10 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-birdcast',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 1}'::jsonb
  );
  $cron$
);

-- Batch 2
SELECT cron.schedule(
  'hunt-birdcast-b2',
  '2 10 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-birdcast',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 2}'::jsonb
  );
  $cron$
);

-- Batch 3
SELECT cron.schedule(
  'hunt-birdcast-b3',
  '4 10 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-birdcast',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 3}'::jsonb
  );
  $cron$
);

-- Batch 4
SELECT cron.schedule(
  'hunt-birdcast-b4',
  '6 10 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-birdcast',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 4}'::jsonb
  );
  $cron$
);

-- Batch 5
SELECT cron.schedule(
  'hunt-birdcast-b5',
  '8 10 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-birdcast',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"batch": 5}'::jsonb
  );
  $cron$
);
