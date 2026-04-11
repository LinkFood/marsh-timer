-- Fix calibration duplicate rows caused by NULL state_abbr in upsert.
-- NULL != NULL in Postgres, so the ON CONFLICT clause never matches national rows.

-- 1. Delete all existing calibration data (it'll be regenerated on next cron run)
DELETE FROM hunt_alert_calibration;

-- 2. Drop any existing constraint/index that doesn't handle NULLs
DROP INDEX IF EXISTS idx_alert_calibration_dedup;

-- 3. Add unique index that handles NULL state_abbr
CREATE UNIQUE INDEX idx_alert_calibration_dedup
  ON hunt_alert_calibration (alert_source, COALESCE(state_abbr, '__national__'), window_days);
