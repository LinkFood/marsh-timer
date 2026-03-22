-- Signal weight column for brain entry ranking
-- Defaults to 1.0 so existing queries return identical results
ALTER TABLE hunt_knowledge ADD COLUMN IF NOT EXISTS signal_weight float DEFAULT 1.0;

-- Boost high-value synthesis and correlation entries
UPDATE hunt_knowledge SET signal_weight = 1.5
WHERE content_type IN ('ai-synthesis', 'bio-environmental-correlation', 'sensor-profile', 'correlation-discovery')
AND signal_weight = 1.0;

UPDATE hunt_knowledge SET signal_weight = 1.3
WHERE content_type IN ('alert-grade', 'alert-calibration')
AND signal_weight = 1.0;
