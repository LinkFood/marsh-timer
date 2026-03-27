# DUCK COUNTDOWN — MASTER BUILD SPEC & HANDOFF
## Date: March 24, 2026 | Status: System Degrading — Immediate Action Required

> **This document supersedes all previous build specs.** It consolidates findings from 5 prior specs (OPS-FIXES, FULL-QA, UNIFIED, OPS-DASHBOARD, CLEANUP-AND-STATE) plus live site testing on March 24, 2026. Work through phases in order. Each phase is a single Code session.

---

## SYSTEM SNAPSHOT (March 24, 2026 — Live)

| Metric | Value | Status |
|--------|-------|--------|
| Brain entries | 2,398,682 | Growing slowly |
| Content types | 55 | Good |
| Crons OK | 3/41 | **CRITICAL — 38 unknown** |
| Errors (48h) | 0 | — |
| Last embed | 3m ago | OK |
| Alerts pending | 171 | **Never graded — 0% accuracy** |
| Brain growth (7d) | Flatlined | **No new entries since ~March 8** |
| Convergence (current) | 51 | Declining (was 66 30d avg) |
| Convergence scan time | 79-82 seconds/state | **10-16x too slow** |
| Ops page load time | 10+ seconds | Slow (was fast) |

### Data Freshness (from /ops)

| Source | Count | Age | Status |
|--------|-------|-----|--------|
| storm-event | 1,518,166 | 2d | STALE |
| usgs-water | 267,350 | 3d | STALE |
| earthquake-event | 143,547 | 2d | STALE |
| weather-realtime | 101,607 | 4m | OK |
| birdcast-historical | 86,913 | 1d | OK |
| photoperiod | 37,198 | 9d | STALE |
| geomagnetic-kp | 29,047 | 2d | STALE |
| noaa-tide | 28,617 | 10d | STALE |
| birdweather-daily | 26,944 | 1d | OK |

**Only 3 sources fresh.** Everything else is degrading because crons aren't running.

### Header vs Ops Count Mismatch
- Main dashboard header shows: `CRONS: 2/25`
- Ops dashboard shows: `3/41 CRONS OK`
- These should match. Header is reading from a different source or using a stale count.

---

## PHASE 1: STOP THE BLEEDING (Session 1)
**Goal:** Get crons running. Restore data pipeline. This is the single highest-leverage fix.

### 1.1 — Apply pg_cron Migration
**Priority:** CRITICAL
**Problem:** Migration 20260348 exists in repo but was never applied to remote Supabase. 38 of 41 crons show "never" run.
**Action:**
1. Connect to Supabase SQL Editor
2. Check current pg_cron state: `SELECT * FROM cron.job ORDER BY jobname;`
3. Apply migration `20260348` if not already applied
4. Create + apply new migration `20260349_register_missing_crons.sql` for the 16 crons that were omitted from 20260348:

```sql
-- These 16 crons were in wave migrations (20260330-20260334) but never made it into the master migration
SELECT cron.schedule('hunt-birdweather', '0 6 * * *', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-birdweather', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-snow-cover', '0 7 * * 0', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-snow-cover', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-snotel', '0 8 * * *', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-snotel', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-gbif', '0 6 1 * *', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-gbif', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-multi-species', '0 7 * * 1', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-multi-species', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-search-trends', '0 8 * * 1', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-search-trends', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-query-signal', '0 9 * * *', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-query-signal', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-power-outage', '0 */3 * * *', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-power-outage', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-climate-indices', '0 6 * * 3', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-climate-indices', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-movebank', '0 7 * * 0', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-movebank', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-phenology', '0 8 * * 1', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-phenology', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-crop-progress', '0 9 * * 2', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-crop-progress', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-historical-news', '0 6 * * 3', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-historical-news', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-usfws-survey', '0 7 1 * *', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-usfws-survey', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-drought-monitor', '0 10 * * 4', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-drought-monitor', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
SELECT cron.schedule('hunt-inaturalist', '0 11 1 * *', $$SELECT net.http_get(url:='https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-inaturalist', headers:='{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '"}'::jsonb);$$);
```

5. Verify: `SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;` — should show 41 active jobs

### 1.2 — Fix hunt-cron-health Tracking
**Priority:** CRITICAL
**Problem:** hunt-cron-health only tracks a subset of crons, so /ops shows "unknown" for the rest.
**File:** `supabase/functions/hunt-cron-health/index.ts`
**Action:** Ensure the `EXPECTED_CRONS` array includes all 41 cron function names with their correct schedules. Cross-reference with the pg_cron jobs after 1.1 is complete.

### 1.3 — Fix Header Cron Count
**Priority:** HIGH
**Problem:** Main dashboard header shows `CRONS: 2/25` while ops shows `3/41`. Different data sources.
**Files:** Check `src/components/BrainHeartbeat.tsx` or wherever the header stats are rendered. It likely queries a different endpoint or uses a hardcoded denominator.
**Action:** Make header pull from the same source as /ops, or at minimum use 41 as denominator.

### 1.4 — Verify Data Pipeline Restarts
**Priority:** HIGH
**Action:** After crons are registered, wait 1 hour, then check:
- `SELECT function_name, status, started_at FROM hunt_cron_log ORDER BY started_at DESC LIMIT 20;`
- Confirm weather-watchdog, migration-monitor, convergence-engine, nws-monitor are running
- Check /ops — "unknown" count should start dropping

---

## PHASE 2: FIX THE SELF-LEARNING LOOP (Session 2)
**Goal:** Get alerts graded. Make the brain learn from its predictions.

### 2.1 — Fix Alert Grader Field Name Mismatch
**Priority:** CRITICAL
**Problem:** `hunt-alert-grader` writes `outcome_grade` but `hunt-alert-calibration` reads `outcome_status`. 171 alerts sitting ungraded.
**Files:**
- `supabase/functions/hunt-alert-grader/index.ts` — find the column it writes to
- `supabase/functions/hunt-alert-calibration/index.ts` — find the column it reads from
**Action:** Align field names. Pick one name (recommend `outcome_grade`) and update both functions to use it. Also check the `hunt_alert_outcomes` or `hunt_convergence_alerts` table schema to see which column actually exists.

### 2.2 — Fix hunt-drought-monitor Response Signature
**Priority:** HIGH
**Problem:** Calls `successResponse(data)` and `errorResponse(message)` but shared module requires `successResponse(request, data)` and `errorResponse(request, message)`.
**File:** `supabase/functions/hunt-drought-monitor/index.ts`
**Action:** Add `req` as first parameter to all `successResponse()` and `errorResponse()` calls.

### 2.3 — Fix hunt-birdcast eval() Vulnerability
**Priority:** HIGH
**Problem:** Uses `Function()` constructor to evaluate untrusted HTML content from BirdCast API.
**File:** `supabase/functions/hunt-birdcast/index.ts`
**Action:** Replace `Function()` / `eval()` with `JSON.parse()` or safe regex extraction.

### 2.4 — Fix Missing logCronRun Calls
**Priority:** MEDIUM
**Problem:** At least 3 functions have success paths that don't call `logCronRun()`, so cron-health can't track them.
**Action:** Search all cron functions for early returns that skip `logCronRun`. Every exit path (success, error, empty data) must call it. Pattern:
```typescript
// CORRECT — log on every path
try {
  // ... work ...
  await logCronRun({ functionName: 'hunt-xyz', status: 'success', summary: '...', durationMs: Date.now() - start });
} catch (err) {
  await logCronRun({ functionName: 'hunt-xyz', status: 'error', errorMessage: err.message, durationMs: Date.now() - start });
}
```

---

## PHASE 3: FIX BROKEN USER-FACING FEATURES (Session 3)
**Goal:** Make the panels and search actually work for visitors.

### 3.1 — Fix Brain Search Panel (Returns Zero Results)
**Priority:** CRITICAL
**Problem:** Brain Search panel shows "No results" for every query despite the hunt-search API returning valid results when called directly.
**Files:** `src/panels/BrainSearchPanel.tsx`, related hook (likely `useSearch` or similar)
**Action:**
1. Check what API endpoint the panel calls
2. Compare the request payload to what hunt-search expects
3. Likely issue: embedding step failing silently, or panel not passing query correctly
4. Test fix with queries like "Texas flooding" and "tornado Oklahoma"

### 3.2 — Fix Convergence Scores Panel Timeout
**Priority:** CRITICAL
**Problem:** Panel shows "No convergence data" with console warnings "Request timed out: convergence scores" (5x).
**Files:** `src/panels/ConvergencePanel.tsx`, the query it uses
**Action:** Check what RPC or API call the panel makes. Likely needs pagination or a simpler query. The convergence_scores table should have daily entries per state — a simple `SELECT * FROM hunt_convergence_scores WHERE score_date = CURRENT_DATE ORDER BY total_score DESC` should return in <1s.

### 3.3 — Fix Dispatcher Historical Search
**Priority:** CRITICAL
**Problem:** Brain Chat can only search last 48 hours of data. Asking about "Texas freeze 2021" returns nothing because the dispatcher limits the date range.
**File:** `supabase/functions/hunt-dispatcher/index.ts`
**Action:** Find the date filter (likely `effective_date > NOW() - INTERVAL '48 hours'`) and either remove it or expand dramatically (5 years). The vector search should handle relevance — the date filter is preventing access to 99% of the brain.

### 3.4 — Fix IVFFlat Index Settings
**Priority:** HIGH
**Problem:** The `search_hunt_knowledge_v3` RPC may have wrong probes setting, causing poor recall.
**Action:** Check the RPC definition. For 2.4M entries with IVFFlat, recommended settings:
- lists: ~1549 (sqrt of 2.4M)
- probes: 40 (good recall/speed balance)
- Verify: `SHOW ivfflat.probes;` in a query context

### 3.5 — Fix Search Result Deduplication
**Priority:** MEDIUM
**Problem:** Same content can appear multiple times in search results (e.g., same storm event from multiple ingests).
**File:** `supabase/functions/hunt-search/index.ts` or the search RPC
**Action:** Add dedup logic — group by content hash or (content_type, state_abbr, effective_date) and take highest similarity score.

### 3.6 — Fix Recency Weight Default
**Priority:** LOW
**Problem:** Default recency_weight is 0.0 (no recency bias). Should be 0.1 to slightly favor recent data.
**File:** `supabase/functions/hunt-search/index.ts` or search RPC
**Action:** Change default from 0.0 to 0.1.

---

## PHASE 4: PERFORMANCE (Session 4)
**Goal:** Make convergence scans fast. Currently 79-82 seconds per state = 68 minutes for all 50 states.

### 4.1 — Add State Filter to Convergence Scan Vector Search
**Priority:** CRITICAL
**Problem:** `scanBrainOnWrite()` passes `filter_state_abbr: null` which causes a full 2.4M row scan instead of filtering to ~48K rows per state.
**File:** `supabase/functions/_shared/brainScan.ts` (or wherever convergence-engine calls the vector search)
**Action:** Pass the state being scanned as the filter. Expected improvement: 80s → 3-5s per state.
```typescript
// BEFORE (bad)
const results = await searchBrain({ query, filter_state_abbr: null, ... });

// AFTER (good)
const results = await searchBrain({ query, filter_state_abbr: stateAbbr, ... });
```

### 4.2 — Ops Dashboard Load Time
**Priority:** MEDIUM
**Problem:** /ops takes 10+ seconds to load (was 2-3s previously). The `hunt-ops-dashboard` edge function likely does too many sequential queries.
**File:** `supabase/functions/hunt-ops-dashboard/index.ts`
**Action:** Profile the function. Likely fixes:
- Parallelize independent queries with `Promise.all()`
- Cache brain entry count (don't COUNT(*) on 2.4M rows every load)
- Limit cron log queries to last 48h instead of scanning full table

---

## PHASE 5: MAP & NAVIGATION (Session 5)
**Goal:** Fix map interactions and visual issues.

### 5.1 — Fix State Route flyTo
**Priority:** HIGH
**Problem:** Navigating to `/:species/:stateAbbr` (e.g., `/all/TX`) doesn't fly the map to that state. Map stays at national zoom.
**Files:** `src/components/MapView.tsx`, route handler in App.tsx
**Action:** When stateAbbr changes in the URL, trigger `flyTo` with the state's center coordinates and zoom level ~6.

### 5.2 — Fix Species Filter on Convergence Scores
**Priority:** MEDIUM
**Problem:** Switching species in the selector doesn't change convergence scores. All species show same values.
**Files:** `src/panels/ConvergencePanel.tsx`, convergence score query
**Action:** The convergence engine likely calculates species-weighted scores. Check if the panel passes the selected species to the query, or if it always fetches the 'all' scores.

### 5.3 — Fix Missing Mapbox Custom Images
**Priority:** MEDIUM
**Problem:** Console warnings for missing images: `score-pill`, `pulsing-dot-fire`, `pulsing-dot-hot`
**File:** `src/components/MapView.tsx`
**Action:** Either create and register these images via `map.addImage()`, or remove references to them from layer definitions.

### 5.4 — Fix Map State Click Navigation
**Priority:** MEDIUM
**Problem:** Clicking a state on the map should navigate to that state's view. Currently does nothing or inconsistent behavior.
**File:** `src/components/MapView.tsx`
**Action:** Add click handler on state polygons that calls `navigate(`/${species}/${stateAbbr}`)` and triggers flyTo.

### 5.5 — Fix "ALL SIGNALS" Button
**Priority:** LOW
**Problem:** The "ALL SIGNALS" button in the header doesn't reliably return to national view from a state view.
**File:** `src/components/HeaderBar.tsx` or wherever this button is defined
**Action:** Should call `navigate('/')` and `flyTo` national view (center: [-98.5, 39.8], zoom: 4.2).

---

## PHASE 6: DOMAIN-AGNOSTIC CLEANUP (Session 6)
**Goal:** Remove hunting bias. Make it truly "Environmental Intelligence."

### 6.1 — Dispatcher System Prompts
**File:** `supabase/functions/hunt-dispatcher/index.ts`
**Action:** Remove "duck hunting", "hunting season", "hunter" language from system prompts and query injection. Replace with environmental/ecological framing.

### 6.2 — Intent Classification Prompt
**File:** `supabase/functions/hunt-dispatcher/index.ts`
**Action:** The Haiku intent classifier prompt is hunting-focused. Rewrite to be domain-neutral: weather, migration, environment, patterns, general.

### 6.3 — Convergence Score Labels
**Files:** Frontend convergence panels
**Action:** Change labels like "tough hunting" → "weak convergence", "prime conditions" → "strong convergence".

### 6.4 — Default Species
**Files:** `src/contexts/DeckContext.tsx`, `src/data/types.ts`
**Action:** Ensure default species is `'all'` everywhere, not `'duck'`. Check route fallbacks too.

### 6.5 — Frontend Renames (Optional, Low Priority)
**Action:** These are cosmetic but good for code clarity:
- HuntChat → BrainChat (already partially done)
- HuntAlert → PatternAlert
- hunting-knowledge content type → environmental-knowledge
- State "facts" reframed from hunting to ecology

---

## PHASE 7: FRONTEND POLISH (Session 7)
**Goal:** UX improvements and missing features.

### 7.1 — Brain Growth Chart Label
**Priority:** MEDIUM
**Problem:** Chart shows "Entries per Day (30d)" — users think it shows total brain size and get confused when it "shrinks." It's actually showing daily ingest rate.
**File:** Ops page component (likely in `src/pages/OpsPage.tsx`)
**Action:** Add subtitle: "Daily ingest rate — not cumulative total" or add a second chart showing cumulative brain size.

### 7.2 — What's Happening Panel
**Priority:** MEDIUM
**Problem:** Panel frequently shows empty state. Needs a broader signal feed.
**File:** `src/panels/WhatsHappeningPanel.tsx`
**Action:** Check what data source it queries. Should aggregate recent entries from weather-realtime, nws-alerts, convergence-alerts, and migration events. If it's querying a specific content_type that isn't being populated, broaden the query.

### 7.3 — Weather Events Panel
**Priority:** MEDIUM
**Problem:** Panel sometimes shows empty despite weather-realtime being fresh (4m old, 101K entries).
**File:** `src/panels/WeatherEventsPanel.tsx`
**Action:** Check the date range filter. May be too narrow or querying wrong content_type.

### 7.4 — Mobile Default Layout
**Priority:** HIGH
**Problem:** Mobile layout may hide all panels by default, showing only the map.
**File:** `src/layout/PanelDockMobile.tsx`
**Action:** Ensure at least 3-4 key panels (Convergence, What's Happening, Brain Chat) are visible by default on mobile.

### 7.5 — Hover Tooltip Improvements
**Priority:** LOW
**Action:** State hover on map should show: state name, convergence score, top signal, and trend arrow. Currently may show minimal info.

---

## PHASE 8: MAKE THE BRAIN CONVERSATIONAL (Session 8+)
**Goal:** This is the big unlock. 2.4M entries are useless if nobody can access them.

### 8.1 — Chat Response Quality
**Problem:** Even when chat works, responses are generic and don't leverage the brain's depth.
**Files:** `supabase/functions/hunt-dispatcher/index.ts`
**Action:**
- Increase context window: pass more brain search results to Sonnet (currently may only pass top 3-5)
- Add "what happened last time" context: when user asks about current conditions, also search for historical matches
- Include convergence score breakdown in system prompt so AI can reference specific components

### 8.2 — Convergence Score Explanations
**Problem:** A score of 83 means nothing to a user. They need to know WHY.
**Action:** When displaying convergence scores, show the component breakdown:
- "Washington score 83: Pressure drop (+18), Migration spike (+15), Water level rise (+12), Temp anomaly (+10)..."
- The 8-component breakdown exists in the panel — make it the default expanded view, not collapsed.

### 8.3 — Pattern Match Narratives
**Problem:** Pattern links exist in the brain but aren't surfaced as stories.
**Action:** When convergence score is high for a state, query hunt_pattern_links for that state and show: "The last 3 times pressure dropped 15mb while migration was spiking in WA: [event 1], [event 2], [event 3]"

### 8.4 — Dynamic Welcome Stats
**File:** `src/components/HuntChat.tsx` or `BrainChat.tsx`
**Action:** The chat welcome screen should show live stats: "2.4M entries across 55 content types. Currently tracking convergence in 50 states. 3 active alerts." Update from hardcoded to live query.

---

## TRACKING: What's Been Built vs What's Planned

### BUILT AND WORKING (as of March 24, 2026)
- [x] 2.4M vector embeddings in brain (hunt_knowledge)
- [x] 57 edge functions deployed
- [x] 25 frontend panels (lazy-loaded, error-bounded)
- [x] 35 map layers with 4 presets
- [x] 7 grid layout presets including Command Center
- [x] Mapbox 3D globe with satellite, terrain, fog, atmosphere
- [x] Convergence engine (50-state daily scoring)
- [x] Event ticker with real-time alerts
- [x] Brain Heartbeat live status indicator
- [x] Widget Manager (panel catalog)
- [x] Deck configs (save/load layouts)
- [x] State Screener (sortable table)
- [x] History Replay (30-day timeline)
- [x] Solunar calendar (365-day precomputed)
- [x] Ops dashboard (/ops)
- [x] SSE streaming chat (Haiku → Sonnet → Tavily)
- [x] Disaster Watch panel
- [x] Pattern Timeline panel
- [x] Mobile responsive layout
- [x] Google OAuth auth
- [x] User alert system (create/manage)
- [x] Web discovery pipeline (Tavily → Opus curator)
- [x] Orchestrator v2 for backfills

### BUILT BUT BROKEN
- [ ] Brain Search panel (zero results)
- [ ] Convergence Scores panel (timeout)
- [ ] Brain Chat historical access (48hr limit)
- [ ] Self-grading loop (field name mismatch)
- [ ] 38 of 41 crons (never registered)
- [ ] Convergence scan performance (80s/state)
- [ ] Alert accuracy tracking (0%, 171 pending)
- [ ] State route flyTo
- [ ] Species-filtered convergence

### NOT YET BUILT (from Roadmap)
- [ ] NEXRAD radar integration
- [ ] Soil moisture data
- [ ] NDVI satellite vegetation
- [ ] Phenology camera feeds
- [ ] USGS streamflow real-time
- [ ] Air quality (AirNow)
- [ ] Lightning data
- [ ] Sea surface temperature
- [ ] Water quality
- [ ] Thesis validation test suite (13 tests defined in THESIS-TEST-PLAN.md)
- [ ] Public API for brain queries
- [ ] Multi-user dashboard sharing
- [ ] Email/push alert notifications
- [ ] Historical pattern replay animations
- [ ] Cross-state correlation visualizations

---

## SESSION COMPLETION CHECKLIST

After each session, verify:
1. `git status` — all changes committed
2. `supabase functions deploy <function-name>` — any modified edge functions redeployed
3. If shared module changed (`_shared/*`), redeploy ALL functions that import it
4. Check /ops after deploy — verify cron counts, error counts, data freshness
5. Update this document: move completed items to "BUILT AND WORKING"

---

## FILE REFERENCE

### Key Edge Functions
| Function | Path | Purpose |
|----------|------|---------|
| hunt-dispatcher | `supabase/functions/hunt-dispatcher/index.ts` | Chat routing (Haiku → Sonnet) |
| hunt-search | `supabase/functions/hunt-search/index.ts` | Brain vector search |
| hunt-convergence-engine | `supabase/functions/hunt-convergence-engine/index.ts` | 50-state daily scoring |
| hunt-alert-grader | `supabase/functions/hunt-alert-grader/index.ts` | Alert outcome grading |
| hunt-alert-calibration | `supabase/functions/hunt-alert-calibration/index.ts` | Rolling accuracy stats |
| hunt-cron-health | `supabase/functions/hunt-cron-health/index.ts` | Cron monitoring |
| hunt-ops-dashboard | `supabase/functions/hunt-ops-dashboard/index.ts` | Ops page data |
| hunt-drought-monitor | `supabase/functions/hunt-drought-monitor/index.ts` | Drought data ingest |
| hunt-birdcast | `supabase/functions/hunt-birdcast/index.ts` | BirdCast radar migration |

### Key Shared Modules
| Module | Path | Used By |
|--------|------|---------|
| brainScan.ts | `supabase/functions/_shared/brainScan.ts` | convergence-engine, migration-monitor, birdcast |
| cronLog.ts | `supabase/functions/_shared/cronLog.ts` | ALL cron functions |
| embedding.ts | `supabase/functions/_shared/embedding.ts` | ALL brain writers |
| response.ts | `supabase/functions/_shared/response.ts` | ALL edge functions |

### Key Frontend Files
| File | Path | Purpose |
|------|------|---------|
| BrainSearchPanel | `src/panels/BrainSearchPanel.tsx` | Brain search UI |
| ConvergencePanel | `src/panels/ConvergencePanel.tsx` | Convergence scores |
| MapView | `src/components/MapView.tsx` | Mapbox map |
| BrainHeartbeat | `src/components/BrainHeartbeat.tsx` | Header status bar |
| DeckContext | `src/contexts/DeckContext.tsx` | Global state |
| PanelRegistry | `src/panels/PanelRegistry.ts` | Panel catalog |

### Database
- **Project:** Supabase `rvhyotvklfowklzjahdd`
- **Brain table:** `hunt_knowledge` (2.4M rows, 512-dim vectors, IVFFlat index)
- **Search RPC:** `search_hunt_knowledge_v3`
- **All tables use `hunt_` prefix** — shared project with JAC Agent OS, never touch JAC tables

### Critical Rules (from CLAUDE.md)
- Pin `supabase-js@2.84.0` and `std@0.168.0` in edge functions
- NEVER retry 4xx errors — only 5xx and network
- NEVER use `$$` in pg_cron — use `$cron$`/`$body$`
- NEVER use psql or `db execute` — REST API only
- Every early-return path calls `logCronRun`
- Shared module change → redeploy EVERY function that imports it
- THE EMBEDDING LAW: every piece of data MUST be embedded via Voyage AI

---

## PREVIOUS BUILD SPECS (Superseded)

These files remain in the repo for reference but this document is the canonical source of truth:
- `BUILD-SPEC-OPS-FIXES-HANDOFF.md` — Ops fixes (March 22)
- `BUILD-SPEC-FULL-QA-HANDOFF-2026-03-22.md` — Full QA test (March 22)
- `BUILD-SPEC-UNIFIED.md` — Architecture vision
- `BUILD-SPEC-OPS-DASHBOARD.md` — Ops dashboard build
- `BUILD-SPEC-CLEANUP-AND-STATE-2026-03-22.md` — Cleanup tasks
