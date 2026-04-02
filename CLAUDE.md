# Duck Countdown — CLAUDE.md

> **This is the single source of truth.** If it's not in this document, it doesn't exist yet. Every session starts here.

---

## What This Is

Duck Countdown is a pattern recognition engine with a self-learning feedback loop. It embeds every public environmental data source into one 512-dimensional vector space — weather, water, seismic, fire, crop, drought, climate indices, satellite, wildlife migration, acoustic, tidal, geomagnetic, phenological — and finds cross-domain connections that no single data source reveals.

The brain doesn't predict. It recognizes. "The last N times these conditions aligned, here's what happened." Then it tracks whether the pattern played out, grades itself, and adjusts confidence for next time. The grading loop is the intelligence. Without it, this is just a search engine.

**This is not a hunting app.** Hunting was the first lens. The brain is domain-agnostic. It works for agriculture, disaster preparedness, ecology, fishing, forestry — any domain where environmental patterns matter. The name "Duck Countdown" stays because it's the brand and the domain.

---

## The Brain

### Pipeline

```
TRIGGER → WATCH → REPORT → GRADE → ANALYZE
```

Every piece of intelligence follows this arc:

1. **Trigger:** Data enters from 25+ APIs, crons fire, embeddings land in hunt_knowledge. scanBrainOnWrite() searches the vector space for cross-domain matches on every write. If similarity > 0.65, creates hunt_pattern_links.

2. **Watch:** Convergence engine scores 50 states daily across 8 weighted domains. When 3+ domains converge in a state, a compound-risk alert fires. The brain is now watching that state.

3. **Report:** The system makes a claim — not "X will happen" but "this pattern has historically produced X." The claim, its basis, and expected signals are recorded in hunt_alert_outcomes with a deadline (72hr for convergence-alerts, 168hr for compound-risk).

4. **Grade:** After the deadline passes, hunt-alert-grader searches for outcome signals (NWS alerts, storm events, weather events) and grades: confirmed, partially_confirmed, missed, or false_alarm. Grades are embedded back into hunt_knowledge — the brain searches its own track record.

5. **Analyze:** hunt-alert-calibration aggregates grades weekly into rolling accuracy per source and state. hunt-convergence-alerts suppresses future alerts from sources with <40% historical accuracy. The brain gets more honest over time.

### The Embedding Law

Every piece of data that enters the system MUST be embedded via Voyage AI (voyage-3-lite, 512-dim) → hunt_knowledge. No exceptions. The embedding pipeline only grows — never shrinks, never skips. If data isn't being embedded, that's a bug.

### Brain State (as of 2026-04-02)

- **3,200,000+** entries in hunt_knowledge
- **60+** content types, **43** types active
- **50** states tracked, **50/50** convergence scoring daily
- **88 crons** (39/41 healthy — weather-realtime and brain-synthesizer intermittent)
- **44 arcs** — 8 recognitions, 33 outcomes, 3 graded
- **Self-grading loop** active — **29 graded, 100% confirmed accuracy** with Opus post-mortem reasoning
- **API cost** ~$2-3/day (~$60-90/month) after convergence-scan throttle (Haiku for 3-4 domains, dedup)
- **No auth wall** — terminal visible without sign-in
- **Compound index** on (content_type, created_at DESC) — content_type queries <3s on 3.2M rows

### 8-Component Convergence Scoring

Each state gets a daily score from 0-135 across these weighted domains:

| Domain | Max Weight | Source |
|--------|-----------|--------|
| Weather | 25 | ASOS stations, Open-Meteo, NWS |
| Migration | 25 | eBird sighting density |
| BirdCast | 20 | Radar migration intensity |
| Solunar | 15 | Lunar phase, feeding windows |
| Water | 15 | USGS stream gauges |
| Pattern | 15 | Historical pattern match strength |
| Photoperiod | 10 | Solar calculations |
| Tide | 10 | NOAA tidal stations |

---

## What Exists Today

### Backend — Strong
- 3.2M+ vector embeddings in one searchable brain
- 66 Deno edge functions
- 82 crons (80 healthy) feeding data continuously
- Self-grading loop (alert-grader → alert-calibration → grade suppression)
- **Synthesis agent** — hunt_state_arcs table + arc reactor hooks + hunt-arc-narrator (Sonnet narratives, Opus grade reasoning, arc fingerprinting)
- scanBrainOnWrite pattern matching on every data ingest
- Convergence engine scoring 50 states daily + triggering state briefs for top 20
- AI chat pipeline: Haiku (intent routing) → Sonnet (streaming response) → Tavily (web search fallback)
- Opus daily web curator reviewing staged discoveries
- Ops dashboard at /ops ("Intelligence Control") with cron health, brain growth, alert performance, intelligence feed

### Frontend — Terminal Landing + Intelligence Command Center
- React 18 + TypeScript + Vite + Tailwind
- Mapbox GL JS with 3D globe, state extrusion, 27+ layers, 4 presets
- **Terminal Landing (`/`)** — 3-zoom-level progressive disclosure: ConvergenceScoreboard (mini-bars, sparklines, conviction dots), RegimeDetector (QUIET/ACTIVE/SURGE), PressureDifferential scatter plot, FusionPanel (72h collision timeline), StateDetailPanel (arc, components, brief, conviction), SplitVerdict + AutopsyDrawer for graded arcs, enriched collision feed with brain narration
- **Intelligence Page (`/intelligence`)** — deep-dive command center with FusionWeb SVG, rankings, brain recognition, outcome windows, live feed, METAR, chat overlay
- **StateIntelView** — replaces panel dock when state selected, shows AI assessment + convergence + pattern links + alerts
- 25 lazy-loaded panels in 4 categories (workbench mode)
- Chat synthesis: answer-first, collapsible evidence, CrossDomainPatternCard
- Streaming AI chat with dynamic prompts
- Real-time event ticker, brain heartbeat
- Supabase Realtime subscriptions on hunt_state_arcs
- Google OAuth via Supabase Auth

---

## Architecture Reference

### Stack

| Layer | Tech |
|-------|------|
| Framework | React 18, TypeScript, Vite |
| Styling | Tailwind CSS |
| Map | Mapbox GL JS (satellite-streets-v12, globe projection, 3D terrain, fog/atmosphere) |
| Panel Layout | CSS Grid 12-col |
| Routing | React Router 6 (`/`, `/:stateAbbr`, `/intelligence`, `/map`, `/auth`, `/ops`) — `/` is the terminal landing, `/intelligence` is the deep-dive command center |
| Icons | Lucide React |
| Fonts | Playfair Display (headings), Lora (body) |
| Auth | Supabase Auth (Google OAuth) |
| AI Chat | Haiku (routing) → Sonnet (streaming SSE) → Tavily (web fallback) |
| AI Curator | Opus (daily web discovery review) |
| Embeddings | Voyage AI voyage-3-lite (512-dim) |
| DB | Supabase Postgres + pgvector (512-dim IVFFlat) |
| Edge Functions | Deno (Supabase Edge Functions) |
| Hosting | Vercel (frontend, auto-deploy on push) + Supabase (backend) |

### Edge Functions (66 total)

Run `ls supabase/functions/ | grep -v _shared` for current list. Key additions since last inventory: hunt-air-quality, hunt-arc-narrator, hunt-brain-synthesizer, hunt-convergence-scan, hunt-murmuration-index, hunt-ocean-buoy, hunt-ops-dashboard, hunt-river-discharge, hunt-soil-monitor, hunt-space-weather, hunt-synthesis-reviewer, hunt-wildfire-perimeters

All functions: `verify_jwt = false`, auth handled in code. Pin `supabase-js@2.84.0`, `std@0.168.0`.

### Shared Edge Function Modules (_shared/)

| Module | Purpose |
|--------|---------|
| anthropic.ts | callClaude + callClaudeStream + CLAUDE_MODELS + cost calculation |
| brainScan.ts | scanBrainOnWrite + enrichWithPatternScan |
| cors.ts | handleCors + getCorsHeaders |
| cronLog.ts | logCronRun (object signature: functionName, status, summary, errorMessage, durationMs) |
| embedding.ts | generateEmbedding + batchEmbed (Voyage AI, max 20 per batch) |
| response.ts | successResponse + errorResponse + cronResponse + cronErrorResponse |
| supabase.ts | createSupabaseClient (service role) |
| states.ts | STATE_ABBRS array |
| tavily.ts | searchWeb (Tavily API, advanced depth) |
| rateLimit.ts | checkRateLimit |

### Cron Schedule

| Time (UTC) | Function | Purpose |
|------------|----------|---------|
| Every 15min | hunt-weather-realtime | ASOS 130-station monitoring |
| Every 3hr | hunt-nws-monitor | NWS severe weather alerts |
| 6:00 AM | hunt-weather-watchdog | 50-state forecast + events |
| 6:30 AM | hunt-nasa-power | NASA POWER satellite |
| 7:00 AM | hunt-migration-monitor | eBird spike detection (+ brain scan) |
| 7:00 AM | hunt-web-curator | Opus reviews web discoveries |
| 8:00 AM | hunt-convergence-engine | 50-state convergence scoring |
| 8:15 AM | hunt-convergence-alerts | Score spike detection (grade-aware) |
| 9:00 AM | hunt-scout-report | Daily environmental brief |
| 9:30 AM | hunt-anomaly-detector | Statistical outlier detection (2σ) |
| 10:00 AM | hunt-birdcast | BirdCast radar migration (+ brain scan) |
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

All cron functions MUST call `logCronRun` on EVERY exit path.

### Database Tables (hunt_ prefix)

**Core Brain:**
| Table | Purpose |
|-------|---------|
| hunt_knowledge | THE BRAIN — 3.2M+ vector embeddings (512-dim IVFFlat) |
| hunt_pattern_links | Cross-domain pattern correlations from scanBrainOnWrite |
| hunt_convergence_scores | 50-state daily convergence scores (8 components) |
| hunt_convergence_alerts | Score spike alerts |
| hunt_alert_outcomes | Universal alert outcome tracker (claims + deadlines + grades) |
| hunt_alert_calibration | Rolling accuracy stats per source/state |
| hunt_state_arcs | Narrative arc state machine per state (buildup→recognition→outcome→grade→closed) |
| hunt_cron_log | Cron execution log |

**Data:**
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

**User:**
| Table | Purpose |
|-------|---------|
| hunt_profiles | User profiles |
| hunt_user_settings | Preferences, query counts |
| hunt_conversations | Chat history |
| hunt_tasks | Token/cost tracking |
| hunt_deck_configs | Saved panel layouts |
| hunt_user_alerts | User-configurable alerts |
| hunt_user_alert_history | Alert notification history |
| hunt_state_briefs | AI-generated state narrative briefs for Intelligence Page |

### Frontend Architecture

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
    PanelRegistry.ts         # All panels cataloged with metadata
    PanelWrapper.tsx         # Chrome: drag handle, title, minimize, fullscreen, share, close
    WidgetManager.tsx        # Slide-out panel catalog
  components/
    MapView.tsx              # Mapbox GL — 3D extrusion, fog, feature-state hover
    HeaderBar.tsx            # Brand + DeckSelector + GridPresetSelector + species + actions
    BrainHeartbeat.tsx       # Live status + health dropdown
    EventTicker.tsx          # 32px scrolling event strip
    HuntChat.tsx             # Streaming AI chat with dynamic prompts
    ChatMessage.tsx          # Brain cards + AI interpretation
  hooks/                     # 31 data hooks
  data/                      # types, speciesConfig, seasons, dataSourceCatalog
  lib/                       # supabase, seasonUtils, isobars, terminator, migrationFront, panelShare
  pages/
    IntelligencePage.tsx     # /intelligence — the product (brain thinking in real time)
    OpsPage.tsx              # /ops — system health dashboard
    StateIntelView.tsx       # Replaces PanelDock when state selected — deep state intelligence view
```

### Chat Architecture

7 intents: `weather | solunar | season_info | search | recent_activity | self_assessment | general`

Each handler returns `HandlerResult { cards, systemPrompt, userContent, mapAction? }`. Streams via SSE or returns JSON fallback. Dynamic prompts via hunt-suggested-prompts (queries live brain activity).

### Signal Domains

```typescript
type Species = 'all' | 'duck' | 'goose' | 'deer' | 'turkey' | 'dove';
```

Default is `'all'` — cross-domain environmental convergence. Each species filters convergence weights. These are biological signal domains, not just game animals.

### Backfill Scripts

Use `orchestrator-v2.ts` for all backfills. Manages concurrency, checkpoints, retries, layered startup.

```bash
VOYAGE_API_KEY=... npx tsx scripts/orchestrator-v2.ts          # Run from checkpoint
npx tsx scripts/orchestrator-v2.ts --status                     # Show pipe status
npx tsx scripts/orchestrator-v2.ts --reset                      # Reset checkpoint
npx tsx scripts/orchestrator-v2.ts --only PIPE                  # Run one pipe solo
```

---

## Rules

### Absolute Rules (Break These and Things Die)
- **THE EMBEDDING LAW:** Every piece of data MUST be embedded via Voyage AI → hunt_knowledge. No exceptions.
- All hunt_ tables share Supabase project with JAC Agent OS — **NEVER touch JAC tables.**
- Pin `supabase-js@2.84.0` in edge functions. Pin `std@0.168.0`.
- NEVER retry 4xx errors — only 5xx and network errors.
- Every early-return path in cron functions calls `logCronRun`.
- Shared module change → redeploy EVERY function that imports it.
- NEVER use `$$` inside pg_cron — use `$cron$`/`$body$`.
- NEVER use psql or `db execute` — REST API only.

### Performance Rules (Learned the Hard Way)
- NEVER run more than 3 backfill pipes simultaneously (Supabase Pro IO budget).
- Use orchestrator-v2.ts with 60s layered startup between pipes.
- Monitor IO every 20 min when running backfills.
- NEVER use `{ count: 'exact' }` on hunt_knowledge — use `{ count: 'estimated' }`.
- Always pass state filter to vector search RPCs when searching for a specific state.

### Design Rules
- Mobile-first. Every feature must work on 375px.
- Brand stays "DUCK COUNTDOWN" with "ENVIRONMENTAL INTELLIGENCE" subtitle.
- Dark theme: bg-gray-950, cyan/teal accents.
- Fonts: Playfair Display (headings), Lora (body).
- Show don't predict. "The last N times these conditions aligned, here's what happened." Never "it WILL happen."

---

## Project Info

**Domain:** duckcountdown.com
**Repo:** github.com/LinkFood/marsh-timer
**Hosting:** Vercel (frontend, auto-deploy on push) + Supabase `rvhyotvklfowklzjahdd` (backend)
**Supabase Plan:** Pro (watch IO budget)
