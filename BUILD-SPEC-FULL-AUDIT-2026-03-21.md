# BUILD SPEC: Full Platform Audit — March 21, 2026

**Brain Size:** 2,017,202 entries | **Content Types:** 25+ | **Edge Functions:** 52 | **Panels:** 22+
**Thesis Validated:** 9/12 HITs, 3 PARTIALs, 0 MISSes on historical disaster backtest
**Core Laws:** (1) Everything gets embedded. (2) Show don't predict.

---

## SECTION 1: CRITICAL BUGS (Fix First)

### BUG-1: Chat Dispatcher Can't Access Historical Data (CRITICAL)
- **File:** `supabase/functions/hunt-dispatcher/index.ts`
- **Problem:** When user asks "What happened in Texas February 2021?" the dispatcher responds "The brain has no stored entries" — but hunt-search returns 20 perfect matches. The dispatcher only queries recent 48hr activity, not historical vector search.
- **Fix:** Extract temporal references from user queries. When Haiku classifies intent, also parse date references ("February 2021" → date_from/date_to). Pass date filters to search_hunt_knowledge_v3 RPC. The `search` and `general` intent handlers need to call the embedding + RPC path, not just recent activity scan.
- **Verification:** Ask chat "What happened in Texas in February 2021?" → should return Winter Storm / Ice Storm data for TX Feb 2021.

### BUG-2: eval() on Untrusted HTML in hunt-birdcast
- **File:** `supabase/functions/hunt-birdcast/index.ts` line 74
- **Problem:** `eval(nuxtMatch[1].replace(/;$/, ''))` executes untrusted HTML content from birdcast.org
- **Fix:** Replace eval with JSON.parse or a dedicated parser.

### BUG-3: ChatCard Type Mismatch
- **File:** `src/hooks/useChat.ts` line 15
- **Problem:** ChatCard type union doesn't include `'activity'` but ChatMessage.tsx uses it (line 105, 170). TypeScript error + potential runtime crash.
- **Fix:** Add `'activity'` to the ChatCard type union.

### BUG-4: Invalid Route Falls Back to Duck Species
- **File:** `src/pages/Index.tsx` line 68
- **Problem:** `return { species: "duck" as Species }` — invalid routes default to duck instead of "all"
- **Fix:** Change `"duck"` to `"all"` on line 68.

### BUG-5: State-Only Routes Assume Duck
- **File:** `src/pages/Index.tsx` lines 64-65
- **Problem:** `getStatesForSpecies("duck")` — 2-letter state routes check against duck species only
- **Fix:** Check against all species groups or use `"all"`.

### BUG-6: Historical News Misclassifies Birds as Duck
- **File:** `supabase/functions/hunt-historical-news/index.ts` line 145
- **Problem:** `term.includes("bird") ? "duck"` — any bird-related historical article gets species tagged as "duck"
- **Fix:** Change to `null` so bird articles stay domain-agnostic.

### BUG-7: IVFFlat Index Setting Mismatch
- **File:** search_hunt_knowledge_v3 RPC (SQL)
- **Problem:** `SET LOCAL hnsw.ef_search = 80` — ignored for IVFFlat index
- **Fix:** Change to `SET LOCAL ivfflat.probes = 10;`

### BUG-8: Duplicate Results in Search
- **File:** `supabase/functions/hunt-search/index.ts`
- **Problem:** Same entries appear multiple times in results (identical title + date + similarity)
- **Fix:** Deduplicate vector results by id or title+date combo before returning.

### BUG-9: Recency Weight Defaults to 0.0
- **File:** `supabase/functions/hunt-search/index.ts`
- **Problem:** `recency_weight: recency_weight ?? 0.0` — when no date filters set, old data ranks equal to new data. Drought query returned 2012 data instead of 2022.
- **Fix:** Change default to `0.1` for slight recency boost.

---

## SECTION 2: HUNTING BIAS — Domain-Agnostic Refactor

The platform is an environmental intelligence research tool, NOT a hunting app. Every instance of "hunting" language needs to become "environmental" language.

### EDGE FUNCTIONS

| File | Line(s) | Current | Fix To |
|------|---------|---------|--------|
| hunt-dispatcher/index.ts | 338 | "You are the Duck Countdown Brain" | "You are an environmental intelligence system" |
| hunt-dispatcher/index.ts | 179 | Example mentions "duck hunting in Idaho" | Rewrite examples as environmental queries |
| hunt-dispatcher/index.ts | ~719 | Injects "duck hunting" into weather searches | Remove "duck hunting" injection |
| hunt-dispatcher/index.ts | ~863 | Injects "feeding times hunting" into solunar | Remove "hunting" injection |
| hunt-dispatcher/index.ts | ~934 | Injects "hunting season regulations" into season | Remove "hunting" injection |
| hunt-dispatcher/index.ts | ~331,369,380,405 | Defaults species to 'duck' | Default to 'all' |
| hunt-dispatcher/index.ts | ~1008 | "You are a hunting season expert" | "You are an environmental pattern expert" |
| hunt-dispatcher/index.ts | ~1228 | "When users ask about hunting, provide that lens" | "Provide environmental intelligence lens" |
| hunt-alerts/index.ts | 142 | "Hunting conditions and migration patterns" | "Environmental conditions and migration patterns" |
| hunt-phenology/index.ts | 31 | "hunting pattern correlation" | "environmental pattern correlation" |
| hunt-search-trends/index.ts | 16-278 | Multiple "hunting-related" references | "environmental-related" throughout |
| hunt-web-curator/index.ts | 58 | "hunting gear review" | "equipment reviews" or "retail marketing" |
| hunt-historical-news/index.ts | 8-18 | "hunting content", "Hunting/migration season" | "ecological content", "migration season" |
| hunt-historical-news/index.ts | 9-16 | Search terms: "duck hunting", "deer hunting season" | Add broader ecological terms |

### FRONTEND

| File | Line(s) | Current | Fix To |
|------|---------|---------|--------|
| src/components/UserMenu.tsx | 38 | Default name: `'Hunter'` | `'User'` or `'Explorer'` |
| src/hooks/useWeatherEvents.ts | 4 | "near hunting areas" | "for environmental monitoring" |
| src/hooks/useHuntAlerts.ts | all | `useHuntAlerts` / `HuntAlert` | `usePatternAlerts` / `PatternAlert` |
| src/hooks/useNWSAlerts.ts | 6 | `HUNTING_EVENTS` variable | `SEVERE_WEATHER_EVENTS` |
| src/hooks/useChat.ts | 27,39,44 | SessionStorage: `'hunt-chat-*'` | `'dc-chat-*'` |
| src/panels/HuntAlertsPanel.tsx | filename | `HuntAlertsPanel.tsx` | `PatternAlertsPanel.tsx` |
| src/pages/Auth.tsx | ~30-35 | "Hunting Intelligence Platform" | "Environmental Intelligence Platform" |
| src/data/stateFacts.ts | all | Hunting-focused facts ("Duck Hunting Capital") | Reframe as ecological intelligence facts |
| src/components/cards/ConvergenceCard.tsx | ~142-146 | "Tough hunting" / "Drop everything and go" | "Low activity" / "Peak convergence" |

---

## SECTION 3: WHAT WORKS (Live QA — All 10 Tests Passed)

| Feature | Status | Notes |
|---------|--------|-------|
| Site Load | PASS | All panels render, no console errors |
| 3D Globe Map | PASS | States visible with convergence coloring, hover tooltips work |
| Convergence Scores | PASS | 50-state scoring, sparkline trends, TOP 10 / ALL 50 tabs |
| Daily Brief | PASS | Generated with watched states, signals, solunar windows |
| Brain Search | PASS | 2,017,202 entries searchable via vector similarity |
| Brain Chat | PASS | Streaming AI responses with data cards, suggested prompts |
| Pattern Alerts | PASS | 10+ high-priority alerts with pressure/temp/wind details |
| Brain Activity | PASS | Cron health visible (2/14 active at test time) |
| Widget Manager | PASS | 22 panels in 4 categories, add/remove functional |
| Species Selector | PASS | All Signals → Duck filters data, URL updates |
| Grid Presets | PASS | 7 layouts including Command Center (side-by-side) |
| Mobile (375px) | PASS | Fully responsive, no layout breaks |
| State Selection | PASS | State picker works, data updates per state |

### Cron Health at Test Time
- **Active:** hunt-nws-monitor, hunt-power-outage (2 of 14 visible)
- **Brain entries (24h):** 2 new embeds
- **Note:** Low cron activity suggests many crons may need restart or are only scheduled for specific days/times. The 22 scheduled crons should all be healthy — audit cron_log for failures.

---

## SECTION 4: IDEAS & IMPROVEMENTS

### Search & Intelligence
1. **Cross-domain synthesis layer** — Activate hunt-brain-synthesizer to read dense vector clusters and write synthesis entries back into the brain. This closes the Tier 3 gaps (drought→crop→bird chain, earthquake→biology).
2. **Trigger definition engine** — Define what a "convergence trigger" looks like (3+ content types, same state, 72hr window, >0.5 similarity). Scan historical data for trigger matches. Compare against known events. This is how you prove the thesis going forward.
3. **Temporal extraction in dispatcher** — Parse date references from chat queries so the AI can search historical data.
4. **Signal decay** — Entries older than 5 years get slightly lower signal_weight unless they're part of a confirmed pattern. Keeps the brain biased toward recent patterns without losing history.

### UI/UX
5. **"What Would Have Happened" mode** — Let users pick a historical date and state, and the brain shows what convergence signals existed at that time. Time machine for environmental intelligence.
6. **Convergence timeline** — Visual timeline showing when multiple signals stacked up in a state over the past 30/90/365 days.
7. **Pattern chains** — When the brain finds a cross-domain link (fire + drought + wind), visualize the chain as a connected graph, not just a list.
8. **Source transparency** — Every brain response should show which content types contributed and their similarity scores. "Here's what I found and how confident each piece is."

### Performance
9. **IVFFlat index tuning** — With 2M rows, lists should be ~1414 (sqrt(2M)). Current probes setting is wrong (hnsw.ef_search instead of ivfflat.probes).
10. **Dedup storm events** — County-level duplicates inflate results. Run dedup-storm-events.ts in dry-run mode first.
11. **ChatMessage memoization** — parseMarkdown() runs on every render. Wrap in useMemo.

---

## SECTION 5: BACKFILL DATA PLAN — Feed the Beast

### TIER 1 — HIGH VALUE (do these first)

| Source | Data | API/Bulk | Est. Entries | Cross-Domain Value |
|--------|------|----------|-------------|-------------------|
| **EPA AirNow** | PM2.5, O3, NO2 real-time + 5yr archive | REST API (free registration) | ~30M+ | Air quality → migration hazards, crop stress, smoke events |
| **NOAA Lightning (NCEI)** | Daily gridded lightning frequency 1986-present | REST + download | ~500K-1M | Lightning → fire ignition, atmospheric ion changes, bird behavior |
| **NASA SMAP Soil Moisture** | Daily 9km soil moisture 2015-present | NSIDC + Earth Engine | ~10M+ | Soil → drought detection, crop stress, fire susceptibility |
| **NOAA Sea Surface Temp** | Daily coastal SST 1998-present | CoastWatch portal | ~30M+ | Ocean temp → hurricane intensity, coastal ecology, fish migration |
| **USGS Water Quality Portal** | pH, dissolved O2, temp, 430M+ records | REST API | ~50M+ useful | Water quality → fish health, algal blooms, ecosystem stress |

### TIER 2 — MEDIUM VALUE (fill gaps)

| Source | Data | Est. Entries | Cross-Domain Value |
|--------|------|-------------|-------------------|
| **NOAA Climate Indices (expanded)** | ONI, NAO, AMO, PDO, SOI — 150yr+ | ~1,800 monthly | Multi-year oscillation cycles → decade-scale patterns |
| **USDA NASS Quick Stats** | Crop yield, planted acres, livestock per county 50yr+ | ~100M+ | Crop cycles → land use → habitat → wildlife |
| **USA-NPN Phenology** | 1000+ species bloom/migration timing 1956-present | ~5M+ | Phenology shifts → food mismatch → population decline |
| **USGS Bird Banding Lab + Motus** | 90yr banding records + real-time nanotag tracking | ~3M+ | Individual bird movement → wind/temp/route validation |
| **NIFC Wildfire Perimeters** | 50yr wildfire boundary + cause data | ~100M+ | Fire history → habitat loss → species displacement |
| **EPA Air Quality (AQS)** | 45yr deep archive from 1000+ stations | ~50M+ | Long-term air trends → respiratory stress in wildlife |

### TIER 3 — FUTURE / EXPERIMENTAL

| Source | Data | Why It Matters |
|--------|------|---------------|
| **NOAA Great Lakes Buoys** | Water temp, ice cover, currents 20yr | Lake thermal → fish + waterfowl habitat |
| **EPA Toxics Release Inventory** | 800+ chemicals from 23K facilities 1987-present | Toxic exposure → ecosystem health baseline |
| **NASA MERRA-2 Reanalysis** | 45yr atmospheric reanalysis hourly global | Deep historical weather for any location |
| **Oklahoma Mesonet** | 50+ stations, 31yr, soil moisture + radiation | Regional deep baseline for tornado alley |
| **USGS Flood Impact (RTFI)** | Real-time flood stage vs. infrastructure | Flood footprints → habitat inundation |

### HISTORICAL BACKFILL PRIORITY (deep temporal data)

| Dataset | Years Available | Why |
|---------|----------------|-----|
| NOAA Climate Indices | 1864-present | 160yr oscillation patterns — El Niño, NAO, AMO cycles |
| USGS Streamflow (NWIS) | 1900-present | 125yr water signatures — drought, flood, baseflow |
| USDA Crop Stats | 1900s-present | 100yr+ agricultural cycles |
| USA-NPN Phenology | 1956-present | 70yr bloom/migration timing |
| EPA Air Quality | 1980-present | 45yr pollution trends |
| NIFC Fire History | 1980-present | 45yr fire behavior |
| NASA MERRA-2 | 1980-present | 45yr atmospheric reanalysis |

---

## EXECUTION ORDER

### Week 1: Critical Fixes
1. BUG-1: Dispatcher historical search fix
2. BUG-3: ChatCard type mismatch
3. BUG-4 + BUG-5: Route fallback species (duck → all)
4. BUG-6: Historical news species misclassification
5. BUG-8: Search result dedup
6. BUG-9: Recency weight default

### Week 2: Domain-Agnostic Refactor
7. All hunt-dispatcher bias fixes (system prompts, query injection, defaults)
8. Frontend text fixes (UserMenu, ConvergenceCard, Auth, stateFacts)
9. Variable/file renames (useHuntAlerts → usePatternAlerts, etc.)

### Week 3: Index + Performance
10. BUG-7: IVFFlat probes setting
11. BUG-2: eval() replacement in hunt-birdcast
12. Storm event dedup script (dry-run first)
13. ChatMessage memoization

### Week 4+: Backfill & Growth
14. EPA AirNow integration (edge function + cron)
15. NOAA Lightning data backfill
16. NASA SMAP soil moisture integration
17. Climate indices expansion (more indices, deeper history)
18. Activate hunt-brain-synthesizer (cross-domain synthesis cron)

### Ongoing
19. Keep all 22 crons healthy and running
20. Monitor brain growth (target: 3M entries by end of month)
21. Run thesis tests weekly as new data arrives

---

## VERIFICATION QUERIES (Run After Fixes)

| Query (via Chat) | Expected Result |
|---|---|
| "What happened in Texas in February 2021?" | Storm-event data: Winter Storm, Ice Storm, TX, Feb 2021 |
| "What environmental conditions converged in Hawaii August 2023?" | Fire + drought + storm-event for HI |
| "What was happening with the Mississippi River in fall 2022?" | Drought data for MS/MO + ideally USGS water |
| "Are there patterns in spring bird migration timing?" | bio-environmental-correlation entries (0.86 sim) |
| "What extreme temperatures hit Oregon in June 2021?" | Excessive Heat storm-events for OR/WA |
| "What's the brain detecting right now?" | Recent convergence signals, active alerts, live data |
