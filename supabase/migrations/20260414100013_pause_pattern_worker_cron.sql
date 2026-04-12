-- Temporarily unschedule the pattern-link-worker cron while the DB recovers.
-- Reschedule via the next migration when ready.
SELECT cron.unschedule('hunt-pattern-link-worker');
