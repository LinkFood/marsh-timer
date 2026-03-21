# DuckCountdown Full Audit Report

**Date:** 2026-03-20
**Auditor:** Cowork AI (Chrome live testing + source code review)
**Site:** duckcountdown.com
**Context:** Post SitDeck-inspired redesign. Claude Code implemented ~10 new features from SITDECK-IMPLEMENTATION-REPORT.md. This audit covers what works, what's broken, and what stale code needs cleanup.

---

## WHAT WORKS (New Features Landing Successfully)

### 1. Deck Selector ✅
- Header dropdown shows 5 templates: Command Center, Migration Tracker, Minimal, Scout Mode, Weather Watch
- Clicking a template loads the correct panel set
- "Save Current Layout" and "Reset to Default" options present
- Label updates in header (e.g., "COMMAND ..." / "MIGRATION ...")

### 2. Grid Layout Presets ✅
- Dropdown with 6 options: Default (12-col), Full Panels, Map Focus, 2/3/4 Columns
- Map Focus correctly expands map to ~75% of viewport
- Grid presets apply column changes to the panel dock

### 3. Widget Manager ✅
- "+" button opens full right-sidebar slide-out
- "WIDGET MANAGER 7/18 active" header with search bar
- Categorized sections: INTELLIGENCE, MIGRATION, WEATHER, ANALYTICS
- Each widget card shows: name, description, refresh badge (daily/15min/real-time/weekly), source count badge
- +/- toggle per widget, "Add All" / "Remove All" per category
- Search filters widgets in real-time

### 4. Panel Fullscreen ✅
- Expand icon (↗) in every panel title bar
- Panel fills entire viewport with "ESC to exit" indicator
- Convergence Scores ALL 50 in fullscreen is excellent — full-width bars for all states
- ESC key and close button both work to exit

### 5. Alert Manager ✅ (UI works, backend untested)
- Bell icon in header opens alerts dropdown
- "No alerts yet" empty state with "+ Create Alert" button
- Alert creation modal: Name, Trigger Type (Score Spike), Min Change/Min Score, States, Species
- CREATE ALERT button present (didn't test submit — requires auth)

### 6. Event Ticker ✅
- Scrolling horizontal strip below BrainHeartbeat
- Shows live weather events: pressure drops, wind shifts, front passages, NWS alerts
- Red dots for NWS warnings (Flood Warning), orange for weather events
- Timestamps and station codes visible
- Auto-scrolls continuously

### 7. Panel Share Buttons ✅
- Share icon (↗) on every panel title bar
- Dropdown: "Copy Link" and "Copy as Text"

### 8. Panel Internal Tabs ✅ (Partial)
- **Convergence Scores:** TOP 10 / ALL 50 tabs with counts — WORKING
- **Weather Events:** ALL 10 / PRESSURE CHANGE 9 / WEATHER EVENT 1 tabs — WORKING
- **Brain Activity:** ALL 4 / WRITERS 2 / GRADERS 0 / ALERTS 2 tabs — WORKING

### 9. Layer Picker ✅
- Right-sidebar slide-out with search, presets (Scout/Weather/Intelligence/Terrain)
- Categorized toggles: ENVIRONMENT, MIGRATION (4 active), WEATHER
- Count badges per category

### 10. BrainHeartbeat ✅
- LIVE indicator with green activity bars
- EMB count (321 and climbing — backfills running)
- CRONS: 4/14 with time-ago indicator

---

## CRITICAL BUGS (P0 — Must Fix)

### BUG 1: Chat Button Crashes Entire Layout 🔴
**Severity:** P0 — Site-breaking
**Steps:** Click the chat/speech-bubble icon in the header
**Result:** "Layout failed to load. Refresh to try again." — entire layout destroyed (map, panels, ticker, heartbeat all gone). Only header bar remains.
**Impact:** Chat is a core feature (Brain Analyst). Users lose all context and must reload.
**Likely Cause:** The chat slide-out or ChatPanel component throws an error during render. The ErrorBoundary in DeckLayout catches it but can't recover — it shows the fallback instead of just the chat failing. This was the same cascading ErrorBoundary issue from the react-grid-layout crash.
**Fix:** Wrap the chat slide-out in its OWN ErrorBoundary separate from the panel dock. The chat toggle should never be able to take down the entire layout.

### BUG 2: Brain Search Returns No Results 🔴
**Severity:** P0 — Core feature broken
**Steps:** Type "cold front Arkansas migration" in Brain Search panel → press Enter
**Result:** "No results for 'cold front Arkansas migration'"
**Expected:** Should return weather patterns, migration spikes, NWS alerts matching the query from 486K+ entries
**Impact:** Brain Search is THE differentiating feature — the user's window into the 486K-entry brain. If it doesn't work, the brain is invisible.
**Likely Cause:** The search panel is calling `hunt-search` or `hunt-generate-embedding` edge function and either: (a) the Voyage API key is missing/expired, (b) the RPC call is failing silently, (c) CORS is blocking, or (d) the embedding endpoint is returning an error that the UI swallows as "no results." Check network tab for 4xx/5xx responses.

### BUG 3: Map State Click Does Nothing 🔴
**Severity:** P0 — Navigation broken
**Steps:** Click on any state on the map (tested KS, WI, multiple areas)
**Result:** Nothing happens — no popup, no state selection, no URL navigation
**Expected:** Should show a popup with state info (season status, convergence score) and/or select the state in DeckContext so State Profile panel loads
**Impact:** The map is the primary navigation element. Users can't drill into any state. State Profile panel permanently shows "Select a state to view profile."
**Likely Cause:** The convergence heatmap fill layer or migration front layer is consuming click events before the state click handler fires. Or the state click handler was broken/removed during the redesign. Check MapView.tsx click event handling and layer ordering.

---

## SIGNIFICANT BUGS (P1 — Should Fix Soon)

### BUG 4: Migration Index Shows "ACTIVE STATES: 0" with 17 Spikes
**Severity:** P1
**Details:** Migration Index panel displays "170" as the index value, "-83.0%" trend, "ACTIVE STATES: 0" and "SPIKES: 17". Having 17 spikes but 0 active states is contradictory.
**Likely Cause:** The "active states" metric is using a different data source or time window than the spikes metric, or the active states query is broken.

### BUG 5: eBird Feed Panel Empty at Default Zoom
**Severity:** P1
**Details:** Shows "Zoom into the map to load sightings — Requires zoom level 6+" when the map is at US-overview zoom.
**Impact:** Panel is useless until user zooms in to a specific region. Should show aggregate or notable sightings at national level.
**Suggestion:** At low zoom, show a summary (e.g., "2,847 sightings today across 38 states") or recent notable observations. Reserve the "zoom to load" message for the map layer itself.

### BUG 6: Bottom Bar Category Tabs Don't Filter Panels
**Severity:** P1
**Details:** Clicking "Intel", "Migration", "Weather", "Analytics" in the bottom bar highlights the label and shows a count badge, but doesn't actually filter or change which panels are visible.
**Expected behavior:** Should filter the panel dock to show only panels in that category, or scroll/highlight relevant panels.

### BUG 7: Deck Selector vs Grid Presets Are Confused
**Severity:** P1
**Details:** The deck selector (templates) changes WHICH panels are shown. The grid preset changes HOW panels are arranged. But clicking "Default" in the grid preset dropdown doesn't reset the deck — it only resets the column layout. This creates confusion where users think "Default" means "go back to my original panels" but it doesn't.
**Fix:** Either: (a) Add a "Default" option to the deck selector that loads the original panel set, or (b) rename the grid preset "Default" to "3 Column" to avoid confusion with "Reset to Default" in the deck selector.

### BUG 8: Map Focus Mode Not Sidebar Layout
**Severity:** P1
**Details:** "Map Focus" preset description says "Large map, sidebar panels" but it actually just increases the map height — panels are still in a horizontal grid below the map, not in a sidebar column.
**Expected:** Panels should be in a narrow vertical sidebar on the right side of the map.

### BUG 9: CRONS: 4/14 — 10 Crons Unhealthy
**Severity:** P1
**Details:** BrainHeartbeat shows only 4 of 14 crons are healthy. That's 10 crons not running — meaning most data ingestion pipelines may be stale.
**Impact:** The brain isn't growing as fast as it should. Weather events, migration monitoring, NWS alerts, etc. may all be stale.
**Action:** Run `hunt-cron-health` endpoint to identify which crons are failing and why.

### BUG 10: Brain Search Shows "212K+ entries" But Database Has 486K
**Severity:** P1
**Details:** The Brain Search panel empty state says "212K+ entries in the brain" but we confirmed 486,200 entries exist. This is a hardcoded or cached number.
**Fix:** Either query the actual count or update the hardcoded value.

---

## MINOR BUGS (P2)

### BUG 11: Fullscreen Convergence Scores — Wasted Space in TOP 10 View
TOP 10 in fullscreen only fills ~40% of the viewport. Should auto-switch to ALL 50, or show expanded detail per state (component breakdown, weather events, etc.).

### BUG 12: No Map Visible After "Full Panels" Grid Preset
"Full Panels" preset hides the map. There's no visual indicator that the map is hidden, and no easy way to get it back without switching presets.

### BUG 13: Event Ticker Shows Only Pressure Events
During testing, the ticker showed almost exclusively pressure-drop and pressure-rise events from ASOS stations. NWS Flood Warnings appeared but no migration events, convergence alerts, or other event types. May need more diverse event sources feeding the ticker.

### BUG 14: Heartbeat Bar Shows Only 4-5 Green Bars
The BrainHeartbeat activity visualization shows very few bars compared to the original. With backfills running and 321 EMBs in 24h, should show more activity.

---

## STALE/DEAD CODE TO CLEAN UP

### Dead Hooks (Delete)
| File | Why It's Dead |
|------|---------------|
| `src/hooks/useFavorites.ts` | Pre-panel architecture favorites system. Never imported. |
| `src/hooks/useHistoryEvents.ts` | Superseded by HistoryReplayPanel. Never called by any component. |

### Dead Utility Functions (Remove from files)
| File | Dead Functions |
|------|---------------|
| `src/lib/seasonUtils.ts` | `getCountdownTarget()`, `getTimeRemaining()`, `getCompactCountdown()`, `sortByNextEvent()`, `getStatusColor()`, `getStatusLabel()`, `getDateDisplay()` — all from the countdown timer era. Only `getSeasonStatus()` and `getSeasonTypeLabel()` are used. |
| `src/lib/icsExport.ts` | Entire file: `generateICS()` and `downloadICS()`. Calendar export feature that was never wired to UI. |
| `src/lib/panelShare.ts` | `copyToClipboard()` — PanelWrapper implements its own clipboard logic. Only `generateShareUrl()` is used. |

### Orphaned Components (Delete)
| File | Why It's Dead |
|------|---------------|
| `src/components/TimelineScrubber.tsx` | Superseded by HistoryReplayPanel's built-in scrubber. Never imported. |
| `src/components/MapLegend.tsx` | Never rendered. Layer system uses inline legends instead. |

### Incomplete Data Infrastructure (Decide: Finish or Remove)
| File | Issue |
|------|-------|
| `src/data/zoneCountyMap.ts` | Only Texas duck zones mapped. Comment says "Add more states as data is verified." Either complete for all states or remove if zones aren't being used. |
| `src/data/flywayPaths.ts` | Static hardcoded GeoJSON flyway corridors. Should eventually be data-driven from hunt_knowledge, but works fine as-is for now. Low priority. |

---

## ARCHITECTURAL CONCERNS

### 1. ErrorBoundary Cascading (Root Cause of Chat Crash)
The layout has a single ErrorBoundary wrapping too much. When ANY child component throws (chat, a panel, a layer), the ENTIRE layout goes down. Need granular ErrorBoundaries:
- One around the panel dock (PanelDock.tsx)
- One around each individual panel (PanelWrapper.tsx — may already exist)
- One around the chat slide-out
- One around the map
- One around the event ticker
This way a chat crash only kills chat, not the whole page.

### 2. The Map Is Not the Primary Navigation Anymore
The map was originally the central piece — click a state, see its data. But with the panel-based intelligence platform, the map has become more of a visualization layer. State click navigation is broken and arguably less important than the panels + brain search. Consider: should state selection happen from the Convergence Scores panel (click a state row) rather than the map? The map becomes a passive intelligence display, and the panels become the active navigation.

### 3. Brain Search Is the Killer Feature — It Must Work
486K entries in hunt_knowledge, 19 content types, 21 data sources, 5 years of cross-referenced data. All of it is invisible if Brain Search doesn't work. This is the single most important fix on the site. Every user interaction should eventually lead back to the brain.

### 4. "Duck Countdown" Name vs Reality
The site title is still "Duck Countdown | When Does Duck Season Open?" but the product is now an environmental intelligence platform. The OG tags, title, and meta description are all countdown-era copy. When you're ready to rebrand, these all need updating:
- `<title>` tag
- OG tags in `middleware.ts`
- Site heading "DUCK COUNTDOWN"
- Species selector still says "DUCK" (accurate but reductive)

---

## PRIORITY FIX ORDER

| Priority | Bug | Effort | Impact |
|----------|-----|--------|--------|
| P0-1 | Chat button crashes layout (ErrorBoundary fix) | Small | Unblocks core feature |
| P0-2 | Brain Search returns no results | Medium | THE killer feature |
| P0-3 | Map state click does nothing | Medium | Core navigation |
| P1-1 | 10/14 crons unhealthy | Investigation | Data freshness |
| P1-2 | Bottom bar tabs don't filter panels | Small | UX confusion |
| P1-3 | Deck/Grid preset confusion | Small | UX confusion |
| P1-4 | Map Focus not sidebar layout | Medium | Layout feature |
| P1-5 | Migration Index contradictory data | Small | Data accuracy |
| P1-6 | eBird Feed empty at default zoom | Small | Panel usefulness |
| P1-7 | Update brain entry count (212K → 486K) | Trivial | Accuracy |
| P2 | Stale code cleanup | Small | Maintenance |

---

## WHAT'S ACTUALLY IMPRESSIVE (Don't Lose Sight)

Despite the bugs, the site has evolved dramatically:

1. **486,200 embedded entries** from 21 data sources in a single vector space
2. **Event ticker** is genuinely useful — live scrolling weather intelligence
3. **Panel fullscreen** transforms the data consumption experience
4. **Widget Manager** is professional-grade — categories, metadata, search
5. **Deck templates** let users switch between scout/migration/weather/analytics workflows
6. **Convergence Scores** with sparkline trends across all 50 states
7. **Scout Report** with real AI-generated intelligence citing actual data
8. **Weather Events panel** with internal tabs filtering by event type
9. **Brain Activity** showing real cron health and embedding rates
10. **History Replay** with 30-day scrubber and national average tracking

The bones are right. The new features from the SitDeck report mostly landed. Fix the P0s (chat crash, brain search, state click), clean up the confusion between deck/grid, and this thing will be very powerful.
