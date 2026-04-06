---
name: UX Navigation Pattern Brainstorm
description: 12 specific UX patterns for unifying Intel command center + Map workbench. Inspired by Bloomberg, Grafana, Windy, FR24, Robinhood, Notion, Linear, Google Earth. Top 3 picks: Bloomberg Function Key Bar, Shared State Bus, FR24 Entity Selection.
type: project
---

## Context
Two separate experiences: `/intelligence` (3-col command center) and `/` (map workbench). No shared chrome, separate headers, separate data hooks. Switching between them reloads everything.

## 12 Patterns (Full details in conversation)

1. **Bloomberg Function Key Bar** -- shared 32px chrome bar above both modes, mode toggle (1/2 keyboard shortcuts), system vitals consolidated
2. **Grafana Drill-Down Chain** -- click entity on Intel, detail panel slides from right, 3-col compresses
3. **Windy Floating Panels** -- map goes full-screen, panels float with glassmorphism, eliminate map-height vs panel-height war
4. **FR24 Entity Selection** -- click state on map, state card overlays (doesn't replace panel dock), "FULL INTEL" button to navigate
5. **Robinhood Portfolio->Stock** -- Intel page commits to one level at a time: all states OR one state, never half-and-half
6. **Notion Sidebar** -- 48px collapsible sidebar replaces both headers, favorited states, mode icons
7. **Linear Command Palette** -- Cmd+K fuzzy search across states, modes, signals, actions, brain content
8. **Google Earth Arc Replay** -- replay completed arcs on the map with narration, timeline scrubber
9. **Mobile Card Stack** -- swipe through ranked states on mobile, bottom tab bar (States/Feed/Map/Chat)
10. **Intel as Default** -- flip hierarchy, `/` = command center, map = drill-down, map slides over from right
11. **Shared State Bus** -- lift shared hooks + state above both routes, single fetch, warm transitions
12. **History Mode** -- date picker in shared chrome, both modes switch to historical, timeline scrubber

## Top 3 Recommended
1. Pattern 1 (Bloomberg Bar) -- unify headers, shared roof
2. Pattern 11 (State Bus) -- shared data, eliminate reloads
3. Pattern 4 (FR24 Entity) -- overlay state card, preserve panel context

## URL Structure Proposed
- `/intel` , `/intel/TX` , `/intel/signal/id` , `/intel/pattern/id`
- `/map` , `/map/duck/TX` , `/map/duck/TX?layer=radar`
- `/map/replay/arc-id`
- `/ops`
- `?date=YYYY-MM-DD` for history mode on any route
