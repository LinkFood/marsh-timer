# Duck Countdown — CLAUDE.md

## The Thesis

The environment is a system. Duck Countdown is environmental OSINT — an embedding engine that fuses every public data source affecting ecological patterns into one vector space. Animals are biological sensors that detect environmental shifts before instruments do. Migration anomalies predict flooding. Pressure pattern matches precede severe weather. Water level convergence signals drought cascades. The brain doesn't predict — it recognizes. 591K+ entries, 21 data sources, 19 content types, 50 states, one vector space. Hunting is one lens into this intelligence. So is agriculture. So is disaster preparedness. The pipeline IS the product.

**THE EMBEDDING LAW:** Every piece of data that enters the system MUST be embedded via Voyage AI -> hunt_knowledge. No exceptions. Every cron output, every weather pattern, every user log, every ingested document. The embedding pipeline only grows — never shrinks, never skips. If data isn't being embedded, that's a bug. This is the core competitive moat.

## How the Brain Works

Ingest -> Embed -> Store -> Search/Alert (same operation, different triggers).

- **Search** = user pulls from the brain.
- **Alerts** = incoming data pushes against the brain.

Same RPC, same filters, same vector space. When a cold front hits Arkansas, the ingest function doesn't just embed and store — it immediately queries the brain: "what happened the last time these conditions aligned?" If the pattern match is strong, it fires an alert. The brain reacts to new data in real time, not just when a user asks.

**Show Don't Predict:** The system draws conclusions from data and cites sources. It never says "it WILL happen." It says "the last N times these conditions aligned, here's what happened."

## Brain State

591K+ entries in hunt_knowledge. Heading to 1M+.
- 21+ data sources: eBird, NOAA, NASA, NWS, USGS, BirdCast, Drought Monitor, iNaturalist, GBIF, USDA, climate indices, and more
- IVFFlat index. 19+ content types. Self-improving via alert grading feedback loop.
- Chat: Haiku routes → Sonnet streams (SSE) → Tavily web search fills gaps → Opus curator auto-embeds discoveries
- Brain honesty: "FROM THE BRAIN" (cyan, cards) + "AI INTERPRETATION" (Sonnet text)
- 19 crons active. Anomaly detector, correlation engine, disaster watch all running.
- Self-improving: alert-grader grades predictions daily, alert-calibration scores accuracy weekly, convergence-alerts suppress low-accuracy states
- Web discoveries staged in hunt_web_discoveries, Opus curator runs at 2am ET daily

## Cron Monitoring

All 14 crons write to `hunt_cron_log` via `logCronRun` from `_shared/cronLog.ts`. The `hunt-cron-health` endpoint queries this table.

**CRITICAL:** Every early-return path in a cron function MUST call `logCronRun` before returning. If a function short-circuits (e.g., "no data found"), it still needs to log — otherwise the health dashboard shows "never_run" and we lose visibility.

**Check cron health every session:**
```bash
SERVICE_KEY=$(npx supabase projects api-keys --project-ref rvhyotvklfowklzjahdd 2>/dev/null | grep service_role | awk '{print $NF}')
curl -s "https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-cron-health" -H "Authorization: Bearer $SERVICE_KEY"
```

If any cron shows "error" or "late", investigate immediately. If "never_run" after 48 hours, the function likely has an early-return path missing logCronRun.

## Brain V2

- `species` column on hunt_knowledge
- `effective_date` column on hunt_knowledge
- Filtered v2 RPC with recency boost
- Query-on-write pattern matching on ingest
- All 5 dispatcher handlers wired to brain with tailored filters

## Future Data Sources

USDA crop data, USGS water levels, soil moisture, ice cover, burn maps, zoology research — the corpus is infinite, all public.

---

**Domain:** duckcountdown.com
**Repo:** github.com/LinkFood/marsh-timer
**Hosting:** Vercel (frontend) + Supabase `rvhyotvklfowklzjahdd` (backend, shared with JAC Agent OS)
**Brand:** "DUCK COUNTDOWN" stays the brand regardless of selected species.

## Stack

| Layer | Tech |
|-------|------|
| Framework | React 18, TypeScript, Vite |
| Styling | Tailwind CSS |
| Map | Mapbox GL JS (satellite-streets-v12, 3D terrain) |
| Panel Layout | react-grid-layout (drag/resize panels) |
| Animation | Framer Motion |
| Routing | React Router 6 (`/`, `/:species`, `/:species/:stateAbbr`, `/auth`) |
| Icons | Lucide React |
| Fonts | Playfair Display (headings), Lora (body) |
| OG Tags | Vercel Edge Middleware (`middleware.ts`) |
| Auth | Supabase Auth (Google OAuth) |
| AI | Claude Haiku 4.5 (intent classification, responses) |
| Embeddings | Voyage AI voyage-3-lite (512-dim) |
| DB | Supabase Postgres + pgvector (512-dim HNSW) |
| Edge Functions | Deno (Supabase Edge Functions) |

## Project Structure

```
src/
  contexts/
    DeckContext.tsx           # Species, selectedState, chat/layers/panelAdd toggles
    LayerContext.tsx          # User-toggleable map layers (replaces LAYER_MODES)
    MapActionContext.tsx      # flyTo, flyToCoords, setMapMode for panel→map interaction
  layout/
    DeckLayout.tsx            # Top-level: heartbeat → map region → panel dock → bottom bar
    MapRegion.tsx             # Resizable map container (drag divider, localStorage height)
    PanelDock.tsx             # Desktop: react-grid-layout (12 cols, drag/resize)
    PanelDockMobile.tsx       # Mobile: vertically stacked panels
    BottomBar.tsx             # Category quick-access + add panel + mobile toggles
  panels/
    PanelTypes.ts             # PanelDef, PanelInstance, DeckState interfaces
    PanelRegistry.ts          # All 18 panels cataloged (lazy-loaded)
    PanelWrapper.tsx          # Panel chrome: drag handle, title, minimize, close
    PanelAddMenu.tsx          # Searchable panel catalog dropdown
    [18 panel components]     # Each owns its own hooks — no prop drilling
  layers/
    LayerTypes.ts             # LayerDef, LayerPreset interfaces
    LayerRegistry.ts          # 27 layers in 5 categories + 4 presets
    LayerPicker.tsx           # Searchable/categorized slide-out toggle panel
    useLayerState.ts          # Re-export of useLayerContext
  components/
    MapView.tsx               # Mapbox GL — accepts visibleMapboxLayers from LayerContext
    HeaderBar.tsx             # Brand + action buttons (add, layers, chat, help, search)
    BrainHeartbeat.tsx        # Live status bar: embeddings, crons, activity
    HuntChat.tsx              # AI chat (rendered inside ChatPanel)
    MapPopup.tsx / SightingPopup.tsx  # Map popups
    cards/                    # ConvergenceCard, WeatherCard, SeasonCard, SolunarCard, AlertCard
    charts/                   # Sparkline, StackedArea
  pages/
    Index.tsx                 # Thin orchestrator: providers + DeckLayout + MapWithLayers
    Auth.tsx                  # Google OAuth sign-in
    NotFound.tsx              # Themed 404
  hooks/                      # 27 data hooks — panels import directly
  data/                       # types, speciesConfig, seasons, flyways, fips
  lib/                        # seasonUtils, isobars, terminator, migrationFront, supabase, ebird
supabase/
  functions/                  # 45+ edge functions (see below)
  migrations/                 # SQL migrations
  config.toml                 # Function configs (all verify_jwt = false)
scripts/                      # Backfill scripts
middleware.ts                 # Vercel Edge Middleware: OG tags, legacy redirects
```

## Data Model

```typescript
type Species = "duck" | "goose" | "deer" | "turkey" | "dove";

interface HuntingSeason {
  species: Species;
  state: string;           // "Texas"
  abbreviation: string;    // "TX"
  seasonType: SeasonType;  // "regular", "archery", "rifle", etc.
  zone: string;            // "South Zone", "Statewide"
  zoneSlug: string;        // "south-zone", "statewide"
  dates: DateRange[];      // Array handles split seasons
  bagLimit: number;
  flyway?: string;         // Waterfowl only
  weapon?: string;         // "Bow", "Rifle", "Shotgun"
  notes?: string;
  verified: boolean;
  sourceUrl?: string;
  seasonYear: string;      // "2025-2026"
}
```

## Routing

```
/                    -> Home (defaults to duck)
/duck                -> Duck map
/deer                -> Deer map
/duck/TX             -> Texas duck seasons
/deer/TX             -> Texas deer seasons
/TX                  -> Legacy redirect -> /duck/TX (301 in middleware)
```

## Features

Composable panel-based intelligence platform. Map always visible at top (resizable). 18 drag/resize panels below in react-grid-layout grid. 27 user-toggleable map layers with 4 presets (Scout, Weather, Intel, Terrain). AI chat slide-out. Species is a filter concept, not navigation.

**Panels:** Convergence Scores, Convergence Alerts, Scout Report, Hunt Alerts, State Profile, Migration Index, eBird Feed, DU Reports, State Screener, Weather Events, NWS Alerts, Weather Forecast, Solunar, History Replay, Convergence History, Brain Activity.

**Map layers:** Convergence heatmap, weather radar, eBird sightings (clusters + heatmap), pressure isobars, NWS alert polygons, dawn/dusk terminator, flyway corridors, migration front, wind flow, weather events, perfect storm, DU pins, wetlands, water, parks, trails, agriculture, land cover, contours, counties, temperature, 3D terrain, satellite.

## Season Statuses

open, soon (<30 days), upcoming (30-90 days), closed

## Data Coverage (2025-2026)

| Species | Entries | States | Season Types | Verified |
|---------|---------|--------|--------------|----------|
| Duck | 104 | 50 | regular, early-teal | 91/104 |
| Goose | 87 | 49 | regular, light-goose-conservation | 31/87 |
| Deer | 144 | 50 | archery, rifle, muzzleloader | 36/144 |
| Turkey | 93 | 49 | spring, fall | 49/93 |
| Dove | 54 | 44 | regular, special-white-wing | 14/54 |

Missing: Goose=HI, Turkey=AK, Dove=AK/HI/ME/MA/NY/VT (no seasons).

## Build & Dev

```
npm run dev       # Vite dev server, port 8080
npm run build     # Production build -> dist/
npm run preview   # Serve production build locally
npm run test      # Vitest
```

## Database Tables (hunt_ prefix, shared Supabase project)

| Table | Purpose |
|-------|---------|
| hunt_species | Reference: species id, label, emoji, colors |
| hunt_states | Reference: abbreviation, name, fips, centroid, flyway |
| hunt_seasons | Season data: species, state, type, zone, dates, bag limit, verified |
| hunt_zones | Zone-to-county FIPS mapping |
| hunt_state_facts | 3 facts per species/state |
| hunt_regulation_links | State DNR URLs per species |
| hunt_weather_cache | Cached Open-Meteo forecasts |
| hunt_solunar_cache | Cached solunar/sunrise data |
| hunt_knowledge | **THE BRAIN** — Vector embeddings (512-dim) for semantic search |
| hunt_profiles | User profiles (auto-created on signup) |
| hunt_user_settings | User prefs, daily_query_count, tier |
| hunt_conversations | Chat history (user_id, session_id, role, content) |
| hunt_tasks | Token/cost tracking per query |
| hunt_migration_history | eBird sighting density per state/species/day (5 years) |
| hunt_weather_history | Daily weather aggregates per state (5 years) |
| hunt_user_locations | Saved hunting spots (future) |
| hunt_intel_briefs | AI-generated daily scout reports |
| hunt_convergence_scores | Hunt score 0-100 per state per day |
| hunt_convergence_alerts | Score spike alerts |
| hunt_solunar_precomputed | 365-day precomputed solunar data |
| hunt_nws_alerts | Filtered NWS severe weather alerts |
| hunt_weather_forecast | 16-day forecast per state (upserted daily by watchdog) |
| hunt_weather_events | Detected weather events (cold fronts, pressure drops, etc.) |
| hunt_cron_log | Cron execution log (function_name, status, summary, duration_ms) |

All tables have RLS. Service role bypasses for edge functions.

## Edge Functions (45+ total)

### Brain Writers (embed into hunt_knowledge)

| Function | Purpose | Schedule |
|----------|---------|----------|
| hunt-du-map | DU migration map pins -> embed | weekly Mon 12pm UTC |
| hunt-du-alerts | DU migration alert articles -> embed | weekly Mon 6am UTC |
| hunt-weather-watchdog | 50-state forecast (2 batches of 25) + hunting events -> embed | daily 6am UTC |
| hunt-weather-realtime | ASOS station monitoring (130 stations) for fronts/pressure/wind | every 15 min |
| hunt-migration-monitor | eBird spike detection (5 batches of 10 states) -> embed | daily 7:00-7:20 UTC |
| hunt-birdcast | BirdCast radar migration -> embed | daily 10am UTC |
| hunt-nasa-power | NASA POWER satellite data (2 batches of 25) -> embed | daily 6:30/6:33 UTC |
| hunt-nws-monitor | NWS filtered alerts -> embed | every 3hr |
| hunt-solunar-precompute | 365-day solunar calendar -> embed | weekly Sun 6am UTC |
| hunt-convergence-engine | 4-component scoring -> embed | daily 8am UTC |
| hunt-extract-patterns | Cross-ref migration+weather -> Sonnet extraction -> embed | manual |
| hunt-log | User interaction logging -> embed | on demand |
| hunt-power-outage | ODIN/DOE real-time power outage data by state -> embed | on demand |
| hunt-usfws-survey | USFWS Waterfowl Breeding Population Survey (WBPHS) data -> embed | on demand (annual) |

### Brain Graders (self-scoring)

| Function | Purpose | Schedule |
|----------|---------|----------|
| hunt-forecast-tracker | Forecast vs actual accuracy scoring -> embed | daily 10am UTC |
| hunt-migration-report-card | Convergence prediction grading -> embed | daily 11am UTC |
| hunt-convergence-report-card | Weekly convergence model performance -> embed | weekly Sun noon UTC |

### Brain Readers (search hunt_knowledge)

| Function | Purpose |
|----------|---------|
| hunt-dispatcher | Intent classify (Haiku) -> route to handler. Weather handler searches brain for pattern matches. |
| hunt-search | Hybrid vector + keyword search |
| hunt-alerts | Bulk forecast -> filter interesting -> vector search historical patterns -> scored alerts |

### Other Functions

| Function | Purpose |
|----------|---------|
| hunt-generate-embedding | Voyage AI 512-dim embedding (used by writers) |
| hunt-weather | Open-Meteo 3-day forecast with cache |
| hunt-solunar | Solunar + sunrise/sunset with cache |
| hunt-scout-report | Daily AI scout brief from convergence data (daily 9am UTC) |
| hunt-convergence-alerts | Score spike detection + notifications (daily 8:15am UTC) |
| hunt-cron-health | Cron health dashboard — queries hunt_cron_log per-function |
| hunt-drought-monitor | US Drought Monitor ingestion |
| hunt-inaturalist | iNaturalist observation ingestion |

All functions: `verify_jwt = false`, auth handled in code. Pin `supabase-js@2.84.0`, `std@0.168.0`.

All cron functions MUST import `logCronRun` from `_shared/cronLog.ts` and call it on EVERY exit path (success, error, AND early returns with no data). The `hunt-cron-health` endpoint depends on these logs.

## Data Pipeline

```
eBird Historical (5 years) + Open-Meteo Archive (5 years)
  -> hunt_migration_history + hunt_weather_history (45,300 rows)
  -> Claude Sonnet pattern extraction (scripts/extract-patterns.ts)
  -> Voyage AI embedding -> hunt_knowledge
  -> User asks weather question -> vector search finds matching patterns
  -> Claude responds with data-backed insights
```

### Scripts

| Script | What it does | How to run |
|--------|-------------|------------|
| `scripts/seed-knowledge.ts` | Embed state facts + reg links -> hunt_knowledge | `SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/seed-knowledge.ts` |
| `scripts/backfill-weather-history.ts` | 5 years Open-Meteo archive -> hunt_weather_history | `SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-weather-history.ts` (supports `START_STATE=TX`) |
| `scripts/backfill-ebird-history.ts` | 5 years eBird -> hunt_migration_history | `EBIRD_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-ebird-history.ts` (200 req/hr, supports `START_STATE`, `YEAR`) |
| `scripts/extract-patterns.ts` | Cross-ref migration+weather -> Sonnet extraction -> embed | `ANTHROPIC_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/extract-patterns.ts` |
| `scripts/orchestrator.ts` | Backfill pipe orchestrator, auto-sequences pipes | `npx tsx scripts/orchestrator.ts` |
| `scripts/run-daily-indices.sh` | Daily AO/NAO/PNA push (launchd at 7am) | `bash scripts/run-daily-indices.sh` |

## Data Sources

### Live & Integrated

| Source | Pipeline |
|--------|----------|
| eBird (Cornell Lab) | Live sightings on map + spike detection via hunt-migration-monitor |
| RainViewer | Live radar overlay (frontend only) |
| Open-Meteo | Live forecast (2x25 batch) + 5-year archive via hunt-weather-watchdog |
| ASOS/METAR | Real-time 130-station weather via hunt-weather-realtime (every 15 min) |
| NASA POWER | Satellite solar/cloud data via hunt-nasa-power |
| NWS API | Severe weather alerts via hunt-nws-monitor (every 3hr) |
| BirdCast | Radar migration intensity via hunt-birdcast |
| DU Migration | Map pins (hunt-du-map) + alert articles (hunt-du-alerts) |
| US Drought Monitor | Weekly drought severity via hunt-drought-monitor |
| iNaturalist | Deer/turkey/dove observations via hunt-inaturalist |
| Photoperiod | Daylight calculations (35K entries, backfill complete) |
| USGS Water | Water levels (19K entries, backfill partial) |
| NOAA Tides | Tide readings (17K entries, backfill partial) |
| NOAA ACIS | Climate normals (800 entries, backfill partial) |

### Ready to Build

USDA Crop Progress: DONE (17,824 entries). Great Lakes ice (GLERL), NOAA Snow Cover (SNODAS), CPC Temperature Outlooks, NASA NDVI, National Phenology Network, NIFC Active Fires, State DNR harvest reports.

### Deferred (Legal Risk)

DuckHuntingChat.com, Refuge Forums, Migration Station USA — use clean USFWS sources first.

## Disk Health Check

Run `df -h /` at session start, before big builds (3+ files/agents), every 5+ commits, and before deploys/pushes. If under 20GB: `sudo rm -rf /private/tmp/*`, re-verify, stop if still low.

## Rules

- Mobile-first. Every feature must work well on phones.
- Season data accuracy matters more than features. Wrong dates = useless site.
- Shareable. Every interaction should be easy to screenshot or share.
- When updating season data, also update middleware.ts state map for OG tags.
- When adding a new species or state, update sitemap.xml.
- Brand stays "DUCK COUNTDOWN" regardless of species selected.
- All hunt_ tables share Supabase project with JAC Agent OS — never touch JAC tables.
- Pin supabase-js to @2.84.0 in edge functions — unpinned @2 crashes Deno isolates.
- **NEVER run more than 1 backfill pipe at a time.** Supabase Pro ($20/mo) has limited disk IO burst budget. Running 2+ pipes depletes it and throttles the entire database — queries timeout, site goes unresponsive. One pipe, one at a time. When it finishes, start the next. Check Supabase dashboard IO before starting any backfill. After large deletes, VACUUM the table when IO has recovered.
- Never retry 4xx errors — only retry 5xx and network errors.
- Use `extensions.vector(512)` with `SET search_path = public, extensions` for vector ops.
- Shared module change -> redeploy every function that imports it.
- Migration push requires `migration repair --status reverted` for JAC's migrations first.
