-- IVFFlat index rebuild for 7M-row brain
-- Current: hunt_knowledge_embedding_idx with lists=1414 (sized for ~2M rows)
-- Target: lists=2645 = sqrt(7M), probes=51 = sqrt(2645)
--
-- WARNING: This migration LOCKS WRITES on hunt_knowledge for 30-60 minutes
-- while the new index builds. All ingestion crons will fail during the rebuild.
-- Run during a low-traffic window.
--
-- Apply manually with `npx supabase db push` during a low-traffic window.

SET statement_timeout = '0';
-- pgvector requires ~1637MB to k-means-train lists=2645 on 7.6M x 512-dim vectors
-- (build failed 2026-07-02 at the previous 512MB setting, SQLSTATE 54000)
SET maintenance_work_mem = '2GB';
SET search_path = public, extensions;

-- Drop the existing undersized index.
-- BOTH historical names — the April rebuild silently no-oped because it
-- dropped idx_hunt_knowledge_embedding while the live index was named
-- hunt_knowledge_embedding_idx. Dropping both makes this rebuild robust
-- regardless of which name is live.
DROP INDEX IF EXISTS idx_hunt_knowledge_embedding;
DROP INDEX IF EXISTS hunt_knowledge_embedding_idx;

-- Build with proper sizing for 7M rows
CREATE INDEX hunt_knowledge_embedding_idx
  ON hunt_knowledge USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 2645);

-- Update v3 RPC probes to match new lists
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

-- Reschedule pattern-link-worker after rebuild completes.
-- Idempotent unschedule-then-schedule — bare cron.schedule is NOT idempotent
-- and an error here would roll back the 30-60 min index build.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hunt-pattern-link-worker') THEN
    PERFORM cron.unschedule('hunt-pattern-link-worker');
  END IF;
  PERFORM cron.schedule(
    'hunt-pattern-link-worker',
    '*/15 * * * *',
    $cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-pattern-link-worker',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
    $cron$
  );
END;
$do$;

RESET search_path;
RESET maintenance_work_mem;
RESET statement_timeout;
