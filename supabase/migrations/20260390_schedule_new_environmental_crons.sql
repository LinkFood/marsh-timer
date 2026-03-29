-- Schedule 6 new environmental data edge functions in pg_cron
-- Staggered across the day to avoid IO spikes
-- Uses vault.decrypted_secrets pattern for auth

-- hunt-river-discharge: daily at 5:00 AM UTC (Open-Meteo flood API, 50 states)
SELECT cron.schedule(
  'hunt-river-discharge',
  '0 5 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/hunt-river-discharge',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- hunt-soil-monitor: daily at 5:30 AM UTC (Open-Meteo soil API, 50 states)
SELECT cron.schedule(
  'hunt-soil-monitor',
  '30 5 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/hunt-soil-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- hunt-air-quality: daily at 6:15 AM UTC (Open-Meteo AQI + pollen, 50 states)
SELECT cron.schedule(
  'hunt-air-quality',
  '15 6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/hunt-air-quality',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- hunt-wildfire-perimeters: daily at 8:30 AM UTC (NIFC ArcGIS, active fires only)
SELECT cron.schedule(
  'hunt-wildfire-perimeters',
  '30 8 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/hunt-wildfire-perimeters',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- hunt-ocean-buoy: every 6 hours at :45 (NOAA NDBC buoy data, ~30 stations)
SELECT cron.schedule(
  'hunt-ocean-buoy',
  '45 0,6,12,18 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/hunt-ocean-buoy',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- hunt-space-weather: every 6 hours at :15 (NOAA SWPC solar wind/Kp/X-ray)
SELECT cron.schedule(
  'hunt-space-weather',
  '15 0,6,12,18 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1) || '/functions/v1/hunt-space-weather',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $cron$
);
