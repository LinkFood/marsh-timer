-- Reschedule hunt-pattern-link-worker — the cron that draws the board's strings.
--
-- History: the worker died 2026-04-12 when simple_vector_search began timing out
-- (57014 / connection-pool exhaustion) on the growing brain, then was unscheduled
-- (migration 20260414100013) during DB recovery and never rescheduled. Its RPC is
-- healthy again after the 2026-07-05 IVFFlat rebuild (lists=2645), and the function
-- has been modernized: recent-window gather with NO created_at ORDER BY (the ordered
-- scan is what times out on the big backfilled types), a curated set of diverse
-- string-producing content types, and a per-run time budget so it links a bounded
-- slice and relies on the schedule instead of catching up in one run.
--
-- Every 15 minutes. Idempotent unschedule-then-schedule. Both Authorization and
-- apikey headers — the Supabase gateway rewrites Authorization to an ES256 JWT but
-- passes apikey through unmodified, so isServiceRoleRequest needs apikey present.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hunt-pattern-link-worker') THEN
    PERFORM cron.unschedule('hunt-pattern-link-worker');
  END IF;
  PERFORM cron.schedule(
    'hunt-pattern-link-worker',
    '*/15 * * * *',
    $body$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-pattern-link-worker',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $body$
  );
END
$cron$;
