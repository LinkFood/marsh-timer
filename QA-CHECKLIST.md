# Duck Countdown QA Checklist — 2026-03-20

Run through each section. Mark PASS/FAIL. Note any issues with screenshots or console errors.

**Site:** https://duckcountdown.com
**Brain:** ~304K entries | **Crons:** 14 active | **Panels:** 18 | **Edge Functions:** 45+

---

## 1. Site Load & Layout

- [ ] Site loads without "Layout failed to load" error
- [ ] Header bar visible: "DUCK COUNTDOWN" brand, species dropdown, action icons
- [ ] BrainHeartbeat bar visible below header (LIVE indicator, activity dots, EMB count, CRONS count)
- [ ] Map renders with satellite-streets style
- [ ] Panel dock visible below map with panels
- [ ] Bottom bar visible with category filters (All, Intel, Migration, Weather, Analytics)
- [ ] No console errors on initial load (open DevTools → Console)

## 2. Map Interaction

- [ ] Click a state → state highlights, URL updates to `/duck/XX`
- [ ] Click same state again or empty area → deselects, URL back to `/duck`
- [ ] Map zoom with scroll wheel works
- [ ] Map drag/pan works
- [ ] Convergence heatmap colors visible on states (warmer = higher score)
- [ ] Resize handle between map and panels → drag up/down works
- [ ] Map height persists after page refresh

## 3. Species Filter

- [ ] Click species dropdown in header → shows Duck, Goose, Deer, Turkey, Dove
- [ ] Select "Deer" → URL changes to `/deer`, map updates
- [ ] Select "Duck" → back to `/duck`
- [ ] State click works correctly after species change

## 4. Panels

### 4a. Default Panels Load
- [ ] Brain Chat panel visible (default panel)
- [ ] Convergence Scores panel shows state rankings with scores
- [ ] Scout Report panel shows daily brief
- [ ] Weather Events panel shows detected events
- [ ] Brain Activity panel shows cron dots and stats

### 4b. Panel Management
- [ ] Click "+" button → Panel Add Menu opens with searchable catalog
- [ ] Add a panel (e.g., "eBird Feed") → panel appears in dock immediately (NOT requiring refresh)
- [ ] Close a panel (X button) → panel removed
- [ ] Drag a panel by its handle → repositions in grid
- [ ] Resize a panel → grid adjusts

### 4c. Category Filters
- [ ] Click "Weather" in bottom bar → only weather panels shown
- [ ] Click "All" → all panels return
- [ ] Panel positions preserved when toggling categories

### 4d. Individual Panel Content
- [ ] **Convergence Scores:** Shows state abbreviations with scores (0-100)
- [ ] **Convergence Alerts:** Shows alert entries with reasoning text, previous score, and current score (NOT blank/undefined)
- [ ] **Scout Report:** Shows today's AI-generated brief
- [ ] **Weather Events:** Shows real-time weather events with type and state
- [ ] **NWS Alerts:** Shows active NWS severe weather alerts
- [ ] **Weather Forecast:** Select a state → shows 16-day forecast
- [ ] **Solunar:** Shows moon phase and best hunting times
- [ ] **Migration Index:** Shows migration momentum data
- [ ] **eBird Feed:** Shows recent sightings when state selected
- [ ] **DU Reports:** Shows Ducks Unlimited migration reports
- [ ] **State Screener:** Shows sortable convergence table
- [ ] **History Replay:** Play button → scrubs through 30 days, map heatmap updates
- [ ] **Convergence History:** Shows sparkline trends
- [ ] **Brain Activity:** Shows cron health dots (should be mostly green)
- [ ] **Brain Search:** Type a query → returns brain entries with similarity scores
- [ ] **State Profile:** Select a state → shows full state deep-dive inside the panel (NOT breaking out of panel with fixed positioning)

## 5. Chat (Brain Chat Panel)

- [ ] Type a message → response appears with brain data cards
- [ ] Response shows "FROM THE BRAIN" section with cyan cards
- [ ] Response shows "AI INTERPRETATION" section
- [ ] Quick prompts visible (if any)
- [ ] Rapid double-click on send doesn't duplicate messages
- [ ] Try: "What's happening in Arkansas?" → should reference brain data
- [ ] Try: "Compare TX vs LA" → should show comparison
- [ ] Chat history persists within tab session (refresh within same tab)

## 6. Slide-Out Panels

- [ ] Click chat icon in header → Chat slide-out opens from right
- [ ] Click layers icon → Layer Picker opens from right
- [ ] Both can't overlap confusingly (one should close when other opens, or z-index is clear)
- [ ] Layer Picker shows 5 categories with toggle switches
- [ ] Toggle "Radar" layer → radar overlay appears on map
- [ ] Apply "Scout" preset → multiple layers activate
- [ ] "Reset" button returns to defaults

## 7. Map Layers

- [ ] Toggle convergence heatmap → state colors update
- [ ] Toggle eBird sightings → clusters/dots appear
- [ ] Toggle NWS alert polygons → colored alert areas on map
- [ ] Toggle flyway corridors → migration path lines
- [ ] Toggle 3D terrain → map tilts to 3D perspective
- [ ] Toggle satellite → switches to pure satellite imagery

## 8. State Deep-Dive

- [ ] Click a state on map → state profile loads
- [ ] Season data shows correct dates for selected species
- [ ] Weather forecast shows for selected state
- [ ] Convergence history sparkline shows for selected state
- [ ] Navigate to different state → data updates (not stuck on old state)
- [ ] Navigate back to original state → data reloads (not permanently cached as empty)

## 9. Routing

- [ ] `/duck` → duck map loads
- [ ] `/deer` → deer map loads
- [ ] `/duck/TX` → Texas selected with duck species
- [ ] `/TX` → redirects to `/duck/TX`
- [ ] `/invalid` → redirects to `/`
- [ ] `/duck/ZZ` → redirects to `/duck` (invalid state)
- [ ] Browser back/forward buttons work correctly

## 10. Auth

- [ ] Click user icon → shows sign-in option (if not signed in)
- [ ] Google OAuth flow works (if testing with account)
- [ ] Signed-in user sees email (masked) in user menu
- [ ] Sign out works

## 11. Mobile Responsiveness

- [ ] Resize browser to mobile width (~375px)
- [ ] Header compacts correctly
- [ ] Map fills appropriate space
- [ ] Panels stack vertically (PanelDockMobile)
- [ ] Bottom bar shows mobile toggles (chat, layers)
- [ ] Chat slide-out goes full-width on mobile
- [ ] Layer picker goes full-width on mobile
- [ ] Touch drag on map works
- [ ] Touch resize of map region works

## 12. Edge Function Health

Run in terminal:
```bash
SERVICE_KEY=$(npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null | grep service_role | awk '{print $NF}')
curl -s "https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-cron-health" -H "Authorization: Bearer $SERVICE_KEY" | python3 -m json.tool
```

- [ ] All 14 crons show "healthy"
- [ ] No crons show "error" or "late"
- [ ] Zero NULL embeddings: `curl -s "https://rvhyotvklfowklzjahdd.supabase.co/rest/v1/hunt_knowledge?embedding=is.null&select=id&limit=1" -H "Authorization: Bearer $SERVICE_KEY" -H "apikey: $SERVICE_KEY" -H "Prefer: count=exact" -I | grep content-range` → should show `*/0`

## 13. Brain Search Quality

Via Brain Search panel or chat:
- [ ] "cold front Arkansas" → returns weather events/patterns for AR
- [ ] "mallard migration November" → returns migration data
- [ ] "drought conditions Texas" → returns drought monitor data
- [ ] Results show content_type, state_abbr, similarity score
- [ ] Results are relevant (not random cross-state noise)

## 14. Error Recovery

- [ ] Throttle network to "Slow 3G" in DevTools → panels show loading states (not permanent blank)
- [ ] Re-enable network → panels recover and show data (NOT stuck empty requiring refresh)
- [ ] Navigate to a state while offline → come back online → state data loads on retry

## 15. Security Checks

- [ ] `hunt-generate-embedding` rejects unauthenticated requests:
  ```bash
  curl -s "https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-generate-embedding" -H "Content-Type: application/json" -d '{"text":"test"}'
  ```
  Should return 401, NOT a valid embedding.

- [ ] No secrets visible in page source or network tab (Supabase anon key is expected/OK)
- [ ] `hunt-feedback` CORS is not wildcard (check response headers)

---

## Summary

| Section | Status | Notes |
|---------|--------|-------|
| 1. Site Load | | |
| 2. Map | | |
| 3. Species | | |
| 4. Panels | | |
| 5. Chat | | |
| 6. Slide-Outs | | |
| 7. Map Layers | | |
| 8. State Deep-Dive | | |
| 9. Routing | | |
| 10. Auth | | |
| 11. Mobile | | |
| 12. Edge Functions | | |
| 13. Brain Search | | |
| 14. Error Recovery | | |
| 15. Security | | |

**Tested by:** ___
**Date:** ___
**Build hash:** ___
**Brain count at test time:** ___
