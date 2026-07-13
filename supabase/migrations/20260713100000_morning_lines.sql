-- MORNING LINES — the published record of the product's flagship voice, and
-- the ledger its auto-grader rules on.
--
-- Product law: the product SHOWS itself being graded, win or lose. The Morning
-- Line publishes one falsifiable-ish sentence a day; until now nothing kept the
-- published text or checked it against what actually happened. This table is
-- the record:
--   - hunt-morning-line writes ONE row the first time a current-day line is
--     composed (day PK, first write wins — that is the published record;
--     dated recomputes never write). basis = 'published'.
--   - hunt-morning-grader backfills days that published before this table
--     existed by recomputing them through the function's own dated path.
--     basis = 'recomputed' — honest flag: pre-day-0-fix lines are not
--     byte-reproducible, so a recomputed row is TODAY'S engine reading that
--     day, not the byte-for-byte line a visitor saw.
--   - At +7 days hunt-morning-grader grades each row against
--     hunt_weather_history actuals and writes grade jsonb
--     {verdict, summary, evidence, graded_at, basis}. Grade also embeds into
--     hunt_knowledge (content_type 'morning-line-grade') per the embedding law.

CREATE TABLE IF NOT EXISTS morning_lines (
  day           date PRIMARY KEY,        -- the American day the line is FOR
  state_abbr    text NOT NULL,
  headline      text NOT NULL,           -- lede + lineup sentence, as published
  lede          text NOT NULL,
  control_line  text,
  quoted_temp_f numeric,                 -- parts.anomaly.value as quoted
  anomaly_sigma numeric,                 -- parts.anomaly.z as quoted
  day0_source   text NOT NULL DEFAULT 'archive',  -- live | live-yesterday | archive
  lineup_claim  jsonb,                   -- structured claim (verb/magnitude/window
                                         -- + lineup/control denominators + anomaly
                                         -- context) so grading never string-parses
                                         -- the headline
  basis         text NOT NULL DEFAULT 'published', -- published | recomputed
  published_at  timestamptz NOT NULL DEFAULT now(),
  grade         jsonb                    -- null until graded at +7 days
);

-- Anon read exposure — /morning reads this table directly through the anon
-- client (mirrors board_rhymes). Read-only for anon/authenticated: a SELECT
-- policy and a SELECT grant, nothing else; writes come only from the service
-- role (which bypasses RLS).
ALTER TABLE morning_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read morning_lines" ON morning_lines;
CREATE POLICY "Public read morning_lines" ON morning_lines FOR SELECT USING (true);
GRANT SELECT ON morning_lines TO anon, authenticated;

-- ─── Schedule hunt-morning-grader — 13:00 UTC daily ─────────────────────────
-- Well after the 06:00 UTC weather_history writer (yesterday's actuals are on
-- file) and after the morning's line has typically published. Idempotent
-- unschedule-then-schedule. Both Authorization and apikey headers — the
-- Supabase gateway rewrites Authorization to an ES256 JWT but passes apikey
-- through unmodified.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hunt-morning-grader') THEN
    PERFORM cron.unschedule('hunt-morning-grader');
  END IF;
  PERFORM cron.schedule(
    'hunt-morning-grader',
    '0 13 * * *',
    $body$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-morning-grader',
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
