-- hunt_seasons carries the 2026-27 OPENERS — one date per state per species.
--
-- Amendment 1.5 ruling 2 narrowed the season-date commitment to openers and a
-- link-out. `hunt_seasons` was shaped for the old scope: it can hold zones,
-- splits and a NOT NULL bag limit, but it has nowhere to put the four things
-- the openers load actually needs said out loud —
--
--   status            the state's own situation: ok / not_published / no_season
--                     / closed / conflicted. A row that is not `ok` must never
--                     produce a countdown; it produces an honest absence
--                     carrying the state's own reason in `notes`.
--   provisional       Ruling 10.1, reaffirmed in Amendment 1.5 ruling 2:
--                     provisional is a DISPLAYED field, not internal metadata.
--                     NULL means we hold no finality label — which is not the
--                     same as final, and the card says so.
--   provisional_note  the state's own words for that label.
--   fetched_at        the moment the state's page was read, so the card can
--                     date its own transcription.
--
-- plus `confidence` (the capture's own read of the transcription),
-- `recheck_after` (the date the state itself named), `source_records` (how many
-- published season rows the one date was collapsed from — a receipt, and the
-- reason the card can say "the earliest of six"), and `superseded_at`.
--
-- bag_limit loses NOT NULL. Under this scope we publish NO bag limit at all:
-- being wrong on one is a citation for the hunter, and the actual authority
-- publishes a URL we already hold 243 of. NULL is the correct value and 0 —
-- the old default — would read as a claim that you may take none.
--
-- SUPERSEDE, NEVER DELETE (house pattern, 20260705120000_mark_storm_v1_superseded).
-- The 482 rows already here are all stamped season_year '2025-2026'. Every one
-- of those dates is last season's; they stay queryable and stamped, not dropped.
--
-- The load itself is 20260726020000_load_2026_27_openers.sql.

ALTER TABLE hunt_seasons
  ADD COLUMN IF NOT EXISTS status           text NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS provisional      boolean,
  ADD COLUMN IF NOT EXISTS provisional_note text,
  ADD COLUMN IF NOT EXISTS fetched_at       timestamptz,
  ADD COLUMN IF NOT EXISTS confidence       text,
  ADD COLUMN IF NOT EXISTS recheck_after    date,
  ADD COLUMN IF NOT EXISTS source_records   int,
  ADD COLUMN IF NOT EXISTS superseded_at    timestamptz;

ALTER TABLE hunt_seasons ALTER COLUMN bag_limit DROP NOT NULL;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hunt_seasons_status_check'
  ) THEN
    ALTER TABLE hunt_seasons
      ADD CONSTRAINT hunt_seasons_status_check
      CHECK (status IN ('ok', 'not_published', 'no_season', 'closed', 'conflicted'));
  END IF;
END
$constraints$;

COMMENT ON COLUMN hunt_seasons.status IS
  'The state''s own situation for this row. Only ''ok'' may produce a countdown; every other value is an honest absence whose reason lives in notes.';
COMMENT ON COLUMN hunt_seasons.provisional IS
  'DISPLAYED, not metadata (Ruling 10.1). true = the state published these pending federal frameworks; false = final; NULL = we hold no label.';
COMMENT ON COLUMN hunt_seasons.provisional_note IS
  'The state''s own wording for its provisional label. Rendered, never paraphrased.';
COMMENT ON COLUMN hunt_seasons.fetched_at IS
  'When the state''s page was actually read. The card dates its own transcription with it.';
COMMENT ON COLUMN hunt_seasons.source_records IS
  'How many published season rows this one opener was collapsed from. A receipt: it is why the card can say "the earliest of six".';
COMMENT ON COLUMN hunt_seasons.bag_limit IS
  'NULL under the openers-only scope — we publish no bag limit. Read the state''s own page (source_url).';
COMMENT ON COLUMN hunt_seasons.superseded_at IS
  'Stamped when a row stops being the season we count toward. Superseded rows stay queryable; nothing is deleted.';

-- Last season's rows: stamped, kept, never counted toward. `season.ts` already
-- refuses any row whose season_year is not the current one; this makes the
-- refusal visible in the table itself rather than only in the client.
UPDATE hunt_seasons
SET superseded_at = now()
WHERE season_year = '2025-2026'
  AND superseded_at IS NULL;

DO $verify$
DECLARE
  n_superseded int;
  n_current    int;
BEGIN
  SELECT count(*) FILTER (WHERE superseded_at IS NOT NULL),
         count(*) FILTER (WHERE superseded_at IS NULL)
  INTO n_superseded, n_current
  FROM hunt_seasons;

  -- 482 rows were here when this was written; the check is "nothing vanished",
  -- not an exact count, because another load may legitimately have run first.
  IF n_superseded + n_current < 482 THEN
    RAISE EXCEPTION 'hunt_seasons lost rows: % superseded + % current < 482 expected', n_superseded, n_current;
  END IF;

  RAISE NOTICE 'hunt_seasons: % rows stamped superseded, % rows left standing', n_superseded, n_current;
END
$verify$;
