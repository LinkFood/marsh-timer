-- Fix NULL handling on hunt_alert_calibration unique constraint.
-- Without NULLS NOT DISTINCT, national rows (state_abbr=NULL) create duplicates
-- instead of upserting, because NULL != NULL in standard SQL unique constraints.
SET search_path = public, extensions;

ALTER TABLE hunt_alert_calibration
  DROP CONSTRAINT IF EXISTS hunt_alert_calibration_alert_source_state_abbr_window_days_key;

ALTER TABLE hunt_alert_calibration
  ADD CONSTRAINT hunt_alert_calibration_source_state_window_key
  UNIQUE NULLS NOT DISTINCT (alert_source, state_abbr, window_days);
