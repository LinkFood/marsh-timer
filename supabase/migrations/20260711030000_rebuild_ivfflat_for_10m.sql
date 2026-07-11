-- IVFFlat rebuild for the 10M-row brain — SERVER-SIDE one-shot pg_cron job
-- (pattern proven by 20260705110000_rebuild_ivfflat_for_7m.sql).
--
-- WHY: the archive grew 7.6M → 9.95M rows since the 07-05 build (NCEI v2 +2.03M,
-- tide roster +183k, stitched events +4.2k, OTD +19.7k). lists=2645 was sized for
-- 7M; resize to lists=3155 (~sqrt(9.95M)), probes 51→56 (~sqrt(lists)).
--
-- IMPROVEMENT over 07-05: build the new index under a TEMP NAME first, then
-- drop-old + rename in a sub-second swap — semantic search stays SERVED BY THE
-- OLD INDEX for the entire hour-long build instead of going dark. Costs the
-- old+new overlap in disk (~25GB transient; disk is autoscaled).

SET search_path = public, extensions;

CREATE OR REPLACE FUNCTION public.run_ivfflat_rebuild()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  -- Done already? (canonical index carries the new sizing)
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'hunt_knowledge_embedding_idx'
      AND reloptions @> ARRAY['lists=3155']
  ) THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ivfflat-rebuild-oneshot') THEN
      PERFORM cron.unschedule('ivfflat-rebuild-oneshot');
    END IF;
    RETURN 'already built';
  END IF;

  IF NOT pg_try_advisory_xact_lock(hashtext('ivfflat-rebuild')) THEN
    RETURN 'another rebuild run is in progress';
  END IF;

  PERFORM set_config('maintenance_work_mem', '2GB', false);

  -- Stage 1: build the replacement under a temp name (old index keeps serving).
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'hunt_knowledge_embedding_idx_v2') THEN
    EXECUTE 'CREATE INDEX hunt_knowledge_embedding_idx_v2
      ON hunt_knowledge USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 3155)';
  END IF;

  -- Stage 2: sub-second swap. Fail fast on locks; the 30s cadence retries.
  PERFORM set_config('lock_timeout', '55s', false);
  DROP INDEX IF EXISTS hunt_knowledge_embedding_idx;
  ALTER INDEX hunt_knowledge_embedding_idx_v2 RENAME TO hunt_knowledge_embedding_idx;
  PERFORM set_config('lock_timeout', '0', false);

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ivfflat-rebuild-oneshot') THEN
    PERFORM cron.unschedule('ivfflat-rebuild-oneshot');
  END IF;
  RETURN 'built and swapped';
END;
$fn$;

-- Status RPC unchanged in shape; reports the canonical + temp index states.
CREATE OR REPLACE FUNCTION public.ivfflat_rebuild_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  idx regclass := to_regclass('public.hunt_knowledge_embedding_idx');
  idx2 regclass := to_regclass('public.hunt_knowledge_embedding_idx_v2');
BEGIN
  RETURN jsonb_build_object(
    'index_exists', idx IS NOT NULL,
    'reloptions', (SELECT reloptions FROM pg_class WHERE relname = 'hunt_knowledge_embedding_idx'),
    'index_size', CASE WHEN idx IS NOT NULL THEN pg_size_pretty(pg_relation_size(idx)) END,
    'v2_building_exists', idx2 IS NOT NULL,
    'v2_size', CASE WHEN idx2 IS NOT NULL THEN pg_size_pretty(pg_relation_size(idx2)) END,
    'job_scheduled', EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ivfflat-rebuild-oneshot'),
    'recent_runs', (
      SELECT jsonb_agg(jsonb_build_object(
        'status', d.status, 'start', d.start_time, 'end', d.end_time, 'msg', left(d.return_message, 200)
      ) ORDER BY d.start_time DESC)
      FROM (
        SELECT dd.status, dd.start_time, dd.end_time, dd.return_message
        FROM cron.job_run_details dd
        JOIN cron.job j ON j.jobid = dd.jobid
        WHERE j.jobname = 'ivfflat-rebuild-oneshot'
        ORDER BY dd.start_time DESC
        LIMIT 5
      ) d
    )
  );
END;
$fn$;

-- probes resized to match lists=3155. Same signature as the 07-05 version —
-- no argument changes, so no overload orphan (preserves all return columns).
CREATE OR REPLACE FUNCTION search_hunt_knowledge_v3(
  query_embedding vector(512),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10,
  filter_content_types text[] DEFAULT NULL,
  filter_state_abbr text DEFAULT NULL,
  filter_species text DEFAULT NULL,
  filter_date_from date DEFAULT NULL,
  filter_date_to date DEFAULT NULL,
  recency_weight float DEFAULT 0.0,
  exclude_du_report boolean DEFAULT false
)
RETURNS TABLE (
  id uuid, title text, content text, content_type text, tags text[],
  state_abbr text, species text, effective_date date, metadata jsonb,
  similarity float, signal_weight float
)
LANGUAGE plpgsql
AS $$
DECLARE
  inner_limit int;
BEGIN
  SET LOCAL statement_timeout = '30s';
  SET LOCAL ivfflat.probes = 56;

  IF filter_date_from IS NOT NULL OR filter_date_to IS NOT NULL THEN
    inner_limit := match_count * 40;
  ELSE
    inner_limit := match_count * 4;
  END IF;

  RETURN QUERY
  SELECT
    sub.id, sub.title, sub.content, sub.content_type, sub.tags,
    sub.state_abbr, sub.species, sub.effective_date, sub.metadata,
    sub.similarity, sub.signal_weight
  FROM (
    SELECT
      hk.id, hk.title, hk.content, hk.content_type, hk.tags,
      hk.state_abbr, hk.species, hk.effective_date, hk.metadata,
      (1 - (hk.embedding <=> query_embedding)) * COALESCE(hk.signal_weight, 1.0) AS similarity,
      COALESCE(hk.signal_weight, 1.0) AS signal_weight,
      (1 - (hk.embedding <=> query_embedding)) AS raw_similarity,
      CASE WHEN recency_weight > 0 AND hk.effective_date IS NOT NULL
        THEN (1.0 + recency_weight * exp(-1.0 * LEAST((CURRENT_DATE - hk.effective_date)::float, 365.0) / 30.0))
        ELSE 1.0
      END AS recency_boost
    FROM hunt_knowledge hk
    WHERE hk.embedding IS NOT NULL
      AND (filter_content_types IS NULL OR hk.content_type = ANY(filter_content_types))
      AND (filter_state_abbr IS NULL OR hk.state_abbr = filter_state_abbr)
      AND (filter_species IS NULL OR hk.species = filter_species)
      AND (NOT exclude_du_report OR hk.content_type NOT IN ('du_report', 'du_alert'))
    ORDER BY hk.embedding <=> query_embedding
    LIMIT inner_limit
  ) sub
  WHERE sub.raw_similarity > match_threshold
    AND (filter_date_from IS NULL OR sub.effective_date >= filter_date_from)
    AND (filter_date_to IS NULL OR sub.effective_date <= filter_date_to)
  ORDER BY sub.similarity * sub.recency_boost DESC
  LIMIT match_count;
END;
$$;

-- Arm the one-shot job. Idempotent unschedule-then-schedule.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ivfflat-rebuild-oneshot') THEN
    PERFORM cron.unschedule('ivfflat-rebuild-oneshot');
  END IF;
  PERFORM cron.schedule(
    'ivfflat-rebuild-oneshot',
    '30 seconds',
    $cron$ SET statement_timeout = 0; SET maintenance_work_mem = '2GB'; SELECT public.run_ivfflat_rebuild(); $cron$
  );
END;
$do$;

RESET search_path;
