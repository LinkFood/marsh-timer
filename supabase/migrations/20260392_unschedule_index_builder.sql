-- Emergency: unschedule the index builder cron that's locking the table
SELECT cron.unschedule('build-content-type-index');
