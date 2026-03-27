-- Register daily sweep cron for hunt-arc-narrator
-- Runs at 9:00 AM UTC daily (after convergence-engine at 8:00 and convergence-alerts at 8:15)
-- Processes all active arcs, regenerates narratives

SELECT cron.schedule(
  'hunt-arc-narrator',
  '0 9 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-arc-narrator',
    headers := $body${"Authorization": "Bearer $body$ || current_setting('app.settings.service_role_key') || $body$", "Content-Type": "application/json"}$body$::jsonb,
    body := '{"trigger": "daily_sweep"}'::jsonb
  );
  $cron$
);
