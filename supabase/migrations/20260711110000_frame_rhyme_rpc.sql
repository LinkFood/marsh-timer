-- THE FRAME RHYME RPC (docs/THE-BOARD-SPINE.md §3.5, Rung 2f).
--
-- Server-side twin of scripts/frames/rhyme.ts: "days whose ground reads like this
-- day", where AS-EXTREME-AS ranks above MERELY-SIMILAR-DIRECTION. Brute-force over
-- all board_frames (the spine's v1 — "sub-second, no index; ship this first"). Same
-- metric as the script, byte-for-byte, so the two agree on the acceptance day.
--
-- THE METRIC (identical to the script — see its header for the full derivation):
--   per slot:  u = 2·(byte/254) − 1 ;  x = sign(u)·|u|^GAMMA     (255 = null slot)
--   over the slots BOTH frames read:
--     cos      = Σxy / √(Σx²·Σy²)          -- shape: same instruments, same way
--     r        = √(Σy² / Σx²)              -- candidate energy / target energy
--     magAgree = min(r, 1/r) ^ BETA        -- 1 = as-extreme-as, →0 = milder/wilder
--     score    = max(0, cos) · magAgree
--   The centre-at-0.5 + tail-emphasis kills the plain-cosine plateau (an ordinary
--   day sits at pct≈0.5 on every slot → x≈0 → no spurious direction); magAgree keeps
--   the magnitude cosine throws away, so a shallow same-shape day cannot tie a deep one.
--
-- Guards: same-season (p_doy_window = ±N calendar days, Dec/Jan wrap; NULL = all
-- seasons), self-exclusion (candidates within ±3 days of the target dropped),
-- min-overlap 80 readable shared slots (of 142).
--
-- NOT pushed by the builder — the main session applies this in the write queue.
-- Verify parity AFTER push:  SELECT * FROM frame_rhyme('2021-02-15', 15, 45);
-- must reproduce scripts/frames/rhyme.ts's top-15 for Uri (same order, scores to ~1e-3).

-- ─── metric constants, as SQL helpers so the RPC reads like the metric ──────────
-- Tail-emphasis exponent GAMMA = 1.5, magnitude-agreement BETA = 1.0 (script defaults).

-- Signed tail-emphasis transform of one packed slot byte. 255 → NULL (unreadable).
CREATE OR REPLACE FUNCTION _frame_tail(b int)
RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN b = 255 OR b IS NULL THEN NULL
    ELSE sign(2*(b/254.0) - 1) * power(abs(2*(b/254.0) - 1), 1.5)
  END;
$$;

-- Calendar-day distance ignoring year, Dec/Jan wrap — matches the script's fixed
-- (no-leap) cumulative-month ordinal exactly, so windows agree with the CLI.
CREATE OR REPLACE FUNCTION _frame_doy_offset(a date, b date)
RETURNS int
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH o AS (
    SELECT (ARRAY[0,31,59,90,120,151,181,212,243,273,304,334])[extract(month FROM a)::int]
             + extract(day FROM a)::int AS oa,
           (ARRAY[0,31,59,90,120,151,181,212,243,273,304,334])[extract(month FROM b)::int]
             + extract(day FROM b)::int AS ob
  )
  SELECT CASE WHEN abs(oa - ob) > 182 THEN 365 - abs(oa - ob) ELSE abs(oa - ob) END FROM o;
$$;

CREATE OR REPLACE FUNCTION frame_rhyme(
  p_day        date,
  p_topk       int DEFAULT 12,
  p_doy_window int DEFAULT NULL
)
RETURNS TABLE (
  day       date,
  score     double precision,
  cos       double precision,
  mag_agree double precision,
  overlap   int,
  matched   jsonb              -- top instruments that drove the rhyme (explainability)
)
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  v_layout int;
BEGIN
  -- decode only against the current layout (the §3.2 drift guard)
  SELECT version INTO v_layout FROM board_layout ORDER BY created_at DESC LIMIT 1;
  IF v_layout IS NULL THEN
    RAISE EXCEPTION 'frame_rhyme: no board_layout registered';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM board_frames f WHERE f.day = p_day) THEN
    RAISE EXCEPTION 'frame_rhyme: no frame for %', p_day;
  END IF;

  RETURN QUERY
  WITH slotmap AS (   -- offset → instrument, from the current manifest
    SELECT (s->>'offset')::int AS off, s->>'inst_id' AS inst_id
    FROM board_layout bl, jsonb_array_elements(bl.slot_manifest) s
    WHERE bl.version = v_layout
  ),
  tgt AS (            -- target's transformed, readable slots
    SELECT g.i AS off, _frame_tail(get_byte(tf.dots, g.i)) AS tx
    FROM board_frames tf, generate_series(0, 141) AS g(i)
    WHERE tf.day = p_day AND _frame_tail(get_byte(tf.dots, g.i)) IS NOT NULL
      AND tf.layout_version = v_layout
  ),
  pairs AS (          -- every candidate frame × the target's slots (shared, readable)
    SELECT f.day AS cday, t.off, t.tx,
           _frame_tail(get_byte(f.dots, t.off)) AS ty
    FROM board_frames f
    CROSS JOIN tgt t
    WHERE f.day <> p_day
      AND f.layout_version = v_layout
      AND abs(f.day - p_day) > 3                                    -- self-exclusion ±3d
      AND (p_doy_window IS NULL OR _frame_doy_offset(f.day, p_day) <= p_doy_window)
      AND _frame_tail(get_byte(f.dots, t.off)) IS NOT NULL
  ),
  agg AS (
    SELECT cday,
           sum(tx*ty) AS dot, sum(tx*tx) AS nx, sum(ty*ty) AS ny, count(*)::int AS n
    FROM pairs GROUP BY cday
  ),
  scored AS (
    SELECT cday, n,
           dot / sqrt(nx*ny)                       AS cos,
           power(least(sqrt(ny/nx), 1/sqrt(ny/nx)), 1.0) AS mag_agree
    FROM agg
    WHERE n >= 80 AND nx > 0 AND ny > 0
  ),
  ranked AS (
    SELECT cday, n, cos, mag_agree, greatest(0, cos) * mag_agree AS score
    FROM scored
    ORDER BY greatest(0, cos) * mag_agree DESC
    LIMIT p_topk
  )
  SELECT r.cday, r.score, r.cos, r.mag_agree, r.n,
         -- top-4 instruments by aligned joint depth (Σ positive tx·ty), for the receipt
         COALESCE((
           SELECT jsonb_agg(label ORDER BY contrib DESC)
           FROM (
             SELECT bi.label, sum(greatest(0, t.tx * _frame_tail(get_byte(f.dots, t.off)))) AS contrib
             FROM tgt t
             JOIN slotmap sm ON sm.off = t.off
             JOIN board_instruments bi ON bi.id = sm.inst_id
             JOIN board_frames f ON f.day = r.cday
             WHERE _frame_tail(get_byte(f.dots, t.off)) IS NOT NULL
               AND t.tx * _frame_tail(get_byte(f.dots, t.off)) > 0
             GROUP BY bi.label
             ORDER BY contrib DESC
             LIMIT 4
           ) q
         ), '[]'::jsonb) AS matched
  FROM ranked r
  ORDER BY r.score DESC;
END;
$fn$;

GRANT EXECUTE ON FUNCTION frame_rhyme(date, int, int)     TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION _frame_tail(int)                TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION _frame_doy_offset(date, date)   TO anon, authenticated, service_role;
