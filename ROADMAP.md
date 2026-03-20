# Duck Countdown — Master Roadmap

Last updated: 2026-03-20

## The Thesis

Fuse every environmental and biological signal into one vector space. Let the brain discover correlations nobody hypothesized. Surface them before events happen. Animals feel it first, the brain remembers, and the user gets the alert before the event.

**Not trying to be right. Trying to recognize patterns.** "The last N times conditions looked like this, here's what happened."

**Everything gets embedded.** The pipeline only grows. If data isn't being embedded, it's a bug.

**The moat is the cross-domain vector space.** Weather + water + vegetation + animal movement + acoustic + satellite + climate oscillations + phenology + crop progress + power grid + historical newspapers — all in one searchable brain. Nobody else has this.

## THE DISCOVERY (2026-03-20, 3AM)

Tested 13 major US natural disasters against 75 years of climate index data (AO/NAO/PDO/ENSO/PNA) embedded in the brain. **11 of 13 showed clear predictive signals 2-6 months before the event.** 85% hit rate. All data queried from hunt_knowledge — no external research.

Key findings:
- Snowmageddon 2010: AO = -4.27 (most extreme in 75 years). Signal building for 4 months.
- Texas Freeze 2021: AO crashed from -1.74 to -2.48 over 2 months. La Niña raging since October.
- 2011 Super Outbreak (362 tornadoes): AO = -2.63 in December, 4 months before. La Niña -1.69.
- Hurricane Ian 2022: PDO extreme negative for 6 straight months (-2.86 in July).
- 2 events (Camp Fire, Derecho) correctly showed no macro signal — they were local events.

**This is not a duck hunting feature. This is a discovery.** The same engine that predicts mallard migration may be an early warning system for natural disasters. The wildlife use case proves the engine. The implications are bigger.

---

---

## CURRENT STATE (2026-03-19)

**Brain:** 212,291 entries in hunt_knowledge. All embedded via Voyage AI 512-dim vectors. IVFFlat index working. Doubled since last update.

### Structured Tables:
| Table | Rows | Date Range |
|-------|-----:|-----------|
| hunt_knowledge | 212,291 | All time |
| hunt_weather_history | 45,450 | Sept 2020 → March 2026 (all 50 states) |
| hunt_migration_history | 8,149 | Sept 2020 → March 2026 (partial states) |
| hunt_convergence_scores | 600 | March 8-19, 2026 (12 days × 50 states) |
| hunt_seasons | 482 | 2025-2026 season data |

### Frontend:
- 111 source files. 14 components, 21 panel files, 5 layout, 4 layer, 3 contexts, 27 hooks.
- Composable panel-based deck layout with react-grid-layout.
- 27 user-toggleable map layers. 16 lazy-loaded panels. AI chat slide-out.

### Infrastructure:
- 14 crons active — ALL logging to hunt_cron_log
- 29 edge functions deployed
- Compute: Small (2GB RAM, 2-core ARM)
- Disk: 36GB gp3
- Supabase IO budget: Healthy

### Cron Health (as of 2026-03-19)
All 14 crons verified healthy. Fixed this session:
- Weather watchdog was failing daily (Open-Meteo TLS errors) — split into 2 batches of 25 + null guards
- 9 functions had no cron logging — added logCronRun to all functions + all early-return paths
- Health endpoint was capped at 100 global entries (weather-realtime dominated) — changed to per-function query
- **CHECK CRON HEALTH EVERY SESSION.** Run the hunt-cron-health endpoint.

---

## WHAT SHIPPED (2026-03-19 night session)

### Composable Panel Intelligence Platform — COMPLETE
Replaced fixed terminal shell with composable panel-based deck. Full frontend rebuild.

**New Architecture:**
- `DeckContext.tsx` — species, selectedState, chat/layers/panelAdd toggles, category filter
- `LayerContext.tsx` — 27 user-toggleable map layers replacing old LAYER_MODES system. 4 presets.
- `DeckLayout.tsx` → `MapRegion.tsx` (resizable) → `PanelDock.tsx` (react-grid-layout) → `BottomBar.tsx`
- `PanelRegistry.ts` — 16 lazy-loaded panels in 4 categories
- `LayerPicker.tsx` — searchable/categorized slide-out. `ChatPanel.tsx` — AI chat slide-out.
- `PanelWrapper.tsx` — drag handle, minimize, close. `PanelAddMenu.tsx` — searchable catalog.

**16 Panels:** Convergence Scores, Convergence Alerts, Scout Report, Hunt Alerts, State Profile, Migration Index, eBird Feed, DU Reports, State Screener, Weather Events, NWS Alerts, Weather Forecast, Solunar, History Replay, Convergence History, Brain Activity.

**Key decisions:**
- Map is NOT a panel — fixed region above panel grid, always visible
- Species is a filter dropdown, not tab navigation
- Each panel owns its own hooks (no prop drilling)
- visibleMapboxLayers from LayerContext drives MapView directly
- Layout persists to localStorage
- BottomBar category filters (All/Intel/Migration/Weather/Analytics)

**Deleted:** 25 old components + 7 orphaned hooks (~5,300 lines removed). Net: -4,100 lines.

**Prior: Bloomberg Terminal UX (2026-03-14)** — TerminalShell, LiveTicker, CanvasTabs, BrainPanel, DataCanvas, HistoryCanvas, ScreenerCanvas. All replaced and deleted by deck rebuild.

---

## PRIORITY: VISUAL POLISH + FEED THE BEAST

**Deck is built. Needs visual verification and iteration.** James hasn't confirmed the live site looks right yet. Data ingestion continues in parallel.

### Data Pipeline Queue (build one at a time):

#### Tier 1 — Fastest Wins (existing)
1. **eBird expanded endpoints** — Status & Trends, hotspots, notable observations (key: `ql314ikts0me`)
2. **NASA GIBS satellite imagery** — free, no auth, daily MODIS tiles for map layer + embedding
3. **NOAA Snow Cover (SNODAS)** — daily, hardest migration signal for waterfowl
4. **USDA Crop Progress** — already have NASS API key `25B05F81-1582-3D5D-A4F1-D13D00FCE7D1`

#### Tier 2 — High-Impact Animal Data (NEW)
5. **Movebank GPS tracking** — 2.5B GPS locations, REST API, free. Movement vectors: speed, bearing, altitude, stopovers. THE unlock for "why they moved."
6. **BirdWeather / BirdNET** — 5,000 always-on microphones detecting nocturnal migration in real time. Hours of lead time over eBird. Public API.
7. **GBIF** — 2.6B records, single API. Aggregates eBird, iNat, museums, government surveys. One pipe replaces many.
8. **Motus Wildlife Tracking** — 1,800 radio towers, birds + bats + dragonflies. Near-real-time, signal strength = altitude.
9. **Wildlife Insights (Google)** — 30M+ camera trap images, AI-classified, API. 1,000+ projects.
10. **Ocean Tracking Network** — 3,000 acoustic receivers, fish/shark/turtle tracks, ERDDAP API.

#### Tier 3 — Easy Wins, Huge Signal (NEW)
11. **USDA SCAN/SNOTEL soil temperature** — 2,000 stations, free CSV. Soil temp drives spring phenology better than air temp.
12. **PhenoCam Network** — 700 cameras, free API, computed vegetation index. Green-down = deer rut trigger.
13. **Journey North** — Bulk CSV, decades of first-arrival dates. Pure phenological calibration.
14. **FeederWatch (Cornell)** — Irruptive species = harsh condition signal.
15. **USA National Phenology Network** — Pheno Forecast maps, predicted emergence timing.
16. **River ice-out dates** — Controls spring waterfowl arrival, decades of historical data.

#### Tier 4 — Massive Unlock (existing + new)
17. **State DNR harvest reports** — Arkansas daily waterfowl, other states weekly/seasonal
18. **Great Lakes ice cover (GLERL)** — daily CSV, staging area signal
19. **USACE pool levels** — managed habitat, Mississippi flyway insider signal
20. **NASA NDVI / AppEEARS** — vegetation health, 16-day composites (turkey, deer, dove)
21. **CPC 6-14 Day Outlooks** — macro temperature predictor
22. **NIFC Active Fire / Prescribed Burns** — dove/turkey habitat

#### Tier 5 — Government Gold (NEW)
23. **USFWS Waterfowl Breeding Population Survey** — Gold standard since 1955.
24. **Christmas Bird Count (Audubon)** — 120+ years midwinter distribution.
25. **North American Breeding Bird Survey (USGS)** — 58 years population trends.
26. **Midwinter Waterfowl Survey (USFWS)** — January aerial counts by flyway.
27. **NEON** — 81 standardized sites: small mammals, birds, beetles, ticks, phenocams. Open API.

#### Tier 6 — Acoustic & Marine (NEW)
28. **NABat (USGS bat monitoring)** — Echolocation acoustic detectors. Bat activity = live barometer.
29. **Whale Alert / Whale Map** — Real-time whale acoustic + sighting data, NOAA hydrophones.
30. **Arbimon (Rainforest Connection)** — 100K+ sites, birds + frogs + insects + mammals from sound.
31. **ERDDAP (NOAA)** — Unified ocean data API: SST, chlorophyll, currents, salinity.
32. **Global Fishing Watch** — Vessel tracking as proxy for marine predator distribution.

#### Tier 7 — Wildcards (NEW)
33. **Roadkill observation systems** — Involuntary census, zero observer bias.
34. **Mushroom Observer** — Fungal fruiting as moisture + temp proxy. API available.
35. **USGS Wildlife Disease Surveillance** — HPAI/CWD outbreaks change movement patterns.
36. **VIIRS Light Pollution** — Artificial light affects nocturnal migration + mammal activity.
37. **Airport Wildlife Hazard Assessments** — Detailed seasonal species inventories.
38. **Cicada emergence tracking** — Soil temp calibration + food bonanza signal.

#### Meta-Play: Environmental State Vectors
Nightly composite embedding per county: ALL available signals concatenated into one fingerprint. Search for historical days with similar fingerprints across ALL dimensions simultaneously. Not 50 separate signals — one unified biological-environmental state space. **This is the product nobody else can build.**

### Existing Pipes (status as of 2026-03-19):
- **Photoperiod:** DONE (35,077 entries). UT/VT/WV failed — re-run with `START_STATE=UT` to fill gaps.
- **Drought Monitor:** DONE (8,400 entries). All 50 states, 168 weeks.
- eBird backfill: Partial (AK-CA in hunt_migration_history). Key `ql314ikts0me`. Resume from OR.
- USDA CropScape: 110 counties done
- USGS Water: 19K rows done. Resume from CA.
- NOAA Tides: 17K rows done. Resume from station 53/223.
- NOAA ACIS: 800 done. Resume from last state.
- **RULE: ONE PIPE AT A TIME.**

### Pattern Re-Extraction
When eBird backfill finishes → run `scripts/extract-patterns.ts`. Current: 8 weather-pattern entries. Expected: 1,000-5,000 cross-referenced patterns. This is the biggest unlock for "last N times conditions looked like this" answers.

---

## SHIPPED (prior sessions)

### Composable Deck Platform (2026-03-19 night) ✅
Full frontend rebuild — panel-based intelligence platform. 16 panels, 27 layers, react-grid-layout. See above.

### Bloomberg Terminal UX (2026-03-14 night) ✅
Terminal shell with live ticker, 4 canvas tabs, brain panel, replay player, screener. Replaced by deck platform.

### Brain V2 + Full Loop (2026-03-13/14) ✅
60+ commits. IVFFlat index, DU separation, pattern linker, forecast tracking, report cards, real-time weather, murmuration index, recall, compare mode, brain honesty, season awareness, species library, chat UX, error handling, cron monitoring.

### Phase 1-7 ✅
Eyes & ears (monitoring), brain (convergence engine), voice (scout reports + alerts), war room (16 map features), mother lode (data pipeline), user data (hunt log + feedback).

### Chat UX Phase 1-3 ✅
Map-chat bridge, convergence in chat, PatternCard, SourceCard, PatternLinksCard, auto-fly, auto-mode, compare mode, branded loading, compass avatar, history persistence.

### Resilience (2026-03-14) ✅
10s request timeouts, error boundaries, species Coming Soon, API deduplication, AuthContext provider.

---

## FUTURE HORIZON

- **Native app (iOS/Android):** Push notifications for convergence spikes + anomaly alerts
- **Ghost Clock:** Predicted migration arrival countdown based on upstream patterns
- **Flyway Dominoes:** Animated migration cascade visualization
- **Solunar Autopsy:** Test solunar theory vs actual eBird data at scale
- **Anomaly Detection:** Brain spots the weird thing before anyone asks — "crows are early this year" + here's why
- **Environmental State Vectors:** County-level daily fingerprints for holistic pattern matching
- **Movebank Integration:** GPS movement vectors fused with environmental conditions
- **Acoustic Layer:** BirdWeather nocturnal migration detection — alerts before dawn
- **Marine Expansion:** Ocean Tracking Network + ERDDAP + Fishing Watch = fishing intelligence
- **Cross-Kingdom:** Insects, pollinators, bats, reptiles — same brain, different biological sensors
- **Premium tiers:** Free = season lookup. Paid = brain access + anomaly alerts
- **The Wire:** Crowdsourced real-time reports feeding back into the brain

---

## The Compounding Effect

| Timeframe | Corpus Size | What It Knows |
|-----------|------------|---------------|
| Today (2026-03-19) | ~219,000 | Weather, migration, tides, water, drought, photoperiod, climate, solunar, species behavior, crops |
| After current pipes | ~300,000+ | + USGS water (all 50), NOAA tides, ACIS climate, USDA crops complete |
| After Tier 2-3 | ~500,000+ | + Movebank GPS tracks, BirdWeather acoustic, GBIF, soil temp, PhenoCam, phenology |
| After pattern extraction | ~510,000+ | + 1,000-5,000 cross-referenced weather-migration patterns |
| After government gold | ~750,000+ | + 70 years of USFWS surveys, CBC, BBS, NEON |
| After acoustic + marine | ~1,000,000+ | + bat monitoring, whale tracking, ocean data, fishing vessel proxies |
| After 1 full season | ~2,000,000+ | + daily accumulation + user logs + pattern links + report cards |
| After environmental state vectors | ∞ | Every county, every day, one fingerprint. Historical pattern matching across ALL dimensions. |

**This isn't a hunting app. It's a biological pattern recognition engine. Every day it gets wider. Nobody can catch up.**
