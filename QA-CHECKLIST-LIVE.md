# Duck Countdown — Live Chrome QA Checklist

**URL:** https://duckcountdown.com
**Browser:** Chrome (DevTools open, Console tab visible)
**Date:** 2026-03-20

Open DevTools (Cmd+Option+I) before loading the site. Keep Console tab visible throughout.

---

## 1. INITIAL LOAD

- [ ] Site loads without blank screen or crash
- [ ] No red errors in Console on load (warnings OK)
- [ ] BrainHeartbeat bar visible at top (dark glass bar, ~28px)
  - [ ] Red pulsing "LIVE" dot on left
  - [ ] Activity dots strip in center (green = success, red = error)
  - [ ] Right side shows: EMB count, CRONS count (should be 12/14 or 14/14)
- [ ] Map renders below heartbeat (satellite imagery, continental US)
- [ ] Panel dock renders below map with panels
- [ ] Bottom bar visible at bottom with category icons (All, Intel, Migration, Weather, Analytics)
- [ ] Header shows "DUCK COUNTDOWN" (or "DC" on mobile) with species dropdown and action icons
- [ ] No layout overlap — heartbeat, map, panels, bottom bar all stack cleanly

## 2. MAP BASICS

- [ ] Map shows satellite-streets imagery (roads + satellite hybrid)
- [ ] Zoom with scroll wheel works smoothly
- [ ] Click-drag to pan works
- [ ] Pinch-to-zoom on trackpad works
- [ ] Map resize: drag the grip handle between map and panels
  - [ ] Map grows/shrinks as you drag
  - [ ] Refresh page — map height persists (saved to localStorage)

## 3. MAP — STATE INTERACTION

- [ ] Click any state on map
  - [ ] State highlights (outline or fill change)
  - [ ] Map flies to state centroid
  - [ ] URL changes to `/duck/XX` (e.g., `/duck/TX`)
  - [ ] State Profile panel loads (if visible) with state data
- [ ] Click same state again
  - [ ] State deselects
  - [ ] URL reverts to `/duck`
- [ ] Click a different state
  - [ ] Previous state deselects, new state selects
  - [ ] URL updates to new state

## 4. MAP — LAYER VISIBILITY

Default layers should be visible on load:
- [ ] Convergence heatmap — colored state fills (red/orange/yellow/blue)
- [ ] Convergence pulse — animated glow on high-score states
- [ ] Weather events — circles on map where events detected
- [ ] Wind flow — arrow overlays showing wind direction
- [ ] Pressure trends — small arrows showing pressure change direction
- [ ] eBird heatmap — density overlay of bird sightings
- [ ] Perfect storm glow — rings on states where multiple signals converge

## 5. MAP — POPUPS

- [ ] Hover/click an eBird sighting dot (if visible via eBird Clusters layer)
  - [ ] Popup shows species name, count, location, date
  - [ ] Close button (X) works
- [ ] Click an NWS alert polygon (if any active — toggle NWS Alerts layer on)
  - [ ] Popup shows alert type, description, issued/expires times
- [ ] Click a DU pin (if any — toggle DU Pins layer on)
  - [ ] Popup shows report title, description, date

## 6. SPECIES FILTER

- [ ] Click species dropdown in header (shows: Duck, Goose, Deer, Turkey, Dove)
- [ ] Select "Deer"
  - [ ] URL changes to `/deer`
  - [ ] Map data updates (convergence scores may change)
  - [ ] Panels refresh with deer-specific data
- [ ] Select "Turkey" — same verification
- [ ] Select "Duck" — return to default
- [ ] With a state selected (e.g., `/duck/TX`), change species
  - [ ] URL updates to `/{newSpecies}/TX`
  - [ ] State stays selected, data refreshes for new species

## 7. PANELS — DEFAULT SET

These panels should load by default. Verify each shows data (not stuck on "Loading..." or empty):

- [ ] **Brain Chat** — Shows welcome message with compass icon and 4 suggested prompts
- [ ] **Convergence Scores** — Table of states ranked by hunt score (0-100), colored bars
- [ ] **Scout Report** — Daily AI-generated scout brief with markdown formatting
- [ ] **Weather Events** — List of detected weather events (cold fronts, pressure drops, etc.)
- [ ] **Brain Activity** — Cron execution dots + stats (embeddings today, active crons)

## 8. PANELS — ADD / REMOVE / MANAGE

### Add Panel
- [ ] Click "+" button in bottom bar (or header)
- [ ] Panel Add Menu dropdown opens with searchable list
- [ ] Type "solunar" in search — filters to Solunar panel
- [ ] Click Solunar — panel appears in dock immediately (no refresh needed)
- [ ] Menu closes after adding

### Close Panel
- [ ] Find the X button on any panel's title bar
- [ ] Click X — panel disappears from dock

### Minimize Panel
- [ ] Find the minimize (—) button on a panel's title bar
- [ ] Click it — panel content collapses, only title bar visible
- [ ] Click again — content expands back

### Drag & Resize (Desktop Only)
- [ ] Grab a panel by its drag handle (grip icon on left of title bar)
- [ ] Drag panel to a new position — other panels reflow
- [ ] Grab a panel's bottom-right corner resize handle
- [ ] Drag to resize — panel grows/shrinks within grid

## 9. PANELS — CATEGORY FILTERS

- [ ] Click "All" in bottom bar — all panels visible
- [ ] Click "Intel" — only Intelligence panels visible (Convergence, Alerts, Scout, Hunt Alerts, Brain Search, Chat, State Profile)
- [ ] Click "Migration" — only Migration panels (Migration Index, eBird, DU Reports, Screener)
- [ ] Click "Weather" — only Weather panels (Weather Events, NWS, Forecast, Solunar)
- [ ] Click "Analytics" — only Analytics panels (History Replay, Convergence History, Brain Activity)
- [ ] Click "All" again — all panels return

## 10. PANELS — DATA VERIFICATION

Add each panel (if not already showing) and verify it loads real data:

### Intelligence
- [ ] **Convergence Scores** — Shows ranked states with scores. Click a row → map flies to state
- [ ] **Convergence Alerts** — Shows score spike alerts with reasoning text and scores (not blank)
- [ ] **Scout Report** — Shows formatted daily brief (sections, bullet points)
- [ ] **Hunt Alerts** — Shows proactive alerts (may be empty if no active alerts — "No alerts" is OK)
- [ ] **Brain Search** — Has search input. Type "cold front Arkansas" → results appear with content_type, state, similarity score
- [ ] **Brain Chat** — (tested separately in Section 12)
- [ ] **State Profile** — Shows "Select a state" if none selected. Click a state on map → profile loads with seasons, weather, convergence

### Migration
- [ ] **Migration Index** — Shows migration momentum data
- [ ] **eBird Feed** — Shows recent eBird sighting activity
- [ ] **DU Reports** — Shows Ducks Unlimited migration articles/reports
- [ ] **State Screener** — Sortable table of all 50 states by convergence. Click column header to sort. Click row to select state

### Weather
- [ ] **Weather Events** — Shows event type (cold front, pressure drop, etc.) + state + timestamp
- [ ] **NWS Alerts** — Shows active NWS severe weather alerts (may be empty in calm weather)
- [ ] **Weather Forecast** — Select a state first → shows 16-day forecast strip
- [ ] **Solunar** — Shows moon phase, sunrise, sunset, solunar rating for selected state/today

### Analytics
- [ ] **History Replay** — Shows date slider (30-day range). Drag slider → map/panels update to historical data
- [ ] **Convergence History** — Shows sparkline/trend charts for convergence over time
- [ ] **Brain Activity** — Shows cron execution log dots (green = success). Stats: total embeddings, cron count

## 11. LAYER PICKER

- [ ] Click Layers icon (in header or bottom bar on mobile) — Layer Picker slides in from right
- [ ] Shows 5 collapsible categories: Environment, Migration, Weather, Intelligence, Terrain
- [ ] Each category shows count of active layers

### Toggle Layers
- [ ] Toggle OFF "Convergence Heatmap" → state fills disappear from map
- [ ] Toggle ON "Convergence Heatmap" → state fills reappear
- [ ] Toggle ON "Radar" → weather radar overlay appears on map
- [ ] Toggle OFF "Radar" → overlay disappears
- [ ] Toggle ON "eBird Clusters" → bird sighting cluster markers appear
- [ ] Toggle ON "Flyway Corridors" → flyway boundary fills appear
- [ ] Toggle ON "Counties" → county boundaries appear
- [ ] Toggle ON "NWS Alerts" → alert polygons appear (if any active)

### Presets
- [ ] Click "Scout" preset → map shows wetlands, water, parks, eBird clusters, counties, flyways
- [ ] Click "Weather" preset → map shows radar, wind, isobars, pressure, NWS alerts, weather events
- [ ] Click "Intel" preset → map shows convergence, perfect storm, migration front, wind, eBird
- [ ] Click "Terrain" preset → map shows land cover, contours, 3D terrain, satellite

### Reset & Search
- [ ] Click Reset button (rotate icon) → all layers return to defaults
- [ ] Type "wind" in search → filters to Wind Flow layer
- [ ] Clear search → all layers visible again

### Close
- [ ] Click X or click outside the picker → picker closes
- [ ] Layer changes persist after closing picker

## 12. CHAT (Brain Chat Panel)

### Welcome State
- [ ] Chat shows compass icon + "Duck Countdown Brain" heading
- [ ] 4 suggested prompt buttons visible
- [ ] Click a suggested prompt → message sends

### Send a Message
- [ ] Type "What's the weather like in Texas?" and press Enter
- [ ] Loading spinner appears (compass rotating)
- [ ] Response arrives with two sections:
  - [ ] **"FROM THE BRAIN"** — Cyan-bordered section with brain data cards
  - [ ] **"AI INTERPRETATION"** — White-bordered section with narrative text
- [ ] Brain cards show real data (weather info, citations)
- [ ] AI text has proper markdown formatting (bold, headers, lists)

### Brain Data Quality
Test these queries and verify relevant results:
- [ ] "cold front Arkansas" → should return weather event data for AR
- [ ] "mallard migration November" → should return migration/eBird data
- [ ] "drought conditions Texas" → should return drought monitor data for TX
- [ ] "best states for duck hunting this week" → should reference convergence scores

### Chat Behavior
- [ ] Double-click send button rapidly — only one message sends (no duplicates)
- [ ] Send button disabled while response loading
- [ ] Chat scrolls to newest message after response
- [ ] User messages appear on right (cyan tint)
- [ ] Bot messages appear on left (with compass icon)
- [ ] Timestamps visible on messages

### Map Actions from Chat
- [ ] Ask "Show me Texas" or similar state-referencing query
- [ ] If chat triggers a map action → map should fly to that state

## 13. STATE DEEP-DIVE

- [ ] Click Texas on the map (or navigate to `/duck/TX`)
- [ ] State Profile panel loads with:
  - [ ] State name + abbreviation
  - [ ] Season data (dates, bag limits, zones) for current species
  - [ ] Weather forecast strip (if available)
  - [ ] Convergence sparkline showing score trend
- [ ] Change species to Deer while TX selected
  - [ ] State Profile updates with deer season data for TX
- [ ] Click a different state (e.g., AR)
  - [ ] Profile refreshes with Arkansas data — no stale Texas data
- [ ] Deselect state (click selected state again)
  - [ ] Profile shows "Select a state to view profile" placeholder

## 14. ROUTING

Test these URLs directly in the address bar:

- [ ] `duckcountdown.com` → loads duck map (default)
- [ ] `duckcountdown.com/duck` → loads duck map
- [ ] `duckcountdown.com/deer` → loads deer map, species dropdown shows Deer
- [ ] `duckcountdown.com/duck/TX` → loads duck map with Texas selected
- [ ] `duckcountdown.com/deer/TX` → loads deer map with Texas selected
- [ ] `duckcountdown.com/TX` → redirects to `/duck/TX`
- [ ] `duckcountdown.com/duck/ZZ` → redirects to `/duck` (invalid state)
- [ ] `duckcountdown.com/invalid` → shows 404 page or redirects to `/`
- [ ] Browser back button after navigation → returns to previous view
- [ ] Browser forward button → goes forward correctly

## 15. AUTH

- [ ] Sign-in option visible (user icon in header or menu)
- [ ] Click sign in → Google OAuth flow starts
- [ ] After sign-in → email shown (masked) in header/menu
- [ ] Sign out button works → returns to signed-out state
- [ ] Site works without signing in (read-only, chat may be limited)

## 16. MOBILE (Chrome DevTools Device Toolbar)

Toggle Chrome DevTools device toolbar (Cmd+Shift+M) to simulate mobile:

- [ ] Header compacts to "DC" instead of "DUCK COUNTDOWN"
- [ ] Map takes ~35% of screen height (less than desktop)
- [ ] Panels stack vertically (no grid layout, no drag handles)
- [ ] Bottom bar shows Chat and Layers toggle buttons
- [ ] Tap Chat button → chat panel slides in from right (full width)
- [ ] Tap Layers button → layer picker slides in from right (full width)
- [ ] Tap outside slide-out → closes it
- [ ] BrainHeartbeat hides EMB/CRONS stats (only dots visible)
- [ ] Touch-drag to pan map works
- [ ] Touch-pinch to zoom map works
- [ ] Map resize divider works with touch drag
- [ ] Panels scroll vertically
- [ ] No horizontal scroll / overflow issues

## 17. PERFORMANCE & ERRORS

- [ ] No red errors in Console throughout entire test
- [ ] No "Loading..." panels stuck permanently (all should resolve within 10s)
- [ ] Map interactions are smooth (no visible lag on click/zoom/pan)
- [ ] Layer toggles apply within 1 second
- [ ] Panel add/remove is instant
- [ ] Chat response arrives within 10-15 seconds
- [ ] No memory warnings in Console
- [ ] Page doesn't freeze or become unresponsive

## 18. BRAIN SEARCH PANEL (Direct Vector Search)

- [ ] Add Brain Search panel if not visible
- [ ] Type "pressure drop migration" → search executes
- [ ] Results show:
  - [ ] Content type label (e.g., weather-event, migration-spike)
  - [ ] State abbreviation
  - [ ] Similarity score (0-1, higher = more relevant)
  - [ ] Content preview/snippet
- [ ] Results are relevant to the query (not random)
- [ ] Try "photoperiod December" → should return photoperiod data
- [ ] Try "convergence score Idaho" → should return convergence data

---

## RESULTS LOG

| Section | Pass | Fail | Notes |
|---------|------|------|-------|
| 1. Initial Load | /7 | | |
| 2. Map Basics | /5 | | |
| 3. Map — States | /7 | | |
| 4. Map — Layers | /7 | | |
| 5. Map — Popups | /6 | | |
| 6. Species Filter | /5 | | |
| 7. Default Panels | /5 | | |
| 8. Panel Management | /9 | | |
| 9. Category Filters | /6 | | |
| 10. Panel Data | /17 | | |
| 11. Layer Picker | /17 | | |
| 12. Chat | /16 | | |
| 13. State Deep-Dive | /7 | | |
| 14. Routing | /9 | | |
| 15. Auth | /5 | | |
| 16. Mobile | /14 | | |
| 17. Performance | /8 | | |
| 18. Brain Search | /7 | | |
| **TOTAL** | **/152** | | |

---

**When done:** Report failures with section number and item. Include Console errors (copy-paste the red text) and screenshots if anything looks wrong visually.
