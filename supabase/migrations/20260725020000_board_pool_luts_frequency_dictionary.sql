-- THE FREQUENCY DICTIONARY — board_pool_luts gains the card (Amendment 1.3 Ruling 4a,
-- docs/PLAN-V1-2026-07-25.md §2 item 4).
--
-- The v1 card is count-only. No forward join, no outcome sentence, no Wilson interval
-- (Ruling 4 removed all of it). It says:
--
--   A pressure fall this size over Maryland in the second week of October
--   has happened 34 times since 1979.
--   Most recently November 14, 2019.
--   [decade distribution — per-year normalized, 1980s forward]
--   Maryland statewide. Not your marsh.
--
-- board_pool_luts was already that dictionary minus the dates: bake-luts.ts built the
-- same-doy±N pool and threw the calendar away, keeping only `vals`/`below`/`n` and a
-- `years` COUNT. This migration keeps the calendar.
--
-- ── WHY THESE COLUMNS AND NOT A BAKED `count` ─────────────────────────────────────
-- "34 times" is band-conditional, and the band is deliberately undecided until the
-- ERA5 pressure delta lands (Ruling 2: "pick from the data, not from taste"; Ruling
-- 3a: confirm delta transfers to pressure first). A baked count would price in a
-- decision nobody has made and force a full re-bake the moment it changed — the exact
-- reason plan §3 rejected the baked cell table (9.33M rows, re-baked per band change)
-- in favour of a column store.
--
-- So this stores the MATERIAL, not the answer:
--
--   days[]  the epoch day of every pool member, in the SAME order as the pool that
--           produced `vals`/`below` — ascending by value, ties by day. Because it is
--           rank-ordered, ANY band is a contiguous slice: the members in
--           [vLo, vHi) are days[below(vLo) .. below(vHi)), and a percentile band
--           [p0, p1) is simply days[floor(p0*n) .. ceil(p1*n)). Episodes, distinct
--           years and the most-recent start all fall out of that slice in the
--           browser, in microseconds, for any band, forever, with no re-bake.
--
-- Ruling 4a's three names map onto this row as:
--   count           → `episodes` (see the naming note below) for the whole pool;
--                     the card's band-conditional count is mergeEpisodes(slice of days).
--   years[]         → `years_list`
--   last_occurrence → `last_occurrence`
--
-- ── NAMING NOTE ───────────────────────────────────────────────────────────────────
-- Ruling 4a calls the first field `count`. It is stored as `episodes` because Ruling 2
-- defines it as OCCASIONS, and the column immediately above it — `n` — already holds
-- the DAY count. A bare `count` sitting next to `n` invites precisely the days-vs-
-- episodes confusion Ruling 2 exists to kill ("a four-day cold snap contributing four
-- to that number is a counting-shaped lie"). Same field, unambiguous name.
--
-- ── WHAT `episodes` AND `last_occurrence` MEAN HERE ───────────────────────────────
-- They describe the WHOLE pool — no band applied. Because a ±N doy window is
-- contiguous, the whole pool merges to ≈ one episode per year of record (measured:
-- 76 episodes over 76 years for ghcn-md doy 283). That is the unconditional
-- denominator, and it is deliberately NOT the card's number. It is here so a row is
-- self-describing without fetching days[], and so `episode_gap_days` has an anchor.
--
-- ── episode_gap_days ──────────────────────────────────────────────────────────────
-- Ruling 2 requires the gap be chosen from data. Until it is, every row records the
-- gap it was computed at, so two gaps can never be silently compared across a re-bake.
-- Same discipline Ruling 10.3 imposes on the ERA5 sampling scheme: costs nothing now,
-- not addable later.
--
-- ── TWO LAYOUT VERSIONS ───────────────────────────────────────────────────────────
-- The table carries 32,574 rows at the live layout and 32,208 at the superseded one
-- (89 vs 88 (instrument,metric) jobs × 366 doy — the needle-pna append). Every column
-- below is NULLABLE WITH NO DEFAULT, on purpose:
--   * bake-luts.ts writes only the CURRENT layout_version (the version is in the PK
--     and in the upsert key), so the superseded rows are never rewritten and keep NULL;
--   * a DEFAULT 0 on `episodes` would assert "this has never happened" about rows that
--     were simply baked before the dictionary existed. Readers MUST treat NULL as
--     "not baked", never as zero.
-- Existing readers are unaffected: hunt-frame-daily/index.ts:119 and
-- scripts/mine/frames.ts:187 both select an explicit column list.
--
-- ── EXPOSURE ──────────────────────────────────────────────────────────────────────
-- anon SELECT on board_pool_luts is unchanged and intended (writes were revoked in
-- 20260724231500 / 20260725001500). These columns inherit it, which means the
-- frequency dictionary is publicly readable — the posture RECON-COUNTRY-MAP.md §794
-- flagged. Not changed here; that is a product call, not a schema one.
--
-- ── SIZE ──────────────────────────────────────────────────────────────────────────
-- Measured from the warm cache: a GHCN state row at ±10d over 76 years is n=1,596, so
-- days[] is 1,596 int4 ≈ 6.4 KB (12 KB as JSON on the wire). Across the live layout's
-- 32,574 rows that is ≈ 210 MB added to a ~171 MB table, before TOAST compression.
-- ERA5 pressure at 1979+ is n=987 ≈ 4 KB/row. This is the price of "any band, no
-- re-bake"; the alternative — plan §3(c)'s transposed column store — is ~400× denser
-- because it stores each day once instead of once per overlapping doy window. When
-- that store lands in week 2 it may supersede days[] as the counting engine; the other
-- four columns stay useful regardless.

ALTER TABLE board_pool_luts
  ADD COLUMN IF NOT EXISTS days             integer[],   -- epoch day (days since 1970-01-01 UTC) per pool member, rank-ordered
  ADD COLUMN IF NOT EXISTS years_list       smallint[],  -- distinct calendar years in the pool, ascending — Ruling 10.4's per-decade denominator
  ADD COLUMN IF NOT EXISTS episodes         integer,     -- Ruling 4a's `count`: occasions in the whole pool at episode_gap_days
  ADD COLUMN IF NOT EXISTS last_occurrence  date,        -- Ruling 2: START date of the most recent episode, not the most recent matched day
  ADD COLUMN IF NOT EXISTS episode_gap_days smallint;    -- non-matched days tolerated inside one episode (0/1/2 under test)

COMMENT ON COLUMN board_pool_luts.days IS
  'Epoch day (days since 1970-01-01 UTC) of every pool member, in the same order as the pool that produced vals/below: ascending by value, ties by day. Rank-ordered so any band is a contiguous slice. NULL = baked before the frequency dictionary existed.';
COMMENT ON COLUMN board_pool_luts.years_list IS
  'Distinct calendar years contributing to the pool, ascending. The per-decade denominator for Ruling 10.4 per-year normalization, and the pre-refusal check for the >=10-distinct-years floor.';
COMMENT ON COLUMN board_pool_luts.episodes IS
  'Ruling 4a count, Ruling 2 semantics: occasions (consecutive matched days merged) in the WHOLE pool at episode_gap_days. Unconditional denominator, not the card number.';
COMMENT ON COLUMN board_pool_luts.last_occurrence IS
  'Start date of the most recent episode in the whole pool (Ruling 2). NOT the most recent matched day.';
COMMENT ON COLUMN board_pool_luts.episode_gap_days IS
  'Gap tolerance episodes/last_occurrence were computed at. Recorded per row so counts from different gaps can never be silently compared.';

-- The load-bearing invariant: days[] is 1:1 with the pool behind `below`/`n`. If this
-- ever breaks, a band slice silently returns the wrong days and the card lies quietly.
-- Rows from the superseded layout (days IS NULL) are exempt.
DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'board_pool_luts_days_aligned') THEN
    ALTER TABLE board_pool_luts
      ADD CONSTRAINT board_pool_luts_days_aligned
      CHECK (days IS NULL OR coalesce(array_length(days, 1), 0) = n);
  END IF;
END
$body$;
