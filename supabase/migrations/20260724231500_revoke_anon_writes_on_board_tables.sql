-- Revoke anon/authenticated write privileges on the board stack.
--
-- Found 2026-07-24 while closing the same class of hole on the lupa tables.
-- Every board_* table carried the default blanket grants to anon and
-- authenticated — INSERT, UPDATE, DELETE and TRUNCATE — and RLS is OFF on
-- board_frames, board_instruments, board_layout, board_pool_luts and
-- board_strings. With RLS off those grants are fully effective: anyone holding
-- the publishable key that ships in duckcountdown.com's bundle could have
-- truncated board_frames (27,964 rows) and blanked the front door.
--
-- board_rhymes has RLS enabled, but TRUNCATE is not subject to row-level
-- security, so it was wipeable too. Policies alone do not close this.
--
-- Reads stay public and unchanged — the front door renders from these tables
-- with the anon key (src/lib/board/frameStore.ts:84, :113, :219). The client
-- never writes: no insert/update/upsert/delete against any board_* table
-- exists anywhere in src/. Every writer is service role — hunt-frame-daily,
-- hunt-board-rhyme, hunt-formation-watch, and the offline bake scripts — and
-- service role bypasses both RLS and these grants.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.board_frames      FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.board_instruments FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.board_layout      FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.board_pool_luts   FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.board_strings     FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.board_rhymes      FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.formation_watches FROM anon, authenticated;

-- SELECT is deliberately left in place on all seven.
