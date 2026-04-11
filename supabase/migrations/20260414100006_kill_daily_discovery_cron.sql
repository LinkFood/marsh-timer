-- Kill the old daily-discovery cron. It produces unchecked headlines by
-- handing raw anomaly data to Sonnet without reading the brain's own
-- arc grades, convergence trends, or grading history.
-- Replaced by hunt-narrator (12:00 UTC daily) which fact-checks against
-- the brain's internal signals before narrating.

SELECT cron.unschedule('hunt-daily-discovery');
