# Duck Countdown — CLAUDE.md

## The Thesis

Hunting is math. Duck Countdown is wildlife OSINT — an embedding system that fuses every public data source affecting animal movement into one vector space. The pipeline IS the product. The LLM is the mouth, not the brain. Data is the permanent asset, models are replaceable.

**THE EMBEDDING LAW:** Every piece of data that enters the system MUST be embedded via Voyage AI -> hunt_knowledge. No exceptions. Every cron output, every weather pattern, every user log, every ingested document. The embedding pipeline only grows — never shrinks, never skips. If data isn't being embedded, that's a bug. This is the core competitive moat.

## How the Brain Works

Ingest -> Embed -> Store -> Search/Alert (same operation, different triggers).

- **Search** = user pulls from the brain.
- **Alerts** = incoming data pushes against the brain.

Same RPC, same filters, same vector space. When a cold front hits Arkansas, the ingest function doesn't just embed and store — it immediately queries the brain: "what happened the last time these conditions aligned?" If the pattern match is strong, it fires an alert. The brain reacts to new data in real time, not just when a user asks.

**Show Don't Predict:** The system draws conclusions from data and cites sources. It never says "it WILL happen." It says "the last N times these conditions aligned, here's what happened."

## Brain State

~103K entries in hunt_knowledge (DU separation complete — 0 du_report remaining). Heading to 1M+.
- Weather events, migration spikes, NWS alerts, NASA POWER, solunar, convergence scores, birdcast, facts, regulations, species behavioral knowledge (152 entries across 39 waterfowl + deer/turkey/dove)
- IVFFlat index working. Search returns species knowledge.
- Brain honesty: chat splits into "FROM THE BRAIN" (cyan, cards) + "AI INTERPRETATION" (LLM text)
- 15 crons active, convergence engine running daily
- Backfill pipes in progress: eBird, USDA crops, USGS water, NOAA tides, NOAA ACIS, photoperiod
- Pattern extraction pending (needs eBird backfill to complete first — the big unlock)

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
  components/
    TerminalShell.tsx        # Layout orchestrator — ticker, tabs, brain panel, canvas area
    LiveTicker.tsx           # Scrolling live feed — convergence, weather, NWS, hunt alerts, migration index
    CanvasTabs.tsx           # Canvas tab bar — Map/Data/History/Screener (desktop top, mobile bottom + Brain)
    BrainPanel.tsx           # Left panel (320px) — chat + collapsible intel drawer with season info
    MapView.tsx              # Map command center — see file for full layer list
    HeaderBar.tsx            # Brand + species pills + search + UserMenu
    Sidebar.tsx              # RETIRED — replaced by BrainPanel (kept for reference)
    MobileSheet.tsx          # RETIRED — replaced by mobile CanvasTabs + brain overlay (kept for reference)
    NationalView.tsx         # State cards + off-season intel (rendered in BrainPanel intel drawer)
    StateView.tsx            # State detail: season tabs, facts, reg links (rendered in BrainPanel intel drawer)
    ZoneView.tsx             # Zone detail (rendered in BrainPanel intel drawer)
    MapPresets.tsx            # Map mode selector + toggles
    HotspotRanking.tsx       # Top 10 states by convergence (rendered in BrainPanel intel drawer)
    ScoutReport.tsx          # Daily AI scout brief (rendered in BrainPanel intel drawer)
    HuntChat.tsx / ChatInput.tsx / ChatMessage.tsx  # Chat UI (rendered in BrainPanel)
    MapPopup.tsx / SightingPopup.tsx  # Map popups
    TimelineScrubber.tsx     # Time machine: 30d back / 7d forward
    MapLegend.tsx            # Contextual floating legend
    HuntAlerts.tsx           # Proactive weather alerts (shown in LiveTicker)
    cards/                   # ConvergenceCard, WeatherCard, SeasonCard, SolunarCard, AlertCard
  pages/
    Index.tsx                # Main page: map + header + terminal shell (all hooks live here)
    Auth.tsx                 # Google OAuth sign-in
    NotFound.tsx             # Themed 404
  data/                      # types.ts, speciesConfig.ts, fips.ts, flyways.ts, seasons/,
                             # stateFacts.ts, regulationLinks.ts, flywayPaths.ts
  lib/                       # seasonUtils.ts, isobars.ts, terminator.ts, migrationFront.ts,
                             # supabase.ts, ebird.ts
  hooks/                     # useAuth, useChat, useHuntContext, useFavorites, useRadarTiles,
                             # useEBirdMapSightings, useHuntAlerts, useNationalWeather,
                             # useConvergenceScores, useScoutReport, useConvergenceAlerts,
                             # useSolunar, useNWSAlerts, useMigrationFront, useIsMobile
supabase/
  functions/
    _shared/                 # cors.ts, response.ts, supabase.ts, auth.ts, anthropic.ts, rateLimit.ts
    hunt-dispatcher/         # THE BRAIN: intent classify + route (Haiku)
    hunt-search/             # Hybrid vector + keyword search
    hunt-generate-embedding/ # Voyage AI 512-dim embedding
    hunt-weather/            # Open-Meteo weather with cache
    hunt-solunar/            # Solunar + sunrise with cache
    hunt-alerts/             # Proactive weather alerts + pattern matching
  migrations/                # SQL migrations
  config.toml                # Function configs (all verify_jwt = false)
scripts/                     # seed-knowledge.ts, backfill-weather-history.ts, backfill-ebird-history.ts, extract-patterns.ts
middleware.ts                # Vercel Edge Middleware: OG tags, legacy redirects
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

5 species (Duck 50 states, Goose/Deer/Turkey/Dove 10 each). Species selector in header. Bloomberg-style terminal layout: live ticker → canvas tabs → brain panel (320px left, chat + intel drawer) + canvas area (map default, Data/History/Screener coming). Mobile: bottom tab bar with Brain overlay. Convergence heatmap colors states by hunt score 0-100. Hotspot ranking (top 10). Daily AI scout report. Per-state convergence card with component breakdown + rank. Season type tabs, split season dates, verification badges. Cross-species nav links. Per-species map colors. Species-qualified favorites. Legacy URL redirects. Species-aware OG tags.

Map layers: convergence heatmap, weather radar, eBird sightings (clusters + heatmap), pressure isobars, NWS alert polygons, dawn/dusk terminator, flyway corridors, migration front line, convergence hotspots, wind flow lines, time machine scrubber, elevation HUD, location search. See `MapView.tsx` for full layer implementation.

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

All tables have RLS. Service role bypasses for edge functions.

## Edge Functions

### Brain Writers (embed into hunt_knowledge)

| Function | Purpose | Schedule |
|----------|---------|----------|
| hunt-du-map | DU migration map pins -> embed | cron |
| hunt-du-alerts | DU migration alert articles -> embed | cron |
| hunt-weather-watchdog | 50-state forecast + hunting events -> embed | daily 0 6 * * * |
| hunt-migration-monitor | eBird spike detection -> embed | 0-20/5 7 * * * |
| hunt-birdcast | BirdCast radar migration -> embed | cron |
| hunt-nasa-power | NASA POWER satellite data -> embed | daily 30/33 6 * * * |
| hunt-nws-monitor | NWS filtered alerts -> embed | every 3hr |
| hunt-solunar-precompute | 365-day solunar calendar -> embed | weekly |
| hunt-convergence-engine | 4-component scoring -> embed | daily 0 8 * * * |
| hunt-extract-patterns | Cross-ref migration+weather -> Sonnet extraction -> embed | manual |
| hunt-log | User interaction logging -> embed | on demand |

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
| hunt-scout-report | Daily AI scout brief from convergence data (0 9 * * *) |
| hunt-convergence-alerts | Score spike detection + notifications (15 8 * * *) |

All functions: `verify_jwt = false`, auth handled in code. Pin `supabase-js@2.84.0`, `std@0.168.0`.

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

## Data Sources

### Tier 1 — Live & Integrated

| Source | Pipeline |
|--------|----------|
| eBird (Cornell Lab) | Live sightings on map + historical backfill via hunt-migration-monitor |
| RainViewer | Live radar overlay (frontend only) |
| Open-Meteo | Live forecast + 5-year archive via hunt-weather-watchdog |
| NASA POWER | Satellite solar/cloud data via hunt-nasa-power |
| NWS API | Severe weather alerts via hunt-nws-monitor |

### Tier 2 — Ready to Build

DU Migration Alerts (JSON, no auth, READY), USFWS Flyway Data Books / Breeding Survey / HIP Harvest (PDF, public domain, READY), BirdCast Radar + DU Migration Map (undocumented APIs, NEEDS RECON).

### Tier 3 — Deferred (Legal Risk)

DuckHuntingChat.com, Refuge Forums, Migration Station USA — all deferred. Use clean USFWS sources first.

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
