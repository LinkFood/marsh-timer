-- Add water, photoperiod, and tide component columns to hunt_convergence_scores
ALTER TABLE hunt_convergence_scores ADD COLUMN IF NOT EXISTS water_component smallint DEFAULT 0;
ALTER TABLE hunt_convergence_scores ADD COLUMN IF NOT EXISTS photoperiod_component smallint DEFAULT 0;
ALTER TABLE hunt_convergence_scores ADD COLUMN IF NOT EXISTS tide_component smallint DEFAULT 0;
