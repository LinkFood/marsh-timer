# BUILD SPEC: Full Feature QA Test Results — Fix Handoff

**Date:** March 22, 2026
**Tested by:** Live browser QA on duckcountdown.com
**Method:** Chrome browser, desktop (1469×837) + mobile (375×812)
**Priority:** Contains critical bugs blocking core functionality

---

## EXECUTIVE SUMMARY

The platform looks impressive visually and the architecture is solid. Map rendering, layer presets, convergence scores on states, event ticker, and the ops dashboard all work. But several core features are silently broken — Brain Search returns nothing, the Convergence Scores panel times out, the dispatcher can't access historical data, and the self-grading loop is dead. These are fixable.

**Test Results:**
- 22 panels cataloged in Widget Manager
- 9 panels tested directly
- 4 layer presets tested
- 7 grid presets tested
- Mobile responsive at 375px: PASS
- Brain Chat: streaming works, historical data broken
- Brain Search: completely broken (returns no results for any query)
- Console: 0 fatal JS errors, 9 warnings

---

## CRITICAL BUGS (fix first)

### BUG-1: Brain Search Panel Returns Zero Results for Everything

**Severity:** CRITICAL — the primary search UI is non-functional
**Steps to reproduce:**
1. Type "Texas flooding 2024" in Brain Search → "No results"
2. Type "tornado Oklahoma" in Brain Search → "No results"
3. Any query returns "No results for [query]"

**Expected:** The brain has 2.28M+ entries including 1.5M+ storm events. Both queries return perfect results when calling hunt-search edge function directly.

**Root cause hypothesis:** The Brain Search panel is either:
- Not calling the hunt-search API at all
- Calling it with wrong parameters
- Failing to parse the response (hunt-search returns `{ vector: [], keywords: [], grouped: {} }` — maybe the panel expects a different shape)
- The embedding step might be failing silently (needs VOYAGE_API_KEY)

**File to investigate:** `src/panels/BrainSearchPanel.tsx` — trace the search submit handler. Compare the API call to how hunt-search expects to be called: `POST /functions/v1/hunt-search` with `{ query, limit, date_from, date_to }`.

### BUG-2: Convergence Scores Panel Shows "No convergence data"

**Severity:** CRITICAL — core intelligence panel is empty
**Steps to reproduce:**
1. Add "Convergence Scores" panel from Widget Manager
2. Panel renders with "No convergence data" message

**Console evidence:** 5× `"Request timed out: convergence scores"` warnings logged.

**Root cause:** The request to fetch convergence score data is timing out. Either:
- The Supabase query on `hunt_convergence_scores` is too slow (missing index?)
- The hook is hitting a different/wrong endpoint
- The query is selecting too much data without pagination

**File to investigate:** `src/hooks/` — find the hook that fetches convergence scores. Check the Supabase query for missing `.limit()` or indexing issues.

### BUG-3: Dispatcher Can't Search Historical Brain Data

**Severity:** CRITICAL — chat says "no data" for queries the brain CAN answer
**Steps to reproduce:**
1. Open Brain Chat
2. Ask "What happened in Texas during February 2021?"
3. Response says: "The brain doesn't have specific indexed data on February 2021 Texas events"

**But:** `hunt-search` returns perfect Texas freeze results with the same query + date filters. The brain HAS the data.

**Root cause:** The dispatcher's search/general intent handlers query only recent 48hr brain activity instead of calling `search_hunt_knowledge_v3` RPC with date filters.

**File:** `supabase/functions/hunt-dispatcher/index.ts`
**Fix:** When user query references a time period, extract date_from/date_to and pass to the RPC. Use the same embedding + vector search path that hunt-search uses.

### BUG-4: Self-Grading Loop Dead — 121 Alerts at 0% Accuracy

**Severity:** CRITICAL — the system can't learn from mistakes
**Ops dashboard shows:** 121 total alerts, 0% accuracy, 0 confirmed, 121 pending

**Root cause:** Two issues:
1. hunt-alert-grader cron not registered in pg_cron → never runs
2. Field name mismatch: grader writes `outcome_grade`, calibration reads `outcome_status`

**Fix:**
1. Register hunt-alert-grader in pg_cron
2. Check column name in `hunt_alert_outcomes` table
3. Fix whichever function uses the wrong field name
4. Manually trigger hunt-alert-grader once to clear backlog

**Files:**
- `supabase/functions/hunt-alert-grader/index.ts` ~line 323
- `supabase/functions/hunt-alert-calibration/index.ts` line 51

---

## HIGH SEVERITY BUGS

### BUG-5: Convergence Scan Takes 85-113 Seconds Per State

**Severity:** HIGH — scans should complete in <10s
**Ops dashboard evidence:** Recent scans show TX: 113.8s, VA: 112.3s, KS: 112.2s, NY: 105.3s, FL: 99.3s

**Root cause:** `hunt-convergence-scan` calls `search_hunt_knowledge_v3` with `filter_state_abbr: null`, searching the entire 2.28M-entry brain instead of filtering to ~40K entries per state.

**Fix:** Pass the state being scanned as `filter_state_abbr: stateAbbr` in the RPC call.
**File:** `supabase/functions/hunt-convergence-scan/index.ts` ~line 155
**Expected improvement:** 85-113s → 3-5s per scan

### BUG-6: State Route Doesn't Fly Map to Selected State

**Severity:** HIGH — URL routing works but map doesn't respond
**Steps to reproduce:**
1. Navigate to `duckcountdown.com/all/TX`
2. Convergence History panel correctly shows "TX CONVERGENCE" with TX data
3. Map stays at the national view — no flyTo animation to Texas

**Expected:** Map should `flyTo` Texas with pitch: 45, bearing: -15 per the spec.
**File to investigate:** Check the router handler in `DeckContext.tsx` or wherever `selectedState` changes trigger `MapActionContext.flyTo()`.

### BUG-7: hunt-nws-monitor In Error State

**Severity:** HIGH — NWS alert pipeline partially broken
**Ops dashboard shows:** hunt-nws-monitor with RED dot, 36m ago, "error" status
**Impact:** NWS severe weather alerts may not be ingesting correctly

**Fix:** Check hunt_cron_log for the error message:
```sql
SELECT * FROM hunt_cron_log
WHERE function_name = 'hunt-nws-monitor'
ORDER BY created_at DESC
LIMIT 5;
```

### BUG-8: 37 of 41 Crons Show "never" — Not Registered in pg_cron

**Severity:** HIGH — 90% of the data pipeline is offline
**Ops dashboard shows:** 3 healthy, 1 error, 0 late, 37 unknown

**Root cause:** Migration `20260348_register_all_crons.sql` was never applied to remote Supabase. Plus 16 additional crons from wave migrations (20260330-20260334) were omitted from that migration.

**Fix:** See `BUILD-SPEC-OPS-FIXES-HANDOFF.md` Phase 1 — apply migration + create new migration for missing 16.

---

## MEDIUM SEVERITY BUGS

### BUG-9: Species Filter Doesn't Change Convergence Scores

**Severity:** MEDIUM
**Steps to reproduce:**
1. Default view shows scores (WA: 83, MT: 80, SD: 81, etc.)
2. Switch species to "Duck" via selector
3. URL changes to /duck, header shows "DUCK"
4. Map scores remain identical — same 83, 80, 81, etc.

**Expected:** Each species should have different convergence weights per the spec. Switching to "duck" should re-weight for duck-specific factors.

**Possible cause:** The convergence engine may not be computing species-specific scores, or the frontend hook isn't passing the species filter.

### BUG-10: Mapbox Custom Images Missing (3 warnings)

**Severity:** MEDIUM — affects map visual features
**Console warnings:**
- `Image "score-pill" could not be loaded`
- `Image "pulsing-dot-fire" could not be loaded`
- `Image "pulsing-dot-hot" could not be loaded`

**Impact:** Score pill badges and pulsing fire/hot dot indicators don't render on the map.
**Fix:** These custom images need to be registered via `map.addImage()` during map initialization, or added to the sprite sheet.
**File:** `src/components/MapView.tsx` — look for where custom images are added. Make sure `score-pill`, `pulsing-dot-fire`, and `pulsing-dot-hot` are created with `map.addImage()` before any layers reference them.

### BUG-11: Mapbox Sprite Style Diff Warning

**Severity:** LOW
**Console:** `Unable to perform style diff: Unimplemented: setSprite. Rebuilding the style from scratch.`
**Impact:** When switching between layer presets, Mapbox can't do an incremental style update and has to rebuild from scratch. Causes a brief flash. Not a crash, but degrades the experience when toggling presets.

### BUG-12: Stale Data Sources (3 showing STALE)

**Severity:** MEDIUM — content types going stale
**Ops dashboard Data Freshness shows:**
- photoperiod: 37,190 entries, 7d old → **STALE**
- noaa-tide: 28,617 entries, 8d old → **STALE**
- crop-progress: 17,824 entries, 2d old → **STALE**

**Fix:** These will auto-resolve once their crons are registered (BUG-8). Specifically:
- photoperiod: computed by hunt-solunar-precompute (not registered)
- noaa-tide: no dedicated cron identified — may need one
- crop-progress: hunt-crop-progress-weekly (not registered)

---

## LOW SEVERITY / UX ISSUES

### UX-1: State Click on Map Doesn't Navigate

Clicking on a state in the map choropleth doesn't navigate to `/:species/:stateAbbr`. The click handler may be missing or the event target is being consumed by the convergence label overlay.

### UX-2: Map Hover Doesn't Show Tooltip

Hovering over states doesn't show a tooltip with state name/score. The feature-state hover may be changing opacity but there's no visible tooltip component.

### UX-3: Brain Growth Chart Title Misleading

The "Entries per Day (30d)" chart on /ops shows daily ingest rate, not cumulative brain size. The title leads users to think the brain shrank when ingest rate dropped after a backfill burst. Rename to "Daily Ingest Rate (30d)" and optionally add a cumulative line.

### UX-4: Hunting Bias in Dispatcher Responses

Chat response about Texas Feb 2021 references "duck migration spike" even though the query was about general weather events. The dispatcher injects hunting-specific context:
- Line ~719: injects "duck hunting"
- Line ~863: "feeding times hunting"
- Line ~934: "hunting season regulations"
- Line ~331/369/380/405: defaults species to 'duck'
- Line ~1008: "You are a hunting season expert"

**Fix:** Replace hunting-specific language with environmental intelligence framing per the "ENVIRONMENTAL INTELLIGENCE" brand.

### UX-5: Weather Forecast Panel Requires State Selection

Weather Forecast panel shows "Select a state to view forecast" on the /all route. This is technically correct behavior, but a better default would be to show a national summary or top-5 states by convergence score.

---

## WHAT WORKS WELL

These features passed testing with no issues:

| Feature | Status | Notes |
|---------|--------|-------|
| Map choropleth rendering | ✅ PASS | All 50 states with convergence scores + "FORMING" labels |
| 3D terrain view | ✅ PASS | Terrain preset shows beautiful satellite + elevation |
| Layer presets (4) | ✅ PASS | Field Recon, Weather, Intelligence, Terrain all toggle correctly |
| Individual layer toggles (27+) | ✅ PASS | Environment, Migration, Weather categories |
| Flyway corridors overlay | ✅ PASS | Pacific, Central, Mississippi flyways render with labels |
| Weather preset | ✅ PASS | Radar, wind flow arrows, station icons, pressure trends |
| Grid presets (7) | ✅ PASS | Default, Full Panels, Map Focus, Command Center, 2/3/4 Column |
| Command Center layout | ✅ PASS | Map 60% left, panels 40% right |
| Species selector | ✅ PASS | URL routing works for all 6 options (all/duck/goose/deer/turkey/dove) |
| Event ticker | ✅ PASS | Scrolling pressure-rise/drop events + COMPOUND RISK alerts |
| Brain Heartbeat | ✅ PASS | LIVE indicator, EMB count, CRONS count, last embed time |
| Widget Manager | ✅ PASS | 22 panels cataloged, add/remove works, search, category counts |
| State Screener | ✅ PASS | All 50 states, sortable columns, temperature filter tabs, sparklines |
| Convergence History | ✅ PASS | 30D/90D/365D toggle, current/7D/30D avg, trend line |
| History Replay | ✅ PASS | 30-day replay with play controls, speed control, day slider |
| NWS Alerts panel | ✅ PASS | Shows active Flood Warning with severity badge |
| What's Happening panel | ✅ PASS | Real-time COMPOUND-RISK alerts with state, domain count, timestamps |
| Brain Chat streaming | ✅ PASS | SSE streaming works, FROM THE BRAIN card + AI INTERPRETATION |
| Brain Chat suggested prompts | ✅ PASS | Dynamic prompts reference live data (17 alerts, SD spike) |
| Brain Activity panel | ✅ PASS | 66 embeds 24h, 3 active crons, last activity timestamp |
| Ops Dashboard | ✅ PASS | System pulse, cron health, brain growth chart, data freshness, alerts |
| Mobile layout (375px) | ✅ PASS | Header abbreviates to "DC", panels stack vertically, all readable |
| Mobile State Screener | ✅ PASS | Full table with all columns visible at 375px |

---

## EXECUTION ORDER

### Phase 1: Fix Broken Core Features (highest impact, do first)
1. **BUG-1:** Fix Brain Search panel — trace API call, compare to hunt-search expected params
2. **BUG-2:** Fix Convergence Scores panel timeout — check hook query, add pagination/index
3. **BUG-3:** Fix dispatcher historical search — add date filter extraction + vector search
4. **BUG-8:** Register all crons in pg_cron (see BUILD-SPEC-OPS-FIXES-HANDOFF.md)

### Phase 2: Fix Grading + Performance
5. **BUG-4:** Fix self-grading loop — field name mismatch + register crons
6. **BUG-5:** Add state filter to convergence-scan vector search (113s → 5s)
7. **BUG-7:** Investigate hunt-nws-monitor error state

### Phase 3: Map + Navigation
8. **BUG-6:** Fix state route flyTo animation
9. **BUG-9:** Fix species filter to actually change convergence weights
10. **BUG-10:** Register missing Mapbox custom images (score-pill, pulsing-dot-fire, pulsing-dot-hot)
11. **UX-1:** Fix state click handler on map
12. **UX-2:** Add state hover tooltip

### Phase 4: Polish
13. **UX-3:** Rename Brain Growth chart title
14. **UX-4:** Remove hunting bias from dispatcher
15. **UX-5:** Improve Weather Forecast default view

---

## FILES TO MODIFY

| File | Bugs |
|------|------|
| `src/panels/BrainSearchPanel.tsx` | BUG-1 |
| `src/hooks/useConvergenceScores.ts` (or similar) | BUG-2 |
| `supabase/functions/hunt-dispatcher/index.ts` | BUG-3, UX-4 |
| `supabase/functions/hunt-alert-grader/index.ts` | BUG-4 |
| `supabase/functions/hunt-alert-calibration/index.ts` | BUG-4 |
| `supabase/functions/hunt-convergence-scan/index.ts` | BUG-5 |
| `src/contexts/DeckContext.tsx` or `MapActionContext.tsx` | BUG-6 |
| `supabase/functions/hunt-nws-monitor/index.ts` | BUG-7 |
| `supabase/migrations/20260348_register_all_crons.sql` | BUG-8 |
| `supabase/migrations/20260349_register_missing_crons.sql` (NEW) | BUG-8 |
| `src/components/MapView.tsx` | BUG-10, BUG-11, UX-1, UX-2 |
| `src/hooks/useConvergenceEngine.ts` (or similar) | BUG-9 |

---

## CONSOLE LOG SUMMARY

| Time | Level | Message | Impact |
|------|-------|---------|--------|
| 12:29:05 | WARN | setSprite unimplemented, rebuilding style | Visual flash on preset switch |
| 12:29:05 | WARN | Image "score-pill" missing | Score badges don't render |
| 12:29:05 | WARN | Image "pulsing-dot-fire" missing | Fire indicators don't render |
| 12:29:05 | WARN | Image "pulsing-dot-hot" missing | Hot indicators don't render |
| 12:31:09 | WARN | Request timed out: convergence scores (5×) | Convergence Scores panel empty |

Zero fatal JS errors. Zero uncaught exceptions. The app is stable — it just has silent failures in data fetching.

---

## RELATED SPECS

- `BUILD-SPEC-OPS-FIXES-HANDOFF.md` — Cron registration SQL, alert grading fix, convergence-scan performance fix
- `BUILD-SPEC-CLEANUP-AND-STATE-2026-03-22.md` — 5-phase cleanup plan, dead code inventory
- `BUILD-SPEC-DISPATCHER-HISTORICAL-FIX.md` — 6 fixes for dispatcher + search
