# BUILD SPEC: Cleanup, State of the Project, and Next Steps

**Date:** March 22, 2026
**Brain:** 2,184,000+ entries | 25+ content types | 52 edge functions | 22 panels
**Status:** Thesis validated (9/12 HITs). Site QA passed (12/12). Architecture sound. Needs cleanup + crons.

---

## WHERE WE STAND

The bones are solid. The thesis works. But 48 hours of heavy development left debris — old specs, dead code, broken crons, and hunting language throughout. This spec is the cleanup pass before we start growing again.

**What's working:**
- Vector search across 2M entries (<2s response)
- Cross-domain convergence proven (fire + drought + weather co-appear in single queries)
- Brain's correlation engine creating its own cross-domain entries (0.862 similarity)
- All 22 panels functional, 7 grid presets, mobile responsive
- hunt-weather-realtime running every 15 min (130 ASOS stations)
- All 46 database migrations applied cleanly
- Storm events backfill at 414K+ records

**What's broken:**
- 22 of 25 crons are NOT RUNNING (only weather-realtime and convergence-report-card active)
- hunt-convergence-scan intermittently failing
- Chat dispatcher can't access historical data (searches last 48hr only)
- Hunting language throughout dispatcher, components, types, hooks

---

## SECTION 1: CRON HEALTH — Get the Pipes Flowing

**CRITICAL:** Only 2 of 25 scheduled crons are actually running. The brain can't grow if it's not eating.

### Crons That Should Be Running But Aren't:

| Cron | Schedule | Purpose | Priority |
|------|----------|---------|----------|
| hunt-weather-watchdog | Daily 6am UTC | 50-state forecast + events | HIGH |
| hunt-nws-monitor | Every 3hr | NWS severe weather alerts | HIGH |
| hunt-migration-monitor | Daily 7am | eBird spike detection + brain scan | HIGH |
| hunt-convergence-engine | Daily 8am | 50-state convergence scoring | CRITICAL |
| hunt-convergence-alerts | Daily 8:15am | Score spike detection | HIGH |
| hunt-scout-report | Daily 9am | Daily environmental brief | MEDIUM |
| hunt-anomaly-detector | Daily 9:30am | 2-sigma outlier detection | HIGH |
| hunt-birdcast | Daily 10am | BirdCast radar migration | HIGH |
| hunt-forecast-tracker | Daily 10am | Forecast accuracy grading | MEDIUM |
| hunt-correlation-engine | Daily 10:30am | Cross-domain pattern discovery | HIGH |
| hunt-migration-report-card | Daily 11am | 7-day prediction grading | MEDIUM |
| hunt-alert-grader | Daily 11:30am | Alert outcome grading | HIGH |
| hunt-web-curator | Daily 7am | Opus reviews web discoveries | MEDIUM |
| hunt-nasa-power | Daily 6:30am | NASA POWER satellite | MEDIUM |
| hunt-du-alerts | Monday 6am | DU migration articles | LOW |
| hunt-du-map | Monday 12pm | DU migration map pins | LOW |
| hunt-solunar-precompute | Sunday 6am | 365-day solunar calendar | LOW |
| hunt-convergence-report-card | Sunday 12pm | Weekly model performance | RUNNING ✓ |
| hunt-alert-calibration | Sunday 1pm | Weekly accuracy aggregation | MEDIUM |
| hunt-absence-detector | Sunday 2pm | Bird absence detection | MEDIUM |
| hunt-disaster-watch | Wednesday 6am | Climate index disaster signatures | HIGH |
| hunt-drought-monitor | Check schedule | Drought data ingestion | HIGH |

### Action:
Check if these crons are registered in pg_cron. If not, register them:

```sql
-- Example for each cron (adjust schedule per table above):
SELECT cron.schedule(
  'hunt-weather-watchdog',
  '0 6 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-weather-watchdog',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $cron$
);
```

**IMPORTANT:** Use `$cron$` delimiters, never `$$`. Check CLAUDE.md rules.

### Debug hunt-convergence-scan:
This function is erroring on 3/5 recent runs. Read the error logs:
```sql
SELECT * FROM hunt_cron_log
WHERE function_name = 'hunt-convergence-scan'
ORDER BY created_at DESC
LIMIT 10;
```

---

## SECTION 2: CRITICAL BUG FIXES

### BUG-1: Dispatcher Can't Search Historical Data (CRITICAL)
**File:** `supabase/functions/hunt-dispatcher/index.ts`
**Problem:** Chat says "no stored entries" for historical queries even though hunt-search returns perfect results.
**Root cause:** Dispatcher queries recent 48hr activity, not historical vector search with date filters.
**Fix:** When user query references a specific time period ("February 2021", "last summer", "August 2023"):
1. Extract date range from the query
2. Pass `date_from` / `date_to` to the search_hunt_knowledge_v3 RPC call
3. The `search` and `general` intent handlers need to use the embedding + RPC path

### BUG-2: eval() on Untrusted HTML
**File:** `supabase/functions/hunt-birdcast/index.ts` line 74
**Fix:** Replace `eval(nuxtMatch[1].replace(/;$/, ''))` with JSON.parse or structured parser.

### BUG-3: IVFFlat Index Setting Wrong
**File:** search_hunt_knowledge_v3 RPC (SQL)
**Fix:** Change `SET LOCAL hnsw.ef_search = 80` → `SET LOCAL ivfflat.probes = 10`

### BUG-4: Route Fallback Defaults to Duck
**File:** `src/pages/Index.tsx` line 68
**Fix:** Change `"duck" as Species` → `"all" as Species`

### BUG-5: State Routes Assume Duck
**File:** `src/pages/Index.tsx` lines 64-65
**Fix:** Change `getStatesForSpecies("duck")` → check all species or use "all"

### BUG-6: Search Result Dedup
**File:** `supabase/functions/hunt-search/index.ts`
**Fix:** Add dedup by title + effective_date after vector results:
```typescript
const seen = new Set();
const deduped = vectorResults.filter(r => {
  const key = `${r.title}-${r.effective_date}`;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
```

### BUG-7: Recency Weight Default
**File:** `supabase/functions/hunt-search/index.ts`
**Fix:** Change `recency_weight ?? 0.0` → `recency_weight ?? 0.1`

### BUG-8: Missing logCronRun Calls
**Files:** hunt-nws-monitor, hunt-check-user-alerts, hunt-search-trends
**Fix:** Add `logCronRun` on success exit paths (each function has it on error paths but not success).

---

## SECTION 3: DEAD CODE CLEANUP

### Files to Delete from Repo Root:
| File | Reason |
|------|--------|
| `README.md` | Default Lovable template placeholder. CLAUDE.md is the source of truth. |
| `HUNTING-DATA-RESEARCH-PROMPT.md` | Historical research brief, data already ingested. |

### Old Specs — Evaluate and Archive:
These may have been superseded. Check if they conflict with BUILD-SPEC-UNIFIED.md:
| File | Status |
|------|--------|
| `BUILD-SPEC-SITE-AUDIT-FIXES.SUPERSEDED.md` | Already marked superseded — DELETE |
| `BUILD-SPEC-DOMAIN-AGNOSTIC-REFACTOR.SUPERSEDED.md` | Already marked superseded — DELETE |
| `BUILD-SPEC-DISPATCHER-HISTORICAL-FIX.md` | Merged into this spec — can DELETE after this spec is active |
| `EMERGENCY-FIX-SEARCH-RPC.md` | Fix was applied — DELETE |
| `SITDECK-IMPLEMENTATION-REPORT.md` | Reference only, keep for now |
| `VISION-TRANSFORMATION-REPORT.md` | Reference only, keep for now |
| `REPORT-LAYOUT-AND-MAPBOX.md` | Reference only, keep for now |

### Dead Frontend Code to Remove:

**Unused Hooks (0 imports):**
- `src/hooks/useCountyGeoJSON.ts`
- `src/hooks/useFeedback.ts`
- `src/hooks/useMigrationFront.ts`
- `src/hooks/useNationalWeather.ts`
- `src/hooks/useWeatherTiles.ts`

**Unused npm Dependencies:**
- `@mapbox/mapbox-gl-draw` — 0 imports, abandoned feature
- `@vercel/edge` — 0 imports, not a frontend dep
- `tailwindcss-animate` — 0 imports
- `react-grid-layout` — disabled per CLAUDE.md (crashes in Vite prod)

### Obsolete Scripts:
- `scripts/validate-data.mjs`
- `scripts/run-daily-indices.sh`
- `scripts/import-csv.mjs`
- `scripts/generate-sitemap.mjs`
- `scripts/ingest-du-alerts.ts` (superseded by hunt-du-alerts cron)
- `scripts/ingest-du-map.ts` (superseded by hunt-du-map cron)

---

## SECTION 4: HUNTING BIAS REFACTOR

### Edge Functions (3 files need changes):

**hunt-dispatcher/index.ts** (the big one):
- Line ~338: "You are the Duck Countdown Brain" → "You are an environmental intelligence system"
- Line ~179: Example mentions "duck hunting in Idaho" → environmental query
- Line ~719: Injects "duck hunting" into weather searches → REMOVE
- Line ~863: Injects "feeding times hunting" into solunar → REMOVE
- Line ~934: Injects "hunting season regulations" → REMOVE
- Lines ~331,369,380,405: Default species 'duck' → 'all'
- Line ~1008: "You are a hunting season expert" → "You are an environmental pattern expert"
- Line ~1228: "When users ask about hunting" → "Provide environmental intelligence lens"

**hunt-search-trends/index.ts:**
- Keywords: "duck season", "bag limit", "duck call" → add environmental terms
- Function: `inferSpecies` → `inferSignalDomain`

**hunt-usfws-survey/index.ts:**
- Comments: "most hunted duck" → ecological baseline language

### Frontend Renames (search-replace):
| Current | New | Files Affected |
|---------|-----|----------------|
| `HuntChat` | `BrainChat` or `EnvironmentalChat` | HuntChat.tsx + imports |
| `HuntAlert` (type) | `PatternAlert` | BrainHeartbeat.tsx + 10+ files |
| `useHuntAlerts` | `usePatternAlerts` | hook + 3 imports |
| `HuntAlertsPanel` | `PatternAlertsPanel` | panel file + registry |
| `.hunt-popup` (CSS) | `.signal-popup` | MapView.tsx, EventTicker.tsx |
| `'Hunter'` default name | `'Explorer'` | UserMenu.tsx line 38 |

### Frontend Content:
| File | Change |
|------|--------|
| `src/pages/Auth.tsx` lines 30-35 | "Hunting Intelligence Platform" → "Environmental Intelligence Platform" |
| `src/components/cards/ConvergenceCard.tsx` lines 142-146 | "Tough hunting" → "Low activity", "Drop everything and go" → "Peak convergence" |
| `src/data/stateFacts.ts` | Reframe hunting facts as ecological intelligence facts |
| `src/data/regulationLinks.ts` | Move to optional hunting module or remove from core |
| `src/components/cards/SeasonCard.tsx` | Rename to TimelineCard, make species-agnostic |

---

## SECTION 5: BACKFILL SCRIPTS STATUS

### Currently Running:
- **ebird-history** — Paused at TX/2022 via orchestrator. ~40hr ETA. Let it finish.
- **storm-events** — 414K+ done. May need continuation.

### Ready to Run Next (after ebird-history completes):
1. `correlate-bio-environmental.ts` — Cross-domain correlation discovery (HIGH priority)
2. `dedup-storm-events.ts` — Remove county duplicates (run dry-run first)
3. `backfill-birdcast-historical.ts` — 50K BirdCast radar records 2021-2025
4. `backfill-snow-cover.ts` — NOAA snow cover data

### New Backfill Scripts Needed (not yet built):
| Script | Source | Est. Entries | Priority |
|--------|--------|-------------|----------|
| `backfill-airnow.ts` | EPA AirNow PM2.5/O3 | ~30M+ | HIGH |
| `backfill-lightning.ts` | NOAA NCEI lightning data | ~1M | HIGH |
| `backfill-soil-moisture.ts` | NASA SMAP satellite | ~10M | MEDIUM |
| `backfill-sst.ts` | NOAA sea surface temp | ~30M | MEDIUM |
| `backfill-water-quality.ts` | USGS Water Quality Portal | ~50M | MEDIUM |

---

## SECTION 6: ARCHITECTURE NOTE — Event-Driven Fusion

The current system is schedule-driven (crons on a clock). The vision is event-driven (weather triggers convergence scans). **hunt-convergence-scan already exists** but is erroring. Once debugged, the architecture should be:

```
hunt-weather-realtime (every 15min)
  → detects weather event in state X
  → calls hunt-convergence-scan(state_abbr: X)
    → pulls latest drought, bird, water, fire, crop for state X
    → checks historical brain for similar multi-domain patterns
    → scores convergence on the spot
    → if score > threshold → writes alert with context
    → sets grade window (7/30/90 days)
  → hunt-alert-grader checks outcome after window closes
  → grade embedded back into brain → brain learns
```

This is the target architecture. The cron schedule stays as a safety net, but the real intelligence comes from event-driven fusion.

---

## EXECUTION ORDER

### Phase 1: Get the Pipes Flowing (do first)
1. Check/register all 22 missing crons in pg_cron
2. Debug hunt-convergence-scan errors
3. Verify hunt-convergence-engine fires and scores all 50 states
4. Let ebird-history backfill complete

### Phase 2: Bug Fixes
5. BUG-1: Dispatcher historical search (CRITICAL)
6. BUG-4 + BUG-5: Route fallback species
7. BUG-6: Search result dedup
8. BUG-7: Recency weight
9. BUG-8: Missing logCronRun calls
10. BUG-2: eval() in hunt-birdcast
11. BUG-3: IVFFlat probes

### Phase 3: Cleanup
12. Delete dead files (README, superseded specs, old scripts)
13. Delete dead hooks (5 unused)
14. Remove unused npm deps (4 packages)
15. Run dedup-storm-events.ts (dry-run first)

### Phase 4: Hunting Bias Refactor
16. hunt-dispatcher system prompts and query injection
17. Frontend renames (HuntChat, HuntAlert, useHuntAlerts, etc.)
18. Content fixes (Auth, ConvergenceCard, stateFacts)
19. Data layer reorganization (seasons, regulationLinks → optional module)

### Phase 5: Growth
20. Run correlate-bio-environmental.ts
21. Run backfill-birdcast-historical.ts
22. Build + run new backfill scripts (AirNow, Lightning, Soil)
23. Activate hunt-brain-synthesizer (cross-domain synthesis cron)
24. Target: 3M+ entries by end of month

---

## VERIFICATION

After Phase 1+2, these should all work:

| Test | Expected |
|------|----------|
| `hunt-cron-health` endpoint | 20+ crons showing healthy with recent runs |
| Chat: "What happened in TX Feb 2021?" | Storm-event data for TX Feb 2021 |
| Chat: "What's happening right now?" | Live convergence signals from today's data |
| Brain Search: "drought crop bird 2022" | Results with 2022 data (not 2012) |
| Convergence Scores panel | Fresh daily scores for all 50 states |
| All 50 state routes (e.g., /all/AR) | Default to "all" species, not "duck" |
