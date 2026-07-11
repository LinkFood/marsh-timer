-- Terminate the stalled IVFFlat rebuild backend (running ~4h, 3x precedent,
-- holding the hunt_knowledge write lock and blocking all pipes). The one-shot
-- job is already unscheduled (20260711070000); this kills the in-flight build
-- transaction. Rollback of CREATE INDEX is cheap; the live serving index
-- (hunt_knowledge_embedding_idx, lists=2645) is untouched by design — the
-- rebuild ran under a temp name precisely so cancellation costs nothing.

DO $do$
DECLARE
  killed int := 0;
  r record;
BEGIN
  FOR r IN
    SELECT pid, left(query, 80) AS q, now() - xact_start AS age
    FROM pg_stat_activity
    WHERE pid <> pg_backend_pid()
      AND (query ILIKE '%run_ivfflat_rebuild%'
           OR query ILIKE '%hunt_knowledge_embedding_idx_v2%')
      AND state <> 'idle'
  LOOP
    PERFORM pg_terminate_backend(r.pid);
    killed := killed + 1;
    RAISE NOTICE 'terminated pid % (age %): %', r.pid, r.age, r.q;
  END LOOP;
  RAISE NOTICE 'stuck index-build backends terminated: %', killed;
END;
$do$;
