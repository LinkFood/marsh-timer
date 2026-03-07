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
    MapView.tsx           # Mapbox GL: satellite, 3D terrain, state fills, county boundaries, flyways
    HeaderBar.tsx         # Brand + species pills + search + UserMenu
    BottomPanel.tsx       # Collapsible: card row + HuntChat split layout
    NationalView.tsx      # Horizontal scroll state cards (open/soon/closed)
    StateView.tsx         # State detail: season tabs, facts, regulation links
    ZoneView.tsx          # Zone detail for drilled-in state
    MapControls.tsx       # Zoom, geolocate, satellite, 3D, flyway toggles
    LiveTicker.tsx        # Scrolling ticker below header
    UserMenu.tsx          # Avatar dropdown (sign in / sign out)
    HuntChat.tsx          # Chat container: 50/50 desktop split, stacked mobile
    ChatInput.tsx         # Chat input with auth gate
    ChatMessage.tsx       # User/assistant message bubbles with card embedding
    ChatContextPanel.tsx  # Right panel: state seasons context
    cards/
      WeatherCard.tsx     # 3-day forecast, wind, precip
      SeasonCard.tsx      # Season status, dates, bag limit
      SolunarCard.tsx     # Moon phase, feeding times, rating
      AlertCard.tsx       # Season alerts, countdowns
  pages/
    Index.tsx             # Main page: map + header + bottom panel + controls
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
    ebird.ts              # eBird API helpers
  hooks/
    useAuth.ts            # Session, user, profile, signIn, signOut
    useChat.ts            # Messages, sendMessage, loading, conversation persistence
    useHuntContext.ts     # Aggregated season context for chat panel
    useFavorites.ts       # localStorage favorites, species-qualified
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
- **Species selector** — Horizontal toggle with open-state counts
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
| hunt_user_locations | Saved hunting spots (future) |
| hunt_intel_briefs | AI-generated hunt briefs (future) |

All tables have RLS. Service role bypasses for edge functions.

## Edge Functions

| Function | Purpose |
|----------|---------|
| hunt-dispatcher | Intent classification (Haiku) → route to handler → respond with text + cards |
| hunt-search | Hybrid search: vector (hunt_knowledge RPC) + keyword (seasons/facts) |
| hunt-generate-embedding | Voyage AI voyage-3-lite (512-dim) |
| hunt-weather | Open-Meteo 3-day forecast with cache |
| hunt-solunar | Solunar + sunrise/sunset with cache |

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

## Future: Migration Data APIs

Live migration data is the killer feature that would make DuckCountdown genuinely more useful than anything else out there for hunters. The integration path: eBird for live sightings, BirdCast for radar overlays, USFWS for flyway boundaries.

### Tier 1 — Realistic Integration Targets

| Source | What It Provides | API? | Auth? |
|--------|-----------------|------|-------|
| **eBird** (Cornell Lab) | Real-time bird sighting data — hotspots, recent observations, species locations with GPS coordinates. Could power "mallards reported in your county this week" on the map. | Yes, REST API | Free, API key required |
| **BirdCast** (Cornell + Colorado State) | Forecast migration maps (predicted intensity/timing) + live radar-based maps showing real-time nocturnal migration activity at county/state level. "Birds moving tonight" overlay potential. | Dashboard + data feeds | Free |
| **USFWS Flyway Boundaries** | Official flyway boundary shapefiles via ArcGIS REST API. Draw flyway overlays on the D3 map. | ArcGIS REST endpoint | Free, no auth |
| **USFWS Waterfowl Survey** | Annual population estimates for 19 duck species from the Breeding Population and Habitat Survey (May/June). This is the data that sets hunting regulations. Published as annual status reports. | PDF reports, some data feeds | Free |

### Tier 2 — Watch List (No Public API Yet)

| Source | What It Provides | Why It Matters |
|--------|-----------------|----------------|
| **Ducks Unlimited Migration Map** | Real-time waterfowl concentration reports from DU biologists, field editors, and hunters. | Most hunter-specific data out there. If they ever open an API, it's perfect for a hunt reports feature. |
| **Migration Station** | Aggregated real waterfowl count data from WMAs and refuges, updated Oct-Jan. Answers "where are the ducks?" | Great data, no API. Worth monitoring for changes. |
| **Movebank** (Max Planck Institute) | Animal tracking database. Powers the Audubon Bird Migration Explorer (458 species, migratory routes across Americas). | Research-grade, deep data. More academic than practical for hunters but the route visualization data is rich. |

### Integration Priority
1. USFWS flyway boundary GeoJSON → map overlay (easiest, most visual impact)
2. eBird API → live sightings by county on state detail pages
3. BirdCast → "birds moving tonight" radar overlay on the map
