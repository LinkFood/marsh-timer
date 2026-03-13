# Duck Countdown — Master Roadmap

Last updated: 2026-03-08 (evening)

## The Thesis

Build the first hunting-specific AI brain. Not a chatbot with hunting prompts — a continuously-learning intelligence system that watches weather, migration, and solunar patterns across all 50 states, correlates them against decades of historical data, and proactively tells hunters when and where to go.

Nobody else is doing this. HuntProof has a static algorithm. Duckr is a journal with weather. HuntWise is deer-focused solunar math. DU has crowdsourced pins with no intelligence layer. None of them have an LLM brain, none learn over time, none do multi-signal convergence, none push proactive alerts based on historical pattern matching.

## The Three Rules

1. **Every data point feeds the brain.** Log → embed → searchable. No exceptions.
2. **Show, don't predict.** Surface patterns from data. "Last 3 times this happened, here's what followed."
3. **The LLM is the mouth, not the brain.** Intelligence = embedded data + vector search + math. LLM only translates at the end.

---

## SHIPPED

### Phase 1: Eyes & Ears (Layer 2 — Continuous Monitoring) ✅

All 3 pipelines running 24/7. 6 edge functions, 10 pg_cron jobs, 2200+ embeddings flowing.

| Function | Schedule | Purpose |
|----------|----------|---------|
| hunt-weather-watchdog | 0 6 * * * | 50-state Open-Meteo daily + events + embed |
| hunt-nws-monitor | 0 */3 * * * | NWS filtered alerts → store + embed |
| hunt-nasa-power (×2) | 30/33 6 * * * | NASA POWER satellite data → weather history |
| hunt-solunar-precompute | 0 6 * * 0 | Meeus lunar math → 365-day calendar |
| hunt-migration-monitor (×5) | 0-20/5 7 * * * | eBird spike detection |

### Phase 2: The Brain (Layer 3 — Convergence) ✅

| hunt-convergence-engine | 0 8 * * * | 4-component scoring → 0-100/state/day |

### Phase 3: The Voice (Layer 4 — Outbound Intelligence) ✅

| hunt-scout-report | 0 9 * * * | Daily AI scout brief |
| hunt-convergence-alerts | 15 8 * * * | Score spike detection + notifications |

### Phase 5: Operation War Room (Map Intelligence) ✅

16 map features shipped: convergence heatmap, eBird clusters, wind flow, isobars, NWS polygons, terminator, flyway corridors, migration front, time machine, 5 map modes, hover intel cards, pressure trends, perfect storm overlay.

### Map Intelligence Layer (2026-03-08) ✅

Satellite-friendly season colors, wind as hero feature (default mode, speed-scaled, glowing), pressure trend arrows per state, perfect storm overlay.

### Phase 6: The Mother Lode (Data Intelligence Pipeline) ✅

All Wave 1 backfills complete. 4,900+ knowledge entries. 12 pg_cron jobs total.

| Source | Entries | Method | Cron |
|--------|---------|--------|------|
| 6A: DU Migration Alerts | 55 articles embedded | TypeScript backfill + edge fn | Weekly Mon 6AM UTC |
| 6B: USFWS Flyway Data Books | ~311 pages embedded (6 PDFs) | Python + pdfplumber | Manual (annual) |
| 6C: BirdCast Radar Migration | 50 states/day, daily cron LIVE | SSR scraper (window.__NUXT__) | Daily 10AM UTC |
| 6D: USFWS Breeding Survey | 107 entries (9 PDFs, 12 species) | Python + pdfplumber | Manual (annual) |
| 6D: USFWS HIP Harvest | 361 pages embedded (5 PDFs) | Python + pdfplumber | Manual (annual) |

| Function | Schedule | Purpose |
|----------|----------|---------|
| hunt-du-alerts | 0 6 * * 1 | Weekly DU migration alert polling |
| hunt-birdcast | 0 10 * * * | Daily BirdCast radar migration (50 states) |

### Phase 7A: Hunt Log ✅

Hunt log form + list in sidebar Log tab. Edge function with auto-fill + embedding.

---

## IN PROGRESS

### Map QA Round 2 — Bug Fixes

13 bugs found in QA. 9 fixed + 4 quick wins shipped. Remaining bugs from QA report:

| # | Bug | Status | Effort |
|---|-----|--------|--------|
| 1 | Wind arrows uniform size (should scale by speed) | **Open** | Medium — modify wind rendering in MapView.tsx |
| 2 | Search flies to state, not specific city/zip | **Open** | Medium — geocode returns coords but fly-to snaps to state centroid. Fix in HeaderBar.tsx search handler |
| 3 | eBird cluster click conflicts with state click (Scout mode) | **Open** | Medium — z-index / event priority in MapView.tsx |
| 4 | 3D toggle no visible effect at national zoom | **Open** | Low — may need minimum pitch on toggle or user education |
| 5 | Dawn/dusk terminator too subtle | **Open** | Low — increase overlay opacity |
| 6 | State fill colors faint on satellite (closed seasons) | **Open** | Low — bump closed-state alpha further |

### Map QA Round 2 — Suggestions to Implement

| # | Suggestion | Status | Effort |
|---|-----------|--------|--------|
| 1 | Species-specific intel for deer/turkey (rut forecast, gobble activity) | **Open** | Large — new data pipeline |
| 2 | Drill-in fill color legend (score/status meaning) | **Open** | Low — add small legend to state detail |
| 3 | Loading indicator for search fly-to | **Open** | Low |
| 4 | County boundary hint in zoom controls | **Open** | Low |

### DU Data Surfacing — INVESTIGATE

All DU data (55 migration alert articles + 7 seasons of migration map pins) is in `hunt_knowledge` as embeddings but only surfaces through chat/vector search. Need to:
- Test: ask chat species-specific migration questions, verify DU data shows in responses
- Test: check state intel cards for DU content on waterfowl state pages
- Evaluate: should DU migration map pins render as a visual layer on the map?
- Evaluate: should there be a dedicated "Migration Reports" section in the sidebar?

### Already Fixed (this session)
- Species gating (waterfowl-only intel)
- Hunt log species sync from map
- Convergence bar clamping + distinct colors
- Radar toggle (CloudRain button)
- Perfect storm thresholds (percentage-based)
- State fill opacity bump (0.75→0.85)
- Intel mode labels/rings (loadedRef → source check)
- Terrain mode auto-enables 3D
- Alerts header → "Notable Hunting Weather"
- Filter waterfowl intel from deer/turkey state pages
- BirdCast 0 bar → "No data" label
- Stale convergence scores purged + re-scored

---

## PHASE 9: FUTURE HORIZON

### Post-eBird Backfill (when ~50% backfill completes)

- **Pattern re-extraction:** Re-run `extract-patterns.ts` with full 5-year eBird + weather data. Current 348 patterns from partial data — could 3-5x.
- **Migration monitor tuning:** Verify `hunt-migration-monitor` spike detection with full dataset.

- **Native app (iOS/Android):** Push notifications require it. PWA as bridge.
- **SMS alerts:** Twilio for convergence alerts. Hunters in the field.
- **Premium tiers:** Free = season lookup. Paid = convergence, scout reports, hunt log, alerts.
- **NOAA AIGFS long-range:** AI 16-day forecast for model comparison.
- **Multi-species intelligence:** Deer movement, turkey roosting patterns.
- **Social layer (The Wire):** Crowdsourced real-time reports. Needs active user base first.

---

## DEFERRED

### Phase 8: Forum Intelligence
Legal risk. DU biologist articles + USFWS data + BirdCast radar + eBird already exceed all competitors combined.

---

## The Compounding Effect

| Timeframe | Corpus Size | What It Knows |
|-----------|------------|---------------|
| Today (2026-03-08) | ~4,900 embeddings | 348 patterns, 55 DU articles, 780 USFWS pages, BirdCast daily, weather/migration/solunar |
| After eBird backfill | ~25,000+ | + 5 years eBird observations across 50 states |
| After pattern re-extraction | ~26,000+ | + 1,000+ cross-referenced weather/migration patterns |
| After 1 season with all crons | ~100,000+ | Weather + radar + expert reports + harvest history + eBird + convergence + user logs |
| After 2 seasons | ~200,000+ | Self-recognizing patterns: "when X happens in Saskatchewan, Y follows in Arkansas 9 days later" |

**Every day it gets wider. Nobody can catch up.**

---

## Off-Season Advantage

Right now (March 2026) most duck seasons are closed. This is the perfect time to build:
- Backfill scripts ingest decades of historical data in hours
- Crons start accumulating current data immediately
- By September when seasons open, the brain has 6+ months of continuous data plus 60+ years of historical harvest data
- Day 1 of season: the most informed waterfowl intelligence system ever built by a consumer product
