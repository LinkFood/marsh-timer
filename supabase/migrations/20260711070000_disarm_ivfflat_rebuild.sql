-- Disarm the IVFFlat rebuild one-shot after a stalled/thrashing build.
-- Applied only if the 2026-07-11 lists=2750 rebuild had to be cancelled
-- (project restart). Unschedules the job so it cannot re-fire on a box
-- that can't afford the build, and clears any half-built v2 remnant.
-- The canonical hunt_knowledge_embedding_idx (lists=2645) remains live and
-- serving; the resize re-arms later via a fresh migration after a compute bump.

SET search_path = public, extensions;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ivfflat-rebuild-oneshot') THEN
    PERFORM cron.unschedule('ivfflat-rebuild-oneshot');
  END IF;
END;
$do$;

DROP INDEX IF EXISTS hunt_knowledge_embedding_idx_v2;

RESET search_path;
