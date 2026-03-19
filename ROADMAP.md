# Duck Countdown — Master Roadmap

Last updated: 2026-03-19

## The Thesis

The grandpa on the porch. 60 years of watching the sky, the creek, and the acorns — and he just knows. Except we're watching 50 states, 24/7, and never forget a single day. This is a wildlife pattern recognition engine. Data in → pattern match → outcome link → remember → repeat. The loop never stops.

**Not trying to be right. Trying to recognize patterns.** "The last N times conditions looked like this, here's what happened." The hunter makes the call.

**Weather is the trigger.** All animals move off weather shifts. The brain needs to detect front passages in hours, not days.

**Everything through the gate gets embedded.** The pipeline only grows. If data isn't being embedded, it's a bug.

**Five species. That's the moat.** Duck, goose, deer, turkey, dove. Deer and birds with wings. Get these working well first. Fish and elk are future expansion.

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

### Infrastructure:
- 14 crons active — ALL logging to hunt_cron_log, ALL healthy as of 2026-03-19
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

## WHAT SHIPPED TONIGHT (2026-03-14 night session)

### Bloomberg Terminal UX Overhaul — COMPLETE
Replaced sidebar-with-tabs layout with a full terminal shell. All 4 tabs live.

**New Components:**
- `TerminalShell.tsx` — Layout orchestrator (fixed positioning, not CSS grid — grid blocks map pointer events)
- `LiveTicker.tsx` — Scrolling live feed with pulsing LIVE dot, convergence/weather/NWS/hunt alerts, migration index. Adaptive scroll speed, hover-pause, severity colors.
- `CanvasTabs.tsx` — Desktop top bar + mobile bottom bar. Map/Data/History/Screener + Brain (mobile only)
- `BrainPanel.tsx` — Chat (always visible) + collapsible Intel drawer with ScoutReport, HotspotRanking, ConvergenceCard, StateView, ZoneView. Back nav when drilled in.
- `DataCanvas.tsx` — 6-card dashboard: Migration Index, Top 10 Hotspots (clickable), Alert Feed, Score Distribution histogram, Scout Brief, Quick Stats
- `HistoryCanvas.tsx` — 30-day replay player. Play/pause, 0.5x-4x speed, step/skip, seek bar. Auto-switches map to Intel mode. Drives existing scrubDate mechanism for convergence heatmap animation.
- `ScreenerCanvas.tsx` — Sortable/filterable state convergence table. Sort by score/weather/migration/solunar/pattern. Filter by minimums. Click to fly to state. HOT/WARM/MILD/COOL badges.

**Modified:**
- `Index.tsx` — Swapped Sidebar/MobileSheet for TerminalShell. Added activeCanvas state, useMurmurationIndex, ErrorBoundary around shell. Auto-Intel-mode for History tab.
- `HeaderBar.tsx` — Removed migration index (moved to LiveTicker), cleaned up unused imports
- `MapLegend.tsx` — Fixed sidebar offset from 340px to 320px
- `MapPresets.tsx` — Fixed mobile bottom position for new bottom tab bar

**Retired (not deleted):**
- `Sidebar.tsx` — replaced by BrainPanel
- `MobileSheet.tsx` — replaced by mobile CanvasTabs + brain overlay

### Data Recon — 30 New Sources Identified
Full recon saved at `.claude/agent-memory/idea-machine/data_source_recon_v2.md`. Key findings:
- Deer and turkey have almost ZERO real-time data feeds (iNaturalist fills this gap)
- No snow/ice data (hardest migration signal — NOHRSC and GLERL are free, daily)
- No drought data (US Drought Monitor — free REST API, weekly, no auth)
- State DNR harvest reports are ground truth (Arkansas publishes DAILY waterfowl harvest)
- NASA GIBS provides free daily satellite imagery that plugs directly into Mapbox

---

## PRIORITY: FEED THE BEAST

**UX is done. The job now is finding and embedding data.** Possibly for a long time. The more information embedded, the smarter the brain gets. Every data source makes every other data source more valuable through cross-referencing.

### Data Pipeline Queue (build one at a time):

#### Tier 1 — Fastest Wins
1. **US Drought Monitor** — REST API, no auth, weekly, all 5 species
2. **iNaturalist** — REST API, no auth, deer/turkey/dove (currently data-starved)
3. **eBird expanded endpoints** — Status & Trends, hotspots, notable observations, regional stats (key: `ql314ikts0me`)
4. **NASA GIBS satellite imagery** — free, no auth, daily MODIS tiles for map layer + embedding
5. **NOAA Snow Cover (SNODAS)** — daily, hardest migration signal for waterfowl

#### Tier 2 — Massive Unlock
6. **State DNR harvest reports** — Arkansas daily waterfowl, other states weekly/seasonal
7. **Great Lakes ice cover (GLERL)** — daily CSV, staging area signal
8. **USACE pool levels** — managed habitat, Mississippi flyway insider signal
9. **USDA Crop Progress** — already have NASS API key `25B05F81-1582-3D5D-A4F1-D13D00FCE7D1`
10. **NASA NDVI / AppEEARS** — vegetation health, 16-day composites (turkey, deer, dove)
11. **USDA Mast Surveys** — acorn/mast crop reports (deer movement trigger)
12. **National Phenology Network** — green-up, leaf-off, frost timing

#### Tier 3 — Bloomberg Terminal Flex
13. **CPC 6-14 Day Outlooks** — macro temperature predictor
14. **SPC Severe Weather Outlooks** — migration trigger prediction
15. **NEXRAD Roost Departures** — morning bird locations from radar
16. **Movebank GPS tracking** — actual tagged animal movements
17. **NIFC Active Fire / Prescribed Burns** — dove/turkey habitat

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

### Bloomberg Terminal UX (2026-03-14 night) ✅
Terminal shell with live ticker, 4 canvas tabs, brain panel, replay player, screener. See above.

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

- **Native app (iOS/Android):** Push notifications for convergence spikes
- **Ghost Clock:** Predicted migration arrival countdown based on upstream patterns
- **Flyway Dominoes:** Animated migration cascade visualization
- **Solunar Autopsy:** Test solunar theory vs actual eBird data at scale
- **Fish & Elk:** Same engine, different species config + data sources (massive effort, future)
- **Premium tiers:** Free = season lookup. Paid = brain access
- **The Wire:** Crowdsourced real-time reports

---

## The Compounding Effect

| Timeframe | Corpus Size | What It Knows |
|-----------|------------|---------------|
| Today (2026-03-19) | ~212,000 | 212K embeddings, 14 crons (all healthy), 29 edge functions, convergence engine, terminal UI |
| After remaining pipes | ~300,000+ | + snow, ice, expanded eBird, DNR harvest, NDVI, phenology |
| After pattern extraction | ~205,000+ | + 1,000-5,000 cross-referenced weather-migration patterns |
| After all pipes finish | ~500,000+ | + water levels, tides, photoperiod, climate normals, crop data backfills complete |
| After 1 full season | ~1,000,000+ | + daily accumulation + user logs + pattern links + report cards |
| After 2 seasons | ~2,000,000+ | Self-reinforcing: predictions linked to outcomes, patterns of patterns |

**Every day it gets wider. Nobody can catch up.**
