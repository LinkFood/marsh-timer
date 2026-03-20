# Duck Countdown — Live Chrome QA Report

**Tested by:** Claude (Chrome extension + source code review)
**Date:** 2026-03-20
**URL:** https://duckcountdown.com
**Browser:** Chrome (via Claude in Chrome MCP)
**Build:** `index-CBXjubeF.js`
**Brain stats at test time:** EMB: 4548 | CRONS: 9/14

---

## 🚨 P0 BLOCKER: Panel Dock Crash

**Error:** `TypeError: me.useRef(...) is not a function`
**Source:** `react-grid-layout` v2.2.2 → `GridLayout` component
**Impact:** The **entire panel dock is dead**. All 18 panels fail to render. The ErrorBoundary shows "Panel dock error". Clicking Chat or any action that triggers a re-render escalates the crash — the ErrorBoundary propagates up and the **entire layout** (including map, heartbeat, bottom bar) shows "Layout failed to load. Refresh to try again."

**Root cause:** `react-grid-layout` v2.2.2 internally uses `useRef` from React, but in the minified production bundle the React reference (`me`) doesn't resolve correctly. This is likely a Vite + `@vitejs/plugin-react-swc` bundling issue where `react-grid-layout`'s ESM chunk gets a stale or incorrect React import.

**Console errors (10 total):** All identical — `me.useRef(...) is not a function` at `hoe` → `zoe` (minified RGL component names).

**Fix options (in priority order):**
1. **Pin `react-grid-layout` to v1.4.4** (last stable v1) — `"react-grid-layout": "1.4.4"` — safest, proven
2. **Add explicit React alias in vite.config.ts:**
   ```ts
   resolve: {
     alias: {
       "@": path.resolve(__dirname, "./src"),
       "react": path.resolve(__dirname, "./node_modules/react"),
       "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
     }
   }
   ```
3. **Check if a Vercel build cache** has a stale bundle — force redeploy with `--force`

**Sections completely blocked by this bug:** §7 (Default Panels), §8 (Panel Management), §9 (Category Filters), §10 (Panel Data Verification), §12 (Chat), §13 (State Deep-Dive via panel), §18 (Brain Search Panel)

---

## Section-by-Section Live Results

### §1. Initial Load — PARTIAL PASS (5/7)

| Item | Status | Notes |
|------|--------|-------|
| Site loads without blank screen | **PASS** | Loads with map visible |
| No red errors in Console | **FAIL** | 10 errors from react-grid-layout `useRef` crash |
| BrainHeartbeat bar visible | **PASS** | Red LIVE dot, green activity bars, EMB: 4548, CRONS: 9/14 |
| Map renders satellite-streets | **PASS** | Mapbox satellite-streets visible with state outlines |
| Panel dock renders with panels | **FAIL** | "Panel dock error" — react-grid-layout crash |
| Bottom bar visible | **PASS** | All, Intel, Migration, Weather, Analytics + "+" button |
| Header bar correct | **PASS** | "DUCK COUNTDOWN", species dropdown (Duck selected), all action icons |

**Additional note:** CRONS shows **9/14** — 5 crons may be unhealthy. Needs service-key investigation.

### §2. Map Basics — PASS (5/5)

| Item | Status | Notes |
|------|--------|-------|
| Satellite-streets imagery | **PASS** | Roads + satellite hybrid visible |
| Scroll zoom | **PASS** | Verified interactively |
| Click-drag pan | **PASS** | Verified interactively |
| Map resize grip | **PASS** | Handle visible between map and panel area |
| Map height persists | **PASS** | Verified via source (localStorage save on release) |

### §3. Map — State Interaction — PARTIAL PASS (4/7)

| Item | Status | Notes |
|------|--------|-------|
| Click state → popup shows | **PASS** | Clicked near TX — popup showed: "TEXAS TX", Season Closed, Hunt Score 62/100, 89°F, SSW 13 mph, Waxing Crescent, 1013 mb |
| State highlights on selection | **PASS** | Texas highlighted in gold fill when navigated to `/duck/TX` |
| URL changes to `/duck/XX` | **FAIL** | Map click shows popup but URL stays at `/`. Direct nav to `/duck/TX` works, but click-to-select doesn't update URL |
| Map flies to state | **PASS** | Verified via `/duck/TX` direct nav |
| Click same state → deselects | **NOT TESTED** | Couldn't trigger URL-based selection via click |
| Click different state → switches | **NOT TESTED** | Same issue |
| Popup shows score, weather, moon | **PASS** | Rich data in popup: hunt score, temp, wind, moon phase, pressure, precip |

### §4. Map — Layer Visibility — PARTIAL PASS (4/7)

| Item | Status | Notes |
|------|--------|-------|
| Weather events circles | **PASS** | Yellow glowing circles visible at weather stations |
| Wind flow arrows | **PASS** | Blue/teal directional arrows visible on map |
| Pressure trends | **PASS** | Red/blue triangles visible showing pressure changes |
| eBird heatmap | **FAIL** | Layer toggle shows OFF in Layer Picker; not visible on default load |
| Convergence heatmap | **FAIL** | Toggle OFF in Layer Picker; state fills not visibly color-coded by score |
| Convergence pulse | **FAIL** | Toggle OFF in Layer Picker |
| Perfect storm glow | **NOT VISIBLE** | Toggle OFF |

**Note:** Checklist expects these ON by default. Either defaults changed intentionally or there's a default-state bug.

### §5. Map — Popups — PASS (1/1 tested)

| Item | Status | Notes |
|------|--------|-------|
| State popup | **PASS** | Shows state name, season status, hunt score, weather, moon, pressure |
| eBird sighting popup | **NOT TESTED** | eBird clusters layer is OFF by default |
| NWS alert popup | **NOT TESTED** | Would need active alert polygon to click |
| DU pin popup | **NOT TESTED** | DU Pins layer is OFF |

### §6. Species Filter — PASS (3/3 tested)

| Item | Status | Notes |
|------|--------|-------|
| Dropdown shows all 5 species | **PASS** | Duck, Goose, Deer, Turkey, Dove |
| Select Deer → URL `/deer` | **PASS** | Title: "Deer Season Countdown", dropdown shows "DEER" |
| Select Duck → return to default | **PASS** | Verified |

### §7-10. Panels — ALL BLOCKED

**Status: FAIL (0/37)**
All panel tests blocked by P0 `react-grid-layout` crash. Panel dock shows "Panel dock error". No panels render.

### §11. Layer Picker — PASS (10/10 visible)

| Item | Status | Notes |
|------|--------|-------|
| Opens from right on Layers click | **PASS** | Smooth slide-in animation |
| Search bar visible | **PASS** | "Search layers..." placeholder |
| 4 presets visible | **PASS** | Scout, Weather, Intelligence, Terrain |
| ENVIRONMENT category (9 layers) | **PASS** | Wetlands, Water Bodies, Waterways, Parks, Trails, Agriculture, Land Cover, Contours, Counties |
| MIGRATION category (6 layers) | **PASS** | eBird Heatmap, eBird Clusters, Flyway Corridors, Flyway Flow, Migration Front, DU Pins |
| WEATHER category (7 layers) | **PASS** | Radar ✅, Wind Flow ✅, Isobars ✅, Pressure Trends ✅, NWS Alerts ✅, Weather Events ✅, Temperature ✅ |
| INTELLIGENCE category (3 layers) | **PASS** | Convergence Heatmap, Convergence Pulse, Perfect Storm (all OFF) |
| TERRAIN category (2 layers) | **PASS** | Satellite, 3D Terrain |
| Reset button | **PASS** | Visible (rotate icon) |
| Close (X) | **PASS** | Closes picker |

**Total layers: 27** matching the documented count.

### §12. Chat — BLOCKED

**Status: FAIL**
Clicking Chat button triggers a re-render that escalates the `react-grid-layout` error, crashing the entire layout to "Layout failed to load." Chat panel cannot be tested until P0 is fixed.

### §13. State Deep-Dive — PARTIAL (via routing only)

State Profile panel blocked by panel dock crash. However, navigating to `/duck/TX` correctly highlights Texas on the map and updates the page title.

### §14. Routing — PASS (7/7)

| Item | Status | Notes |
|------|--------|-------|
| `/` → default duck map | **PASS** | Loads correctly |
| `/duck` → duck map | **PASS** | Loads correctly |
| `/deer` → deer map, dropdown shows Deer | **PASS** | Title: "Deer Season Countdown" |
| `/duck/TX` → Texas selected | **PASS** | Texas highlighted, title: "Texas Duck Season" |
| `/TX` → redirects to `/duck/TX` | **PASS** | Immediate redirect, correct title |
| `/duck/ZZ` → redirects to `/duck` | **PASS** | Invalid state stripped |
| `/invalid` → redirects to `/` | **PASS** | Returns to home |

### §15. Auth — NOT TESTED

Would require clicking sign-in which may trigger layout crash.

### §16. Mobile — PASS (6/6 visible)

| Item | Status | Notes |
|------|--------|-------|
| Header compacts to "DC" | **PASS** | Verified at 375px width |
| Species dropdown visible | **PASS** | Shows "DUCK" |
| Map fills appropriate space | **PASS** | Takes ~70% of viewport |
| Bottom bar with mobile toggles | **PASS** | Chat + Layers icons visible |
| BrainHeartbeat hides EMB/CRONS | **PASS** | Only LIVE dot + activity bars shown |
| No horizontal overflow | **PASS** | Clean single-column layout |
| Panel dock mobile stacking | **FAIL** | Panel dock crashed same as desktop |

### §17. Performance — FAIL

| Item | Status | Notes |
|------|--------|-------|
| No red Console errors | **FAIL** | 10 errors from RGL crash |
| No stuck "Loading..." panels | **FAIL** | Panels don't render at all |
| Map interactions smooth | **PASS** | Zoom/pan/popups are fast |
| Layer toggles responsive | **PASS** | Layer Picker works well |
| Page doesn't freeze | **PARTIAL** | Works until Chat click crashes layout |

### §18. Brain Search — BLOCKED

Brain Search panel cannot be opened due to panel dock crash.

---

## Summary Table

| Section | Pass | Fail | Blocked | Notes |
|---------|------|------|---------|-------|
| 1. Initial Load | 5 | 2 | 0 | Console errors + panel dock crash |
| 2. Map Basics | 5 | 0 | 0 | All working |
| 3. Map States | 4 | 1 | 2 | Click doesn't update URL |
| 4. Map Layers | 4 | 3 | 0 | Default layers wrong |
| 5. Map Popups | 1 | 0 | 3 | State popup works; others need layers ON |
| 6. Species Filter | 3 | 0 | 0 | All working |
| 7. Default Panels | 0 | 5 | 0 | **BLOCKED** — RGL crash |
| 8. Panel Mgmt | 0 | 9 | 0 | **BLOCKED** — RGL crash |
| 9. Category Filters | 0 | 6 | 0 | **BLOCKED** — RGL crash |
| 10. Panel Data | 0 | 17 | 0 | **BLOCKED** — RGL crash |
| 11. Layer Picker | 10 | 0 | 0 | All working |
| 12. Chat | 0 | 16 | 0 | **BLOCKED** — triggers full crash |
| 13. State Deep-Dive | 2 | 5 | 0 | Routing works; panel blocked |
| 14. Routing | 7 | 0 | 0 | All working |
| 15. Auth | 0 | 0 | 5 | Not tested (crash risk) |
| 16. Mobile | 6 | 1 | 7 | Mobile panels blocked by same crash |
| 17. Performance | 2 | 3 | 3 | RGL crash dominates |
| 18. Brain Search | 0 | 7 | 0 | **BLOCKED** — panel dock crash |
| **TOTALS** | **49** | **75** | **20** | |

---

## Prioritized Issues

### P0 — Site-Breaking (Fix Immediately)

1. **`react-grid-layout` v2.2.2 `useRef` crash** — Kills all 18 panels, chat, brain search, state profile. Blocks 75+ checklist items.
   - **Error:** `TypeError: me.useRef(...) is not a function`
   - **File:** `node_modules/react-grid-layout/dist/chunk-XM2M6TC6.mjs`
   - **Fix:** Pin to `"react-grid-layout": "1.4.4"` in `package.json` and redeploy

2. **Chat click crashes entire layout** — Clicking Chat button escalates the panel dock ErrorBoundary to the top-level layout ErrorBoundary, showing "Layout failed to load."
   - **Root cause:** Same as #1 — Chat triggers a state change that re-renders the panel dock
   - **Fix:** Fix #1 fixes this. Alternatively, isolate the Chat slide-out from the panel dock render tree

### P1 — Functional Issues

3. **Map state click doesn't update URL** — Clicking a state on the map shows the popup but URL stays at `/`. Expected: URL changes to `/duck/XX`. Direct URL navigation works.
   - **Likely cause:** The click handler for URL navigation may depend on the panel dock context which is crashed
   - **Test after P0 fix**

4. **CRONS: 9/14** — Only 9 of 14 crons healthy. 5 crons may be errored, late, or never_run.
   - **Action:** Run `hunt-cron-health` with service key to identify which 5 are unhealthy

### P2 — Default Layer Configuration

5. **Intelligence layers OFF by default** — Convergence Heatmap, Convergence Pulse, and Perfect Storm are all OFF on load. The checklist expected them ON.
   - **Impact:** Map looks less informative on first visit — no convergence coloring visible
   - **Action:** Verify if this is intentional or a LayerContext default-state bug

---

**Overall verdict:** The site is **non-functional for its core use case** (panels, chat, brain search) due to the `react-grid-layout` v2.2.2 crash. The map, routing, layer picker, species filter, mobile layout, and heartbeat all work well. **Fix the RGL version first, then retest all blocked sections.**
