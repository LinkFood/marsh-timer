# Duck Countdown — Master Roadmap

Last updated: 2026-03-13

## The Thesis

Build the first hunting-specific AI brain. Not a chatbot with hunting prompts — a continuously-learning intelligence system that watches weather, migration, and solunar patterns across all 50 states, correlates them against decades of historical data, and proactively tells hunters when and where to go.

Nobody else is doing this. HuntProof has a static algorithm. Duckr is a journal with weather. HuntWise is deer-focused solunar math. DU has crowdsourced pins with no intelligence layer. None of them have an LLM brain, none learn over time, none do multi-signal convergence, none push proactive alerts based on historical pattern matching.

## The Three Rules

1. **Every data point feeds the brain.** Log → embed → searchable. No exceptions.
2. **Show, don't predict.** Surface patterns from data. "Last 3 times this happened, here's what followed."
3. **The LLM is the mouth, not the brain.** Intelligence = embedded data + vector search + math. LLM only translates at the end.

---

## SHIPPED

### Phase 1: Eyes & Ears (Continuous Monitoring) ✅

6 edge functions, 10 pg_cron jobs, 2200+ embeddings flowing 24/7.

### Phase 2: The Brain (Convergence Engine) ✅

5-component scoring (weather/solunar/migration/birdcast/pattern) → 0-100 per state per day.

### Phase 3: The Voice (Outbound Intelligence) ✅

Daily scout reports + convergence spike alerts + feedback loop (thumbs up/down).

### Phase 5: Operation War Room (Map Intelligence) ✅

16 map features: convergence heatmap, eBird clusters, wind flow, isobars, NWS polygons, terminator, flyway corridors, migration front, time machine, 5 map modes, hover intel cards, pressure trends, perfect storm overlay. Satellite-friendly season colors, wind as hero feature.

### Phase 6: The Mother Lode (Data Pipeline) ✅

4,900+ knowledge entries from 5 sources: DU Migration Alerts (55 articles, weekly cron), USFWS Flyway Data Books (~311 pages), BirdCast Radar (daily 50-state cron), USFWS Breeding Survey (107 entries), USFWS HIP Harvest (361 pages). DU Migration Map (7 seasons backfilled, weekly cron).

### Phase 7: User Data ✅

Hunt log (form + edge fn + auto-fill + embedding) + feedback loop on reports/alerts/scores.

### Map QA Round 1 (13 bugs) ✅

All 13 bugs fixed. Species gating, convergence bars, radar toggle, terrain auto-3D, fill opacity, intel labels, alerts header, BirdCast empty state, stale scores purged.

### Map QA Round 2 (6 bugs) ✅

Wind arrow scaling (arrowheads at line endpoints, speed-based sizing). Search flies to city not state centroid. 3D toggle zoom-in + pitch at national zoom. Terminator opacity boost. Species-tinted closed-state fills on satellite + streets.

---

### Chat UX Phase 1 & 2 ✅

Phase 1: Map-chat bridge + convergence in chat. Phase 2: PatternCard (amber, vector similarity matches with confidence), SourceCard (muted, search coverage stats), safe JSX parseMarkdown(). Brain intelligence now visible in UI.

### Flyway Corridors — Full Continental Extent ✅

All 4 flyway corridors + flow lines extended from Arctic breeding grounds (Labrador, Manitoba, Alberta, Alaska ~65°N) through US to wintering grounds (Caribbean, Gulf, Mexico, Baja). Pacific Flyway includes Alaska.

### DU Data Surfacing ✅

DU Migration Reports sidebar component — grouped by state, activity level badges, relative dates, weather context. Collapsible per-state sections, auto-expand for current state. Waterfowl only, integrated at national (after HotspotRanking) and state (after ConvergenceCard) levels.

### MapLegend Drill-Level Awareness ✅

Legend appends context-specific items when drilled into state/zone: county convergence (intel mode), zone status indicators (default), county boundaries (all modes).

### Migration Monitor Upgrade ✅

Graduated severity (moderate/significant/extreme) replaces boolean isSpike. Weighted baseline favoring recent years. Requires 3+ data points for baseline. Detects migration lulls (>50% below baseline). Embeds with severity-specific content_types.

### Species-Aware Intelligence (Partial) ✅

Seed script generates ~230 embedded hunt_knowledge entries for deer (rut timing, moon phase, pressure, wind), turkey (gobble peaks, weather, roosting, calling), and dove (migration, field rotation, weather, wind). Dispatcher prepends species to search queries and adds species context to general system prompt.

### eBird Backfill Resilience ✅

Retry logic improvements to backfill script.

---

## IN PROGRESS

### eBird Backfill

Running via nohup (~40 hrs). Check: `tail ~/marsh-timer/ebird-backfill.log` or query `hunt_migration_history`. ~50% done as of 2026-03-08.

### eBird Cluster Click Priority (Bug 3)

Click priority fixed (eBird handlers intercept before state selection). Cluster zoom-to-expand action broken — `e.features` stale in async callback, fix deployed, awaiting verification.

---

## UP NEXT

### Post-eBird Backfill
- **Pattern re-extraction:** Re-run `extract-patterns.ts` with full 5-year eBird + weather data. Current 348 patterns from partial data — could 3-5x.
- **Migration monitor tuning:** Verify `hunt-migration-monitor` spike detection with full dataset (now with graduated severity levels).

### Species Intelligence — Phase 2
Knowledge is seeded and dispatcher is species-aware, but still needs:
- Species-specific convergence scoring (rut phase for deer, gobble activity for turkey)
- Species-specific map layers or visual indicators
- Verify seed data surfaces correctly in chat for each species

### Chat UX Phase 3 — Remaining Handlers
PatternCard/SourceCard only wired for search + weather handlers. Still TODO:
- General handler — could surface related patterns
- Solunar handler — inline moon phase viz
- Season handler — structured season card

### Map QA Suggestions
| # | Suggestion | Effort |
|---|-----------|--------|
| 1 | Loading indicator for search fly-to | Low |
| 2 | County boundary hint in zoom controls | Low |

---

## PHASE 9: FUTURE HORIZON

- **Native app (iOS/Android):** Push notifications require it. PWA as bridge.
- **SMS alerts:** Twilio for convergence alerts. Hunters in the field.
- **Premium tiers:** Free = season lookup. Paid = convergence, scout reports, hunt log, alerts.
- **NOAA AIGFS long-range:** AI 16-day forecast for model comparison.
- **Multi-species intelligence:** Deer movement patterns, turkey roosting.
- **Social layer (The Wire):** Crowdsourced real-time reports. Needs active user base first.

---

## DEFERRED

### Phase 8: Forum Intelligence
Legal risk. DU biologist articles + USFWS data + BirdCast radar + eBird already exceed all competitors combined.

---

## The Compounding Effect

| Timeframe | Corpus Size | What It Knows |
|-----------|------------|---------------|
| Today (2026-03-13) | ~5,000 embeddings | 348 patterns, 55 DU articles, 780 USFWS pages, BirdCast daily, weather/migration/solunar |
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
