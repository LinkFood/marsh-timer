-- Fix alert performance RPC: was querying hunt_convergence_alerts (which never gets graded)
-- The grader writes to hunt_alert_outcomes, so we need to read from there.
-- Also fix grade value mismatch: grader writes 'partially_confirmed', old RPC looked for 'partial'.

CREATE OR REPLACE FUNCTION hunt_ops_alert_performance()
RETURNS TABLE(total_30d bigint, confirmed bigint, partial bigint, missed bigint, false_alarm bigint, pending bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*) AS total_30d,
    COUNT(*) FILTER (WHERE outcome_grade = 'confirmed') AS confirmed,
    COUNT(*) FILTER (WHERE outcome_grade = 'partially_confirmed') AS partial,
    COUNT(*) FILTER (WHERE outcome_grade = 'missed') AS missed,
    COUNT(*) FILTER (WHERE outcome_grade = 'false_alarm') AS false_alarm,
    COUNT(*) FILTER (WHERE outcome_checked = false) AS pending
  FROM hunt_alert_outcomes
  WHERE created_at > NOW() - INTERVAL '30 days';
$$;
