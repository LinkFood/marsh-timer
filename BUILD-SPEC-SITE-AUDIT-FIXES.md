# BUILD SPEC: Site Audit Fixes — March 21, 2026

Comprehensive fix list from end-to-end site audit. Ordered by priority. Each item includes the exact problem, where to look, and what "done" looks like.

---

## B1: State Filtering Broken Across All Panels (HIGH)

**Problem:** When a user selects a state (URL changes to `/:species/:stateAbbr`), most panels ignore it. Pattern Alerts still says "Select a state." Weather Events, NWS Alerts, and Chat FROM THE BRAIN all show national data instead of state-specific data.

**Where to look:**
- `src/contexts/DeckContext.tsx` — `selectedState` value. Confirm it updates on route change.
- `src/panels/PatternAlerts/` — needs to read `selectedState` from DeckContext and pass `state_abbr` to its query.
- `src/panels/WeatherEvents/` — same: filter by `state_abbr` when a state is selected.
- `src/panels/NWSAlerts/` — same: filter `hunt_nws_alerts` by state when selected.
- `supabase/functions/hunt-dispatcher/index.ts` — the `recent_activity` handler returns national data even when the user asks about a specific state. It needs to parse state names from the query and pass `state_abbr` as a filter to the brain search RPC.

**Done when:**
- Clicking AR in convergence panel → Pattern Alerts loads AR historical matches
- NWS Alerts filters to AR alerts (or shows "No alerts for Arkansas")
- Weather Events filters to AR events
- Chat "What's happening in Arkansas?" → FROM THE BRAIN shows only AR data
- Clearing state selection returns to national view

---

## B5: Mobile Default Layout Hides All Panels (HIGH)

**Problem:** On 375px mobile, the default "Command Center" layout fills the entire viewport with the map. No panels visible, no bottom bar, no way to scroll to panels. Users must manually discover and switch to "Full Panels" grid preset.

**Where to look:**
- `src/layout/DeckLayout.tsx` — grid preset selection logic. Needs a mobile breakpoint check.
- `src/contexts/DeckContext.tsx` — `gridPreset` state. On mobile widths (<768px), should default to a mobile-friendly preset.
- `src/layout/PanelDockMobile.tsx` — this component exists and works (tested in "Full Panels" mode). Just needs to be the default on mobile.

**Options (pick one):**
1. Auto-switch to "Full Panels" on mobile (simplest)
2. Implement a swipe-up drawer (bottom sheet pattern like Google Maps) — map visible on top, panels slide up
3. Add a floating "View Intelligence" button on mobile that toggles panels

**Done when:** A user on a 375px phone sees panels without changing any settings.

---

## B2: Brain Search Panel Returns No Results (HIGH)

**Problem:** Searching "tornado damage Alabama" in the Brain Search panel returns "No results" despite the `hunt-search` edge function returning matches at 0.626 similarity via direct API call.

**Where to look:**
- `src/panels/BrainSearch/` — check what endpoint it calls, what similarity threshold it uses, and what filters it passes.
- `supabase/functions/hunt-search/index.ts` — the edge function works correctly. The panel may be calling a different RPC, using a higher threshold, or failing silently.
- Check browser console for errors when a search is executed.

**Done when:** "tornado damage Alabama" returns results with similarity scores shown.

---

## B3: "What's Happening" Panel Always Empty (MEDIUM)

**Problem:** Shows "No signals in the last 24 hours" with ALL 0, CONVERGENCE 0, WEATHER 0, NWS 0 — despite active NWS flood warnings in the ticker and convergence data flowing.

**Where to look:**
- `src/panels/WhatsHappening/` — check what data source it queries, what time window it uses, and what constitutes a "signal."
- It has tabs: ALL, CONVERGENCE, WEATHER, NWS — each likely queries a different table or content_type.
- The ticker is showing NWS and convergence events, so the data exists. The panel is likely querying the wrong table, using an incorrect time filter, or the signal detection logic has a bug.

**Done when:** The panel shows recent NWS alerts, convergence score changes, and weather events from the last 24 hours.

---

## B4: Weather Events Panel Empty (MEDIUM)

**Problem:** Shows "No active weather events" while `hunt-weather-realtime` has been logging events (pressure-drop, temp-drop, wind-shift, front-passage) to `hunt_weather_events`.

**Where to look:**
- `src/panels/WeatherEvents/` — check what table it queries and its time window filter.
- `hunt_weather_events` table — verify data exists with a recent `created_at`.
- The `hunt-weather-realtime` cron has been erroring for 9+ hours, so the most recent events may be >9 hours old. The panel may use a 1-hour or 6-hour window. Check and widen if needed.

**Done when:** Panel shows recent weather events with type, location, and timestamp.

---

## N1: Brain Entry Count Stale in Multiple Places (MEDIUM)

**Problem:** Three different counts displayed:
- Brain Search panel: "466K+ entries in the brain"
- Daily Brief footer: "295K+ embedded data points"
- Chat welcome: "1,136,414 entries from 21 sources" (this one is correct)

**Where to look:**
- `src/panels/BrainSearch/` — likely has a hardcoded or cached count. Should query the same source as the chat welcome.
- `supabase/functions/hunt-scout-report/index.ts` — the "295K+" is embedded in the report template. Should query actual count at generation time.
- `src/components/HuntChat.tsx` — has the correct count. Find how it gets it and reuse that pattern.

**Done when:** All three locations show the same count, pulled from a single source of truth (ideally a lightweight RPC or cached value that updates hourly).

---

## B6: Map Click Doesn't Navigate to State (LOW)

**Problem:** Clicking directly on a state polygon on the map doesn't trigger state selection/navigation. Only clicking in the Convergence Scores panel works.

**Where to look:**
- `src/components/MapView.tsx` — the click handler on state polygons. It may only trigger a hover effect or popup, not a navigation action.
- Look for `map.on('click', ...)` events on the state fill layer.
- Should call the same navigation logic as the convergence panel click: set `selectedState` in DeckContext and navigate to `/:species/:stateAbbr`.

**Done when:** Clicking any state on the map navigates to that state's view.

---

## B7: "ALL SIGNALS" Button Doesn't Return to National View (LOW)

**Problem:** When viewing `/all/AR`, clicking the "ALL SIGNALS" button in the header does nothing. Should navigate back to `/all`.

**Where to look:**
- `src/components/HeaderBar.tsx` — find the ALL SIGNALS button's onClick handler.
- It should clear `selectedState` in DeckContext and navigate to `/:species` (no stateAbbr).

**Done when:** Clicking ALL SIGNALS from any state view returns to the national view.

---

## N2: Data Source Health Indicators (MEDIUM)

**Problem:** The Data Sources dropdown shows 1 ONLINE, 7 STATIC, 13 UNKNOWN. Most "UNKNOWN" sources are actually active crons running successfully.

**Where to look:**
- `src/components/BrainHeartbeat.tsx` — the data source health logic.
- `src/data/dataSourceCatalog.ts` — where sources are defined with their status.
- Should cross-reference with `hunt_cron_log` to determine actual health status from last run.

**Done when:** Active crons show as ONLINE (green), not UNKNOWN.

---

## CRON: hunt-weather-realtime Erroring (MEDIUM)

**Problem:** Last ran 9+ hours ago with error status. Should run every 15 minutes. This is the ASOS 130-station monitoring pipeline.

**Where to look:**
- `supabase/functions/hunt-weather-realtime/index.ts` — check recent error in logs.
- Supabase dashboard → Edge Functions → hunt-weather-realtime → Logs.
- Common causes: API rate limit, timeout, malformed response from ASOS stations.

**Done when:** Cron runs successfully every 15 minutes and shows "healthy" in hunt-cron-health.

---

## CRON: 6+ Crons Missing from Health Tracking

**Problem:** `hunt-cron-health` only tracks 14 of 20+ scheduled crons. Missing:
- `hunt-anomaly-detector` (daily 9:30am)
- `hunt-correlation-engine` (daily 10:30am)
- `hunt-alert-grader` (daily 11:30am)
- `hunt-alert-calibration` (Sunday 1pm)
- `hunt-absence-detector` (Sunday 2pm)
- `hunt-web-curator` (daily 7am)
- `hunt-solunar-precompute` (Sunday 6am)
- `hunt-disaster-watch` (Wednesday 6am)

**Where to look:**
- `supabase/functions/hunt-cron-health/index.ts` — the cron list is likely hardcoded. Add the missing functions.
- Verify each missing function calls `logCronRun` on every exit path (success AND error). If they don't, that's why they're missing.

**Done when:** All 20+ scheduled crons appear in the health endpoint.

---

## CRON: 4 "Never Run" Crons

**Problem:** `hunt-weather-watchdog`, `hunt-convergence-report-card`, `hunt-du-map`, `hunt-du-alerts` show as "never_run."

**Where to look:**
- `hunt-weather-watchdog` — daily 6am. May not be calling `logCronRun`. Check the function.
- `hunt-convergence-report-card` — Sunday only. If it ran last Sunday before logging was added, it would show as never_run. Wait for next Sunday or trigger manually.
- `hunt-du-map` and `hunt-du-alerts` — Monday only. Same issue. Verify `logCronRun` is called.

**Done when:** Each function has `logCronRun` on every exit path and shows run history after its next scheduled execution.

---

## Improvement: State Intelligence Dashboard

**Not a bug — a feature gap.** When a state is selected, the panels should transform into a state-specific intelligence view. Currently state selection only affects map flyTo and convergence expansion.

**Ideal state view would show:**
- State convergence breakdown (already works in convergence panel)
- State-specific NWS alerts
- State weather events and forecast
- State migration data (eBird sightings, BirdCast radar)
- State pattern history (historical matches from brain)
- State profile (seasons, species, environment summary)

---

## Improvement: Cross-Panel Linking

Clicking an alert in NWS Alerts should fly the map to that state. Clicking a state in Migration Index should update all panels. Panels should communicate through DeckContext, not be isolated.

---

## Quick Reference: Key Files

| Component | Path |
|-----------|------|
| DeckContext | `src/contexts/DeckContext.tsx` |
| MapView | `src/components/MapView.tsx` |
| HeaderBar | `src/components/HeaderBar.tsx` |
| BrainHeartbeat | `src/components/BrainHeartbeat.tsx` |
| HuntChat | `src/components/HuntChat.tsx` |
| DeckLayout | `src/layout/DeckLayout.tsx` |
| PanelDockMobile | `src/layout/PanelDockMobile.tsx` |
| Panel Registry | `src/panels/PanelRegistry.ts` |
| Brain Search panel | `src/panels/BrainSearch/` |
| What's Happening panel | `src/panels/WhatsHappening/` |
| Weather Events panel | `src/panels/WeatherEvents/` |
| NWS Alerts panel | `src/panels/NWSAlerts/` |
| Pattern Alerts panel | `src/panels/PatternAlerts/` |
| hunt-dispatcher | `supabase/functions/hunt-dispatcher/index.ts` |
| hunt-search | `supabase/functions/hunt-search/index.ts` |
| hunt-cron-health | `supabase/functions/hunt-cron-health/index.ts` |
| hunt-scout-report | `supabase/functions/hunt-scout-report/index.ts` |
| hunt-weather-realtime | `supabase/functions/hunt-weather-realtime/index.ts` |
| Shared modules | `supabase/functions/_shared/` |
