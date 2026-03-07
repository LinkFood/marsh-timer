-- pg_cron jobs for Session 3: Migration spike detection
-- 5 batches of 10 states, 5 minutes apart starting at 7:00 UTC

SELECT cron.schedule(
  'hunt-migration-batch1',
  '0 7 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-migration-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"states":["AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA"]}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'hunt-migration-batch2',
  '5 7 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-migration-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"states":["HI","ID","IL","IN","IA","KS","KY","LA","ME","MD"]}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'hunt-migration-batch3',
  '10 7 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-migration-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"states":["MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ"]}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'hunt-migration-batch4',
  '15 7 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-migration-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"states":["NM","NY","NC","ND","OH","OK","OR","PA","RI","SC"]}'::jsonb
  );
  $cron$
);

SELECT cron.schedule(
  'hunt-migration-batch5',
  '20 7 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-migration-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{"states":["SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"]}'::jsonb
  );
  $cron$
);
