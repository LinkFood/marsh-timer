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

## IN PROGRESS

### eBird Cluster Click Priority (Bug 3)

Click priority fixed (eBird handlers intercept before state selection). Cluster zoom-to-expand action broken — `e.features` stale in async callback, fix deployed, awaiting verification.

### eBird Backfill

Running via nohup (~40 hrs). Check: `tail ~/marsh-timer/ebird-backfill.log` or query `hunt_migration_history`.

---

## UP NEXT

### Chat UX Overhaul — "The Brain Deserves a Better Face"
The embedding pipeline and vector search are the moat — 5,000+ entries, hybrid search, pattern matching, historical context. But the chat output is raw markdown. It looks like a log file, not an intelligence briefing. The brain is smart; the mouth needs to match.

**Problems:**
- Responses render as flat markdown — no visual hierarchy, no cards, no data visualization
- No distinction between data-backed insights vs. general responses
- Doesn't leverage the rich structured data we already have (convergence scores, weather, solunar, patterns)
- Chat lives in a sidebar tab — unclear how it relates to what's on the map

**What "good" looks like:**
- Structured response cards: weather snapshots, score breakdowns, pattern matches — not just text
- Inline data viz: mini convergence bars, wind indicators, moon phase icons within responses
- Source attribution: "Based on 3 matching patterns from Nov 2023" with expandable detail
- Map integration: chat responses that highlight/fly-to relevant states
- Conversational feel, not report feel — brief, punchy, visual

**Scope:** Large — touches ChatMessage rendering, dispatcher response format, possibly new response card components. Core logic (embeddings, search, dispatcher routing) stays untouched.

### Flyway Corridors — Full Continental Extent
All 4 flyway corridors + flow lines currently stop at US borders. Real flyways run from Arctic breeding grounds (Canada/Alaska) through the US to wintering grounds (Mexico, Caribbean, Central America). Extend polygon + flow line coordinates in `flywayPaths.ts`. Also extends Pacific Flyway to include Alaska.

### DU Data Surfacing
All DU data (55 articles + 7 seasons of map pins) is embedded but only surfaces via chat. Evaluate:
- DU migration map pins as a visual layer on the map (toggle-controlled)
- Dedicated "Migration Reports" section in sidebar
- Verify DU content appears in state intel cards for waterfowl

### Post-eBird Backfill
- **Pattern re-extraction:** Re-run `extract-patterns.ts` with full 5-year eBird + weather data. Current 348 patterns from partial data — could 3-5x.
- **Migration monitor tuning:** Verify `hunt-migration-monitor` spike detection with full dataset.

### Map QA Suggestions
| # | Suggestion | Effort |
|---|-----------|--------|
| 1 | Species-specific intel for deer/turkey (rut forecast, gobble activity) | Large — new data pipeline |
| 2 | Drill-in fill color legend (score/status meaning) | Low |
| 3 | Loading indicator for search fly-to | Low |
| 4 | County boundary hint in zoom controls | Low |

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
