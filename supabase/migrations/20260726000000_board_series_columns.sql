-- THE TRANSPOSED COLUMN STORE — plan §3 option (c), the card's query path.
--
-- board_frames is one row per DAY holding every instrument's byte. The frequency
-- card wants the opposite cut: one instrument's whole history, and nothing else.
-- Getting that from board_frames means pulling the entire 8.11 MB store (plan §3
-- option b, measured at 1,078 ms over 28 parallel pages, re-pulled per cold
-- isolate). This table is that store transposed: ONE row per (instrument, metric)
-- holding the slot's entire column, so a card request is one bounded GET of one
-- row and the counting happens in the browser over ~1,600 numbers.
--
-- ── WHY THE COLUMN AND NOT THE ANSWER ─────────────────────────────────────────
-- Plan §3 rejected a baked cell table because the BAND is deliberately undecided
-- (Amendment 1.3 Ruling 1a / Ruling 2: "pick from the data, not from taste").
-- Baking answers prices in a decision nobody has made and forces a re-bake the
-- moment it changes. Baking the column prices in nothing: any band, any window,
-- any future rule, no re-bake. Only the newest day appends.
--
-- ── WHY VALUES AND NOT THE BOARD BYTE — a deliberate departure from plan §3 ────
-- Plan §3 describes this row as holding the packed board BYTE (one uint8 per day,
-- 144 rows keyed by (instrument, metric, side), ~4 MB). Building it that way was
-- measured against the committed definition of a match and fails three ways:
--
--   1. WRONG DEFINITION. The board byte is a day's rank inside ITS OWN doy±10
--      pool. The card's match is a rank inside the TARGET day's pool — that is
--      what scripts/frames/bake-luts.ts `bandFacts` computes and what every
--      measured number in the plan was produced by. They are different
--      populations and they give different answers: for Maryland at doy 284 on a
--      1979+ pool the committed definition gives 5 / 12 / 27 occasions at the
--      1% / 2% / 5% bands; byte-thresholding the same days gives 7 / 12 / 28.
--      Shipping the second while quoting the first would be the ±10-vs-±15 defect
--      of Ruling 1 all over again — two subsystems holding two definitions of one
--      concept — so the column stores what the committed definition needs.
--
--   2. QUANTIZATION. The byte is round(pct × 254). A GHCN state pool is n=1,596,
--      so one byte step spans ~6 pool members. At a 1% band (16 members) the
--      threshold cannot be placed to better than ±40% of the count.
--
--   3. NO PRODUCT SENTENCE. "A percentile is not a product sentence"
--      (scripts/mine/frames.ts:231). From the byte, physical units come back only
--      through `invertPct`, whose own docstring concedes it is byte- and
--      rank-quantized. From the value column the card reads the threshold
--      directly off the pool: "a daytime high of 58 °F or colder", exact.
--
-- The cost of the departure is one extra byte per day (int16, not uint8) and a
-- table ~5.2 MB instead of ~4 MB. That is the whole price.
--
-- ── ENCODING ──────────────────────────────────────────────────────────────────
--   readings  big-endian int16, one per day, first_day .. first_day + n_days - 1,
--             CONTIGUOUS with no calendar gaps. value = int16 / scale.
--             -32768 (0x8000) = NO READING. It is the int16 minimum, so it can
--             never collide with a scaled reading (the encoder asserts this).
--   scale     1 | 10 | 100 | 1000 — the smallest power of ten that makes every
--             reading in this series an exact integer. Chosen per row and
--             verified round-trip by the bake, never assumed:
--             avg_high_f ×10, pressure_mb ×10, residual_*_ft ×100, index value ×1000.
--
-- No `layout_version`. That column guards the BYTE PACKING ORDER of board_frames
-- (§7.2's footgun) and a value column has no packing order — appending
-- needle-pna to the manifest cannot invalidate a row here. The PK is the
-- instrument and metric, which is what the data actually is.
--
-- ── SIZE (measured by `bake-series-columns.ts --dry-run`, not estimated) ──────
--   50 state-temp rows   27,759 days each (1950-01-01 .. 2025-12-31)     2.65 MB
--   18 tide rows         spans vary by gauge, longest 45,289 days        0.73 MB
--    9 buoy rows         spans vary by station                           0.19 MB
--    5 needle rows       27,940 days (1950-01-01 .. 2026-06-30)          0.27 MB
--   ── 82 rows, 3.83 MB before TOAST. (The registry declares 89
--      (instrument, metric) pairs; 7 hold no readings in the cache and get no
--      row rather than an empty one.) Tide and buoy columns are majority
--      sentinel, which pglz crushes; the state columns are ~100% present.
--
-- A card request reads ONE row. Maryland is 55,518 bytes, which PostgREST renders
-- as a 108 KB `\x…` hex string. Hex doubles the payload; if that ever matters,
-- the fix is a read RPC returning `encode(readings,'base64')`, the way
-- board_frames_range already serves `dots` — not a change to this table.
--
-- ── WRITES ────────────────────────────────────────────────────────────────────
-- Service role only, from scripts/frames/bake-series-columns.ts. Anon is
-- read-only: anon write grants were revoked cluster-wide (20260724231500) and the
-- schema default now denies them — nothing here re-adds any.

CREATE TABLE IF NOT EXISTS board_series_columns (
  instrument_id text     NOT NULL,          -- 'ghcn-md', 'tide-8574680', 'needle-ao'
  metric        text     NOT NULL,          -- 'avg_high_f', 'residual_max_ft', 'value'
  first_day     date     NOT NULL,          -- the day at byte offset 0
  n_days        integer  NOT NULL,          -- contiguous days covered; last_day = first_day + n_days - 1
  scale         integer  NOT NULL,          -- value = int16 / scale
  readings      bytea    NOT NULL,          -- big-endian int16 per day; -32768 = no reading
  n_present     integer  NOT NULL,          -- days with a reading (n_days - n_present = sentinels)
  first_year    smallint NOT NULL,          -- calendar year of the first PRESENT reading
  last_year     smallint NOT NULL,          -- calendar year of the last PRESENT reading
  min_value     double precision,           -- over present readings, in physical units
  max_value     double precision,
  source        text     NOT NULL,          -- the lane this came from, for the methods note
  baked_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instrument_id, metric)
);

-- The load-bearing invariant. If the blob and n_days ever disagree, every day
-- after the discrepancy is read at the wrong offset and the card counts the wrong
-- calendar — silently, and only ever noticed by a hunter who was there.
ALTER TABLE board_series_columns DROP CONSTRAINT IF EXISTS board_series_columns_length;
ALTER TABLE board_series_columns
  ADD CONSTRAINT board_series_columns_length
  CHECK (octet_length(readings) = n_days * 2);

ALTER TABLE board_series_columns DROP CONSTRAINT IF EXISTS board_series_columns_scale;
ALTER TABLE board_series_columns
  ADD CONSTRAINT board_series_columns_scale
  CHECK (scale IN (1, 10, 100, 1000));

ALTER TABLE board_series_columns DROP CONSTRAINT IF EXISTS board_series_columns_present;
ALTER TABLE board_series_columns
  ADD CONSTRAINT board_series_columns_present
  CHECK (n_present >= 0 AND n_present <= n_days);

COMMENT ON COLUMN board_series_columns.readings IS
  'Big-endian int16 per day, contiguous from first_day. value = int16 / scale. -32768 = no reading (the int16 minimum, unreachable by any scaled value).';
COMMENT ON COLUMN board_series_columns.scale IS
  'Smallest power of ten making every reading in this series an exact integer. Chosen per row by the bake and verified round-trip, never assumed.';
COMMENT ON COLUMN board_series_columns.n_days IS
  'Contiguous day count. Calendar gaps are stored as sentinels, never skipped — the offset IS the date.';

-- Anon read exposure — /season reads this table directly through the anon client
-- (mirrors planting_climatology): a SELECT policy and a SELECT grant, nothing
-- else; writes come only from the service role (which bypasses RLS).
ALTER TABLE board_series_columns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read board_series_columns" ON board_series_columns;
CREATE POLICY "Public read board_series_columns" ON board_series_columns FOR SELECT USING (true);
GRANT SELECT ON board_series_columns TO anon, authenticated;
