# BUILD SPEC: Ops Dashboard Findings — Fix Handoff

**Date:** March 22, 2026
**Priority:** CRITICAL — 23/25 crons dead, self-grading loop broken, alert accuracy 0%
**Context:** The /ops dashboard is live and working. It revealed the system is 92% offline. This spec fixes everything it found.

---

## WHAT THE OPS DASHBOARD SHOWS

```
System Pulse:   2,177,101 brain entries | +391,297 today | 54 types
Cron Health:    2 healthy | 0 error | 0 late | 23 unknown ("never_run")
Alert Perf:     121 alerts fired | 0 graded | 0% accuracy | 121 pending
Data Freshness: 8+ content types STALE (>7 days old)
Active Scans:   convergence-scan firing at 70-87s execution time
```

Only `hunt-weather-realtime` (every 15min) and `hunt-convergence-scan` (event-triggered) are actually running.

---

## ROOT CAUSE: Migration 20260348 Not Applied

The file `supabase/migrations/20260348_register_all_crons.sql` exists in the repo and registers 30 pg_cron jobs. But the ops dashboard shows 23 crons at "never_run" — meaning **this migration was never pushed to the remote Supabase database**.

### Step 1: Verify pg_cron state (run in Supabase SQL Editor)

```sql
-- See what's actually registered in pg_cron
SELECT jobid, jobname, schedule, active
FROM cron.job
ORDER BY jobname;
```

If this returns only 2-3 rows (weather-realtime, convergence-scan, maybe convergence-report-card), the migration was never applied.

### Step 2: Apply the migration

Option A — Run the full SQL from `20260348_register_all_crons.sql` in the Supabase SQL Editor.

Option B — Push via Supabase CLI:
```bash
supabase db push --linked
```

### Step 3: Verify registration

```sql
-- Should return 30 rows after applying
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname LIKE 'hunt-%'
ORDER BY jobname;
```

---

## CRITICAL BUG: 16 Crons Missing From Migration

Migration 20260348 registers 30 jobs but **omits 16 crons** that were registered in earlier wave migrations (20260330-20260334). These need to be added in a new migration.

### Missing crons to register:

```sql
-- FILE: supabase/migrations/20260349_register_missing_crons.sql

-- Daily 5:30 AM UTC
SELECT cron.schedule(
  'hunt-birdweather-daily',
  '30 5 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-birdweather',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Daily 7:00 AM UTC
SELECT cron.schedule(
  'hunt-snow-cover-daily',
  '0 7 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-snow-cover',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Daily 8:00 AM UTC
SELECT cron.schedule(
  'hunt-snotel-daily',
  '0 8 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-snotel',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Daily 9:30 AM UTC (gbif-daily shares slot with anomaly-detector — offset by 15min)
SELECT cron.schedule(
  'hunt-gbif-daily',
  '45 9 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-gbif',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Daily 11:00 AM UTC
SELECT cron.schedule(
  'hunt-multi-species-daily',
  '0 11 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-multi-species',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Daily 12:00 PM UTC
SELECT cron.schedule(
  'hunt-search-trends-daily',
  '0 12 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-search-trends',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Daily 11:00 PM UTC
SELECT cron.schedule(
  'hunt-query-signal-daily',
  '0 23 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-query-signal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Every 6 hours
SELECT cron.schedule(
  'hunt-power-outage-6h',
  '0 */6 * * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-power-outage',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Weekly Monday 11:00 AM UTC
SELECT cron.schedule(
  'hunt-climate-indices-weekly',
  '0 11 * * 1',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-climate-indices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Weekly Monday 2:00 PM UTC
SELECT cron.schedule(
  'hunt-movebank-weekly',
  '0 14 * * 1',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-movebank',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Weekly Wednesday 9:00 AM UTC
SELECT cron.schedule(
  'hunt-phenology-weekly',
  '0 9 * * 3',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-phenology',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Weekly Friday 2:00 PM UTC
SELECT cron.schedule(
  'hunt-crop-progress-weekly',
  '0 14 * * 5',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-crop-progress',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Weekly Saturday 8:00 AM UTC
SELECT cron.schedule(
  'hunt-historical-news-weekly',
  '0 8 * * 6',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-historical-news',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- Monthly 1st 6:00 AM UTC
SELECT cron.schedule(
  'hunt-usfws-survey-monthly',
  '0 6 1 * *',
  $cron$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url') || '/functions/v1/hunt-usfws-survey',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
```

### Also update hunt-cron-health to track these 16

**File:** `supabase/functions/hunt-cron-health/index.ts`

Add to the `cronNames` array (line 15-25):
```typescript
'hunt-birdweather', 'hunt-snow-cover', 'hunt-snotel', 'hunt-gbif',
'hunt-multi-species', 'hunt-search-trends', 'hunt-query-signal',
'hunt-power-outage', 'hunt-climate-indices', 'hunt-movebank',
'hunt-phenology', 'hunt-crop-progress', 'hunt-historical-news',
'hunt-usfws-survey',
```

Add corresponding entries to the `expected` array (line 57-83).

---

## BUG FIXES (ordered by severity)

### BUG-1: Alert Grading Loop Broken — Field Name Mismatch (CRITICAL)

**The self-grading loop is completely broken.** 121 alerts are stuck at "pending" with 0% accuracy.

**Root cause:** `hunt-alert-grader` writes `outcome_grade` but `hunt-alert-calibration` reads `outcome_status`.

**Files:**
- `supabase/functions/hunt-alert-grader/index.ts` ~line 323
- `supabase/functions/hunt-alert-calibration/index.ts` line 51

**Fix:** Make them consistent. Check the actual column name in `hunt_alert_outcomes`:

```sql
-- Run in SQL Editor to check actual column name
SELECT column_name FROM information_schema.columns
WHERE table_name = 'hunt_alert_outcomes'
AND column_name LIKE 'outcome%';
```

Then fix whichever function uses the wrong name. If the column is `outcome_grade`:
- In `hunt-alert-calibration/index.ts` line 51: change `outcome_status` → `outcome_grade`

If the column is `outcome_status`:
- In `hunt-alert-grader/index.ts` ~line 323: change `outcome_grade` → `outcome_status`

### BUG-2: hunt-drought-monitor Response Signature (HIGH)

**File:** `supabase/functions/hunt-drought-monitor/index.ts`

The shared `response.ts` module requires `request` as the first parameter:
```typescript
// response.ts signature:
export function successResponse<T>(request: Request, data: T, status = 200): Response
export function errorResponse(request: Request, message: string, status = 400): Response
```

But hunt-drought-monitor calls them wrong:

**Line ~203:** `successResponse({ embedded, errors, durationMs })` → missing `req`
**Line ~214:** `errorResponse(String(err), 500)` → missing `req`

**Fix:**
```typescript
// Line ~203
return successResponse(req, { embedded: totalEmbedded, errors, durationMs });

// Line ~214
return errorResponse(req, String(err), 500);
```

This function will crash on EVERY invocation because it passes the data object where `request` is expected. Even if the cron fires, the response will fail.

### BUG-3: hunt-birdcast eval() on Untrusted HTML (HIGH)

**File:** `supabase/functions/hunt-birdcast/index.ts` line ~79

```typescript
// CURRENT (unsafe):
const parsed = new Function('return ' + raw)();

// FIX — use JSON.parse with cleanup:
const cleaned = raw
  .replace(/undefined/g, 'null')
  .replace(/,\s*}/g, '}')
  .replace(/,\s*]/g, ']');
const parsed = JSON.parse(cleaned);
```

The `Function()` constructor is executing arbitrary code from an external HTML page. While it's a known BirdCast payload, any change in their markup could inject code.

### BUG-4: IVFFlat Index Setting Wrong in RPC (MEDIUM)

**File:** `search_hunt_knowledge_v3` RPC (check in SQL Editor)

The brain uses IVFFlat indexing but the RPC may still set `hnsw.ef_search`:

```sql
-- Check current RPC body
SELECT prosrc FROM pg_proc WHERE proname = 'search_hunt_knowledge_v3';
```

**Fix:** If it says `SET LOCAL hnsw.ef_search = 80`:
```sql
-- Should be:
SET LOCAL ivfflat.probes = 10;
```

### BUG-5: Dispatcher Can't Search Historical Data (CRITICAL)

**File:** `supabase/functions/hunt-dispatcher/index.ts`

Chat says "no stored entries" for queries like "What happened in TX Feb 2021" even though `hunt-search` returns perfect results with the same query.

**Root cause:** The `search` and `general` intent handlers query recent 48hr activity instead of using the embedding + `search_hunt_knowledge_v3` RPC with date filters.

**Fix:** When user query references a time period:
1. Extract `date_from` / `date_to` from the query
2. Pass them to `search_hunt_knowledge_v3` RPC call
3. The search and general handlers need to use the embedding + RPC path (same as hunt-search does)

### BUG-6: Search Result Dedup (MEDIUM)

**File:** `supabase/functions/hunt-search/index.ts`

Add dedup after vector results:
```typescript
const seen = new Set();
const deduped = vectorResults.filter(r => {
  const key = `${r.title}-${r.effective_date}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
```

### BUG-7: Recency Weight Default (LOW)

**File:** `supabase/functions/hunt-search/index.ts` line ~53

Change: `recency_weight ?? 0.0` → `recency_weight ?? 0.1`

### BUG-8: Missing logCronRun on Success Paths (LOW)

**Files:** hunt-nws-monitor, hunt-check-user-alerts, hunt-search-trends

Each has `logCronRun` on error paths but NOT on success exits. Add:
```typescript
await logCronRun(supabase, {
  functionName: 'hunt-FUNCTION-NAME',
  status: 'success',
  summary: { /* relevant counts */ },
  durationMs: Date.now() - startTime,
});
```

---

## PERFORMANCE: Convergence Scan Takes 70-87 Seconds

`hunt-convergence-scan` fires on every weather event and scans one state. Breakdown:

| Step | Time | Cause |
|------|------|-------|
| Domain data collection | ~10ms | 8 parallel queries (fast) |
| Historical pattern search | **50-70s** | `search_hunt_knowledge_v3` with NO state filter across 2.1M rows |
| Claude synthesis (Sonnet) | ~10-15s | Generates alert text |
| Embedding alert | ~1-2s | Voyage AI call |

### Fix: Add state filter to convergence scan vector search

**File:** `supabase/functions/hunt-convergence-scan/index.ts` ~line 155

```typescript
// CURRENT (searches full 2.1M brain, no state filter):
const { data: matches } = await supabase.rpc('search_hunt_knowledge_v3', {
  query_embedding: embedding,
  match_threshold: 0.4,
  match_count: 10,
  filter_state_abbr: null,  // ← THIS IS THE PROBLEM
});

// FIX (filter to state — reduces search space ~98%):
const { data: matches } = await supabase.rpc('search_hunt_knowledge_v3', {
  query_embedding: embedding,
  match_threshold: 0.4,
  match_count: 10,
  filter_state_abbr: stateAbbr,  // ← Pass the state being scanned
});
```

**Expected improvement:** 70-80s → 3-5s per scan. The IVFFlat index with a state filter only scans ~40K rows instead of 2.1M.

### Also: Increase IVFFlat probe count for the filtered case

The current `ivfflat.probes = 40` was set for full-brain searches. With state filtering, fewer probes are needed. Consider reducing to 10 for filtered queries, which will further improve speed.

---

## STALE DATA SOURCES (from Data Freshness panel)

These content types show >7 days since last entry. They'll refresh once the crons are registered:

| Content Type | Last Entry | Cron That Feeds It |
|-------------|-----------|-------------------|
| ebird-hotspot | STALE | hunt-migration-monitor (not running) |
| climate-index | STALE | hunt-climate-indices (not registered) |
| inaturalist-monthly | STALE | hunt-inaturalist (no cron) |
| weather-event | STALE | hunt-weather-watchdog (not running) |
| drought-weekly | STALE | hunt-drought-monitor (not running + BUG-2) |
| fire-activity | STALE | no dedicated cron — comes from NWS/convergence |
| birdcast-daily | STALE | hunt-birdcast (not running) |
| snow-cover | STALE | hunt-snow-cover (not registered) |

**Most of these fix themselves once the crons are registered and running.** hunt-drought-monitor also needs BUG-2 fixed or it will crash on every invocation.

---

## ALERT GRADING LOOP: 121 Pending → 0% Accuracy

The self-improving loop is completely broken:

```
convergence-scan fires alert → hunt_alert_outcomes row created →
hunt-alert-grader SHOULD grade after deadline →
hunt-alert-calibration SHOULD aggregate accuracy →
Grades embedded back into brain → brain searches its own track record
```

**What's broken:**
1. hunt-alert-grader cron not registered → 121 alerts sitting ungraded
2. Field name mismatch (BUG-1) → even if grader runs, calibration can't read the grades
3. hunt-alert-calibration cron not registered → no accuracy aggregation happening

**Fix order:**
1. Fix BUG-1 (field name mismatch)
2. Register both crons (via migration 20260348/349)
3. Manually trigger hunt-alert-grader once to clear the 121 backlog:
```bash
curl -X POST https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-alert-grader \
  -H "Authorization: Bearer SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```
4. Check results in ops dashboard — accuracy should jump from 0%

---

## EXECUTION ORDER

### Phase 1: Get Pipes Flowing (do first, highest impact)

1. **Verify pg_cron state** — run `SELECT * FROM cron.job` in SQL Editor
2. **Apply migration 20260348** — run the full SQL or `supabase db push`
3. **Create + apply migration 20260349** — register 16 missing crons
4. **Update hunt-cron-health** — add 16 new cron names to tracking
5. **Wait 1 hour** — check /ops to see crons starting to report
6. **Clean up orphaned pg_cron jobs** — remove old names from wave migrations if duplicated

### Phase 2: Critical Bug Fixes

7. **BUG-1:** Fix alert grader/calibration field name mismatch
8. **BUG-2:** Fix hunt-drought-monitor response signature
9. **BUG-5:** Fix dispatcher historical search
10. **Manually trigger hunt-alert-grader** to clear 121 pending alerts

### Phase 3: Performance

11. **Add state filter to convergence-scan** vector search (70s → 5s)
12. **BUG-4:** Fix IVFFlat setting in RPC if still wrong

### Phase 4: Code Quality

13. **BUG-3:** Replace eval() in hunt-birdcast
14. **BUG-6:** Add search result dedup
15. **BUG-7:** Fix recency weight default
16. **BUG-8:** Add missing logCronRun calls

### Phase 5: Verify

17. Check /ops — should show 40+ crons healthy
18. Chat: "What happened in TX Feb 2021?" — should return storm-event data
19. Alert Performance panel — accuracy should be >0%
20. Convergence scans — should complete in <10s

---

## FILES TO CREATE/MODIFY

| File | Action |
|------|--------|
| `supabase/migrations/20260349_register_missing_crons.sql` | NEW — register 16 missing crons |
| `supabase/functions/hunt-cron-health/index.ts` | MODIFY — add 16 cron names to tracking |
| `supabase/functions/hunt-alert-grader/index.ts` | MODIFY — fix field name (BUG-1) |
| `supabase/functions/hunt-alert-calibration/index.ts` | MODIFY — fix field name (BUG-1) |
| `supabase/functions/hunt-drought-monitor/index.ts` | MODIFY — fix response signature (BUG-2) |
| `supabase/functions/hunt-birdcast/index.ts` | MODIFY — replace Function() with JSON.parse (BUG-3) |
| `supabase/functions/hunt-convergence-scan/index.ts` | MODIFY — add state filter to vector search |
| `supabase/functions/hunt-search/index.ts` | MODIFY — dedup + recency weight (BUG-6, BUG-7) |
| `supabase/functions/hunt-dispatcher/index.ts` | MODIFY — historical search fix (BUG-5) |
| `supabase/functions/hunt-nws-monitor/index.ts` | MODIFY — add logCronRun success (BUG-8) |
| `supabase/functions/hunt-search-trends/index.ts` | MODIFY — add logCronRun success (BUG-8) |

---

## RULES REMINDER

- Pin `supabase-js@2.84.0` in ALL edge functions
- Pin `std@0.168.0` in ALL edge functions
- NEVER use `$$` inside pg_cron — use `$cron$`/`$body$`
- NEVER use psql or `db execute` — REST API / SQL Editor only
- Every edge function exit path MUST call `logCronRun`
- Shared module change → redeploy every function that imports it
- THE EMBEDDING LAW: every new data entry gets embedded. No exceptions.
