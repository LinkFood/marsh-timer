---
name: UX Architecture Brainstorm — March 27, 2026
description: 8 concrete UX architecture proposals for Duck Countdown front door problem. Intelligence Page vs Workbench vs new patterns. Each proposal includes routing, flow, 5-sec impression, mobile, trade-offs. Recommended sequence: Swap (ship now) -> Cascade state pages -> Radar Scope merger -> Newsroom arc feed.
type: project
---

## Context
Duck Countdown has a front door problem. 2.4M+ brain entries, 42 crons, 48 arcs — but new visitors land on a 25-panel workbench with 27 map layers. The Intelligence Page (3-column command center showing the brain thinking) IS the product but lives at `/intelligence`, hidden behind a Brain icon.

## 8 Proposals Generated

1. **The Swap** — Swap `/` and `/intelligence` routes. Intel becomes landing page, workbench moves to `/map`. Minimal code change. Ship immediately.
2. **The Vestibule** — New minimal landing page at `/`. SVG mini-map with convergence-colored states + active arc cards + two buttons (Intelligence Center, Open Map). The "what is this?" answer.
3. **The Flip** — Single page with INTEL/MAP tabs. Shared state selection. Mapbox lazy-loads. Bloomberg LAUNCHPAD feel. Complex state management.
4. **The Cascade** — Progressive disclosure: overview (`/`) -> state page (`/TX` with mini-map + arc narrative) -> full map (`/map`). Editorial product pattern. Best for shareability.
5. **The Terminal** — Side-by-side: Intel left 40%, Map right 60%. Panels opt-in. Full Bloomberg. Heavy refactor.
6. **The Newsroom** — Arc-first feed at `/`. Story cards sorted by intensity. Each arc is a shareable URL. Best mobile UX. Requires synthesis agent quality. Best viral potential.
7. **The Skin** — Same URL, density toggle (OVERVIEW/DETAIL/MAP). localStorage remembers preference. Progressive disclosure without progressive URLs.
8. **The Radar Scope** — Map with collapsible intelligence sidebar. Sidebar expands from 280px to 50% to 100%. Mobile = bottom sheet. Most cinematic. Best final form.

## Recommended Sequence
1. Ship tomorrow: **The Swap** (Proposal 1) — 2 hours, massive UX improvement
2. Build next week: **The Cascade** state pages (Proposal 4) — shareable `/TX` URLs
3. Build next month: **The Radar Scope** sidebar (Proposal 8) — merged surfaces
4. Build when arcs are rich: **The Newsroom** feed (Proposal 6) — marketing engine

## User Reaction
Awaiting response. Watch for:
- Does James want minimal change (Swap) or bigger vision (Radar Scope)?
- Does the Bloomberg metaphor push toward Terminal or toward Radar Scope?
- Does shareability matter to him (Cascade/Newsroom)?
- Is mobile important or is this primarily a desktop product?
