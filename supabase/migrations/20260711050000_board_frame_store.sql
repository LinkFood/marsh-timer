-- THE BOARD — Rung 2: THE FRAME STORE (docs/THE-BOARD-SPINE.md §1, §3, §6).
--
-- One row per day, every instrument's depth-into-its-own-tail precomputed once,
-- served in a range query. This migration builds the substrate only — the seed
-- (scripts/frames/seed-instruments.ts) and the backfill (scripts/frames/
-- backfill-frames.ts) populate it; the live edge (hunt-frame-daily) maintains
-- today's row.
--
-- Tables:
--   board_instruments  — the registry (§1.3): what a "dot" is + precomputed Albers.
--   board_layout       — the layout_version guard (§3.2 / §7.2): the ordered slot
--                        manifest a frame's bytes decode against. THE sharpest
--                        footgun in the design gets its own home.
--   board_frames       — one bytea-packed row per day (§3.1).
--   board_strings      — string edge defs (§3.3), populated by the Lookout Mine;
--                        the range-read RPC returns these once per response.
--   board_frames_range — the read-only serve RPC (§6.1), range-capped ≤120 days,
--                        layout-guarded.
--
-- Row contract: all board_* tables are NEW (§7.3) — never touch hunt_ or JAC
-- tables. Bloom refs point at source rows; the board copies nothing it references.
-- NOT pushed to the DB by the builder — the main session fires it in the write
-- queue after the IVFFlat rebuild + AO backfill.

-- ─── 1. THE INSTRUMENT REGISTRY (§1.3) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS board_instruments (
  id            text PRIMARY KEY,           -- 'ghcn-tx', 'tide-8574680', 'buoy-42035', 'needle-ao'
  kind          text NOT NULL,              -- 'state-temp' | 'tide' | 'buoy' | 'needle' (player contract)
  label         text NOT NULL,              -- 'Texas', 'Baltimore', 'Arctic Oscillation'
  sublabel      text,                       -- 'air temperature', 'tide setdown', "the pole's grip"
  lane          text NOT NULL,              -- 'air' | 'water-level' | 'ocean-pressure' | 'climate' (LENSES key)
  lat           double precision,           -- null for national needles
  lng           double precision,
  albers_x      real,                       -- PRECOMPUTED at canonical 975×610 (projection.ts)
  albers_y      real,                       -- needles get a fixed chrome position (AO: 487,28)
  proj_version  int  NOT NULL DEFAULT 1,    -- bump if the CONUS-fit projection changes
  source_ct     text NOT NULL,              -- how to read the daily scalar: 'ghcn-daily' | 'tide-gauge'
                                            --   | 'ocean-buoy-historical' | 'climate-index' | 'cpc-daily-ao'
  source_key    jsonb NOT NULL,             -- {"state_abbr":"TX"} | {"station_id":"8574680"} | {"index_id":"AO"}
  metrics       jsonb NOT NULL,             -- ordered array of metric defs (§2.4) — defines this dot's slots
  slot_offset   int  NOT NULL,              -- byte index where this instrument's slots begin (decode order)
  slot_count    int  NOT NULL,              -- how many slots (two-sided metric = 2, one-sided = 1)
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS board_instruments_lane_idx ON board_instruments (lane) WHERE active;
CREATE INDEX IF NOT EXISTS board_instruments_slot_idx ON board_instruments (slot_offset) WHERE active;

-- ─── 2. THE LAYOUT GUARD (§3.2, §7.2) ──────────────────────────────────────────
-- layout_version = a serial/hash over the ordered instrument+metric slot list.
-- Every frame stores its layout_version; the serve RPC decodes ONLY frames that
-- match the current (latest) layout. Reorder/add an instrument → new version →
-- old frames refuse to decode until recomputed. This is the drift footgun's guard.
CREATE TABLE IF NOT EXISTS board_layout (
  version         int PRIMARY KEY,          -- computed by the seed (hash of the ordered slot manifest)
  slot_manifest   jsonb NOT NULL,           -- [{inst_id, metric, direction, offset}] in byte order
  instrument_count int NOT NULL,
  slot_count      int NOT NULL,
  note            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── 3. THE FRAME BLOB — one row per day (§3.1) ────────────────────────────────
CREATE TABLE IF NOT EXISTS board_frames (
  day            date PRIMARY KEY,
  layout_version int   NOT NULL REFERENCES board_layout(version),
  dots           bytea NOT NULL,            -- packed uint8, one byte per SLOT in layout order
                                            --   255 = null (no reading / below min_years floor)
                                            --   else round(pct × 254), pct ∈ [0,1]
  strings        jsonb,                     -- { "<string_id>": activation 0..1 } (few — earned only)
  blooms         jsonb,                     -- [ { ref_ct, ref_id, lat, lng, label, severity } ]
  day0_source    text,                      -- 'live'|'live-yesterday'|'archive' for the leading lane (audit)
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS board_frames_layout_idx ON board_frames (layout_version);

-- ─── 4. THE STRINGS — edges defined once (§3.3) ────────────────────────────────
CREATE TABLE IF NOT EXISTS board_strings (
  id           text PRIMARY KEY,
  from_inst    text REFERENCES board_instruments(id),
  to_target    text,                        -- instrument id OR a region key (e.g. 'ghcn-tx')
  precedent_ct int,                         -- thickness = court/mine precedent count (EARNED)
  receipt      text,                        -- the tap-strip sentence
  source       text,                        -- 'lookout' | 'graded-claim' | 'pattern-link'
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── 5. THE SERVE RPC — range read (§6.1) ──────────────────────────────────────
-- Read-only, no precompute-on-request. Instruments + string defs sent once; each
-- frame carries only its packed dots (base64) + activations + blooms. Range is
-- capped ≤120 days so payload stays < 200 KB at the 500-instrument target. Only
-- frames matching the CURRENT layout_version are returned (the drift guard).
CREATE OR REPLACE FUNCTION board_frames_range(p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  v_layout  int;
  v_result  jsonb;
BEGIN
  IF p_to < p_from THEN
    RAISE EXCEPTION 'board_frames_range: to (%) is before from (%)', p_to, p_from;
  END IF;
  IF p_to - p_from > 120 THEN
    RAISE EXCEPTION 'board_frames_range: range % days exceeds the 120-day cap (§6.1)', p_to - p_from;
  END IF;

  SELECT version INTO v_layout FROM board_layout ORDER BY created_at DESC LIMIT 1;
  IF v_layout IS NULL THEN
    RAISE EXCEPTION 'board_frames_range: no board_layout registered — run the seed first';
  END IF;

  SELECT jsonb_build_object(
    'projection', jsonb_build_object('width', 975, 'height', 610, 'version', 1),
    'layout_version', v_layout,
    'instruments', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', i.id, 'kind', i.kind, 'label', i.label, 'sublabel', i.sublabel,
          'lane', i.lane, 'x', i.albers_x, 'y', i.albers_y,
          'slots', i.metrics
        ) ORDER BY i.slot_offset
      )
      FROM board_instruments i WHERE i.active
    ), '[]'::jsonb),
    'strings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', s.id, 'from', s.from_inst, 'to', s.to_target,
        'precedent_ct', s.precedent_ct, 'receipt', s.receipt
      ))
      FROM board_strings s
    ), '[]'::jsonb),
    'frames', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'day', to_char(f.day, 'YYYY-MM-DD'),
          'dots', encode(f.dots, 'base64'),
          'strings', COALESCE(f.strings, '{}'::jsonb),
          'blooms', COALESCE(f.blooms, '[]'::jsonb),
          'day0_source', f.day0_source
        ) ORDER BY f.day
      )
      FROM board_frames f
      WHERE f.day >= p_from AND f.day <= p_to
        AND f.layout_version = v_layout   -- drift guard: refuse mismatched frames
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$fn$;

-- PostgREST exposure (read-only surfaces fan out freely; this is a read RPC).
GRANT EXECUTE ON FUNCTION board_frames_range(date, date) TO anon, authenticated, service_role;
