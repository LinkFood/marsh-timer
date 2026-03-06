# Duck Countdown — CLAUDE.md

Multi-species hunting season countdown platform. Interactive US map with countdown timers for Duck, Goose, Deer, Turkey, and Dove seasons across all 50 states. Mobile-first. Shareable. No accounts, no paywall.

**Domain:** duckcountdown.com
**Repo:** github.com/LinkFood/marsh-timer
**Hosting:** Vercel (static deploy + Edge Middleware for OG tags)
**Brand:** "DUCK COUNTDOWN" stays the brand regardless of selected species.

## Stack

| Layer | Tech |
|-------|------|
| Framework | React 18, TypeScript, Vite |
| Styling | Tailwind CSS |
| Map | D3 + TopoJSON (US Atlas CDN) |
| Animation | Framer Motion |
| Routing | React Router 6 (`/`, `/:species`, `/:species/:stateAbbr`) |
| Icons | Lucide React |
| Fonts | Playfair Display (headings), Lora (body) |
| OG Tags | Vercel Edge Middleware (`middleware.ts`) |

## Project Structure

```
src/
  components/
    Header.tsx            # Title + tagline (static, species-agnostic)
    SpeciesSelector.tsx   # Horizontal toggle bar: Duck | Goose | Deer | Turkey | Dove
    StatusBar.tsx         # "X States Open" / "Y Opening Soon" (species-filtered)
    SearchBar.tsx         # State search with autocomplete (species-filtered)
    USMap.tsx             # D3 interactive map (species-aware colors, no-data states)
    StateDetail.tsx       # State panel: season type tabs, split dates, verification badge, cross-species nav
    CountdownTimer.tsx    # Days/hours/min/sec display
    StateList.tsx         # Sorted list with favorites at top (species-filtered)
    FavoritesBar.tsx      # Horizontal pills (species-qualified: "duck:TX")
    Footer.tsx            # Disclaimer
  pages/
    Index.tsx             # Main page: parses species from URL, wires everything
    NotFound.tsx          # Themed 404
  data/
    types.ts              # Species, SeasonType, HuntingSeason, DateRange interfaces
    speciesConfig.ts      # Per-species metadata: colors, emoji, season types
    fips.ts               # FIPS <-> abbreviation maps for D3
    seasons/
      duck.ts             # 50 states, 104 entries (regular + early-teal, zone-level)
      goose.ts            # 49 states, 87 entries (regular + light goose conservation order)
      deer.ts             # 50 states, 144 entries (archery + rifle + muzzleloader)
      turkey.ts           # 49 states, 93 entries (spring + fall)
      dove.ts             # 44 states, 54 entries (regular + special white-wing)
      index.ts            # Merge helpers: getSeasonsForSpecies, getPrimarySeasonForState, etc.
    stateFacts.ts         # Record<Species, Record<StateName, string[]>>
    regulationLinks.ts    # Record<Species, Record<Abbr, string>>
  lib/
    seasonUtils.ts        # Status calc, countdown, sorting (works with dates[] arrays)
  hooks/
    useFavorites.ts       # localStorage favorites, species-qualified ("duck:TX"), migrates legacy
middleware.ts             # Vercel Edge Middleware: species-aware OG tags, /TX -> /duck/TX 301
vercel.json               # SPA rewrites
public/
  sitemap.xml             # Species-prefixed URLs
  robots.txt              # Sitemap reference
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

## Rules

- Mobile-first. Every feature must work well on phones.
- Keep it simple. No accounts, no backend.
- Season data accuracy matters more than features. Wrong dates = useless site.
- Shareable. Every interaction should be easy to screenshot or share via link/text.
- When updating season data, also update the middleware.ts state map for OG tags.
- When adding a new species or state, update the sitemap.xml.
- Brand stays "DUCK COUNTDOWN" regardless of species selected.

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
