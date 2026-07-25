-- Revoke anon/authenticated INSERT, UPDATE and DELETE on every DCD table.
--
-- Scope: hunt_*, board_*, formation_watches, morning_lines, planting_climatology.
-- Deliberately NOT cluster-wide — ct_* and lupa_* and JAC's unprefixed tables
-- belong to other applications whose client write paths have not been audited
-- from this repo. The catastrophic privilege (TRUNCATE) was already revoked
-- everywhere in 20260725000500; this migration is DCD defence-in-depth.
--
-- Verified 2026-07-25 before applying: the DCD client never writes. A full
-- sweep of src/ for .insert( / .update( / .upsert( / .delete( returns only a
-- JS Set delete (src/hooks/useYourGround.ts:114) and a URLSearchParams delete
-- (src/pages/AskPage.tsx:136) — neither is Supabase. Every .from() target in
-- the app is a read: board_instruments, board_rhymes, formation_watches,
-- hunt_knowledge, hunt_nws_alerts, hunt_weather_history, morning_lines,
-- planting_climatology.
--
-- Every real writer is service role — edge functions, cron jobs and the offline
-- bake scripts — and service_role bypasses both RLS and these grants, so none
-- of them are affected.
--
-- Why grants and not policies: RLS is OFF on board_frames, board_instruments,
-- board_layout, board_pool_luts and board_strings. On those five, grants are the
-- ONLY access control there is — a policy-based fix would protect nothing. And
-- on the RLS-enabled tables, revoking the grant means a future migration that
-- toggles RLS off does not silently reopen a write path.
--
-- Reads are untouched. SELECT stays granted; the public site renders from these
-- tables with the anon key.

DO $body$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND (
            c.relname LIKE 'hunt\_%'
         OR c.relname LIKE 'board%'
         OR c.relname IN ('formation_watches', 'morning_lines', 'planting_climatology')
       )
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon, authenticated', r.relname);
  END LOOP;
END
$body$;
