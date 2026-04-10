-- Clean up the one-shot index rebuild cron that didn't auto-unschedule
SELECT cron.unschedule('rebuild-ivfflat-index');
