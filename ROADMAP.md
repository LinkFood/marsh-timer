# Duck Countdown — Master Roadmap

Last updated: 2026-03-14

## The Thesis

The grandpa on the porch. 60 years of watching the sky, the creek, and the acorns — and he just knows. Except we're watching 50 states, 24/7, and never forget a single day. This is a wildlife pattern recognition engine. Data in → pattern match → outcome link → remember → repeat. The loop never stops.

**Not trying to be right. Trying to recognize patterns.** "The last N times conditions looked like this, here's what happened." The hunter makes the call.

**Weather is the trigger.** All animals move off weather shifts. The brain needs to detect front passages in hours, not days.

**Everything through the gate gets embedded.** The pipeline only grows. If data isn't being embedded, it's a bug.

---

## CURRENT STATE (2026-03-14 afternoon)

**Brain:** ~80K main table (DU separation complete). IVFFlat index working. Search returns species knowledge, weather patterns, convergence data. Brain cites sources with 📊 prefix.

**What shipped this session (60+ commits):**
- Brain V2: species + effective_date, filtered v2 RPC, query-on-write, all handlers wired
- IVFFlat index (replaced HNSW — couldn't fit in Supabase memory)
- DU report separation (58K pins moved to hunt_knowledge_du)
- Pattern Linker (hunt_pattern_links, real-time connections)
- Embed Forecasts (weather watchdog embeds 2-day predictions)
- Forecast Tracker (daily self-scoring, 10am cron)
- Migration + Convergence Report Cards (daily/weekly self-grading)
- Real-time Weather (130 METAR stations, every 15 min cron)
- Murmuration Index (continental pulse in header)
- The Recall (this day in history, Intel tab)
- State Comparison Mode ("Compare AR vs LA" with side-by-side data)
- Brain Honesty (📊 prefix for brain data, admits gaps)
- Season Awareness (warns when seasons are closed)
- Off-Season Mode (brain watches year-round)
- Species Library (39 waterfowl + deer/turkey/dove = 152 entries)
- Chat UX: auto-fly, auto-mode, compass avatar, branded loading, history persistence
- Error Boundaries + 10s request timeouts (no more infinite loading)
- Species tabs "Coming Soon" for non-duck (no more duck data contamination)
- API deduplication (AuthContext, no more 6x profile calls)
- Cron health monitoring (all 15 crons log to hunt_cron_log)
- 6 backfill scripts built (photoperiod, USGS water, NOAA tides, NOAA ACIS, USDA crops, eBird)

**Pipes (ALL PAUSED — Supabase IO budget depleted, recovering):**
- eBird: 20/2030 requests done. **RESTART FIRST when IO recovers.**
- USDA CropScape: 110 counties done.
- Photoperiod: 26K/36K (72%).
- USGS Water: 19K done.
- NOAA Tides: 17K done.
- NOAA ACIS: 800 done.
- **RULE: ONE PIPE AT A TIME.**

**15 crons active.** 3 confirmed healthy overnight.

---

## NEXT UP (when you come back)

### 1. Restart eBird (when IO recovers)
Check Supabase dashboard. If IO budget has recovered, restart eBird backfill — ONE pipe only. Resume from Oregon (request 20/2030, ~10 hours). This is the highest priority pipe because pattern re-extraction depends on it.

### 2. Pattern Re-Extraction (after eBird completes)
Run `scripts/extract-patterns.ts` with full 5-year eBird + weather data. Current: 348 patterns. Expected: 1,000-5,000 cross-referenced weather-migration patterns. **This is the biggest unlock for the brain.** "Last N times conditions looked like this" answers depend on this.

### 3. Resume Data Pipes (one at a time)
After eBird settles: USDA crops → photoperiod → USGS water → NOAA tides → NOAA ACIS. One finishes, next starts.

### 4. QA Round 4
Test the new features on duckcountdown.com:
- Brain honesty (📊 prefix, gap acknowledgment)
- Season awareness (closed season warnings)
- Species Coming Soon on non-duck tabs
- Error states (10s timeout, retry buttons)
- Compare mode ("Compare AR vs LA")

### 5. UX: Brain vs LLM visual distinction
Frontend change — brain data gets colored border/label, LLM filler gets muted. The user should instantly see what's data vs AI.

### 6. Real-time weather tuning
METAR function scans 130 stations every 15 min but detects 0 events. Lower thresholds or add logging to see what readings look like. The brain needs to feel fronts.

---

## SHIPPED

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
- **Fishing:** Same engine, different species config + data sources
- **Premium tiers:** Free = season lookup. Paid = brain access
- **The Wire:** Crowdsourced real-time reports

---

## The Compounding Effect

| Timeframe | Corpus Size | What It Knows |
|-----------|------------|---------------|
| Today (2026-03-14) | ~80,000 | Brain V2, species library, 6 data sources, 15 crons, self-grading loop |
| After eBird + patterns | ~85,000+ | + 1,000-5,000 cross-referenced weather-migration patterns |
| After all pipes finish | ~200,000+ | + water levels, tides, photoperiod, climate normals, crop data |
| After 1 full season | ~500,000+ | + daily accumulation + user logs + pattern links + report cards |
| After 2 seasons | ~1,000,000+ | Self-reinforcing: predictions linked to outcomes, patterns of patterns |

**Every day it gets wider. Nobody can catch up.**
