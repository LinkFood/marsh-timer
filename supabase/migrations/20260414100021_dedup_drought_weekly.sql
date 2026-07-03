-- Dedup drought-weekly rows in hunt_knowledge (2026-07-02 mining audit:
-- exactly 2x duplicated).
--
-- Root cause: hunt_knowledge has NO unique constraint, so the
-- "Prefer: resolution=merge-duplicates" header every writer sends is a silent
-- no-op — re-running any backfill doubles its data. backfill-drought-monitor
-- completed at least twice (orchestrator-v2 checkpoint shows a full "done"
-- run on top of an earlier manual run), doubling every row.
--
-- Scope: drought-weekly only — ~50 states x ~170 weeks x 2 ≈ 17k rows,
-- selected via the (content_type, created_at) compound index. This is a
-- bounded, safe DELETE (removes ~8.5k rows from a 7.6M-row table).
--
-- One drought reading per (state_abbr, effective_date) is the natural key
-- (both the backfill and the weekly hunt-drought-monitor cron write exactly
-- one row per state per USDM week). Keeps the newest copy.
--
-- Deliberately NOT adding a global unique index on hunt_knowledge:
--   * no natural key spans all 60+ content types (title is not unique),
--   * building any index on 7.6M rows locks the table for minutes and would
--     collide with the IVFFlat maintenance window,
--   * idempotency is instead enforced in the writers (scripts now diff
--     against existing rows before inserting — see backfill-ghcn-daily.ts).
--
-- MUST run AFTER the 20260414100018 IVFFlat rebuild has finished — deletes
-- on hunt_knowledge block while that index build holds its lock.

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY state_abbr, effective_date
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM hunt_knowledge
  WHERE content_type = 'drought-weekly'
)
DELETE FROM hunt_knowledge k
USING ranked r
WHERE k.id = r.id
  AND r.rn > 1;
