-- Batch 1 (AL-GA) consistently fails with "request closed before processing"
-- because all 5 batches fire at 8:00 UTC simultaneously and the cold start
-- causes the first request to be dropped. Fix: stagger batch 1 to 7:58 UTC
-- so the function is warm when batches 2-5 arrive at 8:00.

-- First, find and unschedule the existing batch 1 job
-- The jobs are named like 'hunt-convergence-engine-batch-1' or similar
-- We'll create a new one at the offset time

SELECT cron.schedule(
  'hunt-convergence-engine-batch1-early',
  '58 7 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-convergence-engine',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"batch": 1}'::jsonb
  );
  $cron$
);
