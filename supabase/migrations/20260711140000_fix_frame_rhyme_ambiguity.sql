-- Fix frame_rhyme 42702: RETURNS TABLE columns (cos, mag_agree, score, day,
-- overlap) are in plpgsql scope and collide with same-named CTE aliases in the
-- RETURN QUERY. Rename all internal aliases with a c_ prefix; identical math,
-- identical signature (no overload orphan), identical output shape.

SET search_path = public, extensions;

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
  matched   jsonb
)
LANGUAGE plpgsql
STABLE
AS $fn$
DECLARE
  v_layout int;
BEGIN
  SELECT version INTO v_layout FROM board_layout ORDER BY created_at DESC LIMIT 1;
  IF v_layout IS NULL THEN
    RAISE EXCEPTION 'frame_rhyme: no board_layout registered';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM board_frames f WHERE f.day = p_day) THEN
    RAISE EXCEPTION 'frame_rhyme: no frame for %', p_day;
  END IF;

  RETURN QUERY
  WITH slotmap AS (
    SELECT (s->>'offset')::int AS off, s->>'inst_id' AS inst_id
    FROM board_layout bl, jsonb_array_elements(bl.slot_manifest) s
    WHERE bl.version = v_layout
  ),
  tgt AS (
    SELECT g.i AS off, _frame_tail(get_byte(tf.dots, g.i)) AS tx
    FROM board_frames tf, generate_series(0, 141) AS g(i)
    WHERE tf.day = p_day AND _frame_tail(get_byte(tf.dots, g.i)) IS NOT NULL
      AND tf.layout_version = v_layout
  ),
  pairs AS (
    SELECT f.day AS cday, t.off, t.tx,
           _frame_tail(get_byte(f.dots, t.off)) AS ty
    FROM board_frames f
    CROSS JOIN tgt t
    WHERE f.day <> p_day
      AND f.layout_version = v_layout
      AND abs(f.day - p_day) > 3
      AND (p_doy_window IS NULL OR _frame_doy_offset(f.day, p_day) <= p_doy_window)
      AND _frame_tail(get_byte(f.dots, t.off)) IS NOT NULL
  ),
  agg AS (
    SELECT cday,
           sum(tx*ty) AS c_dot, sum(tx*tx) AS c_nx, sum(ty*ty) AS c_ny, count(*)::int AS c_n
    FROM pairs GROUP BY cday
  ),
  scored AS (
    SELECT cday, c_n,
           c_dot / sqrt(c_nx*c_ny)                                  AS c_cos,
           power(least(sqrt(c_ny/c_nx), 1/sqrt(c_ny/c_nx)), 1.0)    AS c_mag
    FROM agg
    WHERE c_n >= 80 AND c_nx > 0 AND c_ny > 0
  ),
  ranked AS (
    SELECT cday, c_n, c_cos, c_mag, greatest(0, c_cos) * c_mag AS c_score
    FROM scored
    ORDER BY greatest(0, c_cos) * c_mag DESC
    LIMIT p_topk
  )
  SELECT r.cday, r.c_score, r.c_cos, r.c_mag, r.c_n,
         COALESCE((
           SELECT jsonb_agg(q.label ORDER BY q.contrib DESC)
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
  ORDER BY r.c_score DESC;
END;
$fn$;

RESET search_path;
