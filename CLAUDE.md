# Duck Countdown — CLAUDE.md

Hunting OS — "Google for Hunting." Interactive Mapbox GL map with AI chat brain, auth, embedding pipeline, and season data for Duck, Goose, Deer, Turkey, and Dove across all 50 states.

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
    MapView.tsx           # Mapbox GL: satellite, 3D terrain, globe projection, state fills, county boundaries, flyways, mode-driven overlays (wetlands, waterways, contours, temp heatmap, convergence heatmap, wind arrows, radar)
    HeaderBar.tsx         # Brand + species pills + search + UserMenu
    Sidebar.tsx           # Desktop left sidebar (340px expanded / 48px collapsed) with Intel/Chat/Alerts tabs
    MobileSheet.tsx       # Mobile bottom sheet with drag-snap (peek/half/full)
    NationalView.tsx      # Horizontal scroll state cards (open/soon/closed) + off-season intel (next season countdown, weather alerts, scouting conditions)
    StateView.tsx         # State detail: season tabs, facts, regulation links
    ZoneView.tsx          # Zone detail for drilled-in state
    MapPresets.tsx         # Map mode selector (Default/Scout/Weather/Terrain/Intel) + utility toggles (3D, Satellite, Flyways) + zoom/geolocate
    HotspotRanking.tsx    # "Where to Hunt Today" — top 10 states by convergence score
    ScoutReport.tsx       # Daily AI scout brief with collapsible sections
    LiveTicker.tsx        # Scrolling ticker below header
    UserMenu.tsx          # Avatar dropdown (sign in / sign out)
    HuntChat.tsx          # Chat container: full-width in sidebar tab
    ChatInput.tsx         # Chat input with auth gate
    ChatMessage.tsx       # User/assistant message bubbles with card embedding
    MapPopup.tsx          # Hover popup: state name, season status, dates, convergence score (HTML string gen)
    HuntAlerts.tsx        # Proactive weather alerts: national scroll strip + state banner
    cards/
      ConvergenceCard.tsx # Hunt score breakdown: 0-100 with 4 component bars + national rank
      WeatherCard.tsx     # 3-day forecast, wind, precip
      SeasonCard.tsx      # Season status, dates, bag limit
      SolunarCard.tsx     # Moon phase, feeding times, rating
      AlertCard.tsx       # Season alerts, countdowns
  pages/
    Index.tsx             # Main page: map + header + sidebar (desktop) / mobile sheet + controls
    Auth.tsx              # Google OAuth sign-in page
    NotFound.tsx          # Themed 404
  data/
    types.ts              # Species, SeasonType, HuntingSeason, DateRange interfaces
    speciesConfig.ts      # Per-species metadata: colors, emoji, season types
    fips.ts               # FIPS <-> abbreviation maps
    flyways.ts            # State-to-flyway mapping, flyway colors
    seasons/              # Per-species static data (duck, goose, deer, turkey, dove)
    stateFacts.ts         # 576 facts across all species
    regulationLinks.ts    # State DNR URLs per species
  lib/
    seasonUtils.ts        # Status calc, countdown, sorting
    supabase.ts           # Supabase client (conditional on env vars)
    ebird.ts              # eBird API helpers (fetchRecentSightings, fetchGeoSightings)
  hooks/
    useAuth.ts            # Session, user, profile, signIn, signOut
    useChat.ts            # Messages, sendMessage, loading, conversation persistence
    useHuntContext.ts     # Aggregated season context for chat
    useFavorites.ts       # localStorage favorites, species-qualified
    useRadarTiles.ts      # RainViewer radar tile URL, 5-min refresh
    useEBirdMapSightings.ts # Geo sightings → GeoJSON FeatureCollection, recency-tagged
    useHuntAlerts.ts      # Proactive weather alerts from hunt-alerts edge function, hourly refresh
    useNationalWeather.ts # Bulk Open-Meteo current weather for all 50 states
    useConvergenceScores.ts # Convergence scores for all 50 states, 30-min refresh
    useScoutReport.ts     # Latest daily scout brief from hunt_intel_briefs, 60-min refresh
    useConvergenceAlerts.ts # Convergence score spike alerts, 30-min refresh
    useSolunar.ts         # Solunar data via hunt-solunar edge function (TanStack Query)
    useIsMobile.ts        # Responsive breakpoint detection
supabase/
  functions/
    _shared/
      cors.ts             # CORS (duckcountdown.com origins)
      response.ts         # successResponse / errorResponse helpers
      supabase.ts         # createSupabaseClient (service role)
      auth.ts             # extractUserId, createServiceClient, isServiceRoleRequest
      anthropic.ts        # callClaude, parseToolUse, calculateCost
      rateLimit.ts        # Daily query rate limiting
    hunt-dispatcher/      # THE BRAIN: intent classify + route (Haiku)
    hunt-search/          # Hybrid vector + keyword search
    hunt-generate-embedding/ # Voyage AI 512-dim embedding
    hunt-weather/         # Open-Meteo weather with cache
    hunt-solunar/         # Solunar + sunrise with cache
    hunt-alerts/          # Proactive weather alerts: bulk forecast → filter interesting → vector search patterns
  migrations/             # SQL migrations
  config.toml             # Function configs (all verify_jwt = false)
scripts/
  seed-knowledge.ts       # Embed state facts + regs into hunt_knowledge
middleware.ts             # Vercel Edge Middleware: OG tags, legacy redirects
docs/
  SETUP-{1-7}*.md         # Setup guides for Google OAuth, Supabase config, testing
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
  dates: DateRange[];      // Array handles split seasons (e.g., AR duck = 3 segments)
  bagLimit: number;
  flyway?: string;         // Waterfowl only
  weapon?: string;         // "Bow", "Rifle", "Shotgun"
  notes?: string;
  verified: boolean;       // Manually verified against state regs?
  sourceUrl?: string;      // Link to official regulation page
  seasonYear: string;      // "2025-2026"
}
```

**Key design decisions:**
- `dates: DateRange[]` solves split seasons
- `verified: boolean` — unverified data shows yellow warning badge
- Per-species data files prevent merge conflicts
- Species-first URLs: `/duck/TX` not `/TX/duck`

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

- **5 species** — Duck (50 states), Goose (10), Deer (10), Turkey (10), Dove (10)
- **Species selector** — Horizontal toggle in header
- **Left sidebar (desktop)** — Tabbed Intel/Chat/Alerts, collapsible to 48px icon strip
- **Mobile bottom sheet** — Drag-snap (peek 15% / half 45% / full 90%)
- **Convergence heatmap** — Intel mode colors states gray→blue→yellow→orange→red by hunt score (0-100)
- **Hotspot ranking** — "Where to Hunt Today" top 10 states by convergence score
- **Scout report** — Daily AI-generated brief with collapsible sections
- **Convergence card** — Per-state score breakdown (weather/solunar/migration/pattern) + national rank
- **Season type tabs** — Archery/Rifle/Muzzleloader for deer, Spring/Fall for turkey, etc.
- **Split season dates** — Shows all date ranges, countdown targets the next one
- **Verification badges** — Green check (verified) or yellow warning (unverified)
- **Cross-species nav** — "Also in Texas: Deer, Turkey" links in state detail
- **Per-species map colors** — Each species has its own color palette
- **Species-qualified favorites** — "duck:TX" format, migrates legacy "TX" format
- **Legacy URL support** — `/TX` 301s to `/duck/TX`
- **Species-aware OG tags** — Title/description change per species in middleware

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

Missing states: Goose=HI (no season), Turkey=AK (no season), Dove=AK/HI/ME/MA/NY/VT (no season).
Data sourced from state DNR websites via CSV import. Unverified entries show yellow warning badge.

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
| hunt_knowledge | Vector embeddings (512-dim) for semantic search |
| hunt_profiles | User profiles (auto-created on signup) |
| hunt_user_settings | User prefs, daily_query_count, tier |
| hunt_conversations | Chat history (user_id, session_id, role, content) |
| hunt_tasks | Token/cost tracking per query |
| hunt_migration_history | eBird sighting density per state/species/day (5 years) |
| hunt_weather_history | Daily weather aggregates per state (5 years, Open-Meteo archive) |
| hunt_user_locations | Saved hunting spots (future) |
| hunt_intel_briefs | AI-generated daily scout reports |
| hunt_convergence_scores | Hunt score 0-100 per state per day (weather+solunar+migration+pattern) |
| hunt_convergence_alerts | Score spike alerts when convergence jumps significantly |
| hunt_solunar_precomputed | 365-day precomputed solunar data (Meeus lunar math) |
| hunt_nws_alerts | Filtered NWS severe weather alerts |

All tables have RLS. Service role bypasses for edge functions.

## Edge Functions

| Function | Purpose |
|----------|---------|
| hunt-dispatcher | Intent classification (Haiku) → route to handler → respond with text + cards. Weather handler includes live pattern matching via vector search. Search handler uses hybrid vector + keyword. |
| hunt-search | Hybrid search: vector (hunt_knowledge RPC) + keyword (seasons/facts) |
| hunt-generate-embedding | Voyage AI voyage-3-lite (512-dim) |
| hunt-weather | Open-Meteo 3-day forecast with cache |
| hunt-solunar | Solunar + sunrise/sunset with cache |
| hunt-alerts | Proactive weather alerts: bulk Open-Meteo forecast for 50 states → filter interesting conditions → vector search historical patterns → scored alerts with severity |
| hunt-weather-watchdog | Daily 50-state Open-Meteo forecast + hunting events + embed (cron 0 6 * * *) |
| hunt-nws-monitor | NWS filtered alerts every 3 hours (cron 0 */3 * * *) |
| hunt-nasa-power | NASA POWER satellite data → weather history (cron 30/33 6 * * *) |
| hunt-solunar-precompute | Meeus lunar math → 365-day solunar calendar (cron weekly) |
| hunt-migration-monitor | eBird spike detection across 5 batches (cron 0-20/5 7 * * *) |
| hunt-convergence-engine | 4-component scoring → 0-100 per state per day (cron 0 8 * * *) |
| hunt-scout-report | Daily AI scout brief from convergence data (cron 0 9 * * *) |
| hunt-convergence-alerts | Score spike detection + notifications (cron 15 8 * * *) |

All functions: `verify_jwt = false`, auth handled in code. Pin `supabase-js@2.84.0`, `std@0.168.0`.

## Rules

- Mobile-first. Every feature must work well on phones.
- Season data accuracy matters more than features. Wrong dates = useless site.
- Shareable. Every interaction should be easy to screenshot or share via link/text.
- When updating season data, also update the middleware.ts state map for OG tags.
- When adding a new species or state, update the sitemap.xml.
- Brand stays "DUCK COUNTDOWN" regardless of species selected.
- All hunt_ tables share Supabase project with JAC Agent OS — never touch JAC tables.
- Pin supabase-js to @2.84.0 in edge functions — unpinned @2 crashes Deno isolates.
- Never retry 4xx errors — only retry 5xx and network errors.
- Use `extensions.vector(512)` with `SET search_path = public, extensions` for vector ops.
- Shared module change → redeploy every function that imports it.
- Migration push requires `migration repair --status reverted` for JAC's migrations first.

## Map Intelligence Layer

| Feature | Source | Implementation |
|---------|--------|----------------|
| Convergence heatmap | `hunt_convergence_scores` table | `useConvergenceScores.ts` → MapView intel mode fills states gray→blue→yellow→orange→red by 0-100 score |
| Hotspot ranking | `hunt_convergence_scores` table | `useConvergenceScores.ts` → `HotspotRanking.tsx` top 10 states in sidebar Intel tab |
| Scout report | `hunt_intel_briefs` table | `useScoutReport.ts` → `ScoutReport.tsx` collapsible daily brief in sidebar Intel tab |
| Convergence card | `hunt_convergence_scores` table | `ConvergenceCard.tsx` — 4 component bars + rank when state selected |
| Weather radar overlay | RainViewer API (free, no auth) | `useRadarTiles.ts` → raster layer, 5-min refresh, CloudRain toggle |
| 3D camera drill-in | Mapbox GL | pitch 45, bearing -15 on state select, fog at distance |
| State info popups | Local season data + convergence | `MapPopup.tsx` → hover popup with status dot + dates + hunt score (desktop) |
| eBird live sightings | eBird Geo API (`VITE_EBIRD_API_KEY`) | `useEBirdMapSightings.ts` → circle markers, green/amber/dim by recency, zoom 6+ |
| Proactive weather alerts | Open-Meteo bulk + hunt_knowledge vectors | `hunt-alerts` edge fn → `useHuntAlerts.ts` → `HuntAlerts.tsx` (national scroll strip + state banner) |
| Map overlay layers | Mapbox streets-v8 + terrain-v2 tilesets | Mode-driven: wetlands, waterways, contours, land cover, agriculture, parks, trails |
| Elevation HUD | Mapbox `queryTerrainElevation` | Client-side, shows ft when 3D on + zoom > 8, shifts right when sidebar expanded |
| Location search | Mapbox Geocoding API v5 | `HeaderBar.tsx` → zip/address/city → flyTo zoom 15 with 3D terrain pitch |

## Data Pipeline (The Moat)

```
eBird Historical (5 years) + Open-Meteo Archive (5 years)
  → hunt_migration_history + hunt_weather_history (45,300 rows)
  → Claude Sonnet pattern extraction (scripts/extract-patterns.ts)
  → Voyage AI embedding → hunt_knowledge
  → User asks weather question → vector search finds matching patterns
  → Claude responds with data-backed insights
```

### Scripts

| Script | What it does | How to run |
|--------|-------------|------------|
| `scripts/seed-knowledge.ts` | Embed state facts + reg links → hunt_knowledge | `SUPABASE_SERVICE_ROLE_KEY=... VOYAGE_API_KEY=... npx tsx scripts/seed-knowledge.ts` |
| `scripts/backfill-weather-history.ts` | 5 years Open-Meteo archive → hunt_weather_history | `SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-weather-history.ts` (supports `START_STATE=TX`) |
| `scripts/backfill-ebird-history.ts` | 5 years eBird observations → hunt_migration_history | `EBIRD_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill-ebird-history.ts` (200 req/hr, supports `START_STATE`, `YEAR`) |
| `scripts/extract-patterns.ts` | Cross-reference migration+weather → Sonnet pattern extraction → embed | `ANTHROPIC_API_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/extract-patterns.ts` (run after both backfills) |

## Future Data Sources

### Tier 1 — Integrated or In Progress

| Source | Status |
|--------|--------|
| **eBird** (Cornell Lab) | Live sightings on map + historical backfill running |
| **RainViewer** | Live radar overlay on map |
| **Open-Meteo** | Live forecast via hunt-weather + 5-year archive backfilled |

### Tier 2 — Watch List

| Source | What It Provides |
|--------|-----------------|
| **BirdCast** (Cornell + Colorado State) | Forecast migration intensity + live radar-based nocturnal migration |
| **USFWS Waterfowl Survey** | Annual population estimates (sets regulations) |
| **Ducks Unlimited Migration Map** | Real-time waterfowl concentration reports (no API yet) |
| **Migration Station** | WMA/refuge waterfowl counts Oct-Jan (no API yet) |
