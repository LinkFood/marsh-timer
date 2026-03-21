# Duck Countdown — Full Site Audit (Post-Vision Transformation)

**Date:** 2026-03-20
**Audited by:** Cowork AI via Chrome
**URL:** https://duckcountdown.com
**Context:** This audit was performed AFTER Claude Code implemented the SitDeck feature set and some vision transformation copy changes. It tests the current live site against the new environmental intelligence platform vision.

---

## EXECUTIVE SUMMARY

The site has made significant progress. The header now reads "DUCK COUNTDOWN / ENVIRONMENTAL INTELLIGENCE." Deck templates have been redesigned (Command Center, Hunting Mode, Wildlife Monitor, etc.). Panel descriptions in the Widget Manager use environmental language. Layer presets renamed ("Field Recon" instead of "Scout"). Brain Search returns results (486K+ entries). Weather Events, Brain Activity, and Convergence Scores all work.

**However, there are critical failures and significant inconsistencies that need fixing before this feels like a finished product.**

---

## P0 — CRITICAL BUGS (Site-Breaking)

### 1. Chat Slide-Out Completely Broken
- **What happens:** Clicking the Chat button (header icon) does absolutely nothing. No slide-out appears, no error visible to user.
- **Root cause:** Console shows `TypeError: ve.useRef(...) is not a function` in the chat component. The ErrorBoundary catches the crash silently.
- **Stack trace:** `Y7 → pq → nI → l3 → s3 → Yj → K1 → BT → tM → dh`
- **Impact:** Users cannot access AI chat at all — the core brain interaction feature is dead.
- **Fix:** The `useRef` call in the chat component (likely `HuntChat.tsx` or `ChatPanel.tsx`) is being called incorrectly — possibly `useRef()()` (double-invoked) or a destructuring issue with the React import. Check for `const ref = useRef(...)` patterns that may have been refactored incorrectly.

### 2. Map State Click Produces No Popup
- **What happens:** Clicking any state on the map does nothing — no popup, no state selection, no URL change.
- **Tested:** Clicked MN, KS, and other visible states directly on the map. Zero response.
- **Workaround exists:** Clicking a state row in the Convergence Scores panel DOES work — it navigates to `/duck/ID`, flies the map to the state, and highlights the row.
- **Impact:** The most intuitive interaction (click a state on the map) is broken. New users will think the map is non-interactive.

### 3. Species Filter Does Not Affect Data
- **What happens:** Switching from Duck to Deer (via `/deer` route or header dropdown) changes the title and header label, but:
  - Convergence Scores show identical rankings (ID 80, OR 77, KS 70) regardless of species
  - Daily Brief shows the same duck-centric scout report ("BirdCast: high intensity, 754K birds")
  - Migration front lines (waterfowl-specific) still display on the deer map
  - eBird layers (waterfowl sightings) still active on deer view
- **Impact:** The species selector is cosmetic — it changes the label but not the data. This makes the platform feel fake. If deer is selected, the convergence engine should weight deer-relevant signals, and waterfowl layers should be hidden or replaced.

---

## P1 — SIGNIFICANT BUGS (Feature-Breaking)

### 4. Alert Bell Does Nothing
- **What happens:** Clicking the Alerts button (bell icon, ref_7) produces no visible response — no dropdown, no panel, no notification list.
- **Expected:** Should show a dropdown or panel with recent convergence alerts, NWS alerts, or pattern spike notifications.

### 5. Search Button Does Nothing
- **What happens:** Clicking the Search States button (magnifying glass, ref_10) produces no visible response.
- **Expected:** Should open a search/filter overlay for finding states by name.

### 6. Cron Health Shows 4/14 Active
- **What happens:** Brain Activity panel shows "CRONS: 4/14" in the header bar, and only 4 crons listed in the status section (weather realtime, nws monitor, check user alerts, power outage).
- **Expected:** 14 crons should be reporting. The remaining 10 may be running but not reporting to the cron health endpoint, OR they may have `never_run` status.
- **Action:** Run the cron health endpoint to diagnose: `curl hunt-cron-health`.

### 7. History Replay Shows "Day 1 of 13" But No Visual Feedback
- **What happens:** The History Replay panel shows playback controls and a sparkline, but pressing Play doesn't visibly animate the map or change convergence data. The "Day 1 of 13" label suggests only 13 days of data (should be 30).
- **Impact:** The replay feature appears non-functional to users.

---

## P2 — COPY & VISION INCONSISTENCIES

### 8. Daily Brief Still Says "DUCK COUNTDOWN SCOUT REPORT"
- **Where:** Daily Brief panel content
- **Current:** "DUCK COUNTDOWN SCOUT REPORT -- 2026-03-20"
- **Should be:** "DUCK COUNTDOWN DAILY BRIEF -- 2026-03-20" (matches the panel title)
- **Root cause:** The `hunt-scout-report` edge function generates this header text server-side. The panel was renamed to "Daily Brief" but the backend prompt wasn't updated.

### 9. Daily Brief Uses Hunting Language Throughout
- **Examples from the actual content:**
  - "[HOT] Idaho -- 80/100" → Should use "[HIGH SIGNAL]" or similar
  - "these conditions create ideal hunting sc..." (truncated "score")
  - "creating excellent late-season hunting as..." (truncated)
  - "NATIONAL HOTSPOTS:" → Could be "STRONGEST SIGNALS:"
  - "YOUR STATES:" → Could be "WATCHED STATES:"
- **Root cause:** The `hunt-scout-report` system prompt still frames everything as hunting intelligence.

### 10. Help Modal Page 1 Says "Scout" Mode
- **Where:** Help modal, page 1 ("Map Modes")
- **Current:** "Switch between Default, Scout, Weather, Terrain, and Intel modes"
- **Should be:** "Switch between Default, Field Recon, Weather, Terrain, and Intelligence modes" (matching the actual layer preset names)

### 11. Help Modal Page 2 Says "Species Pills"
- **Where:** Help modal, page 2 ("Species Intelligence")
- **Current:** "Tap the species pills in the header"
- **Should be:** "Use the species dropdown in the header" (it's now a `<select>` dropdown, not pills)

### 12. Help Modal Page 3 Undersells the Brain
- **Where:** Help modal, page 3 ("Chat Brain")
- **Current:** "It searches thousands of embedded knowledge entries"
- **Should be:** "It searches 486,000+ embedded knowledge entries from 21 data sources"

### 13. Brain Search Panel Shows Wrong Count
- **Where:** Brain Search panel empty state
- **Current:** Shows "486K+ entries in the brain" (correct!)
- **Note:** This was fixed from the previous "212K" — good.

### 14. Species Selector Is a Native `<select>` Element
- **What:** The species selector in the header is a plain HTML `<select>` dropdown showing "DUCK" in a bordered box.
- **Issue:** Doesn't match the dark theme styling of the rest of the header. A native select looks out of place in a custom-designed UI. Consider a custom dropdown component.

---

## WHAT'S WORKING WELL

### Brand & Framing (Partially Updated)
- ✅ Page title: "Duck Countdown | Environmental Intelligence Platform"
- ✅ Header subtitle: "ENVIRONMENTAL INTELLIGENCE"
- ✅ Species route titles: "Deer Intelligence | Duck Countdown"
- ✅ Widget Manager descriptions use environmental language ("Environmental convergence index by state", "AI-generated environmental intelligence summary", "Proactive environmental pattern alerts")
- ✅ Brain Search says "486K+ entries in the brain"

### Deck Templates (Fully Updated)
- ✅ Command Center, Hunting Mode, Minimal, Research, Weather Station, Wildlife Monitor
- ✅ Save Current Layout works
- ✅ Reset to Default works

### Layer System (Updated)
- ✅ Presets: Field Recon, Weather, Intelligence, Terrain
- ✅ Categories: Environment, Migration, Weather (well-organized)
- ✅ Multiple layers work simultaneously (convergence heatmap + migration front + flyway corridors)

### Grid Presets
- ✅ Default (12-column), Full Panels, Map Focus, 2/3/4 Columns all present

### Panel Data
- ✅ Convergence Scores: Working, shows top 10 with scores, bars, trend sparklines
- ✅ Daily Brief: Loads and displays content (copy needs update, but data flows)
- ✅ Brain Search: Returns results with content types and similarity scores
- ✅ Weather Events: Real-time data showing pressure changes, temp drops, front passages with station codes and timestamps
- ✅ Brain Activity: Shows embed count (1028/24h), active crons, last activity
- ✅ History Replay: UI renders with sparkline and controls
- ✅ State Profile: Shows "Select a state to view profile" empty state (correct behavior)

### Map
- ✅ Convergence heatmap renders with color gradient
- ✅ Dawn/dusk terminator line visible
- ✅ Migration front lines at ~43°N with labels
- ✅ Flyway corridor labels (Pacific, Central, Atlantic)
- ✅ eBird cluster markers (green dots) visible
- ✅ 3D globe perspective with satellite imagery

### Event Ticker
- ✅ Live scrolling: Flood warnings, pressure drops, front passages, temp drops
- ✅ Color-coded severity (red for NWS alerts, yellow/orange for weather events)
- ✅ Timestamps showing recency (now, 1h, 2h, 3h, etc.)

### Brain Heartbeat
- ✅ "LIVE" indicator with activity bars
- ✅ "EMB: 1028" (24h embed count) and "CRONS: 4/14" visible
- ✅ "SRC" badge on mobile

### Mobile Responsiveness
- ✅ Header collapses to "DC" brand with all icons visible
- ✅ Map renders correctly at mobile width
- ✅ Panels stack vertically
- ✅ Bottom bar shows category filters with counts
- ✅ Event ticker scrolls properly

### Auth
- ✅ Profile dropdown shows user email and Sign Out option

---

## PRIORITIZED FIX LIST

### Immediate (Do First)
1. **Fix chat `useRef` crash** — P0, blocks core feature
2. **Fix map state click handler** — P0, blocks primary interaction
3. **Update `hunt-scout-report` prompt** — change header to "DAILY BRIEF", section labels to [HIGH SIGNAL]/[MODERATE]/[LOW SIGNAL], remove hunting-specific framing

### This Week
4. **Make species filter actually filter data** — convergence should weight species-relevant signals, layers should toggle based on species
5. **Fix Alert bell** — wire up to show convergence alerts or NWS alerts in a dropdown
6. **Fix Search button** — wire up state search overlay
7. **Update Help modal copy** — "Scout" → "Field Recon", "pills" → "dropdown", "thousands" → "486,000+"
8. **Investigate 10 missing crons** — run cron health endpoint, check for early-return paths missing `logCronRun`

### Next Sprint
9. **Style species selector** — replace native `<select>` with custom themed dropdown
10. **Build "What's Happening" panel** — the new real-time signal feed from the vision transformation report
11. **Add Pattern Timeline panel** — historical pattern matching UI
12. **Update dispatcher system prompt** — shift from "hunting expert" to "environmental intelligence system"

---

## CONSOLE ERRORS CAPTURED

```
[ERROR] TypeError: ve.useRef(...) is not a function
    at Y7 (index-CsXNp25j.js:3541:18013)
    at pq (index-CsXNp25j.js:3542:5686)

[ERROR] [ErrorBoundary] TypeError: ve.useRef(...) is not a function
    at Y7 (index-CsXNp25j.js:3541:18013)
    at pq (index-CsXNp25j.js:3542:5686)
```

Both errors fire when the Chat button is clicked. The ErrorBoundary catches the crash, so the user sees nothing instead of a broken UI. This is better than a full-page crash but worse than an error message.

---

## STALE HUNTING LANGUAGE TRACKER

| Location | Current Text | Needed Change | Source |
|----------|-------------|---------------|--------|
| Daily Brief content | "DUCK COUNTDOWN SCOUT REPORT" | "DUCK COUNTDOWN DAILY BRIEF" | `hunt-scout-report` edge function |
| Daily Brief content | "[HOT] Idaho" | "[HIGH SIGNAL] Idaho" | `hunt-scout-report` edge function |
| Daily Brief content | "NATIONAL HOTSPOTS:" | "STRONGEST SIGNALS:" | `hunt-scout-report` edge function |
| Daily Brief content | "YOUR STATES:" | "WATCHED STATES:" | `hunt-scout-report` edge function |
| Daily Brief content | "ideal hunting sc..." | Remove hunting framing | `hunt-scout-report` edge function |
| Daily Brief content | "late-season hunting" | "late-season activity" | `hunt-scout-report` edge function |
| Help modal page 1 | "Scout" mode | "Field Recon" | `HelpModal.tsx` |
| Help modal page 2 | "species pills" | "species dropdown" | `HelpModal.tsx` |
| Help modal page 3 | "thousands of entries" | "486,000+ entries from 21 sources" | `HelpModal.tsx` |
| Dispatcher prompt | "hunting season expert" | "environmental intelligence system" | `hunt-dispatcher/index.ts` |

---

## SUMMARY

The site is about 65% of the way to the new vision. The framing layer (titles, subtitles, panel descriptions, deck templates, layer presets) has been updated well. The data pipeline is solid — 486K entries, real-time weather events, migration monitoring, convergence scoring all working.

The three P0s (chat crash, map click broken, species filter cosmetic-only) need to be fixed first. Then the backend prompts (scout report, dispatcher) need their language shifted from hunting to environmental intelligence. After that, the new panels (What's Happening, Pattern Timeline) will complete the transformation from "hunting countdown" to "environmental intelligence platform."

The bones are right. The brain is real. The data is flowing. Now fix the broken interactions and update the AI's voice.
