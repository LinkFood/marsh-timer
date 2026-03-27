# DUCK COUNTDOWN — POST-SHIP QA HANDOFF
## Date: March 24, 2026 | Post-Build-Spec QA Results

> **Context:** The master build spec (BUILD-SPEC-MASTER-HANDOFF-2026-03-24.md) was shipped to Code. This document captures what was fixed, what's still broken, and the exact next steps. Work through in order — Phase A is the single most important fix in the entire system.

---

## WHAT GOT FIXED (Confirmed Working)

| Feature | Before | After | Status |
|---------|--------|-------|--------|
| Convergence Scores panel | Timed out, "No convergence data" | Loads instantly, GA #1 at 67, expandable breakdown | ✅ FIXED |
| State route flyTo | Map stayed at national zoom | Map flies to state, gold 3D extrusion, breadcrumb nav | ✅ FIXED |
| Weather Forecast panel | Empty, "Select a state" | Shows 5-day state-specific forecast when state selected | ✅ FIXED |
| NWS Alerts panel | Untested | Shows live Flood Warnings, filters by state | ✅ FIXED |
| Brain Growth chart label | "Entries per Day" (confusing) | "Daily Ingest Rate" with subtitle "(not cumulative total)" | ✅ FIXED |
| Chat welcome stats | Hardcoded | Live: "2,402,647 entries across 55 types, 9 crons active" | ✅ FIXED |
| Dynamic suggested prompts | Static prompts | References current events ("2 weather alerts across WI, HI") | ✅ FIXED |
| Header cron counter | "CRONS: 2/25" | "CRONS: 37/42" (denominator updated) | ✅ FIXED |
| What's Happening panel | Empty | Shows COMPOUND RISK entries (KS 5 domains, CO 4, SC 4) | ✅ FIXED |
| Widget Manager | Working | Shows 9/23 active, correct metadata per panel | ✅ CONFIRMED |
| State Screener | Working | Shows ranked states with scores and sparklines | ✅ CONFIRMED |
| Map layers | Working | All 35 layers present, 4 presets, toggleable | ✅ CONFIRMED |
| Weather events on map | Working | Yellow markers at KSEA, KPDX, KSLC, KMSP | ✅ CONFIRMED |
| Event Ticker | Working | Real-time pressure drops, flood warnings, front passages | ✅ CONFIRMED |
| History Replay | Working | 30-day replay at Day 1 of 15, national avg 70 | ✅ CONFIRMED |
| Convergence History | Working | Current 51, 7D 58, 30D 66 (declining but rendering) | ✅ CONFIRMED |

---

## WHAT'S STILL BROKEN

### PHASE A: FIX BRAIN SEARCH (CRITICAL — Blocks Everything)
**This is the #1 priority. Nothing else matters until search works.**

#### The Problem
Every search query returns zero results:
- Brain Chat: "Brain searched — no matching data found" → AI Interpretation hangs on "Searching the brain..." indefinitely
- Brain Search panel: "No results for 'tornado Oklahoma'" (despite 1.5M storm events in brain)
- Tested queries: "Texas flooding", "current weather Georgia", "tornado Oklahoma" — ALL returned nothing

#### The Code Path
```
User query → hunt-dispatcher → generateEmbedding(query, 'query') → search_hunt_knowledge_v3 RPC → results
```

**Files involved:**
- `supabase/functions/hunt-search/index.ts` — calls embedding then RPC
- `supabase/functions/hunt-dispatcher/index.ts` — chat calls searchBrain() helper (line ~56-95)
- `supabase/functions/_shared/embedding.ts` — calls Voyage AI API (voyage-3-lite, 512-dim)
- RPC defined in: `supabase/migrations/20260356_fix_recency_underflow.sql`

#### Root Cause Candidates (in order of likelihood)

**1. VOYAGE_API_KEY not set in edge function environment (MOST LIKELY)**
- `embedding.ts` line 20: reads `Deno.env.get('VOYAGE_API_KEY')`
- If missing → throws error → hunt-search catches it (line 57-59) and returns empty array
- This would explain why EVERY query fails — the embedding step itself is broken
- **FIX:** Check Supabase Edge Function secrets: `supabase secrets list` — verify `VOYAGE_API_KEY` exists
- **FIX:** If missing: `supabase secrets set VOYAGE_API_KEY=<key>`

**2. All embeddings in hunt_knowledge are NULL**
- The v3 RPC (20260356) has `WHERE hk.embedding IS NOT NULL` (line 70)
- If backfill wrote rows without embeddings, they'd all be filtered out
- **DEBUG:** `SELECT COUNT(*) FROM hunt_knowledge WHERE embedding IS NULL;`
- **DEBUG:** `SELECT COUNT(*) FROM hunt_knowledge WHERE embedding IS NOT NULL;`

**3. RPC not applied to remote database**
- Migration 20260356 (fix_recency_underflow) may not have been applied
- If the old v3 RPC has bugs (e.g., exp() underflow on old dates), it could return empty
- **DEBUG:** Check if migration was applied: look at supabase migration history

**4. IVFFlat index needs rebuild after large data ingest**
- After adding 1M+ rows, the IVFFlat index may need `REINDEX` for good recall
- With stale index, similarity scores may all fall below 0.3 threshold
- **DEBUG:** `SELECT probes FROM pg_settings WHERE name = 'ivfflat.probes';` (should be 40)
- **FIX:** `REINDEX INDEX idx_hunt_knowledge_embedding;`

**5. Chat-specific: AI Interpretation hangs**
- When brain returns no results, the dispatcher still calls Claude Sonnet for interpretation
- Sonnet call may be timing out or the SSE stream isn't closing properly
- **File:** `hunt-dispatcher/index.ts` — check what happens when `searchBrain()` returns `[]`
- **FIX:** Add timeout to Sonnet call, return graceful "no data found" message

#### Debugging Steps (Run These First)
```sql
-- 1. Check if embeddings exist at all
SELECT COUNT(*) as total,
       COUNT(embedding) as has_embedding,
       COUNT(*) - COUNT(embedding) as null_embedding
FROM hunt_knowledge;

-- 2. Check embedding dimensions
SELECT array_length(embedding::float[], 1)
FROM hunt_knowledge
WHERE embedding IS NOT NULL
LIMIT 1;

-- 3. Test the RPC with a simple query (use any existing embedding as test)
SELECT id, title, content_type, state_abbr
FROM hunt_knowledge
WHERE embedding IS NOT NULL
ORDER BY random()
LIMIT 5;

-- 4. Check if VOYAGE_API_KEY is set
-- Run in edge function: console.log('KEY exists:', !!Deno.env.get('VOYAGE_API_KEY'));

-- 5. Direct API test of hunt-search
-- curl https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-search \
--   -H "Authorization: Bearer <anon-key>" \
--   -H "Content-Type: application/json" \
--   -d '{"query": "tornado Oklahoma", "limit": 5}'
```

#### After Fixing Search
Once search returns results, test these three queries:
1. `tornado Oklahoma` — should return storm-event entries
2. `current weather Georgia` — should return weather-realtime entries
3. `Texas flooding 2021` — should return historical storm events (tests date range)

If query 3 fails but 1-2 work, there's still a date filter issue in the dispatcher.

---

### PHASE B: REGISTER CRONS IN PG_CRON (CRITICAL)

#### The Problem
Ops dashboard: **2/41 healthy, 0 error, 0 late, 39 unknown**. Every cron shows "never" for last run.

The header shows "CRONS: 37/42" — this is measuring something completely different (probably registered cron jobs in pg_cron vs actually-ran-recently). The ops page checks `hunt_cron_log` for recent successful runs.

#### The Discrepancy
| Source | Shows | Meaning |
|--------|-------|---------|
| Header (BrainHeartbeat) | 37/42 | Crons registered in pg_cron |
| Ops (/ops page) | 2/41 | Crons that ran successfully in last window |

So 37 crons ARE registered — but none of them are actually running successfully (only 2 logged success). This means the cron jobs exist in pg_cron but either:
- The edge functions they call are failing silently
- The `net.http_get` calls are returning errors
- The functions run but don't call `logCronRun()`

#### Debug Steps
```sql
-- 1. Check pg_cron job status
SELECT jobname, schedule, active,
       (SELECT MAX(start_time) FROM cron.job_run_details WHERE job_run_details.jobid = job.jobid) as last_run
FROM cron.job
ORDER BY jobname;

-- 2. Check cron execution errors
SELECT jobid, jobname, status, return_message, start_time
FROM cron.job_run_details
ORDER BY start_time DESC
LIMIT 20;

-- 3. Check hunt_cron_log for recent entries
SELECT function_name, status, summary, error_message, started_at
FROM hunt_cron_log
ORDER BY started_at DESC
LIMIT 20;
```

#### Likely Fix
If crons are registered (37/42) but never logging success:
1. Check `cron.job_run_details` for error messages — likely HTTP errors calling edge functions
2. Common issue: `service_role_key` not set in `current_setting('app.settings.service_role_key')`
3. Alternative: edge function URLs wrong, or functions not deployed

If crons are NOT registered (despite header saying 37):
1. Apply the pg_cron SQL from the master build spec (Phase 1.1)
2. See `BUILD-SPEC-MASTER-HANDOFF-2026-03-24.md` for the full SQL

---

### PHASE C: FIX ALERT GRADING LOOP

#### The Problem
171 alerts pending, 0% accuracy, 0 confirmed/partial/missed/false alarm. The grader has never processed a single alert.

#### Root Cause
Field name mismatch between functions:
- `hunt-alert-grader` writes `outcome_grade` column
- `hunt-alert-calibration` reads `outcome_status` column
- Result: calibration always gets NULL, considers nothing graded

#### Fix
**Files:**
- `supabase/functions/hunt-alert-grader/index.ts`
- `supabase/functions/hunt-alert-calibration/index.ts`

**Steps:**
1. Check `hunt_alert_outcomes` or `hunt_convergence_alerts` table schema — which column exists?
2. Pick one name (recommend `outcome_grade`) and update both functions
3. Redeploy both: `supabase functions deploy hunt-alert-grader && supabase functions deploy hunt-alert-calibration`
4. Manually trigger grader to process the 171 pending alerts

---

### PHASE D: CONVERGENCE SCAN PERFORMANCE

#### The Problem
Scans now take **110-119 seconds per state** (was 79-82s in last session — WORSE). At 115s avg × 50 states = 96 minutes for one full scan cycle.

Recent scans from ops:
| State | Domains | Time |
|-------|---------|------|
| AR | 5 | 119.4s |
| KS | 3 | 118.9s |
| CA | 3 | 118.4s |
| WA | 4 | 113.7s |
| OK | 3 | 112.8s |

#### Root Cause
`scanBrainOnWrite()` passes `filter_state_abbr: null` to vector search — full 2.4M row scan instead of ~48K per state.

#### Fix
**File:** `supabase/functions/_shared/brainScan.ts`

```typescript
// FIND this pattern:
const results = await searchBrain({
  query,
  filter_state_abbr: null,  // ← THIS IS THE BUG
  ...
});

// CHANGE TO:
const results = await searchBrain({
  query,
  filter_state_abbr: stateAbbr,  // ← Pass the state being scanned
  ...
});
```

**Expected improvement:** 115s → 3-5s per state. Full 50-state scan: 96 min → 4 min.

**IMPORTANT:** After changing a `_shared/` module, redeploy EVERY function that imports `brainScan.ts`:
- hunt-convergence-engine
- hunt-migration-monitor
- hunt-birdcast
- Any other function importing from `_shared/brainScan`

---

### PHASE E: MINOR FIXES

#### E.1 — Convergence Heatmap Default
**Problem:** The "Convergence Heatmap" map layer is OFF by default at national view. The map shows satellite imagery but no colored state choropleth until user toggles it on.
**File:** `src/contexts/LayerContext.tsx`
**Fix:** Set `convergenceHeatmap: true` in the default layer state. This is the flagship visual — it should be on by default.

#### E.2 — "ALL SIGNALS" Button Navigation
**Problem:** Clicking "ALL SIGNALS" from a state view (/all/GA) doesn't navigate back to national view. The ✕ next to state name works.
**File:** `src/components/HeaderBar.tsx` or wherever the ALL SIGNALS button is wired
**Fix:** Button should call `navigate('/all')` (or `navigate('/')`) and `flyTo` national view.

#### E.3 — Ops/Header Cron Count Mismatch
**Problem:** Ops page says "2/41 CRONS OK" but header says "CRONS: 37/42". These measure different things but should be reconciled.
**Files:**
- `src/components/BrainHeartbeat.tsx` (header)
- `supabase/functions/hunt-cron-health/index.ts` (ops)
**Fix:** Both should report the same metric: "X crons ran successfully in the last expected window out of Y total." The header should pull from hunt-cron-health, not from pg_cron job count.

#### E.4 — Ops Page Content Types Count
**Problem:** Header of ops page shows "20 TYPES" but brain has 55 content types. Likely counting only types with recent data (last 24h), not total unique types.
**File:** `supabase/functions/hunt-ops-dashboard/index.ts` or ops page component
**Fix:** Show total unique content types, not just recently active ones. Or show both: "20 active / 55 total"

#### E.5 — hunt-drought-monitor Response Signature
**Problem:** Calls `successResponse(data)` instead of `successResponse(request, data)`.
**File:** `supabase/functions/hunt-drought-monitor/index.ts`
**Fix:** Add `req` as first parameter to all response calls.

---

## SESSION EXECUTION ORDER

```
Session 1: PHASE A (Brain Search) — THE BLOCKER
  → Debug embedding pipeline
  → Fix root cause (likely VOYAGE_API_KEY or embedding NULL)
  → Verify 3 test queries return results
  → Fix chat hang when search returns empty

Session 2: PHASE B (Crons) + PHASE C (Alert Grading)
  → Debug why registered crons aren't running
  → Fix alert grader field mismatch
  → Verify crons start logging to hunt_cron_log
  → Trigger alert grader on 171 pending alerts

Session 3: PHASE D (Performance) + PHASE E (Minor Fixes)
  → Add state filter to convergence scan
  → Redeploy all brainScan importers
  → Fix convergence heatmap default
  → Fix ALL SIGNALS navigation
  → Reconcile cron counts
```

---

## VERIFICATION CHECKLIST

After all sessions, these should all pass:

- [ ] Brain Search: "tornado Oklahoma" returns storm event results
- [ ] Brain Search: "Texas flooding 2021" returns historical data
- [ ] Brain Chat: "What are current conditions in Georgia?" returns streamed AI response
- [ ] Brain Chat: AI Interpretation completes (no infinite hang)
- [ ] Ops: Crons OK count > 30/41
- [ ] Ops: No crons show "never" for last run
- [ ] Ops: Alert accuracy > 0% (at least some alerts graded)
- [ ] Ops: Data freshness — no source >24h stale (except weekly sources)
- [ ] Main: Convergence heatmap visible at national view by default
- [ ] Main: "ALL SIGNALS" navigates back from state view
- [ ] Main: Header and ops cron counts match
- [ ] Convergence scan time < 10 seconds per state

---

## FILE REFERENCE

| File | Purpose | Phase |
|------|---------|-------|
| `supabase/functions/hunt-search/index.ts` | Brain vector search | A |
| `supabase/functions/hunt-dispatcher/index.ts` | Chat routing + search | A |
| `supabase/functions/_shared/embedding.ts` | Voyage AI embedding | A |
| `supabase/migrations/20260356_fix_recency_underflow.sql` | Latest search RPC | A |
| `supabase/functions/hunt-cron-health/index.ts` | Cron monitoring | B, E.3 |
| `supabase/functions/hunt-alert-grader/index.ts` | Alert grading | C |
| `supabase/functions/hunt-alert-calibration/index.ts` | Accuracy stats | C |
| `supabase/functions/_shared/brainScan.ts` | Convergence scan | D |
| `src/contexts/LayerContext.tsx` | Map layer defaults | E.1 |
| `src/components/HeaderBar.tsx` | Header nav/stats | E.2, E.3 |
| `src/components/BrainHeartbeat.tsx` | Live status bar | E.3 |
| `supabase/functions/hunt-drought-monitor/index.ts` | Drought ingest | E.5 |

---

## PREVIOUS BUILD SPECS (Reference Only)

- `BUILD-SPEC-MASTER-HANDOFF-2026-03-24.md` — 8-phase master plan (this doc picks up where it left off)
- `BUILD-SPEC-OPS-FIXES-HANDOFF.md` — Original ops fixes
- `BUILD-SPEC-FULL-QA-HANDOFF-2026-03-22.md` — Full QA test results
