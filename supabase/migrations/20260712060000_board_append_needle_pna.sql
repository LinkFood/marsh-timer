-- THE BOARD — live expansion #1 (2026-07-12): append needle-pna.
--
-- First new instrument since the v1 seed (layout 2005746365, 71 instruments,
-- 142 slots). PNA = Pacific–North American pattern, daily 1950+ from the
-- archive's climate-index-daily rows (the 2026-07-11 AO/NAO/PNA daily pipe).
--
-- THE APPEND-ONLY LAW (registry.ts APPEND_ORDER — the rule that makes expanding
-- a LIVE front door safe): the new instrument's two slots go at the END of the
-- slot manifest (offsets 142, 143). Every existing offset survives byte-for-byte
-- (verified: new manifest[0..141] identical to stored v1 manifest before this
-- was written). Readers treat missing bytes as 255 (no reading), so mid-backfill
-- an old 142-byte frame shows PNA as absent — honest degradation, never garbage.
--
-- New layout_version 1711701607 = registry.ts buildLayout() hash over the
-- 144-entry manifest. board_frames_range serves only the LATEST layout, so the
-- room is dark from this push until the backfill upserts new-layout frames —
-- run the 2026-bounded backfill immediately after pushing.

-- Guard: the layout we append to must be the v1 seed exactly as recorded.
DO $mig$
DECLARE
  v_old_count int;
BEGIN
  SELECT slot_count INTO v_old_count FROM board_layout WHERE version = 2005746365;
  IF v_old_count IS DISTINCT FROM 142 THEN
    RAISE EXCEPTION 'append-only guard: expected v1 layout 2005746365 with 142 slots, found %', v_old_count;
  END IF;
END
$mig$;

-- v2 layout: the stored v1 manifest + the two appended PNA entries. Built FROM
-- the DB row (not retyped) so append-only is guaranteed against what's live.
INSERT INTO board_layout (version, slot_manifest, instrument_count, slot_count, note)
SELECT 1711701607,
       slot_manifest
         || '[{"inst_id":"needle-pna","metric":"value","side":"low","offset":142},
              {"inst_id":"needle-pna","metric":"value","side":"high","offset":143}]'::jsonb,
       instrument_count + 1,
       slot_count + 2,
       'v2 — append needle-pna (append-only law; offsets 0–141 unchanged)'
FROM board_layout
WHERE version = 2005746365
ON CONFLICT (version) DO NOTHING;

-- The instrument row — mirrors registry.ts needle-pna exactly (seed idempotency).
-- Sky-row chrome position: one 120px step WEST of AO (367,28) — x=967 would clip
-- the glow ring against the 975px canvas edge.
INSERT INTO board_instruments
  (id, kind, label, sublabel, lane, lat, lng, albers_x, albers_y, proj_version,
   source_ct, source_key, metrics, slot_offset, slot_count, active)
VALUES
  ('needle-pna', 'needle', 'Pacific–North American Pattern', 'the jet stream''s arc',
   'climate', NULL, NULL, 367, 28, 1,
   'climate-index-daily', '{"index_id":"PNA"}'::jsonb,
   '[{"field":"value","direction":"two-sided","n_days":15,"min_years":10,"label":"the index"}]'::jsonb,
   142, 2, true)
ON CONFLICT (id) DO NOTHING;
