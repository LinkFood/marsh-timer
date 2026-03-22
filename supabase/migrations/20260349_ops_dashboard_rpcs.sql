-- RPCs for hunt-ops-dashboard edge function

-- Approximate brain total from pg_class (avoids full table scan on 2M+ rows)
CREATE OR REPLACE FUNCTION hunt_ops_brain_total()
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  SELECT reltuples::bigint FROM pg_class WHERE relname = 'hunt_knowledge';
$$;

-- Growth by day for last 30 days
CREATE OR REPLACE FUNCTION hunt_ops_growth_by_day()
RETURNS TABLE(day date, count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT DATE(created_at) AS day, COUNT(*) AS count
  FROM hunt_knowledge
  WHERE created_at > NOW() - INTERVAL '30 days'
  GROUP BY DATE(created_at)
  ORDER BY day;
$$;

-- Content type breakdown
CREATE OR REPLACE FUNCTION hunt_ops_content_types()
RETURNS TABLE(type text, count bigint, latest timestamptz)
LANGUAGE sql
STABLE
AS $$
  SELECT content_type AS type, COUNT(*) AS count, MAX(created_at) AS latest
  FROM hunt_knowledge
  GROUP BY content_type
  ORDER BY count DESC;
$$;

-- Alert performance for last 30 days
CREATE OR REPLACE FUNCTION hunt_ops_alert_performance()
RETURNS TABLE(total_30d bigint, confirmed bigint, partial bigint, missed bigint, false_alarm bigint, pending bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*) AS total_30d,
    COUNT(*) FILTER (WHERE outcome_grade = 'confirmed') AS confirmed,
    COUNT(*) FILTER (WHERE outcome_grade = 'partial') AS partial,
    COUNT(*) FILTER (WHERE outcome_grade = 'missed') AS missed,
    COUNT(*) FILTER (WHERE outcome_grade = 'false_alarm') AS false_alarm,
    COUNT(*) FILTER (WHERE outcome_grade IS NULL) AS pending
  FROM hunt_convergence_alerts
  WHERE created_at > NOW() - INTERVAL '30 days';
$$;

-- Discovery status counts
CREATE OR REPLACE FUNCTION hunt_ops_discoveries()
RETURNS TABLE(pending bigint, embedded bigint, skipped bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COUNT(*) FILTER (WHERE curator_decision IS NULL) AS pending,
    COUNT(*) FILTER (WHERE embedded_at IS NOT NULL) AS embedded,
    COUNT(*) FILTER (WHERE curator_decision = 'reject') AS skipped
  FROM hunt_web_discoveries;
$$;
