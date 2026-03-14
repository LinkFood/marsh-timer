# Duck Countdown — Master Roadmap

Last updated: 2026-03-14

## The Thesis

The grandpa on the porch. 60 years of watching the sky, the creek, and the acorns — and he just knows. Except we're watching 50 states, 24/7, and never forget a single day. This is a wildlife pattern recognition engine. Data in → pattern match → outcome link → remember → repeat. The loop never stops.

**Not trying to be right. Trying to recognize patterns.** "The last N times conditions looked like this, here's what happened." The hunter makes the call.

**Weather is the trigger.** All animals move off weather shifts. The brain needs to detect front passages in hours, not days.

**Everything through the gate gets embedded.** The pipeline only grows. If data isn't being embedded, it's a bug.

---

## CURRENT STATE (2026-03-14)

**Brain:** 77,889 embeddings and growing. Three backfill pipes running (photoperiod, USGS water, NOAA tides).

**Infrastructure shipped this session:**
- Brain V2: species + effective_date columns, filtered v2 RPC, 4 new indexes
- Query-on-write: weather-watchdog, migration-monitor, nws-monitor scan brain on every ingest
- All 5 dispatcher handlers wired to brain with tailored filters
- 12 ingest functions updated with species + effective_date
- 3 new data source backfill scripts (photoperiod, USGS water, NOAA tides)
- CLAUDE.md rewritten thesis-first

**Running pipes:**
- Photoperiod: ~36K embeddings (pure math, every 3rd day, 50 states x 5 years)
- USGS Water: ~500K+ embeddings (gauge heights, all active stream stations)
- NOAA Tides: ~100K+ embeddings (coastal stations, weekly tide patterns)
- eBird historical: ~50% complete (5-year backfill, started 2026-03-08)

**Daily crons running:**
- hunt-weather-watchdog (6am) — 50-state forecast + weather events
- hunt-nws-monitor (every 3hr) — severe weather alerts
- hunt-nasa-power (6:30am) — satellite data
- hunt-migration-monitor (7am) — eBird spike detection
- hunt-birdcast (daily) — radar migration activity
- hunt-solunar-precompute (weekly) — lunar calendar
- hunt-convergence-engine (8am) — 50-state scoring
- hunt-scout-report (9am) — daily AI brief
- hunt-convergence-alerts (8:15am) — spike notifications
- hunt-du-map (weekly) — DU migration pins
- hunt-du-alerts (weekly) — DU expert articles

---

## 48-HOUR ROADMAP

Say "do 1" or "do 3" and I build it.

### 1. Pattern Linker (The Continuous Loop)
**The missing piece.** Right now predictions and outcomes exist as separate embeddings. The brain finds them via similarity but they're not explicitly linked. Build `hunt_pattern_links` table — every time query-on-write finds a match, write a visible link. The map and chat read this in real time. Not a daily cron — fires on every ingest.
- **Effort:** Medium (2-3 hours)
- **Impact:** Closes the loop. The brain starts linking "what happened" to "what happened next."

### 2. Embed Forecasts
**Forecasts are embeddings too.** "Predicted 20-degree drop in AR in 48hrs" goes into the brain. When actual weather arrives 48hrs later, vector similarity links forecast→outcome automatically. The brain remembers what was predicted AND what happened.
- **Effort:** Medium (modify hunt-weather-watchdog to embed forecasts, not just actuals)
- **Impact:** The brain can now compare prediction vs reality on every weather event.

### 3. Real-Time Weather — The Nervous System (PRIORITY)
**Weather is the chokehold. The brain can't "feel" fronts by checking once a day.**
- Phase A (FREE): Build `hunt-weather-realtime` using NWS METAR/ASOS API. 950 airport stations, 1-minute observations, no auth. Cron every 15 minutes. Build front detection: rolling 3-hour window on temp rate-of-change, wind shift, pressure drop. Every detected front → embed → query-on-write → pattern link. **Prove the brain can feel weather changes.**
- Phase B (PAID): If Phase A works, upgrade to Synoptic Data ($300-950/mo). 170,000 stations, 2-5 min latency, push streaming. The brain goes from 950 eyes to 170,000.
- **Effort:** High (Phase A = 4-6 hours. Phase B = 2-3 hours after validation)
- **Impact:** This is the difference between a research engine and the grandpa on the porch. Everything else depends on this.

### 4. Wire New Data Into Convergence Engine
**The convergence score (0-100) doesn't know about water, photoperiod, or tides yet.** Wire USGS water levels, photoperiod thresholds, and tidal patterns into the scoring formula. When water + weather + light + migration all converge, the score should reflect it.
- **Effort:** Medium (2-3 hours, modify hunt-convergence-engine)
- **Impact:** The heatmap on the map becomes the full picture, not just weather+solunar+migration.

### 5. The Recall (This Day in History)
**Quick win.** Every day, automatically surface what happened on this date across all 5 years of data. Compare similarity to today's conditions. "March 14, 2023: massive teal push through Louisiana. Conditions today: 87% similar." Visible in the Intel tab.
- **Effort:** Low (afternoon, new edge function + frontend card)
- **Impact:** Makes the brain VISIBLE. Users see it remembering. Builds trust.

### 6. Murmuration Index (Continental Pulse)
**Single number in the header.** Total migration activity across the entire continent, updated with each cron run. Derived from BirdCast + eBird + convergence scores. "Migration Index: 847 (↑23%)". Glanceable "is anything happening?"
- **Effort:** Low (afternoon, aggregate query + header component)
- **Impact:** Changes the UX feel. You open the app and immediately know if birds are moving.

### 7. NOAA ACIS Climate Normals Backfill
**The "is this abnormal?" baseline.** 30-year climate normals + first/last freeze dates for every state. Lets the brain say "this November cold front arrived 11 days earlier than the 30-year average" instead of just "it got cold."
- **Effort:** Low (build backfill script, same pattern as others)
- **Impact:** Adds the baseline that makes every weather reading meaningful.

### 8. USDA CropScape Backfill
**The food layer.** County-level crop data — which counties grow rice, corn, milo, soybeans. "Poinsett County AR: 62% rice, post-harvest stubble available October." The brain can correlate "rice harvest complete" + "cold front" + "rising water" = convergence.
- **Effort:** Medium (API key registration + backfill script)
- **Impact:** Adds food availability — the #1 thing that holds birds in an area.

### 9. Off-Season Mode
**"No seasons open, but here's where patterns align."** The map should show convergence patterns year-round. The brain watches 365 days. The map should too.
- **Effort:** Low (frontend logic to show patterns even when seasons are closed)
- **Impact:** Retention year-round. The app doesn't go dead in April.

### 10. Pattern Re-Extraction
**Run extract-patterns.ts after eBird backfill completes.** Current: 348 patterns from partial data. Should produce 1,000-5,000 cross-referenced weather-migration patterns from the full 5-year dataset.
- **Effort:** Low (just run the script)
- **Depends on:** eBird backfill completion

---

## SHIPPED

### Brain V2 (2026-03-13) ✅
species + effective_date columns, filtered v2 RPC, query-on-write, all handlers wired, 12 ingest functions updated, 3 new backfill scripts, CLAUDE.md rewritten.

### Phase 1: Eyes & Ears (Continuous Monitoring) ✅
6 edge functions, 10 pg_cron jobs, 2200+ embeddings flowing 24/7.

### Phase 2: The Brain (Convergence Engine) ✅
5-component scoring (weather/solunar/migration/birdcast/pattern) → 0-100 per state per day.

### Phase 3: The Voice (Outbound Intelligence) ✅
Daily scout reports + convergence spike alerts + feedback loop.

### Phase 5: Operation War Room (Map Intelligence) ✅
16 map features: convergence heatmap, eBird clusters, wind flow, isobars, NWS polygons, terminator, flyway corridors, migration front, time machine, 5 map modes.

### Phase 6: The Mother Lode (Data Pipeline) ✅
4,900+ knowledge entries from 5 sources: DU Migration Alerts, USFWS Flyway Data Books, BirdCast Radar, USFWS Breeding Survey, USFWS HIP Harvest, DU Migration Map.

### Phase 7: User Data ✅
Hunt log + feedback loop on reports/alerts/scores.

### Chat UX Phase 1 & 2 ✅
Map-chat bridge, convergence in chat, PatternCard, SourceCard, safe markdown.

### Species Intelligence Phase 1 ✅
~230 seed entries for deer/turkey/dove + species-aware dispatcher.

---

## FUTURE HORIZON

- **Native app (iOS/Android):** Push notifications for convergence spikes
- **SMS alerts:** Twilio for hunters in the field
- **Premium tiers:** Free = season lookup. Paid = brain access
- **Fishing:** Same engine, different species config + data sources (water temp, stream flow)
- **Multi-species deep intelligence:** Deer rut phase, turkey gobble peaks, dove field rotation
- **The Wire:** Crowdsourced real-time reports (needs user base first)

---

## The Compounding Effect

| Timeframe | Corpus Size | What It Knows |
|-----------|------------|---------------|
| Today (2026-03-14) | ~78,000 | Brain V2, 3 backfill pipes running, 11 daily crons |
| After current backfills | ~250,000+ | + water levels, tides, photoperiod across 50 states x 5 years |
| After all Tier 1 sources | ~500,000+ | + climate normals, freeze dates, crop data, vegetation index |
| After 1 full season | ~750,000+ | + daily real-time accumulation + user hunt logs + pattern links |
| After 2 seasons | ~1,000,000+ | Self-reinforcing: predictions linked to outcomes, patterns of patterns |

**Every day it gets wider. Nobody can catch up.**
