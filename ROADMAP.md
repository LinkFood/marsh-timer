# Duck Countdown — Master Roadmap

Last updated: 2026-03-08

## The Thesis

Build the first hunting-specific AI brain. Not a chatbot with hunting prompts — a continuously-learning intelligence system that watches weather, migration, and solunar patterns across all 50 states, correlates them against years of historical data, and proactively tells hunters when and where to go.

Nobody else is doing this. HuntProof has a static algorithm. Duckr is a journal with weather. HuntWise is deer-focused solunar math. DU has crowdsourced pins with no intelligence layer. None of them have an LLM brain, none learn over time, none do multi-signal convergence, none push proactive alerts based on historical pattern matching.

## Rule Zero: Every Data Point Feeds the Brain

This is non-negotiable. It's the principle the entire platform is built on.

**Every piece of data that enters the system gets: logged → embedded → searchable.**

No exceptions. No "we'll embed that later." No fire-and-forget API calls. If the system touches data, the brain learns from it.

| Data Type | Log It | Embed It | Learn From It |
|-----------|--------|----------|---------------|
| Daily weather snapshot (50 states) | `hunt_weather_history` | Voyage AI → `hunt_knowledge` | Pattern matching, convergence scoring |
| 10-day forecast | `hunt_weather_forecast` | Voyage AI → `hunt_knowledge` | Prediction confidence, front tracking |
| Weather event (cold front, pressure drop) | `hunt_weather_events` | Voyage AI → `hunt_knowledge` | "Last time this event hit AR, sightings spiked 3 days later" |
| Moon phase / solunar window | `hunt_solunar_calendar` | Voyage AI → `hunt_knowledge` | Feeding time correlation with harvest data |
| eBird observation spike | `hunt_migration_spikes` | Voyage AI → `hunt_knowledge` | Migration timing models, flyway patterns |
| Forum-scraped hunt report | `hunt_forum_posts` | Voyage AI → `hunt_knowledge` | Conditions-to-outcome correlation |
| User hunt log | `hunt_logs` (future) | Voyage AI → `hunt_knowledge` | Ground truth — the highest-value signal |
| Convergence score | `hunt_convergence_scores` | Voyage AI → `hunt_knowledge` | Score-to-outcome tracking (did the 85 score day actually produce?) |
| User alert feedback (thumbs up/down) | `hunt_alert_feedback` (future) | Informs scoring weights | Self-correcting prediction model |

The embedding format is consistent: `"{type} | {state} | {date} | {key signals} | {content}"` — same structure used for search queries. This means when a user asks "what were conditions like in Arkansas last December," the brain pulls weather snapshots, migration spikes, forum reports, and hunt logs from that window — all from one vector search.

**The compounding effect:** Day 1, the brain has 348 patterns. After 30 days of monitoring, it has 348 + (50 states × 30 days of weather) + solunar data + migration spikes + forum posts = thousands of embedded data points. After a full season, tens of thousands. After 2 years, it knows more about hunting conditions than any human could hold in their head. That's the moat. It only gets wider.

## Rule One: Show, Don't Predict

The system never makes predictions. It surfaces patterns from data and lets the user connect the dots.

**Wrong:** "It's going to be a cold winter. Get your blinds ready early."

**Right:** "Birds are moving south 2 weeks earlier than the 5-year average. The last 3 times this happened (2021, 2023, 2024), winter temps in the central flyway ran 8-12°F below average by December. Here's the data."

The system presents what happened, when it happened, and what followed. The user decides what it means. This isn't hedging — it's integrity. Predictions are opinions. Patterns are facts. Hunters trust facts.

This applies everywhere:
- Convergence scores are "conditions match previous high-activity periods," not "you should go hunting tomorrow"
- Scout reports say "these conditions have historically correlated with X," not "expect X"
- Alerts say "this pattern has appeared — here's what followed last time," not "birds are coming"

The system gets smarter every year, but it never gets arrogant. 10 years of data makes the patterns undeniable — but the data still speaks for itself.

## Rule Two: The LLM Is the Mouth, Not the Brain

The intelligence lives in the data, not the model. This is a critical architecture decision that keeps costs low and quality high.

```
DATA LAYER (cheap, scales forever):
  Voyage AI embeds every data point — pennies per 1000 entries, one-time cost
  pgvector stores + searches — pennies per month
  Open-Meteo, eBird, solunar math — free
  Convergence scoring — pure SQL/math, zero LLM calls
  Pattern matching — vector similarity search, zero LLM calls

LLM LAYER (expensive, used sparingly):
  Haiku translates data into English — only when a user asks or an alert fires
  It formats what the data already found — it doesn't think, it talks
  Fractions of a cent per call
```

The brain is the embedded knowledge graph. The vector search finds the patterns. The math scores the convergence. The LLM is called at the very end to say it in plain English. This means:

- 50 states × 365 days of monitoring = ~73,000 embedded data points/year at ~$0.50 total embedding cost
- Zero daily LLM spend from the monitoring stack
- LLM costs only scale with user interactions, not with data growth
- The system can hold 10 years of data (730K+ embeddings) and still answer in milliseconds via vector search

This is why the competitors can't catch up even if they copy the idea. The data is the moat, and the architecture makes it economically viable to collect it forever.

## What Exists Today (Shipped)

- 5-species season data (482 entries, 50 states)
- Mapbox GL command center (satellite, 3D, 7 overlay layers, radar, eBird sightings)
- AI chat brain (Haiku intent classification, weather/solunar/season/search handlers)
- Proactive weather alerts (50-state bulk forecast + 348 embedded historical patterns)
- Calendar sync (ICS export)
- Google OAuth, user profiles, conversation persistence
- Historical data: 25K weather rows (5yr), ~20K migration rows (backfill running)
- Embedding pipeline (Voyage AI 512-dim, hybrid vector+keyword search)

## Architecture: The Four Layers

```
LAYER 4: OUTBOUND INTELLIGENCE (not built)
  Push alerts, daily scout briefs, "go now" convergence signals
  Slack → SMS → push notifications (progressive rollout)
  Per-user: your states, your spots, your species

LAYER 3: PREDICTION ENGINE (not built)
  Convergence scoring: weather + solunar + migration + history = score per state
  Pattern confidence: "these conditions → this outcome" with data backing
  Show the pattern, never make the prediction

LAYER 2: CONTINUOUS MONITORING (not built — this is the gap)
  Three pipelines running at different speeds (see below)
  Every pipeline: log → embed → feed the brain

LAYER 1: KNOWLEDGE BASE (80% built)
  348 weather-migration patterns, 25K weather history, 20K migration history
  482 season entries, 576 state facts, hybrid search
  Chat brain with intent routing
```

Layer 1 is mostly done. Layer 2 is what turns this from a static brain into a living one. Layers 3 and 4 are where the money is, but they need Layer 2 feeding them.

## The Three Pipelines (Layer 2 Core Design)

A 15-day forecast won't catch a storm that spins up in 24 hours. The system needs multiple time horizons running at different speeds. Not one fat cron job — three pipelines, each optimized for its job.

```
RAPID PIPELINE (every 2-4 hours)
  Purpose: Catch fast-developing weather, real-time alerts
  Sources: NWS alerts API + Open-Meteo hourly conditions
  Detects: New severe weather alerts, sudden temp/pressure shifts,
           conditions that changed significantly since last check
  Action: When something triggers, re-run convergence scoring for affected states
  Cost: Free (NWS + Open-Meteo), zero LLM calls
  Embeds: Every alert, every significant condition change

DAILY PIPELINE (once per day, morning)
  Purpose: Archive everything, run full analysis, detect patterns
  Sources: Open-Meteo daily actuals + NASA POWER satellite data + eBird observations
  Does: Archive yesterday's weather (all 50 states)
        Fetch NASA POWER solar/cloud data
        Check eBird for migration activity vs baseline
        Run full convergence scoring (all 50 states)
        Generate scout report for users with saved states
  Cost: Free data sources, Voyage AI embedding (~pennies), Haiku for scout report text
  Embeds: Weather snapshots, NASA data, migration observations, convergence scores

WEEKLY PIPELINE (once per week)
  Purpose: Big-picture trends, knowledge maintenance, long-range outlook
  Sources: Solunar math + NOAA AIGFS long-range + Reddit forums
  Does: Precompute solunar calendar (next 12 months)
        Fetch long-range outlook for model comparison
        Scrape Reddit hunting forums, extract via Haiku, quality-score
        Re-extract patterns if enough new data accumulated
  Cost: Haiku for forum extraction (~cents), Voyage for embedding
  Embeds: Solunar windows, long-range outlook comparisons, forum hunt reports
```

The rapid pipeline is the "storm up the coast" detector. It's light, fast, cheap — just watching for changes. When it sees something, it kicks the convergence engine to re-score.

The daily pipeline is the workhorse. Archives everything, embeds everything, scores everything. This is what makes the brain smarter every single day.

The weekly pipeline is the thinker. Long-range planning, knowledge ingestion, pattern extraction. This is what builds the moat over months and years.

## Weather Data Sources

| Source | Pipeline | Free? | Auth? | What It Provides | Why We Need It |
|--------|----------|-------|-------|------------------|----------------|
| **Open-Meteo** | Daily + Rapid | Yes, unlimited | No | 16-day forecast, 80yr historical, hourly resolution | Primary weather engine. Already integrated. Reliable. |
| **NWS API** | Rapid | Yes | No | Official severe weather alerts, storm warnings, advisories | The "storm blowing up the coast in 24 hours" signal. Real-time. |
| **NASA POWER** | Daily | Yes | Free key | Satellite-derived solar radiation, cloud cover, back to 1981 | Unique signal nobody else has. Clear sky after cold front = feeding conditions. |
| **NOAA AIGFS** | Weekly | Yes | No | AI-powered 16-day forecast (GRIB2 format) | Long-range model comparison. When AIGFS + Open-Meteo agree = high confidence. |
| **RainViewer** | Live (frontend) | Yes | No | Radar imagery | Already integrated on map. Visual, not data pipeline. |

---

## Phase 1: The Eyes and Ears (Layer 2)

**Goal:** The system watches everything, 24/7, and archives it. Every day it runs, it gets smarter. Three pipelines, three speeds.

**Timeline: 3-4 build sessions (~28 hrs)**

### 1A. Weather Watchdog (Daily Pipeline)
- **What:** pg_cron + edge function, runs daily (morning UTC)
- **Does:** Archives yesterday's actual weather for all 50 states into `hunt_weather_history` (extends the 5-year backfill forward, forever). Fetches 10-day forecast outlook into new `hunt_weather_forecast` table. Detects interesting events (cold fronts, pressure crashes, wind shifts, first freeze) into `hunt_weather_events`.
- **Embeds:** Every daily weather snapshot and every detected event gets embedded into `hunt_knowledge` via Voyage AI. Format: `"weather | {state} | {date} | temp:{hi}/{lo} wind:{dir}@{mph} precip:{mm} pressure:{mb} | {event description if any}"`. The brain remembers every day's weather in every state, forever.
- **Source:** Open-Meteo (free, unlimited, no auth)
- **New:** 1 edge function, 1 migration (2 new tables), 1 pg_cron job
- **Effort:** 5-7 hrs (includes embedding pipeline)
- **Risk:** Low. Open-Meteo is reliable. Pattern follows existing `hunt-alerts`.

### 1A-2. NASA POWER Integration (Daily Pipeline)
- **What:** Runs as part of the daily pipeline, after weather watchdog
- **Does:** Fetches satellite-derived data from NASA POWER REST API for all 50 states: solar radiation, cloud cover, surface pressure, wind. Stores alongside weather data.
- **Embeds:** Format: `"nasa | {state} | {date} | solar:{kWh/m2} cloud:{pct} pressure:{kPa} | {analysis}"`. Unique signal — satellite-observed conditions, not model predictions. Clear sky after cold front = feeding opportunity.
- **Source:** NASA POWER API (free, requires free API key registration)
- **New:** Added to weather watchdog edge function (extends it, not a separate function)
- **Effort:** 2-3 hrs (bolts onto 1A)
- **Risk:** Very low. Simple REST API, JSON response.

### 1A-3. NWS Alert Monitor (Rapid Pipeline)
- **What:** pg_cron every 2-4 hours + edge function
- **Does:** Polls NWS alerts API for all active weather alerts across US. Filters for hunting-relevant alerts: winter storms, cold weather advisories, wind advisories, freeze warnings, dense fog. Stores in `hunt_nws_alerts` table. When a new significant alert appears, triggers convergence re-score for affected states.
- **Embeds:** Every alert gets embedded. Format: `"nws_alert | {states} | {date} | type:{alert_type} severity:{severity} | {headline} | {description}"`. The brain remembers every storm, every advisory, every warning — and can correlate with what happened to migration patterns afterward.
- **Source:** NWS API (free, no auth, JSON)
- **Why this matters:** This is the "storm that builds in 24 hours" detector. A 15-day forecast won't catch it. NWS alerts fire in real-time when conditions develop. This is the fastest signal in the system.
- **New:** 1 edge function, 1 migration (1 new table), 1 pg_cron job (every 2-4 hrs)
- **Effort:** 4-5 hrs (includes embedding)
- **Risk:** Low. NWS API is rock-solid government infrastructure.

### 1B. Solunar Precompute
- **What:** Edge function + pg_cron weekly
- **Does:** Computes moon phase, illumination, major/minor feeding windows for next 12 months using Jean Meeus lunar algorithms. Pure math, no API calls. Flags "prime windows" (new moon + major feed alignment).
- **Embeds:** Each week's solunar calendar gets embedded into `hunt_knowledge`. Format: `"solunar | {date} | phase:{phase} illum:{pct} | major:{time1}-{time2} minor:{time3}-{time4} | prime:{yes/no}"`. Brain can correlate moon conditions with weather events and migration data.
- **New:** 1 edge function (~80 lines of astro math), 1 migration (1 new table), 1 pg_cron job
- **Effort:** 4-5 hrs (includes embedding)
- **Risk:** Very low. Deterministic math. Validate against known moon phase dates.

### 1C. Migration Spike Detection
- **What:** 5 pg_cron jobs (10 states each, 5 min apart) calling edge function
- **Does:** Daily check of recent eBird observations vs 5-year historical baseline for same week-of-year. Flags states where current activity is significantly above normal.
- **Embeds:** Every spike event gets embedded into `hunt_knowledge`. Format: `"migration | {state} | {date} | species:duck sightings:{count} baseline:{avg} deviation:{pct}% | {notable locations}"`. Also embeds the daily observation summary even when NOT spiking — the brain needs to know what "normal" looks like to recognize abnormal.
- **Gotcha:** eBird rate limit (200/hr) means can't do 50 states in one function call. Split into 5 batches.
- **Dependency:** eBird backfill completing (currently running, ~40 hrs remaining). `EBIRD_API_KEY` already added to Supabase secrets.
- **New:** 1 edge function, 1 migration (1 new table), 5 pg_cron jobs
- **Effort:** 6-8 hrs (includes embedding pipeline)
- **Risk:** Medium. Historical baseline may be sparse for some state/week combos.

### 1D. Forum Scraping Pipeline (Reddit V1)
- **What:** Edge function + pg_cron every 6 hours
- **Does:** Fetches recent posts from r/duckhunting, r/waterfowl, r/hunting via Reddit public JSON (no auth, 10 req/min). Haiku extracts structured data: state, date, species, count, weather conditions, location hints, tactics. Quality scores and deduplicates. Stores in `hunt_forum_posts`.
- **Phase 1:** Store raw extracted data, inspect quality. Do NOT embed yet.
- **Phase 2:** Tune extraction prompt based on real data. Add embedding pipeline. Connect to `hunt_knowledge`.
- **Reality check:** ~5-10 useful reports/day during season. ~900-1800 data points over 6 months. Not massive, but unique data nobody else has.
- **New:** 1 edge function, 1 migration (1 new table), 1 pg_cron job
- **Effort:** 8-10 hrs (V1 only)
- **Risk:** High on quality. Most Reddit posts are photos with "got my limit!" and zero structured data. Haiku extraction needs aggressive filtering.

---

## Phase 2: The Brain (Layer 3)

**Goal:** Cross-reference all signals into a single "hunting score" per state per day. Pattern match against history.

**Timeline: 2 build sessions (~15 hrs)**
**Dependency: Phase 1 running and producing data for at least 1-2 weeks**

### 2A. Convergence Engine
- **What:** Edge function + pg_cron, runs daily after all Phase 1 jobs complete
- **Does:** For each of 50 states, computes a composite "hunt score" (0-100) based on:
  - Weather events (cold front arriving = +20, stable high pressure = -10, etc.)
  - Solunar window (prime = +15, major feed = +10, full moon = -5)
  - Migration activity (above baseline = +25, spike = +40)
  - Historical pattern match ("conditions like this produced X" = confidence multiplier)
- Stores daily scores in `hunt_convergence_scores` table
- Ranks top 10 states nationally ("hottest spots right now")
- **Embeds:** Every daily convergence score gets embedded. Format: `"convergence | {state} | {date} | score:{n}/100 | weather:{summary} solunar:{phase} migration:{status} | reasoning:{why}"`. This is critical — after a full season, the brain has hundreds of scored days it can look back on. When combined with hunt logs (Phase 4A), we can correlate: "score 85 days → did hunters actually see birds?" That's how the model self-corrects.
- **Key insight from HuntProof:** They proved hunters will pay for a 15-day migration predictor. Ours goes further — multi-signal, transparent reasoning ("here's WHY"), and it learns.
- **New:** 1 edge function, 1 migration (1 new table), 1 pg_cron job
- **Effort:** 10-12 hrs (includes embedding + reasoning generation)
- **Risk:** Medium. Scoring weights need tuning. Start simple, iterate based on data.

### 2B. Pattern Confidence System
- **What:** Enhancement to convergence engine
- **Does:** When scoring, looks up similar historical conditions in `hunt_knowledge` via vector search. If patterns exist with known outcomes, adjusts score and adds reasoning: "Last 3 times AR had these conditions in December, eBird sightings spiked 3-5 days later (confidence: high)."
- **Effort:** 4-5 hrs (builds on 2A)
- **Risk:** Low if pattern data is good. Depends on Phase 1D quality + existing 348 patterns.

---

## Phase 3: The Voice (Layer 4)

**Goal:** The system reaches out to users. Daily briefs, real-time alerts, "go now" signals.

**Timeline: 2 build sessions (~15 hrs)**
**Dependency: Phase 2 convergence scores flowing**

### 3A. Scout Report (Daily Brief)
- **What:** pg_cron daily (morning, user timezone) + edge function
- **Does:** For each user, generates a personalized brief:
  - Your favorited states: convergence scores + trend (rising/falling)
  - National hotspots: top 3 states by score
  - Upcoming solunar windows worth noting
  - Weather outlook for your region
  - Any migration spikes in your flyway
- **Delivery:** Slack first (bot already exists in JAC). Email later. Push notifications eventually.
- **Uses:** `hunt_intel_briefs` table (already exists, empty, waiting for this)
- **New:** 1 edge function, 1 pg_cron job, brief UI component in frontend
- **Effort:** 8-10 hrs
- **Risk:** Low. All data sources exist from Phase 1+2.

### 3B. Real-Time Convergence Alerts
- **What:** Enhancement to convergence engine — when a state's score crosses a threshold (e.g., jumps 30+ points in a day), fire an alert
- **Does:** "Heads up: conditions in Arkansas just lit up. Cold front arriving Thursday + new moon + migration spike detected. Score jumped from 45 to 82."
- **Delivery:** Slack → SMS → push (progressive rollout)
- **New:** Alert threshold logic in convergence engine, Slack notification integration
- **Effort:** 4-5 hrs
- **Risk:** Alert fatigue. Need smart throttling (max 1 alert per state per 48hrs, only top 3 nationally).

---

## Phase 4: The Moat (Data Flywheel)

**Goal:** Every interaction makes the system smarter. User data + scraped data + continuous monitoring = compound advantage.

**Timeline: Ongoing, 3-4 build sessions (~25 hrs)**
**Dependency: Phases 1-3 running**

### 4A. Hunt Log
- **What:** Users log hunts — date, location, species, count, conditions, notes
- **Does:** Each log gets embedded into `hunt_knowledge`. Auto-populates `hunt_user_locations` (GPS). Feeds back into convergence engine as ground truth: "user reported great hunt in AR under these conditions" → reinforces pattern.
- **Insight from HuntProof:** Their log has 21 customizable data points. Start with 8-10 core fields, expand based on what users actually fill in.
- **Fields V1:** date, state, species, harvest count, weather (auto-filled from watchdog), moon phase (auto-filled from solunar), notes, GPS coords (optional)
- **New:** 1 edge function, 1 migration, log UI component, embedding pipeline
- **Effort:** 12-16 hrs
- **Risk:** Low technical risk. UX risk: will hunters actually log? Auto-fill weather + moon reduces friction.

### 4B. Forum Scraping V2 (Quality + Embedding)
- **What:** Tune Haiku extraction based on V1 data. Add embedding. Connect to `hunt_knowledge`.
- **Does:** Every scraped report becomes searchable knowledge. "What were conditions like in Stuttgart AR last December?" now returns real hunt reports.
- **Effort:** 5-8 hrs
- **Risk:** Depends on V1 data quality. May need to add more subreddits or find other sources.

### 4C. Feedback Loop
- **What:** Users can thumbs-up/down convergence alerts. "Was this alert accurate?"
- **Does:** Feeds back into scoring weights. If alerts for certain conditions consistently get thumbs-down, system adjusts. Over time, scoring becomes state-specific and season-specific.
- **Effort:** 4-6 hrs
- **Risk:** Low. Simple table + UI. Real value comes after hundreds of ratings.

---

## Phase 5: Operation War Room (Frontend Intelligence Layer)

**Status: SHIPPED (2026-03-07)**

Transformed the map from colored rectangles into a world-class military-grade hunting intelligence command center. 16 features across 4 build phases, all in one session.

### What Was Built

**Phase 1 — Bring the Map to Life:**
- eBird interactive clusters + heatmap (clustering, click-to-expand, species popups)
- Pulsing convergence hotspots (animated rings on 70+ states, red/orange by tier)
- Floating convergence score labels (dark pill + tier-colored score over each state)
- Animated wind flow lines (replaced ugly white triangles with marching-ants, speed-colored)
- Dead code cleanup (removed unused OWM wind/clouds/pressure tiles)

**Phase 2 — Weather Intelligence:**
- Pressure isobars with H/L center markers (turf interpolation + marching squares)
- NWS alert polygons (live from NWS API, severity-colored, pulsing, clickable)
- Dawn/dusk terminator (real-time sunrise line, updates every 60s, golden hour band)

**Phase 3 — Migration Intelligence:**
- Flyway migration corridors (4 bands with animated directional flow, seasonal)
- Migration front line (estimated from eBird density, cyan dashed, Intel mode)
- Convergence-weighted national heatmap (glows at national zoom using scores as proxy)

**Phase 4 — Command Center:**
- Rich hover intel cards (dark glass Bloomberg-style: score bar, weather, wind, moon, rank)
- Time machine scrubber (30d back / 7d forward, fetches historical convergence scores)
- Mode overhaul (5 distinct identities with master layer visibility map)
- Contextual legend panel (mode-aware, collapsible, bottom-left)

### Mode Identities After Overhaul

| Mode | Identity | Key Layers |
|------|----------|-----------|
| Default | Season overview | Season fills + flyways + eBird heatmap |
| Scout | Habitat recon | Wetlands + parks + water + trails + eBird clusters |
| Weather | Meteorologist view | Temp fills + radar + isobars + H/L + wind + NWS alerts |
| Terrain | Topographic | Landcover + contours + contour labels |
| Intel | Command center | Convergence fills + scores + hotspots + migration front + NWS + flyways + heatmap |

### Files Created (9)
- `src/components/SightingPopup.tsx` — eBird click popup
- `src/components/TimelineScrubber.tsx` — Time machine UI
- `src/components/MapLegend.tsx` — Contextual floating legend
- `src/hooks/useNWSAlerts.ts` — Live NWS alert polygons
- `src/hooks/useMigrationFront.ts` — Migration front estimation
- `src/lib/isobars.ts` — Pressure interpolation + contouring
- `src/lib/terminator.ts` — Solar terminator calculation
- `src/lib/migrationFront.ts` — Migration front math
- `src/data/flywayPaths.ts` — Flyway corridor GeoJSON

### New Dependencies
None. Everything built with existing deps (mapbox-gl, @turf/turf).

---

## Phase 6: Future Horizon

Items that matter but aren't in the immediate build plan.

### Data Sources to Integrate
- **NOAA AI Weather Models (AIGFS):** 16-day forecasts at fraction of compute cost. Public. Could replace or supplement Open-Meteo for longer-range outlooks.
- **Google DeepMind WeatherNext:** 15-day storm prediction. Experimental but accessible.
- **BirdCast (Cornell):** Nocturnal migration radar data. No public API yet — monitor for one.
- **USFWS Waterfowl Survey:** Annual population estimates. PDF scraping + Haiku extraction.
- **State harvest reports:** Many states publish annual harvest data. Same pipeline as forum scraping.

### Product Evolution
- **Native app (iOS/Android):** Push notifications require it. PWA as bridge.
- **SMS alerts:** Twilio integration for convergence alerts. Hunters in the field don't have app open.
- **Premium tiers:** Free = season lookup + basic weather. Paid = convergence scores, scout reports, hunt log, alerts. ($5-10/month or $50/year, in line with HuntProof/Duckr pricing)
- **Multi-species intelligence:** Deer movement prediction (HuntWise competitor), turkey roosting patterns, dove field scouting.
- **Social layer (The Wire):** Crowdsourced real-time reports. Only viable after active user base (cold-start problem). Phase 4A hunt logs are the seed.
- **Regulation parsing:** Deep reg parsing + change alerts. Skip for now — liability risk, maintenance burden. Current DNR links are safer.

---

## Build Order Summary

| Phase | What | Effort | Outcome |
|-------|------|--------|---------|
| **1A** | Weather Watchdog (Daily) | 5-7 hrs | Archives + embeds weather for 50 states, every day, forever |
| **1A-2** | NASA POWER (Daily) | 2-3 hrs | Satellite solar/cloud data — unique signal nobody else has |
| **1A-3** | NWS Alert Monitor (Rapid) | 4-5 hrs | Real-time severe weather alerts, the "storm in 24hrs" detector |
| **1B** | Solunar Precompute (Weekly) | 4-5 hrs | Moon/feeding windows precomputed + embedded 12 months ahead |
| **1C** | Migration Spike Detection (Daily) | 6-8 hrs | eBird activity vs baseline, flags + embeds anomalies |
| **1D** | Forum Scraping V1 (Weekly) | 8-10 hrs | Reddit hunt reports extracted, stored, quality-scored |
| **2A** | Convergence Engine | 10-12 hrs | Multi-signal "hunt score" per state per day, embedded with reasoning |
| **2B** | Pattern Confidence | 4-5 hrs | Historical pattern matching with reasoning |
| **3A** | Scout Report | 8-10 hrs | Personalized daily brief pushed to users |
| **3B** | Convergence Alerts | 4-5 hrs | "Go now" push when signals align |
| **4A** | Hunt Log | 12-16 hrs | User data feeds the brain |
| **4B** | Forum Scraping V2 | 5-8 hrs | Scraped data embedded and searchable |
| **4C** | Feedback Loop | 4-6 hrs | Alerts self-correct based on user feedback |

**Total estimated: 80-100 hours across ~10 build sessions**

**Build order:** 1A + 1A-2 + 1B can run in parallel (same session). 1A-3 (NWS rapid) is independent — can build anytime. 1C needs eBird backfill done. 1D is independent. Phase 2 needs Phase 1 producing data. Phase 3 needs Phase 2 scoring. Phase 4 is ongoing.

**Pipeline mapping:**
- Rapid pipeline = 1A-3 (NWS alerts, every 2-4 hrs)
- Daily pipeline = 1A (weather) + 1A-2 (NASA) + 1C (migration) + 2A (convergence)
- Weekly pipeline = 1B (solunar) + 1D (forum scraping)

---

## Off-Season Advantage

Right now (March 2026) most duck seasons are closed. This is the perfect time to build:
- Layer 2 monitoring runs all spring/summer collecting data
- Detection thresholds get tuned with zero stakes (no hunters making decisions on bad scores)
- By September when seasons open, the brain has 6 months of continuous data
- It knows what "normal" looks like, so it can spot what's abnormal
- Day 1 of season: system already knows weather patterns, moon cycles, migration baselines

The competitors are native apps with annual update cycles. We're a continuously-learning web platform that gets smarter every day it's online.
