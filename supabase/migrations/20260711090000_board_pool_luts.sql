-- THE BOARD — Rung 2: THE POOL LUTs (docs/THE-BOARD-SPINE.md §2, §5.1).
--
-- WHY: hunt-frame-daily (the live edge) used to recompute every instrument's
-- 77-year same-doy±N pool on EVERY invocation — hundreds of REST reads across all
-- years, per lane — and hung past the edge wall (120s timeout, HTTP 000). The pool
-- is global-per-instrument-per-doy and never changes for history, so it is computed
-- ONCE by the backfill (from the disk-cached series) and read daily.
--
-- WHAT: one row per (layout_version, instrument_id, metric, doy 1..366) holding the
-- byte-quantile lookup that converts a raw day-0 reading to the 0..254 board byte —
-- EXACTLY as scripts/board/tailDepth.ts does, but as a single binary search instead
-- of a full pool scan:
--
--   below(v) = count of pool values strictly < v          (the strict-less-than rank)
--   lowRank  = 1 - below/n ;  highRank = below/n           (tailDepth's two ranks)
--   pct      = side==low ? lowRank : highRank              (directional slot)
--   if years < 10: pct = min(pct, 0.6)                     (honesty floor, §2.5)
--   byte     = round(pct * 254)                            (255 = null)
--
-- REPRESENTATION (byte-exact, compact): the pool is stored as its SORTED DISTINCT
-- values `vals` (real[]) with, for each, `below[j]` = the number of pool values
-- strictly less than vals[j] (below[0]=0). A single binary search for the daily v
-- gives the exact `below` count for ANY v (measured: distinct values are ~5x fewer
-- than the raw pool for quantized temp/tide/buoy, so this is far smaller than the
-- raw pool while reproducing tailDepth's strict-less-than count bit-for-bit).
--
--   below(v): j = first index with vals[j] >= v ; below = (j < len) ? below[j] : n
--
-- `layout_version` pins the LUT to the registry ordering it was baked against — the
-- same drift guard board_frames carries (§7.2); the daily edge reads only LUTs whose
-- version matches the current board_layout.
--
-- Row contract: board_* tables are NEW (§7.3) — never touch hunt_ or JAC tables.
-- Populated by scripts/frames/bake-luts.ts from the shared frame cache.

CREATE TABLE IF NOT EXISTS board_pool_luts (
  layout_version int      NOT NULL REFERENCES board_layout(version),
  instrument_id  text     NOT NULL,             -- 'ghcn-tx', 'tide-8574680', 'buoy-42035', 'needle-ao'
  metric         text     NOT NULL,             -- the source field: 'avg_high_f' | 'residual_max_ft' | ...
  doy            smallint NOT NULL,             -- 1..366, the pool-center day-of-year (leap-year/2000 ordinal)
  vals           real[]   NOT NULL,             -- sorted DISTINCT pool values, ascending
  below          integer[] NOT NULL,            -- strict-less-than count at each vals[j]; below[0]=0
  n              integer  NOT NULL,             -- pool size (with duplicates) — the rank denominator
  years          smallint NOT NULL,             -- distinct calendar years in the pool (honesty floor §2.5)
  PRIMARY KEY (layout_version, instrument_id, metric, doy)
);

-- The daily read pulls one (or two) doy's worth of rows for the current layout.
CREATE INDEX IF NOT EXISTS board_pool_luts_doy_idx ON board_pool_luts (layout_version, doy);
