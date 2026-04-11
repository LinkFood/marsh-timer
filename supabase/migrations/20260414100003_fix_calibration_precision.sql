-- Fix numeric overflow on calibration rates.
-- accuracy_rate and precision_rate are percentages (0-100) but
-- numeric(5,4) only holds values up to 9.9999. Change to numeric(7,4)
-- which holds up to 999.9999, covering the full 0-100% range.

ALTER TABLE hunt_alert_calibration
  ALTER COLUMN accuracy_rate TYPE numeric(7,4),
  ALTER COLUMN precision_rate TYPE numeric(7,4);
