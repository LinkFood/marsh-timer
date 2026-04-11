-- Prevent duplicate alert outcomes (same source + state + date)
-- 69 duplicates already cleaned up via REST API

-- Add unique constraint (handles NULL state_abbr correctly with COALESCE)
CREATE UNIQUE INDEX IF NOT EXISTS idx_alert_outcomes_dedup
  ON hunt_alert_outcomes (alert_source, COALESCE(state_abbr, '__national__'), alert_date);

-- Reset all previously graded outcomes so they get re-graded under the new per-domain logic.
-- The old grader confirmed everything by finding weather events with limit(20).
-- The new grader checks each claimed domain independently.
UPDATE hunt_alert_outcomes
SET outcome_checked = false,
    outcome_grade = NULL,
    outcome_signals_found = NULL,
    outcome_reasoning = NULL,
    grade_knowledge_id = NULL,
    graded_at = NULL
WHERE outcome_checked = true;
