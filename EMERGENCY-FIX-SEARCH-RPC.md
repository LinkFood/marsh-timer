# EMERGENCY FIX: Vector Search Completely Dead

**Date:** March 21, 2026
**Severity:** CRITICAL — all brain search is broken
**Impact:** Chat returns no brain data, Brain Search panel empty, pattern matching dead, convergence alerts can't scan brain

---

## What Happened

Claude Code deployed a new version of `hunt-search` edge function that calls `search_hunt_knowledge_v3` RPC. But the migration file that creates this RPC (`supabase/migrations/20260344_search_v3_rpc.sql`) was never run against the database. The old RPCs (v1, v2) also appear to not exist in the database.

**Result:** Every vector search silently returns `[]`. The edge function's embedding generation might succeed, but when it calls `supabase.rpc('search_hunt_knowledge_v3', ...)`, it gets null/error and falls back to empty.

## Immediate Fix

**Run this SQL in the Supabase SQL Editor** (Dashboard → SQL Editor → New Query):

```sql
-- Step 1: Add signal_weight column if it doesn't exist
ALTER TABLE hunt_knowledge ADD COLUMN IF NOT EXISTS signal_weight float DEFAULT 1.0;

-- Step 2: Create the v3 search RPC
SET search_path = public, extensions;

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
  id uuid,
  title text,
  content text,
  content_type text,
  tags text[],
  state_abbr text,
  species text,
  effective_date date,
  metadata jsonb,
  similarity float,
  signal_weight float
)
LANGUAGE plpgsql
AS $$
BEGIN
  SET LOCAL statement_timeout = '30s';

  RETURN QUERY
  SELECT
    hk.id,
    hk.title,
    hk.content,
    hk.content_type,
    hk.tags,
    hk.state_abbr,
    hk.species,
    hk.effective_date,
    hk.metadata,
    (1 - (hk.embedding <=> query_embedding)) * COALESCE(hk.signal_weight, 1.0) AS similarity,
    COALESCE(hk.signal_weight, 1.0) AS signal_weight
  FROM hunt_knowledge hk
  WHERE
    hk.embedding IS NOT NULL
    AND (1 - (hk.embedding <=> query_embedding)) > match_threshold
    AND (filter_content_types IS NULL OR hk.content_type = ANY(filter_content_types))
    AND (filter_state_abbr IS NULL OR hk.state_abbr = filter_state_abbr)
    AND (filter_species IS NULL OR hk.species = filter_species)
    AND (filter_date_from IS NULL OR hk.effective_date >= filter_date_from)
    AND (filter_date_to IS NULL OR hk.effective_date <= filter_date_to)
    AND (NOT exclude_du_report OR hk.content_type NOT IN ('du_report', 'du_alert'))
  ORDER BY
    (1 - (hk.embedding <=> query_embedding)) * COALESCE(hk.signal_weight, 1.0) *
    CASE WHEN recency_weight > 0 AND hk.effective_date IS NOT NULL
      THEN (1.0 + recency_weight * exp(-1.0 * (CURRENT_DATE - hk.effective_date)::float / 30.0))
      ELSE 1.0
    END
    DESC
  LIMIT match_count;
END;
$$;

RESET search_path;
```

**Step 3: Verify it works** — run this test query in the SQL editor:
```sql
-- This should return results if embeddings exist
SELECT count(*) FROM hunt_knowledge WHERE embedding IS NOT NULL;
```

## Secondary Issue: Brain Data Loss

The brain dropped from ~1.13M to ~617K entries. Major losses:

| Content Type | Was | Now | Status |
|-------------|-----|-----|--------|
| storm-event | 76,000+ | 0 | **WIPED** |
| nasa-power | had data | 0 | **WIPED** |
| anomaly-alert | had data | 0 | Gone |
| correlation-discovery | had data | 0 | Gone |
| alert-grade | had data | 0 | Gone |
| disaster-watch | had data | 0 | Gone |

**Current brain: 617K entries across 27 content types**

Top entries: usgs-water (267K), weather-realtime (75K), earthquake-event (70K), birdcast-historical (53K), photoperiod (37K)

The storm-event data was the largest dataset and critical for historical disaster pattern matching. It needs to be re-backfilled.

## After Fix: Test These

1. Brain Search panel: search "tornado" → should return results
2. Chat: "What's happening in Arkansas?" → FROM THE BRAIN should show data
3. hunt-search API: POST with any query → `vector` array should not be empty
4. Convergence alerts: should fire on next cron run with brain scan working again

## Also Still Needed

The IVFFlat index may need tuning. Check:
```sql
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'hunt_knowledge' AND indexdef LIKE '%ivfflat%';
```

If lists = 100 on 617K rows, rebuild with ~800 lists:
```sql
DROP INDEX IF EXISTS idx_hunt_knowledge_embedding;
CREATE INDEX idx_hunt_knowledge_embedding ON hunt_knowledge
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 800);
```

And set probes in the RPC or session:
```sql
SET ivfflat.probes = 20;
```
