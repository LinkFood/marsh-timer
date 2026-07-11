-- IVFFlat rebuild sizing correction: lists 3155 → 2750.
--
-- WHY: pgvector's build pre-check rejected lists=3155 on this instance —
-- "memory required is 2266 MB, maintenance_work_mem is 2048 MB" — four failed
-- one-shot firings (2026-07-11 01:13–01:38 UTC). At ~0.718 MB/list, lists=2750
-- needs ~1975 MB and fits the proven 2GB ceiling with headroom. Recall delta vs
-- sqrt(9.95M)≈3155 is marginal; probes stay 56 (valid for any lists ≥ 56).
-- The armed 'ivfflat-rebuild-oneshot' job picks this function up on its next
-- 30s firing; done-check now keys on lists=2750.

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.run_ivfflat_rebuild()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'hunt_knowledge_embedding_idx'
      AND reloptions @> ARRAY['lists=2750']
  ) THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ivfflat-rebuild-oneshot') THEN
      PERFORM cron.unschedule('ivfflat-rebuild-oneshot');
    END IF;
    RETURN 'already built';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('ivfflat-rebuild')) THEN
    RETURN 'another rebuild run is in progress';
  END IF;

  PERFORM set_config('maintenance_work_mem', '2GB', false);

  -- Clear any half-orphaned v2 from the failed 3155 attempts before rebuilding.
  DROP INDEX IF EXISTS hunt_knowledge_embedding_idx_v2;

  EXECUTE 'CREATE INDEX hunt_knowledge_embedding_idx_v2
    ON hunt_knowledge USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 2750)';

  PERFORM set_config('lock_timeout', '55s', false);
  DROP INDEX IF EXISTS hunt_knowledge_embedding_idx;
  ALTER INDEX hunt_knowledge_embedding_idx_v2 RENAME TO hunt_knowledge_embedding_idx;
  PERFORM set_config('lock_timeout', '0', false);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ivfflat-rebuild-oneshot') THEN
    PERFORM cron.unschedule('ivfflat-rebuild-oneshot');
  END IF;
  RETURN 'built and swapped (lists=2750)';
END;
$fn$;

RESET search_path;
