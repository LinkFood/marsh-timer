# Duck Countdown — CLAUDE.md

## The Thesis

The environment is a system. Duck Countdown is environmental OSINT — an embedding engine that fuses every public data source affecting ecological patterns into one vector space. Animals are biological sensors that detect environmental shifts before instruments do. Migration anomalies predict flooding. Pressure pattern matches precede severe weather. Water level convergence signals drought cascades. The brain doesn't predict — it recognizes. 1M+ entries, 25+ data sources, 25+ content types, 50 states, one vector space. Hunting is one lens into this intelligence. So is agriculture. So is disaster preparedness. The pipeline IS the product.

**THE EMBEDDING LAW:** Every piece of data that enters the system MUST be embedded via Voyage AI → hunt_knowledge. No exceptions. The embedding pipeline only grows — never shrinks, never skips. If data isn't being embedded, that's a bug.

## How the Brain Works

```
INGEST → EMBED → STORE → SCAN → GRADE
```

1. **Ingest:** Data enters from 25+ public APIs, bulk downloads, or real-time station feeds
2. **Embed:** 512-dim vector from Voyage AI (voyage-3-lite) via hunt-generate-embedding
3. **Store:** hunt_knowledge with content_type, state_abbr, species, effective_date, tags, metadata
4. **Scan:** scanBrainOnWrite() queries brain for cross-domain pattern matches. If similarity > 0.65, creates hunt_pattern_links and may fire alerts
5. **Grade:** Alert grader tracks predictions, grades them after outcome window closes, embeds grades back. Brain learns from mistakes.

Search and alerts are the same operation. Search = user pulls. Alerts = data pushes. Same RPC, same filters, same vector space.

**Show Don't Predict:** "The last N times these conditions aligned, here's what happened." Never "it WILL happen."

## Brain State

2,184,000+ entries in hunt_knowledge. Growing via crons + event-driven convergence scans. Heading to 3M+.

**Content types (25+):** storm-event, usgs-water, earthquake-event, photoperiod, noaa-tide, geomagnetic-kp, fire-activity, birdweather-daily, crop-data, drought-weekly, gbif-monthly, climate-index, historical-newspaper, weather-event, nws-alert, birdcast-daily, birdcast-historical, convergence-score, weather-forecast, migration-spike-*, migration-lull, migration-daily, bio-environmental-correlation, bio-absence-signal, alert-grade, alert-calibration, web-discovery, anomaly-alert, correlation-discovery, disaster-watch, hunting-knowledge, species-behavior, du_report, du_alert

**AI Stack:**
- **Haiku** — intent classification (routing only, 200ms)
- **Sonnet** — response generation (streaming SSE, 2-4s)
- **Tavily** — web search when brain results are thin (<3 matches)
- **Opus** — daily web curator (reviews staged discoveries, auto-embeds good ones)

**Self-Improving Loop:**
- hunt-alert-grader: daily, grades predictions as confirmed/partial/missed/false_alarm
- hunt-alert-calibration: weekly, computes rolling accuracy per source/state
- hunt-convergence-alerts: suppresses alerts with <40% historical accuracy
- Grades embedded back into hunt_knowledge — brain searches its own track record

## Cron Schedule (20 scheduled)

| Time (UTC) | Function | Purpose |
|------------|----------|---------|
| Every 15min | hunt-weather-realtime | ASOS 130-station monitoring |
| Every 3hr | hunt-nws-monitor | NWS severe weather alerts |
| 6:00 AM | hunt-weather-watchdog | 50-state forecast + events |
| 6:30 AM | hunt-nasa-power | NASA POWER satellite |
| 7:00 AM | hunt-migration-monitor | eBird spike detection (+ brain scan triggers) |
| 7:00 AM | hunt-web-curator | Opus reviews web discoveries |
| 8:00 AM | hunt-convergence-engine | 50-state convergence scoring |
| 8:15 AM | hunt-convergence-alerts | Score spike detection (grade-aware) |
| 9:00 AM | hunt-scout-report | Daily environmental brief |
| 9:30 AM | hunt-anomaly-detector | Statistical outlier detection (2σ) |
| 10:00 AM | hunt-birdcast | BirdCast radar migration (+ brain scan triggers) |
| 10:00 AM | hunt-forecast-tracker | Forecast accuracy grading |
| 10:30 AM | hunt-correlation-engine | Cross-domain pattern discovery |
| 11:00 AM | hunt-migration-report-card | 7-day migration prediction grading |
| 11:30 AM | hunt-alert-grader | Alert outcome grading |
| Mon 6am | hunt-du-alerts | DU migration articles |
| Mon 12pm | hunt-du-map | DU migration map pins |
| Sun 6am | hunt-solunar-precompute | 365-day solunar calendar |
| Sun 12pm | hunt-convergence-report-card | Weekly model performance |
| Sun 1pm | hunt-alert-calibration | Weekly accuracy aggregation |
| Sun 2pm | hunt-absence-detector | Bird absence detection |
| Wed 6am | hunt-disaster-watch | Climate index disaster signatures |

All cron functions MUST call `logCronRun` on EVERY exit path. The `hunt-cron-health` endpoint depends on these logs.

## Edge Functions (52 total)

### Brain Writers
hunt-weather-watchdog, hunt-weather-realtime, hunt-migration-monitor, hunt-birdcast, hunt-nasa-power, hunt-nws-monitor, hunt-solunar-precompute, hunt-convergence-engine, hunt-du-map, hunt-du-alerts, hunt-drought-monitor, hunt-inaturalist, hunt-birdweather, hunt-climate-indices, hunt-log, hunt-power-outage, hunt-usfws-survey, hunt-extract-patterns, hunt-historical-news, hunt-gbif, hunt-snow-cover, hunt-snotel, hunt-phenology, hunt-crop-progress, hunt-multi-species, hunt-movebank, hunt-search-trends, hunt-query-signal

### Intelligence Layer
hunt-anomaly-detector, hunt-correlation-engine, hunt-disaster-watch, hunt-absence-detector, hunt-web-curator

### Self-Graders
hunt-forecast-tracker, hunt-migration-report-card, hunt-convergence-report-card, hunt-alert-grader, hunt-alert-calibration

### Brain Readers
hunt-dispatcher (Haiku routes → Sonnet streams), hunt-search, hunt-alerts, hunt-suggested-prompts, hunt-ops-summary

### Utilities
hunt-generate-embedding, hunt-weather, hunt-solunar, hunt-scout-report, hunt-convergence-alerts, hunt-check-user-alerts, hunt-cron-health, hunt-feedback, hunt-recall, hunt-murmuration-index

All functions: `verify_jwt = false`, auth handled in code. Pin `supabase-js@2.84.0`, `std@0.168.0`.

## Stack

| Layer | Tech |
|-------|------|
| Framework | React 18, TypeScript, Vite |
| Styling | Tailwind CSS |
| Map | Mapbox GL JS (satellite-streets-v12, globe projection, 3D terrain, fog/atmosphere) |
| Panel Layout | CSS Grid 12-col (react-grid-layout removed — crashes in Vite prod) |
| Routing | React Router 6 (`/`, `/:species`, `/:species/:stateAbbr`, `/auth`) |
| Icons | Lucide React |
| Fonts | Playfair Display (headings), Lora (body) |
| OG Tags | Vercel Edge Middleware (`middleware.ts`) |
| Auth | Supabase Auth (Google OAuth) |
| AI Chat | Haiku (routing) → Sonnet (streaming SSE) → Tavily (web search) |
| AI Curator | Opus (daily web discovery review) |
| Embeddings | Voyage AI voyage-3-lite (512-dim) |
| DB | Supabase Postgres + pgvector (512-dim IVFFlat) |
| Edge Functions | Deno (Supabase Edge Functions) |

## Frontend Architecture

```
src/
  contexts/
    DeckContext.tsx          # Species, selectedState, gridPreset, mapHeight, panelsCollapsed, chat/layer toggles
    LayerContext.tsx         # 27+ user-toggleable map layers, 4 presets, localStorage persistence
    MapActionContext.tsx     # flyTo, flyToCoords, setMapMode
  layout/
    DeckLayout.tsx           # 5-row grid (heartbeat→ticker→map→panels→bottombar) + side-by-side mode
    MapRegion.tsx            # Draggable map container (height via DeckContext)
    PanelDock.tsx            # CSS Grid 12-col, 60px rows
    PanelDockMobile.tsx      # Vertical stack for mobile
    BottomBar.tsx            # Category filters + panel collapse + add panel
  panels/                    # 25 panels (lazy-loaded, error-bounded)
    PanelRegistry.ts         # All panels cataloged with metadata (refreshInterval, dataSources)
    PanelWrapper.tsx         # Chrome: drag handle, title, minimize, fullscreen (Portal), share, close
    WidgetManager.tsx        # Slide-out panel catalog (replaced PanelAddMenu)
  components/
    MapView.tsx              # Mapbox GL — 3D extrusion, fog, feature-state hover, glow effects
    HeaderBar.tsx            # Brand + subtitle + DeckSelector + GridPresetSelector + species + actions
    BrainHeartbeat.tsx       # Live status + clickable data source health dropdown (Portal)
    EventTicker.tsx          # 32px scrolling event strip
    HuntChat.tsx             # Dynamic prompts, live welcome stats, streaming responses
    ChatMessage.tsx          # FROM THE BRAIN (expanded card types) + AI INTERPRETATION
    GridPresetSelector.tsx   # 7 layout presets including Command Center (side-by-side)
    DeckSelector.tsx         # Save/load deck configurations
    AlertBell.tsx            # User alert notifications
    AlertManager.tsx         # Create/manage user-configurable alerts
    PanelTabs.tsx            # Shared tab strip component
  hooks/                     # 31 data hooks
  data/                      # types (Species includes 'all'), speciesConfig, seasons, dataSourceCatalog
  lib/                       # supabase, seasonUtils, isobars, terminator, migrationFront, panelShare
```

## 25 Panels

**Intelligence:** Convergence Scores (expandable 8-component breakdown), Convergence Alerts, Daily Brief, Pattern Alerts, State Profile, Brain Search, Brain Chat, What's Happening (real-time signal feed), Map View, Pattern Timeline

**Migration:** Migration Index, eBird Feed, DU Reports, State Screener

**Weather:** Weather Events, NWS Alerts, Weather Forecast, Solunar

**Analytics:** History Replay, Convergence History, Brain Activity, Admin Console

## Signal Domains (Species Selector)

```typescript
type Species = 'all' | 'duck' | 'goose' | 'deer' | 'turkey' | 'dove';
```

Default is `'all'` — shows cross-domain environmental convergence. Each species filters convergence weights.

## Grid Presets

Default, Equal Grid (no map), Map Focus, 2 Column, 3 Column, 4 Column, Command Center (side-by-side: map 60% left, panels 40% right)

## Database Tables (hunt_ prefix)

### Core
| Table | Purpose |
|-------|---------|
| hunt_knowledge | **THE BRAIN** — 1M+ vector embeddings (512-dim) |
| hunt_pattern_links | Cross-domain pattern correlations |
| hunt_convergence_scores | 50-state daily convergence scores |
| hunt_convergence_alerts | Score spike alerts + outcome tracking |
| hunt_alert_outcomes | Universal alert outcome tracker |
| hunt_alert_calibration | Rolling accuracy stats per source/state |
| hunt_cron_log | Cron execution log |

### Data
| Table | Purpose |
|-------|---------|
| hunt_seasons | Season data per species/state |
| hunt_migration_history | eBird sighting density (5 years) |
| hunt_weather_history | Daily weather aggregates (5 years) |
| hunt_weather_forecast | 16-day forecast per state |
| hunt_weather_events | Detected weather events |
| hunt_nws_alerts | NWS severe weather |
| hunt_solunar_precomputed | 365-day solunar data |
| hunt_birdcast | Daily BirdCast radar migration |
| hunt_web_discoveries | Staged web research (Tavily → Opus curator) |

### User
| Table | Purpose |
|-------|---------|
| hunt_profiles | User profiles |
| hunt_user_settings | Preferences, query counts |
| hunt_conversations | Chat history |
| hunt_tasks | Token/cost tracking |
| hunt_deck_configs | Saved panel layouts (6 builtin templates) |
| hunt_user_alerts | User-configurable alerts |
| hunt_user_alert_history | Alert notification history |

## Backfill Scripts

| Script | Target | Status |
|--------|--------|--------|
| backfill-birdcast-historical.ts | 50K BirdCast radar (2021-2025) | Running |
| backfill-storm-events.ts | 300K+ NOAA storm events | Running (414K done) |
| correlate-bio-environmental.ts | 10K+ bird↔environment correlations | Ready to run |
| dedup-storm-events.ts | Remove county-level duplicates | Ready (dry-run first) |
| backfill-ebird-history.ts | eBird 5yr history | Partially done |
| orchestrator.ts | Auto-sequences pipes | Available |

All scripts: `SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/NAME.ts`

## Mapbox Features

- Globe projection with always-on fog/atmosphere + stars
- 3D fill-extrusion choropleth (states rise by convergence score)
- Feature-state hover (smooth, no full repaint)
- Migration front glow layer + animated dash
- eBird cluster data-driven sizing + color ramp + glow
- Cinematic flyTo with pitch: 45, bearing: -15
- 27+ custom layers in 5 categories + 4 presets
- Default zoom: 4.2 (US fills viewport)

## Shared Edge Function Modules (_shared/)

| Module | Purpose |
|--------|---------|
| anthropic.ts | callClaude + callClaudeStream + CLAUDE_MODELS + cost calculation |
| brainScan.ts | scanBrainOnWrite + enrichWithPatternScan |
| cors.ts | handleCors + getCorsHeaders |
| cronLog.ts | logCronRun (object signature: functionName, status, summary, errorMessage, durationMs) |
| embedding.ts | generateEmbedding + batchEmbed (Voyage AI, max 20 per batch) |
| response.ts | successResponse + errorResponse |
| supabase.ts | createSupabaseClient (service role) |
| states.ts | STATE_ABBRS array |
| tavily.ts | searchWeb (Tavily API, advanced depth) |
| rateLimit.ts | checkRateLimit |

## Chat Architecture

7 intents: `weather | solunar | season_info | search | recent_activity | self_assessment | general`

Each handler returns `HandlerResult { cards, systemPrompt, userContent, mapAction? }`. Main function streams via SSE or returns JSON (fallback).

Dynamic prompts via hunt-suggested-prompts edge function (queries live brain activity). Welcome state shows live entry count + alert count.

Card types: weather, season, solunar, convergence, pattern, source, pattern-links, alert, activity

## Rules

- Mobile-first. Every feature must work on 375px.
- Brand stays "DUCK COUNTDOWN" with "ENVIRONMENTAL INTELLIGENCE" subtitle.
- All hunt_ tables share Supabase project with JAC Agent OS — never touch JAC tables.
- Pin supabase-js@2.84.0 in edge functions. Pin std@0.168.0.
- NEVER retry 4xx errors — only 5xx and network errors.
- NEVER run more than 2 light backfill pipes simultaneously. Heavy pipes (storm events) run solo.
- Shared module change → redeploy every function that imports it.
- Every early-return path calls logCronRun.
- NEVER use `$$` inside pg_cron — use `$cron$`/`$body$`.
- NEVER use psql or `db execute` — REST API only.
- ALWAYS embed new data. THE EMBEDDING LAW.

---

**Domain:** duckcountdown.com
**Repo:** github.com/LinkFood/marsh-timer
**Hosting:** Vercel (frontend, auto-deploy on push) + Supabase `rvhyotvklfowklzjahdd` (backend)
**Strategic Roadmap:** /Users/jameschellis/Desktop/JWC/DCD/DCD/DUCK-COUNTDOWN-STRATEGIC-ROADMAP.docx
