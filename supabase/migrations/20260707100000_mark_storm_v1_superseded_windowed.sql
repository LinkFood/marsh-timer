-- Supersede v2: the original mark_storm_v1_superseded(int) died at 57014 once
-- ~1.5M rows were marked — every call re-scans all previously-marked rows
-- (predicates unindexed) before finding 5k unmarked ones. This version bounds
-- each call to an effective_date window (btree-indexed), so the scan never
-- grows, and raises the function-local statement timeout as belt-and-braces.
-- Gotcha honored: arg-list change → DROP the old overload or PostgREST PGRST203s.

DROP FUNCTION IF EXISTS public.mark_storm_v1_superseded(int);

CREATE OR REPLACE FUNCTION public.mark_storm_v1_superseded(
  date_from date,
  date_to date,
  batch_size int DEFAULT 5000
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
SET statement_timeout = '120s'
AS $$
DECLARE
  updated_count int;
BEGIN
  WITH batch AS (
    SELECT id
    FROM hunt_knowledge
    WHERE content_type = 'storm-event'
      AND effective_date >= date_from
      AND effective_date <= date_to
      AND metadata->>'source_event_id' IS NULL
      AND (metadata->>'superseded') IS DISTINCT FROM 'true'
    LIMIT batch_size
    FOR UPDATE SKIP LOCKED
  )
  UPDATE hunt_knowledge k
  SET metadata = k.metadata || jsonb_build_object('superseded', true)
  FROM batch
  WHERE k.id = batch.id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
