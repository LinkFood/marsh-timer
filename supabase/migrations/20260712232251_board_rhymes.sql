-- THE BOARD — daily board-rhyme store (the front door's magic line).
--
-- "Today reads most like March 4, 2019 — the same instruments, deep the same
-- way. What followed then: ___." One row per (day, rank 1..5): the top-5 rhyme
-- days for each board_frames.day under the proven tail-centered metric
-- (scripts/frames/rhyme.ts — γ=1.5 tail emphasis, direction × magnitude-
-- agreement, MIN_OVERLAP 80/142), plus the drivers (the instruments that made
-- the rhyme) and the honest "what followed" (a stitched/storm event in the 10
-- days after the rhyme day, or null — null means no named event followed).
--
-- Written by supabase/functions/hunt-board-rhyme (cron below, 12:10 UTC — 25 min
-- after hunt-frame-daily lands today's frame at 11:45). Read by the front door
-- via anon supabase-js, same as board_instruments.

CREATE TABLE IF NOT EXISTS board_rhymes (
  day         date     NOT NULL,   -- the board_frames.day this rhyme is FOR
  rank        smallint NOT NULL,   -- 1..5
  rhyme_day   date     NOT NULL,
  score       numeric  NOT NULL,
  cos         numeric,
  mag         numeric,
  drivers     jsonb,               -- [{label, side, kind}] top ~4 driving instruments, human labels
  followed    jsonb,               -- {title, began, days_after, deaths, injuries, damage_usd} or null
                                   --   (null = no named event followed — honest)
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, rank)
);

-- Anon read exposure — the front door reads this table directly through the anon
-- client (like board_instruments). Read-only for anon/authenticated: a SELECT
-- policy and a SELECT grant, nothing else; writes come only from the service
-- role (which bypasses RLS).
ALTER TABLE board_rhymes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read board_rhymes" ON board_rhymes;
CREATE POLICY "Public read board_rhymes" ON board_rhymes FOR SELECT USING (true);
GRANT SELECT ON board_rhymes TO anon, authenticated;

-- ─── Schedule hunt-board-rhyme — 12:10 UTC daily ────────────────────────────────
-- 25 min after hunt-frame-daily (11:45) so today's frame exists before we rhyme it.
-- Idempotent unschedule-then-schedule. Both Authorization and apikey headers — the
-- Supabase gateway rewrites Authorization to an ES256 JWT but passes apikey through
-- unmodified, so isServiceRoleRequest needs apikey present.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hunt-board-rhyme') THEN
    PERFORM cron.unschedule('hunt-board-rhyme');
  END IF;
  PERFORM cron.schedule(
    'hunt-board-rhyme',
    '10 12 * * *',
    $body$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-board-rhyme',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'apikey', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $body$
  );
END
$cron$;
