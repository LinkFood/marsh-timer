-- PIPE 2 phase 2 (supersede, never delete blind — THE-WEEK risk register).
-- Marks v1 storm-event rows (the type-filtered / duplicated / casualty-zeroed
-- ingest, identifiable by the ABSENCE of metadata.source_event_id) with
-- metadata.superseded = true, in bounded batches so no statement runs long.
-- Called repeatedly by scripts/ncei-reingest.ts --supersede until it returns 0.
-- v1 rows stay queryable until the post-week archive decision.

CREATE OR REPLACE FUNCTION public.mark_storm_v1_superseded(batch_size int DEFAULT 5000)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  updated_count int;
BEGIN
  WITH batch AS (
    SELECT id
    FROM hunt_knowledge
    WHERE content_type = 'storm-event'
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
