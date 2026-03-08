# Duck Countdown — Master Roadmap

Last updated: 2026-03-08

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

---

## PHASE 6: THE MOTHER LODE (Data Intelligence Pipeline)

**Status: READY TO BUILD**

The research report identified 6 major public data sources that would 10x the knowledge corpus. These are all independent builds — run them all in parallel.

### The Sources

| # | Source | Type | Volume | Legal | Priority |
|---|--------|------|--------|-------|----------|
| 6A | DU Migration Alerts API | JSON API, no auth | ~500-700 articles | CLEAN — public content | IMMEDIATE |
| 6B | USFWS Flyway Data Books | PDF download | ~200 PDFs, 60+ years | PUBLIC DOMAIN | IMMEDIATE |
| 6C | BirdCast Radar Migration | API (reverse-eng) | 2013-present, daily, county-level | Academic/public dashboard | HIGH |
| 6D | USFWS Breeding Survey + HIP | PDF download | Annual 1947-present | PUBLIC DOMAIN | HIGH |
| 6E | DU Migration Map Pins | API (needs discovery) | Thousands/season | Public content | HIGH |

### 6A: DU Migration Alerts API — IMMEDIATE

**The single fastest win with the biggest impact.**

Ducks Unlimited publishes a content API at `https://www.ducks.org/sites/ducksorg/contents/data/api.json` — no auth, full JSON, 4,939 articles. Filter for `migration-alerts` in URL → ~500-700 expert-written migration reports by DU biologists.

Each article has: `uuid`, `title`, `articleDate`, `url`, `teaser`, `categories[]`, `states[]`. The `states[]` field means instant state-level retrieval precision.

**Backfill script** (`scripts/ingest-du-alerts.ts`):
- Paginate API (limit=50, offset), filter migration-alerts
- Fetch full article body from each URL
- Haiku structured extraction: state, flyway, species, conditions, migration status
- Voyage AI embed: `"du_alert | {states} | {date} | {title} | {body snippet}"`
- Store in `hunt_du_articles` (dedup by uuid) + `hunt_knowledge`

**Weekly cron** (`supabase/functions/hunt-du-alerts/index.ts`):
- Poll API for articles newer than last stored `articleDate`
- Same extract + embed pipeline
- pg_cron: `0 6 * * 1` (Monday morning)

**New tables:** `hunt_du_articles` (uuid, title, article_date, url, states, body, embedded_at)
**Effort:** 3-4 hrs
**Files:** 1 script, 1 edge function, 1 migration

### 6B: USFWS Flyway Data Books — IMMEDIATE

Federal government data — public domain, no copyright, no TOS risk. Decades of harvest data by state, by species, with hunter counts, age ratios, and breeding population estimates.

URL pattern: `https://www.fws.gov/sites/default/files/documents/{flyway}_flyway_databook_{year}.pdf`
Confirmed live for Atlantic 2021, 2022.

**Backfill script** (`scripts/ingest-usfws-flyway.py`):
- Download all available PDFs (4 flyways × ~50 years)
- `pdfplumber` table extraction → structured records
- Fields: flyway, year, state, species, harvest_count, hunters, days_hunted, age_ratio
- Store in `hunt_usfws_harvest` table
- Embed summaries: `"usfws_harvest | {flyway} | {year} | {state} | {species} | harvest:{n} hunters:{n}"`

**No cron needed** — annual update, manual re-run each September.
**New tables:** `hunt_usfws_harvest` (flyway, year, state, species, harvest, hunters, days_hunted, age_ratio)
**Effort:** 5-6 hrs (PDF parsing is finicky)
**Files:** 1 Python script, 1 migration
**Dependency:** `pip install pdfplumber`

### 6C: BirdCast Radar Migration — HIGH

**The crown jewel.** Cornell Lab radar physics — 143 NEXRAD stations detecting actual nocturnal bird migration. Not observation-based. Instrumental data. When BirdCast says 40M birds passed over Ohio, 40M birds passed over Ohio.

Dashboard: `dashboard.birdcast.org/region/{FIPS-code}`
API: Undocumented — requires network tab inspection to discover.

**Phase 1: Recon** (manual, 30 min):
- Open dashboard in Chrome DevTools → Network tab
- Select historical dates → capture XHR requests
- Document API endpoint, params, response structure

**Phase 2: Backfill script** (`scripts/ingest-birdcast.ts`):
- All 3,100 US counties, Oct-Nov seasons, 2013-present
- Store in `hunt_birdcast` (date, county_fips, state, intensity, direction, speed, altitude)
- Embed: `"birdcast | {state} | {date} | intensity:{n} direction:{dir} | {county}"`

**Phase 3: Daily cron** (`supabase/functions/hunt-birdcast/index.ts`):
- Fetch previous night's migration data for all states
- During migration season only (Aug 1 - Nov 15, Mar 1 - Jun 15)
- Feed directly into convergence engine as a 5th component
- pg_cron: `0 10 * * *` (after overnight migration)

**New tables:** `hunt_birdcast` (date, county_fips, state_abbr, intensity, direction, speed, altitude)
**Effort:** 6-8 hrs (including recon + API discovery)
**Files:** 1 script, 1 edge function, 1 migration
**BLOCKED:** Needs manual recon before build

### 6D: USFWS Breeding Survey + HIP Harvest — HIGH

Two more public domain federal datasets:

**Breeding Population Survey** — Annual since 1947. 19 duck species, aerial surveys, population estimates + trend. This is what feeds regulation decisions. When the brain knows mallard populations are down 12%, it contextualizes everything else.

**Harvest Information Program (HIP)** — County-level historical harvest data. 3.5M hunters registered annually. State-level harvest by species, days hunted, wing survey age/sex ratios.

**Backfill scripts** (`scripts/ingest-usfws-breeding.py`, `scripts/ingest-usfws-hip.py`):
- Download annual PDFs from fws.gov
- pdfplumber extraction → structured records
- Embed population baselines and harvest summaries

**New tables:** `hunt_usfws_breeding` (year, species, population_est, trend, survey_area), `hunt_usfws_hip` (year, state, species, harvest, hunters, days)
**Effort:** 5-6 hrs
**Files:** 2 Python scripts, 1 migration

### 6E: DU Migration Map Pins — HIGH

Live at `migrationmap.ducks.org` — user-submitted + biologist pins with species, intensity, lat/lng.

**Phase 1: Recon** (manual, 30 min):
- Open map in Chrome DevTools → Network tab
- Filter XHR — look for `reports`, `markers`, `pins`
- Document API endpoint, params, response structure

**Phase 2: Backfill + periodic fetch:**
- Store in `hunt_du_map_reports` (date, lat, lng, state, species_type, intensity, reporter_type)
- Embed: `"du_report | {state} | {date} | {species_type} | intensity:{rating} | {lat},{lng}"`

**BLOCKED:** Needs manual recon before build. Season may need to be active for data.
**Effort:** 3-4 hrs (after recon)

---

## PHASE 7: USER DATA LAYER

### 7A: Hunt Log

Users log hunts. Each log gets embedded as ground truth — the highest-value signal in the system.

**Fields V1:** date, state, county, species, harvest_count, weather (auto-filled from watchdog), moon (auto-filled from solunar), notes, GPS coords (optional)
**Auto-fills reduce friction:** Weather + moon + solunar automatically populated from existing crons.

**Files:**
- `src/components/HuntLogForm.tsx` — log entry UI
- `src/hooks/useHuntLogs.ts` — CRUD + query
- `supabase/functions/hunt-log/index.ts` — save + embed
- Migration: `hunt_logs` table

**Effort:** 10-12 hrs
**Dependency:** None — fully independent

### 7B: Feedback Loop

Thumbs up/down on convergence alerts and scout reports. Feeds back into scoring weights.

**Files:**
- Small UI changes to existing alert/report components
- `hunt_alert_feedback` table
- Edge function or inline save

**Effort:** 4-5 hrs
**Dependency:** None

---

## PHASE 8: FORUM INTELLIGENCE (DEFERRED)

Legal risk for a commercial product. Deferred until clean sources (Phase 6) are exhausted.

| Source | Volume | Risk | Status |
|--------|--------|------|--------|
| DuckHuntingChat.com | 3.2M posts | Medium — commercial forum, user content | DEFERRED |
| Refuge Forums | Large, state-specific | Medium — same | DEFERRED |
| Reddit r/Waterfowl | Since 2012 | Low — Reddit API is public | BACKLOG |
| WaterfowlForum.net | Small, focused | Medium | DEFERRED |

**Rationale:** DU biologist articles + USFWS harvest data + BirdCast radar + eBird observations already provide more data than every competitor combined. Forums add ground truth but carry legal baggage. Revisit after Phase 6 is producing.

---

## PHASE 9: FUTURE HORIZON

- **Native app (iOS/Android):** Push notifications require it. PWA as bridge.
- **SMS alerts:** Twilio for convergence alerts. Hunters in the field.
- **Premium tiers:** Free = season lookup. Paid = convergence, scout reports, hunt log, alerts. ($5-10/mo)
- **BirdCast as 5th convergence component:** When Phase 6C is live, add radar intensity to the convergence engine alongside weather/solunar/migration/pattern.
- **NOAA AIGFS long-range:** AI 16-day forecast for model comparison.
- **Multi-species intelligence:** Deer movement, turkey roosting patterns.
- **Social layer (The Wire):** Crowdsourced real-time reports. Needs active user base first.

---

## PARALLEL BUILD PLAN

### Session: "The Mother Lode" — 6 agents, 4 parallel

All Phase 6 sources are independent. No shared files. Maximum parallelism.

**Wave 1 — Build immediately (4 parallel agents):**

| Agent | Build | Type | Est. Time |
|-------|-------|------|-----------|
| A | 6A: DU Migration Alerts | TypeScript script + edge fn + migration | 3-4 hrs |
| B | 6B: USFWS Flyway PDFs | Python script + migration | 5-6 hrs |
| C | 6D: USFWS Breeding + HIP | Python scripts + migration | 5-6 hrs |
| D | 7A: Hunt Log | React components + hook + edge fn + migration | 10-12 hrs |

**Wave 2 — After manual recon (2 parallel agents):**

| Agent | Build | Blocker | Est. Time |
|-------|-------|---------|-----------|
| E | 6C: BirdCast Radar | Need API endpoint from DevTools | 6-8 hrs |
| F | 6E: DU Migration Map | Need pin API from DevTools | 3-4 hrs |

**Wave 3 — After Phase 6 producing:**

| Agent | Build | Est. Time |
|-------|-------|-----------|
| G | 7B: Feedback Loop | 4-5 hrs |
| H | BirdCast → Convergence Engine integration | 3-4 hrs |

### Each backfill script follows the same pattern:
```
Fetch from source → Parse/extract structured fields
  → Haiku extraction (if unstructured text)
  → Voyage AI embed (512-dim, batch 20)
  → Insert hunt_knowledge + source-specific table
  → Dedup by source-specific key (uuid, url, date+state)
```

### Embedding format (consistent across all sources):
```
"{source_type} | {state} | {date} | {key_fields} | {content}"
```
Same format used for search queries. One vector search returns results from ALL sources.

---

## The Compounding Effect

| Timeframe | Corpus Size | What It Knows |
|-----------|------------|---------------|
| Today | ~3,000 embeddings | 348 patterns, weather/migration/solunar snapshots |
| After Phase 6A | ~4,000+ | + 500-700 expert DU migration reports |
| After Phase 6B | ~8,000+ | + 60 years of harvest data by state by species |
| After Phase 6C | ~50,000+ | + decade of radar migration intensity by county |
| After Phase 6D | ~55,000+ | + population baselines back to 1947 |
| After 1 season with all crons | ~100,000+ | Weather + radar + expert reports + harvest history + eBird + convergence scores |
| After 2 seasons | ~200,000+ | Self-recognizing patterns: "when X happens in Saskatchewan, Y follows in Arkansas 9 days later" |

**Every day it gets wider. Nobody can catch up.**

---

## Off-Season Advantage

Right now (March 2026) most duck seasons are closed. This is the perfect time to build:
- Backfill scripts ingest decades of historical data in hours
- Crons start accumulating current data immediately
- By September when seasons open, the brain has 6+ months of continuous data plus 60+ years of historical harvest data
- Day 1 of season: the most informed waterfowl intelligence system ever built by a consumer product
