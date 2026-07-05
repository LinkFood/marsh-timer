-- IVFFlat rebuild for the 7.6M-row brain — SERVER-SIDE via one-shot pg_cron job.
-- Three client-side attempts failed for environmental reasons (restart mid-build,
-- disk exhaustion pre-autoscale, client TCP timeout while queueing for the lock).
-- This migration is FAST: it installs a rebuild function + status RPC and schedules
-- a self-unscheduling pg_cron job. The hour-long CREATE INDEX runs entirely inside
-- the database — no client connection to break.

SET search_path = public, extensions;

-- The rebuild worker. Advisory try-lock makes concurrent firings no-op instantly;
-- the reloptions check makes post-success firings no-op; self-unschedules when done.
CREATE OR REPLACE FUNCTION public.run_ivfflat_rebuild()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'hunt_knowledge_embedding_idx'
      AND reloptions @> ARRAY['lists=2645']
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
  -- Fail fast on the drop locks; the 30s job cadence is the retry loop.
  PERFORM set_config('lock_timeout', '55s', false);
  DROP INDEX IF EXISTS idx_hunt_knowledge_embedding;
  DROP INDEX IF EXISTS hunt_knowledge_embedding_idx;
  PERFORM set_config('lock_timeout', '0', false);

  EXECUTE 'CREATE INDEX hunt_knowledge_embedding_idx
    ON hunt_knowledge USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 2645)';

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ivfflat-rebuild-oneshot') THEN
    PERFORM cron.unschedule('ivfflat-rebuild-oneshot');
  END IF;
  RETURN 'built';
END;
$fn$;

-- Poll this over PostgREST to watch the build land.
CREATE OR REPLACE FUNCTION public.ivfflat_rebuild_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  idx regclass := to_regclass('public.hunt_knowledge_embedding_idx');
BEGIN
  RETURN jsonb_build_object(
    'index_exists', idx IS NOT NULL,
    'reloptions', (SELECT reloptions FROM pg_class WHERE relname = 'hunt_knowledge_embedding_idx'),
    'index_size', CASE WHEN idx IS NOT NULL THEN pg_size_pretty(pg_relation_size(idx)) END,
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

-- probes must match the new lists sizing; safe to apply before the index lands.
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
  SET LOCAL ivfflat.probes = 51;

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

-- pattern-link-worker rescheduling intentionally deferred to a post-verify
-- migration — it must not resume until the index is confirmed live.

RESET search_path;
