# Duck Countdown — CLAUDE.md

Fun, free site for duck hunters. Interactive US map with countdown timers to every state's duck season. Mobile-first. Shareable. No accounts, no paywall.

**Domain:** duckcountdown.com
**Repo:** github.com/LinkFood/marsh-timer
**Hosting:** Vercel (static deploy + Edge Middleware for OG tags)

## Stack

| Layer | Tech |
|-------|------|
| Framework | React 18, TypeScript, Vite |
| Styling | Tailwind CSS |
| Map | D3 + TopoJSON (US Atlas CDN) |
| Animation | Framer Motion |
| Routing | React Router 6 (`/` + `/:stateAbbr`) |
| Icons | Lucide React |
| Fonts | Playfair Display (headings), Lora (body) |
| OG Tags | Vercel Edge Middleware (`middleware.ts`) |

## Project Structure

```
src/
  components/
    Header.tsx          # Title + tagline
    StatusBar.tsx       # "X States Open" / "Y Opening Soon" pills
    SearchBar.tsx       # State search with autocomplete
    USMap.tsx           # D3 interactive map (touch-aware, color-coded)
    StateDetail.tsx     # Selected state panel (countdown, facts, share, favorite, regulations)
    CountdownTimer.tsx  # Days/hours/min/sec display
    StateList.tsx       # Sorted list with favorites at top
    FavoritesBar.tsx    # Horizontal pills of favorited states above map
    Footer.tsx          # Disclaimer
  pages/
    Index.tsx           # Main page layout + routing + favorites wiring
    NotFound.tsx        # Themed 404
  data/
    seasonData.ts       # DuckSeason[] — all 50 state season dates + bag limits
    stateFacts.ts       # Fun facts per state (3 each, all 50 states)
    regulationLinks.ts  # Links to official state wildlife agency regulation pages
  lib/
    seasonUtils.ts      # Status calc, countdown, sorting
  hooks/
    useFavorites.ts     # localStorage favorites (max 5 states)
middleware.ts           # Vercel Edge Middleware — injects state-specific OG meta tags
vercel.json             # SPA rewrites for client-side routing
public/
  sitemap.xml           # All 50 state routes
  robots.txt            # Sitemap reference
```

## Features

- **50-state coverage** — All states with 2025-2026 season data
- **State routes** — Deep links: `/TX`, `/CA`, etc. (case-insensitive)
- **Favorites** — Star up to 5 states, persisted in localStorage
- **Web Share API** — Native share on mobile, clipboard fallback on desktop
- **OG meta tags** — State-specific previews when sharing links (via Edge Middleware)
- **Regulation links** — Direct links to each state's official waterfowl regulations
- **Touch-optimized map** — No tooltips on touch devices, tap-to-select
- **Accessibility** — `prefers-reduced-motion` disables grain overlay

## Data Model

```typescript
interface DuckSeason {
  state: string;          // "Alabama"
  abbreviation: string;   // "AL"
  zone: string;           // "South Zone"
  flyway: string;         // "Mississippi" | "Pacific" | "Atlantic" | "Central"
  bagLimit: number;       // Daily bag limit (6-7)
  seasonOpen: string;     // ISO date "2025-11-22"
  seasonClose: string;    // ISO date "2026-01-30"
  notes?: string;         // Split season info, special notes
}
```

**Season statuses:** open, soon (<30 days), upcoming (30-90 days), closed
**Map colors:** Green (open), Amber (soon), Dark green (upcoming), Dark gray (closed), Gold (selected)

## Season Data

All season data lives in `src/data/seasonData.ts`. Hardcoded for 2025-2026.
Middleware duplicates state names/dates in a lightweight map for OG tags — update both when season changes.
Data changes annually — each state publishes new dates/limits, usually by summer.

## Build & Dev

```
npm run dev       # Vite dev server, port 8080
npm run build     # Production build -> dist/
npm run preview   # Serve production build locally
npm run test      # Vitest
```

## Design

- Dark theme: deep green/black backgrounds with gold/green accents
- Hunting/marsh aesthetic with grain overlay (disabled on reduced-motion)
- Serif typography (Playfair + Lora)
- Animations: fade-in headers, slide-up details, cascading list rows
- Mobile-first: responsive grid, touch-friendly map, 44px+ touch targets

## Rules

- Mobile-first. Every feature must work well on phones.
- Keep it simple. No accounts, no backend.
- Season data accuracy matters more than features. Wrong dates = useless site.
- Shareable. Every interaction should be easy to screenshot or share via link/text.
- When updating season data, also update the middleware.ts state map.
