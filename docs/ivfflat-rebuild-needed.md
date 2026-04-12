# IVFFlat Index Rebuild Required

## ROOT CAUSE FOUND

The current IVFFlat index `hunt_knowledge_embedding_idx` has `lists=1414`
(sized for ~2M rows). The brain is now 7M rows. Each query scans 5x more
candidates than the index was tuned for, causing 30s+ timeouts.

The April 9 rebuild migration (`20260409_rebuild_ivfflat_index.sql`) tried
to create a new index `idx_hunt_knowledge_embedding` with lists=2636 but
that name doesn't exist — the migration must have failed silently or the
new index was dropped. The OLD undersized index is still active.

## Ready-to-push migration

`supabase/migrations/20260414100018_rebuild_ivfflat_for_7m.sql.READY_TO_PUSH`

To execute (during low-traffic window — locks writes for 30-60 min):

```bash
mv supabase/migrations/20260414100018_rebuild_ivfflat_for_7m.sql.READY_TO_PUSH \
   supabase/migrations/20260414100018_rebuild_ivfflat_for_7m.sql
npx supabase db push
```

What it does:
1. Drops the existing undersized `hunt_knowledge_embedding_idx`
2. Creates a new one with lists=2645 (sqrt(7M))
3. Updates `search_hunt_knowledge_v3` probes to 51 (sqrt(2645))
4. Re-schedules `hunt-pattern-link-worker` cron (currently paused)

## Original symptoms

The IVFFlat index on `hunt_knowledge.embedding` is sized for ~2M rows (lists=1414).
The brain is now at 7M rows. Vector searches via `search_hunt_knowledge_v3` are
slow enough to hit the RPC's internal 30s statement timeout on most queries.

## Symptoms

- `hunt-pattern-link-worker` can't complete — every vector search times out
- `rpc=canceling statement due to statement timeout` errors
- `rpc=upstream request timeout` (Supabase pooler giving up after 2 min)
- Running the worker exhausts the connection pool, blocking REST API for 10-30 min

## Fix

Rebuild the IVFFlat index with proper sizing for current brain size:

```sql
-- sqrt(7M) ≈ 2645, round to 2500
DROP INDEX CONCURRENTLY IF EXISTS hunt_knowledge_embedding_ivfflat_idx;

CREATE INDEX CONCURRENTLY hunt_knowledge_embedding_ivfflat_idx
  ON hunt_knowledge
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 2500);
```

**Warning:** Rebuild takes 30-60 minutes on a 7M-row brain with 512-dim vectors.
Run during low-traffic window. Cannot be done inside a transaction.

## Post-rebuild

1. Re-schedule `hunt-pattern-link-worker` cron (currently unscheduled via migration 20260414100013)
2. Test one run: `curl supabase-functions/hunt-pattern-link-worker`
3. Verify new pattern links are being written to `hunt_pattern_links`
4. Monitor `hunt_cron_log` for pattern-link-worker health

## What I tried (all failed with 30s+ timeouts)

1. `search_hunt_knowledge_v3` with full filters and recency_weight
2. Same RPC with no content_type filter, no recency_weight
3. Same RPC with date filters (alert-grader uses these successfully)
4. New `simple_vector_search` RPC stripped of all wrapping logic
5. Same simple RPC with no `NOT IN` content_type exclusions
6. Same simple RPC with `SET LOCAL ivfflat.probes = 5` (faster but less accurate)

All hit the same wall: vector search on 7M rows with current index sizing
exceeds the 30s statement_timeout. There is no workaround at the application
layer. The index must be rebuilt.

## Why it matters for the filament test

Without working pattern links, the narrator can't speak about cross-domain discoveries.
The whole point of the filament test is to see if the 512-dim embedding space reveals
real cross-domain connections. That requires the vector search to actually work.

The daily digest continues to run (it reads narrator outputs and arc grades) but
the "INTERESTING BUT UNCONFIRMED" section stays empty until pattern links flow again.
