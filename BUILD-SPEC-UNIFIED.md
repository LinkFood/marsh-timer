# UNIFIED BUILD SPEC — Duck Countdown

**Date:** March 21, 2026
**Brain Size:** ~2M entries, growing ~1M per 48 hours
**Priority:** Execute sections in order. Each unlocks the next.

---

## THE VISION

Duck Countdown is an environmental intelligence platform. The brain is a 512-dimensional vector space containing weather, water, seismic, fire, crop, drought, climate, and biological data — all embedded side by side. When someone asks "what's going on in Arkansas," the answer should pull from ALL of that, not just bird migration. Birds are one biological sensor among many. They're powerful because they detect environmental shifts before instruments do — but they're signal, not product.

The platform is a research tool for anyone who cares about environmental patterns: farmers, emergency managers, ecologists, hunters, researchers. The code currently forces everything through a hunting lens. This spec fixes that.

**Three rules for every change:**
1. The brain searches wide — tags organize output, they don't restrict input
2. The AI layer makes sense of clusters — not hardcoded labels
3. Show what happened, never predict what will happen

---

# SECTION 1: SITE BUGS

Mechanical fixes from end-to-end testing. No architectural decisions required.

---

## 1.1 State Filtering Broken Across All Panels — HIGH

**Problem:** Selecting a state (URL → `/:species/:stateAbbr`) only affects the map flyTo. All panels ignore it.

**What's broken:**
- Pattern Alerts: shows "Select a state" even when AR is selected
- Weather Events: shows "No active weather events" — doesn't filter to state
- NWS Alerts: shows Spokane WA flood warning when AR is selected
- Chat FROM THE BRAIN: returns national data (AK, HI) when user asks about Arkansas

**Files:**
- `src/contexts/DeckContext.tsx` — confirm `selectedState` updates on route change
- `src/panels/PatternAlerts/` — read `selectedState`, pass `state_abbr` to query
- `src/panels/WeatherEvents/` — filter by `state_abbr` when state selected
- `src/panels/NWSAlerts/` — filter `hunt_nws_alerts` by state
- `supabase/functions/hunt-dispatcher/index.ts` — `recent_activity` handler must parse state names from query and pass `state_abbr` filter

**Done when:** Click AR → all panels show AR data. Clear state → national view returns.

---

## 1.2 Mobile Default Layout Hides All Panels — HIGH

**Problem:** On 375px, "Command Center" layout fills viewport with map. No panels visible. No bottom bar. Users must manually discover "Full Panels" mode.

**Files:**
- `src/layout/DeckLayout.tsx` — grid preset selection
- `src/contexts/DeckContext.tsx` — `gridPreset` state

**Fix:** On viewports < 768px, default to "Full Panels" layout (PanelDockMobile vertical stack). The component already exists and works well on mobile — it just isn't the default.

**Done when:** A user on a phone sees panels without changing any settings.

---

## 1.3 Brain Search Panel Returns No Results — HIGH

**Problem:** "tornado damage Alabama" returns no results in the Brain Search panel, but `hunt-search` edge function returns matches at 0.626 similarity via direct API call.

**Files:**
- `src/panels/BrainSearch/` — check endpoint, threshold, filters
- `supabase/functions/hunt-search/index.ts` — works correctly

**Likely cause:** Panel uses a different threshold, different endpoint, or fails silently. Check browser console for errors during search.

**Done when:** "tornado damage Alabama" returns results with similarity scores displayed.

---

## 1.4 "What's Happening" Panel Always Empty — MEDIUM

**Problem:** "No signals in the last 24 hours" with ALL 0, CONVERGENCE 0, WEATHER 0, NWS 0 — despite active NWS flood warnings in the ticker.

**Files:**
- `src/panels/WhatsHappening/` — check data source, time window, signal definition

**Done when:** Panel shows recent NWS alerts, convergence changes, and weather events.

---

## 1.5 Weather Events Panel Empty — MEDIUM

**Problem:** "No active weather events" despite hunt-weather-realtime logging events (pressure-drop, temp-drop, wind-shift).

**Files:**
- `src/panels/WeatherEvents/` — check table query and time window
- Note: `hunt-weather-realtime` cron has been erroring for 9+ hours — most recent events may be stale. Fix the cron too.

**Done when:** Panel shows recent weather events with type, location, timestamp.

---

## 1.6 Stale Brain Entry Counts — MEDIUM

**Problem:** Three different counts:
- Brain Search panel: "466K+ entries"
- Daily Brief footer: "295K+ embedded data points"
- Chat welcome: "1,136,414 entries" (closest to correct but also stale)
- Actual: ~2M+

**Files:**
- `src/panels/BrainSearch/` — likely hardcoded or cached
- `supabase/functions/hunt-scout-report/index.ts` — "295K+" in template
- `src/components/HuntChat.tsx` — has the best count, find its source

**Fix:** Single source of truth. One lightweight RPC or cached value that updates hourly. All components read from it.

**Done when:** All three locations show the same count, within 1 hour of actual.

---

## 1.7 Map Click Doesn't Navigate to State — LOW

**Problem:** Clicking a state polygon on the map does nothing. Only clicking in Convergence Scores panel works.

**Files:**
- `src/components/MapView.tsx` — add click handler on state fill layer that sets `selectedState` and navigates

**Done when:** Click any state on map → navigates to state view.

---

## 1.8 "ALL SIGNALS" Button Doesn't Return to National View — LOW

**Problem:** When on `/all/AR`, clicking "ALL SIGNALS" does nothing.

**Files:**
- `src/components/HeaderBar.tsx` — onClick handler should clear `selectedState` and navigate to `/:species`

**Done when:** ALL SIGNALS click from any state view returns to national view.

---

## 1.9 Cron Health Gaps

**hunt-weather-realtime** — erroring for 9+ hours. Check Supabase logs. Common causes: ASOS API rate limit, timeout, malformed response.

**4 "Never Run" crons** — `hunt-weather-watchdog`, `hunt-convergence-report-card`, `hunt-du-map`, `hunt-du-alerts`. Verify each calls `logCronRun` on every exit path.

**6+ crons missing from tracking** — `hunt-cron-health` only tracks 14 of 20+ scheduled crons. Add: `hunt-anomaly-detector`, `hunt-correlation-engine`, `hunt-alert-grader`, `hunt-alert-calibration`, `hunt-absence-detector`, `hunt-web-curator`, `hunt-solunar-precompute`, `hunt-disaster-watch`.

---

# SECTION 2: DOMAIN-AGNOSTIC REFACTOR

Strip hunting bias so the brain can surface cross-domain intelligence. The data is already diverse — storms, water, earthquakes, fire, crops, climate indices. The code forces it all through a hunting lens. Every fix below removes a wall between the brain and the user.

---

## 2.1 Search Query Injection — CRITICAL, DO FIRST

This is the #1 reason the system responds bird-heavy. The dispatcher hardcodes "duck hunting" into brain search queries.

**File:** `supabase/functions/hunt-dispatcher/index.ts`

**Weather handler (~line 719):**
```typescript
// REMOVE "duck hunting" injection
// CURRENT: query: `${state.name} duck hunting weather conditions ${query}`,
// FIX:
query: `${state.name} weather conditions environmental patterns ${query}`,
```

**Solunar handler (~line 863):**
```typescript
// CURRENT: query: `${state.name} solunar moon phase feeding times hunting ${query}`,
// FIX:
query: `${state.name} solunar moon phase activity patterns ${query}`,
```

**Season info handler (~line 934):**
```typescript
// CURRENT: query: `${species} hunting season regulations ${stateAbbr} ${query}`,
// FIX:
query: species && species !== 'all'
  ? `${species} seasonal patterns ${stateAbbr} ${query}`
  : `environmental seasonal patterns ${stateAbbr} ${query}`,
```

**Search handler (~line 1061):**
```typescript
// CURRENT: const searchQuery = species !== 'duck' ? `${species} ${query}` : query;
// FIX:
const searchQuery = species && species !== 'all' ? `${species} ${query}` : query;
```

---

## 2.2 Default Species from 'duck' to 'all' — CRITICAL

The dispatcher defaults to `'duck'` in 4+ places when no species is selected, biasing every unfiltered query.

**File:** `supabase/functions/hunt-dispatcher/index.ts`
**Lines ~331, ~369, ~380, ~405:**
```typescript
// CURRENT (every instance):
const resolvedSpecies = intentSpecies || ctxSpecies || 'duck';
`Selected species: ${ctxSpecies || 'duck'}`

// FIX (every instance):
const resolvedSpecies = intentSpecies || ctxSpecies || 'all';
`Selected species: ${ctxSpecies || 'all'}`
```

---

## 2.3 Intent Classification Prompt — HIGH

Haiku uses hunting vocabulary to classify intents.

**File:** `supabase/functions/hunt-dispatcher/index.ts` (~lines 326-354)

Replace hunting-specific intent descriptions:
```typescript
// CURRENT examples:
"Use 'weather' for questions about weather, wind, temperature, conditions for hunting."
"Use 'solunar' for moon phase, feeding times, best hunting times, solunar."
"Use 'season_info' for when does season open/close, bag limits, dates, regulations."
"Use 'search' for searching for hunting knowledge, tips, regulations, general hunting info."

// FIX:
"Use 'weather' for weather, wind, temperature, pressure, fronts, environmental conditions."
"Use 'solunar' for moon phase, tidal influence, activity cycles, solunar patterns."
"Use 'season_info' for species lifecycle timing, seasonal transitions, regulatory dates."
"Use 'search' for environmental knowledge, ecological patterns, historical data, general research."
```

---

## 2.4 System Prompts for Response Generation — HIGH

**File:** `supabase/functions/hunt-dispatcher/index.ts`

**Solunar handler (~line 903):**
```typescript
// CURRENT: "You are a solunar and lunar phase analyst for outdoor activity planning..."
// FIX: "You are a solunar and lunar phase analyst for environmental pattern analysis. Summarize the solunar data briefly, noting peak activity periods and moon phase."
```

**Season info handler (~line 1008):**
```typescript
// CURRENT: "You are a hunting season expert..."
// FIX: "You are a species behavior and regulatory expert. Summarize the season information briefly."
```

**General handler (~line 1228):**
```typescript
// CURRENT: "When users ask about hunting, provide that lens."
// FIX: "Adapt your framing to the user's context — environmental research, agriculture, ecology, weather, or general awareness."
```

---

## 2.5 Convergence Score Labels — HIGH

Users see these. "Tough hunting" tells a farmer this isn't for them.

**File:** `src/components/cards/ConvergenceCard.tsx` (~lines 142-146)
```typescript
// CURRENT:
'80-100 — Outstanding. Drop everything and go.'
'60-79 — Strong. Solid day, worth the trip.'
'40-59 — Fair. Average conditions.'
'20-39 — Poor. Tough hunting.'
'0-19 — Skip it. Stay home.'

// FIX:
'80-100 — Exceptional. Multiple signals converging.'
'60-79 — Strong. Clear pattern alignment.'
'40-59 — Moderate. Mixed conditions.'
'20-39 — Weak. Limited convergence.'
'0-19 — Minimal. Insufficient signal activity.'
```

---

## 2.6 Convergence Engine Search Text — HIGH

**File:** `supabase/functions/hunt-convergence-engine/index.ts` (~line 215)
```typescript
// CURRENT: const searchText = `${stateName} hunting conditions: ${weatherDetails}...`
// FIX: const searchText = `${stateName} environmental conditions: ${weatherDetails}...`
```

---

## 2.7 Alert Branding — HIGH

**File:** `supabase/functions/hunt-convergence-alerts/index.ts` (~line 255)
```typescript
// CURRENT: `DUCK COUNTDOWN ALERT -- ${stateName}`
// FIX: `ENVIRONMENTAL ALERT -- ${stateName}`
```

---

## 2.8 Daily Brief Branding — HIGH

**File:** `supabase/functions/hunt-scout-report/index.ts` (~line 58)
```typescript
// CURRENT: `DUCK COUNTDOWN DAILY BRIEF -- ${today}`
// FIX: `ENVIRONMENTAL INTELLIGENCE BRIEF -- ${today}`
```

---

## 2.9 Auth Page Subtitle — HIGH

**File:** `src/pages/Auth.tsx` (~lines 30-35)
```typescript
// CURRENT: "Hunting Intelligence Platform"
// FIX: "Environmental Intelligence Platform"
```

---

## 2.10 Help Modal — HIGH

**File:** `src/components/HelpModal.tsx` (~line 25)
```typescript
// CURRENT: "...filter by biological indicator type: All Signals, Waterfowl, Big Game, Upland..."
// FIX: "...filter by biological indicator type: All Signals shows cross-domain convergence. Individual species domains weight scoring toward that species' environmental sensitivities."
```

---

## 2.11 Data Source Catalog — MEDIUM

**File:** `src/data/dataSourceCatalog.ts`
```typescript
// Line ~13: "hunting event detection" → "environmental event detection"
// Line ~42: "waterfowl + game" → "monitored species"
```

---

## 2.12 State Facts — MEDIUM

**File:** `src/data/stateFacts.ts`

Reframe ~50 state facts from "great place to hunt" to "ecologically significant because":
```typescript
// CURRENT: "Stuttgart, AR is known as the 'Duck Hunting Capital of the World.'"
// FIX: "Stuttgart, AR sits at the heart of the Mississippi Flyway — one of the densest waterfowl staging areas in North America."

// CURRENT: "The flooded timber of Bayou Meto WMA offers legendary mallard hunting."
// FIX: "Bayou Meto WMA provides critical winter habitat for mallard populations migrating through the Central Mississippi Valley."
```

---

## 2.13 Type Definitions — MEDIUM

**File:** `src/data/types.ts` (~lines 21-36)
```typescript
// Rename: HuntingSeason → RegulatedSeason
// Rename: bagLimit → harvestLimit
// Search all usages before renaming — referenced in multiple files
```

**File:** `src/components/cards/SeasonCard.tsx` (~line 52)
```typescript
// "Bag limit:" → "Limit:"
```

**File:** `src/components/StateProfile.tsx` (~line 556)
```typescript
// "Bag:" → "Limit:"
```

---

## 2.14 What NOT to Change

- **"DUCK COUNTDOWN" brand name** — it stays. Subtitle "ENVIRONMENTAL INTELLIGENCE" is already correct.
- **`hunt_` table prefixes** — internal, users never see them
- **`hunt-` edge function names** — internal, not worth the breakage
- **Species selector values** (duck, goose, deer, turkey, dove) — valid signal domains. The issue is that 'duck' was the default, not that they exist.
- **BRAIN_RULES in dispatcher** — already says "frame around environmental signals, not hunting." Leave it.
- **`[HOT]` / `[WARM]` / `[COLD]` labels** — work in any domain as signal strength indicators

---

# SECTION 3: BRAIN ARCHITECTURE FOR SCALE

The brain is growing at ~1M entries per 48 hours. At this rate: 10M in weeks, 50M by summer. The vector math stays fast (IVFFlat handles hundreds of millions). The challenge is signal-to-noise ratio and making sure the brain can discover cross-domain patterns instead of being walled off by tags and filters.

**Core principle: tags organize output, they never restrict input.** The brain searches wide open. The AI layer makes sense of what comes back. This is what makes the platform different from everything else.

---

## 3.1 Remove Pre-Filters from Vector Search — CRITICAL

**Current behavior:** Brain searches use `content_type` and `state_abbr` as WHERE clauses that run BEFORE vector similarity. This means a storm event that correlates with a bird evacuation gets excluded if someone filters by `content_type = 'migration-daily'`. The filter kills cross-domain discovery.

**New behavior:** Vector similarity runs against the FULL brain — no content_type filter, no state_abbr filter. Results come back with their metadata attached for display grouping, not for exclusion.

**Files to change:**
- `supabase/functions/hunt-search/index.ts` — remove content_type and state_abbr from the RPC WHERE clause. Keep them as return fields.
- `supabase/functions/_shared/brainScan.ts` — `scanBrainOnWrite()` should search unfiltered so it can discover cross-domain patterns.
- `supabase/functions/hunt-dispatcher/index.ts` — all handler brain queries should stop passing content_type filters.

**Implementation — Two-Pass Search:**
```
Pass 1: Vector similarity across full brain → return top 50 nearest neighbors
Pass 2: Group results by content_type for display
         → "3 storm events, 2 migration readings, 1 water spike, 1 AI synthesis"
```

The user sees the cross-domain connections. The brain isn't blind.

**Performance note:** IVFFlat doesn't scan every row. It scans ~40-80 clusters out of thousands. At 50M entries, a properly tuned unfiltered similarity search takes 50-100ms. The filters were saving maybe 20ms. The cross-domain discovery they killed was worth infinitely more.

**Exception:** Time-based filtering is OK. Searching "what's happening right now" should filter to last 24-48 hours. Time is a legitimate constraint. Content type and state are not.

**Done when:** Asking "what's happening in Arkansas" returns storm events, water data, migration data, NWS alerts, AND any AI synthesis — all in one response, grouped by type.

---

## 3.2 AI Synthesis Layer — HIGH

As raw data grows past 2M, 10M, 50M — individual entries become noise. The AI synthesis layer reads clusters of nearby vectors, distills the pattern, and embeds a synthesis entry back into the brain. The synthesis becomes the smartest vector in the neighborhood because it encodes concepts from multiple domains in one embedding.

**New edge function: `hunt-brain-synthesizer`**

**Schedule:** Daily, after all data crons complete (~12pm UTC)

**Logic:**
1. Query hunt_knowledge for the densest vector clusters (regions with the most entries in a small similarity radius)
2. For each dense cluster, pull the top 50 entries
3. Group by content_type to see what domains are represented
4. If cluster spans 3+ content types (cross-domain) → send to Sonnet for synthesis
5. Sonnet reads the cluster and writes a synthesis like:
   ```
   "Arkansas flood risk pattern: When AO index goes negative AND USGS water
   levels rise >15% above baseline AND BirdWeather acoustic activity drops
   >40% within 72 hours, significant flooding follows within 5-7 days.
   Based on 11 historical matches across 2021-2025. Confidence: 73%."
   ```
6. Embed the synthesis via Voyage AI → store in hunt_knowledge with:
   - `content_type: 'ai-synthesis'`
   - `state_abbr`: from the cluster's dominant state
   - `tags`: content types that were fused (e.g., `['usgs-water', 'birdweather-daily', 'climate-index']`)
   - `metadata.source_ids`: IDs of the entries it synthesized from
   - `metadata.confidence`: based on historical match count
   - `metadata.synthesized_at`: timestamp
   - `metadata.domains_fused`: count of unique content types in cluster

**Why this works:** The synthesis entry sits in the vector space right next to the raw data it came from. But it's richer — it contains concepts from storms AND water AND birds in one embedding. When someone searches, the synthesis floats to the top because it's more semantically relevant than any individual raw entry. It becomes the brain's memory.

**Signal weight:** Add a `signal_weight` column to hunt_knowledge (default 1.0). AI synthesis gets 1.5-2.0. Confirmed alert grades get boosted. False alarms get demoted. The search RPC multiplies similarity × signal_weight for final ranking.

```sql
ALTER TABLE hunt_knowledge ADD COLUMN signal_weight FLOAT DEFAULT 1.0;

-- Update search RPC to use it:
-- ORDER BY (1 - (embedding <=> query_embedding)) * signal_weight DESC
```

---

## 3.3 Smarter scanBrainOnWrite — HIGH

Currently `scanBrainOnWrite()` finds pattern matches when new data lands. Make it unfiltered and AI-aware.

**File:** `supabase/functions/_shared/brainScan.ts`

**Current:** Searches with content_type and state_abbr filters → creates pattern links if similarity > 0.65

**New behavior:**
1. New data lands → embed it
2. Search the FULL brain (no content_type filter) for top 20 nearest neighbors
3. If neighbors span 3+ different content types → this is a cross-domain convergence
4. Send the cluster to a lightweight AI check (Haiku, not Sonnet — needs to be fast): "Is this a meaningful pattern or noise?"
5. If meaningful → create pattern link AND fire an alert with the cross-domain context
6. If 5+ neighbors are AI synthesis entries → this new data is reinforcing a known pattern. Log it as a confirmation.

**Done when:** A new USGS water reading that correlates with a bird evacuation pattern AND a storm event triggers an alert that references all three domains — not just "similar water reading found."

---

## 3.4 Index Tuning for Scale — MEDIUM

**Current:** Probably default IVFFlat settings (lists = 100, probes = 10)

**Tuning guide:**
| Brain Size | lists | probes | Rebuild Needed |
|-----------|-------|--------|----------------|
| 2M | 1,414 | 20-30 | Yes |
| 10M | 3,162 | 40-60 | Yes |
| 50M | 7,071 | 60-80 | Yes |
| 100M | 10,000 | 80-100 | Yes |

Formula: `lists = sqrt(n)`, `probes = lists * 0.02` (minimum 20)

```sql
-- Check current settings:
SELECT * FROM pg_indexes WHERE tablename = 'hunt_knowledge';

-- Rebuild for 2M entries:
DROP INDEX IF EXISTS hunt_knowledge_embedding_idx;
CREATE INDEX hunt_knowledge_embedding_idx ON hunt_knowledge
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 1414);

-- Set probes (per-session or in the search RPC):
SET ivfflat.probes = 25;
```

**When to rebuild:** Every time brain size doubles. At current growth rate, that's every ~4 days. Set up a weekly rebuild cron or trigger on row count milestones.

---

## 3.5 Synthesis Lifecycle — MEDIUM

AI synthesis entries aren't permanent truth. They need a lifecycle:

1. **Created** — synthesizer writes it based on N source entries
2. **Reinforced** — new data lands that matches the pattern. Increment a `metadata.confirmations` counter. Boost `signal_weight`.
3. **Challenged** — new data contradicts the pattern. The AI re-reads the cluster with the new data and either updates or refutes the synthesis.
4. **Superseded** — a newer synthesis covers the same cluster with better confidence. Old one gets `metadata.status: 'superseded'` and `signal_weight` drops to 0.5.
5. **Archived** — synthesis older than 12 months with no reinforcements. `signal_weight` drops to 0.25. Still searchable but won't crowd results.

**New cron: `hunt-synthesis-reviewer`**
**Schedule:** Weekly (Sunday)
**Logic:** For each AI synthesis entry, check if new data has reinforced or contradicted it since last review. Update status and signal_weight accordingly.

---

## 3.6 Raw Data Compression — LOW (future)

At 50M+ entries, consider moving old raw data to a cold storage table (`hunt_knowledge_archive`) while keeping synthesis entries hot. The brain searches the hot table first. If results are thin, it searches the archive.

Not needed yet at 2M. Plan for it at 20M+.

---

# EXECUTION ORDER

**Week 1: Fix What's Broken**
1. Site bugs 1.1-1.5 (state filtering, mobile, brain search, empty panels)
2. Stale counts 1.6
3. Minor nav bugs 1.7-1.8
4. Cron health 1.9

**Week 2: Free the Brain**
5. Search query injection 2.1-2.2 (remove "duck hunting" from queries, default to 'all')
6. System prompts 2.3-2.4 (stop telling the AI to think like a hunter)
7. UI text 2.5-2.10 (convergence labels, auth page, help modal, alerts, daily brief)
8. Deeper cleanup 2.11-2.13 (state facts, data catalog, types)

**Week 3: Scale the Brain**
9. Remove pre-filters from vector search 3.1
10. Add signal_weight column 3.2
11. Build hunt-brain-synthesizer cron 3.2
12. Upgrade scanBrainOnWrite 3.3
13. Tune IVFFlat index 3.4

**Week 4: Self-Improvement Loop**
14. Build hunt-synthesis-reviewer cron 3.5
15. Wire synthesis lifecycle (reinforce/challenge/supersede)
16. Monitor and tune

---

# VERIFICATION

After all sections complete, these queries should work correctly:

1. **"What's going on in Arkansas?"** → Returns weather + water + storms + bird activity + crop data + any AI synthesis. NOT just bird migration data.
2. **"What environmental patterns are converging in Iowa right now?"** → Cross-domain response pulling from ALL content types.
3. **"What happened last time these conditions aligned in Oklahoma?"** → Finds historical matches across storms, drought, USGS water, bird data — not just migration patterns.
4. **"Show me flood risk in Louisiana"** → USGS water + NWS alerts + storm events + bird displacement data + AI synthesis if it exists.
5. **"What's the brain detecting?"** → Most interesting signals across ALL domains, weighted by signal_weight. AI synthesis entries float to the top.
6. **On mobile at 375px** → Panels visible without changing settings.
7. **Click a state on the map** → All panels filter to that state.
8. **Brain Search: "tornado damage Alabama"** → Returns results with similarity scores.

---

# FILES QUICK REFERENCE

| Component | Path |
|-----------|------|
| **Dispatcher (search queries, prompts, intents)** | `supabase/functions/hunt-dispatcher/index.ts` |
| **Brain scan on write** | `supabase/functions/_shared/brainScan.ts` |
| **Search endpoint** | `supabase/functions/hunt-search/index.ts` |
| **Convergence engine** | `supabase/functions/hunt-convergence-engine/index.ts` |
| **Convergence alerts** | `supabase/functions/hunt-convergence-alerts/index.ts` |
| **Scout report / daily brief** | `supabase/functions/hunt-scout-report/index.ts` |
| **Cron health** | `supabase/functions/hunt-cron-health/index.ts` |
| **Weather realtime** | `supabase/functions/hunt-weather-realtime/index.ts` |
| **Embedding utility** | `supabase/functions/_shared/embedding.ts` |
| **Shared modules** | `supabase/functions/_shared/` |
| **DeckContext (state selection)** | `src/contexts/DeckContext.tsx` |
| **MapView** | `src/components/MapView.tsx` |
| **HeaderBar** | `src/components/HeaderBar.tsx` |
| **HuntChat** | `src/components/HuntChat.tsx` |
| **ConvergenceCard (score labels)** | `src/components/cards/ConvergenceCard.tsx` |
| **HelpModal** | `src/components/HelpModal.tsx` |
| **Auth page** | `src/pages/Auth.tsx` |
| **DeckLayout** | `src/layout/DeckLayout.tsx` |
| **PanelDockMobile** | `src/layout/PanelDockMobile.tsx` |
| **Brain Search panel** | `src/panels/BrainSearch/` |
| **What's Happening panel** | `src/panels/WhatsHappening/` |
| **Weather Events panel** | `src/panels/WeatherEvents/` |
| **NWS Alerts panel** | `src/panels/NWSAlerts/` |
| **Pattern Alerts panel** | `src/panels/PatternAlerts/` |
| **Species config** | `src/data/speciesConfig.ts` |
| **State facts** | `src/data/stateFacts.ts` |
| **Data source catalog** | `src/data/dataSourceCatalog.ts` |
| **Types** | `src/data/types.ts` |
| **Season card** | `src/components/cards/SeasonCard.tsx` |
| **State profile** | `src/components/StateProfile.tsx` |
| **Regulation links** | `src/data/regulationLinks.ts` |
