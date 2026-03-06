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
      duck.ts             # 50 states, regular season
      goose.ts            # 10 states: regular + light goose conservation order
      deer.ts             # 10 states: archery + rifle + muzzleloader
      turkey.ts           # 10 states: spring + fall
      dove.ts             # 10 states: regular + special white-wing (TX)
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

| Species | States | Season Types | Verified |
|---------|--------|--------------|----------|
| Duck | 50 | regular | 0/50 |
| Goose | 10 | regular, conservation order | 0/10 |
| Deer | 10 | archery, rifle, muzzleloader | 0/10 |
| Turkey | 10 | spring, fall | 0/10 |
| Dove | 10 | regular, white-wing | 0/10 |

All data is `verified: false`. Verification against official state regulation pages is the priority.

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
