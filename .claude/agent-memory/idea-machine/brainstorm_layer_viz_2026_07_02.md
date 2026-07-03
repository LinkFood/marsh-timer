---
name: brainstorm-layer-viz-2026-07-02
description: 7 inline-SVG ideas for visualizing many domains at once so cross-domain coincidence is visible honestly (the crime board). DCD DatePage.
metadata:
  type: project
---

# Visualizing the Layers — brainstorm 2026-07-02 (DCD, marsh-timer)

**Owner's problem:** "good engine, but how we show it is hard." 7.6M entries, 25+ domains, one vector space. Magic = cross-domain coincidence (birds quiet 11d before heat wave). Doctrine: show don't predict, never render dead convergence score, receipts/denominators always. Constraint: inline SVG only, no chart libs, Mapbox stays removed, bounded REST (effective_date=eq per DOMAIN_GROUP).

**Key realization:** DatePage's ±14-day `useArchaeologyTimeline` already MERGES all domains into one dot-row. Most ideas = "un-merge that row into per-domain bands."

Ideas delivered:
1. **Layer Loom** — horizontal band per DOMAIN_GROUP, ticks by effective_date, height=signal_weight. Read down a column = coincidence. Low-Med. Buildable today.
2. **Coincidence Columns** — faint vertical light-shaft behind day-columns where >=3 domains fired. Anti-convergence-score; honest counting. Low. Buildable today.
3. **Lead-Lag Ribbon** — anchor on event day (0-line); domains show marks days-before(left)/after(right). Makes "birds quiet 11d before heat" visible. Med. THE signature view.
4. **Core Sample** — Loom rotated 90deg, time flows DOWN like a geological drill core; horizontal ash-layer alignment = coincidence. Mobile-native scroll. Med. The nobody-would-think-of one.
5. **Domain Heartbeat/ICU** — EKG polyline per domain, signal_weight drives spikes, flatline=honest quiet. Low-Med. Buildable today.
6. **Small-Multiple State Strips** — TILE_GRID tiles become mini-Looms; one windowed query grouped client-side. Med-High.
7. **Echo Layer** — this year's marks solid, prior years (useThisDayInHistory) as faint ghosts behind. Anomaly detection by eyeball with denominator on screen. Med. Other nobody-would-think-of one.
Bonus: Scrubber (play head recolors tile map), Year Ribbon (365-day woven threads), Silence bands (draw expected-but-absent domains).

**Recommended smallest real step:** #1 + #2 as a single swap-in replacing the merged dot-timeline on DatePage. Offered to route to core-logic for scoping.

**Files grounding this:** src/pages/DatePage.tsx, src/components/EventMap.tsx, src/hooks/useDayArchive.ts (DOMAIN_GROUPS, PROBE_COLORS/LABELS, signal_weight, useArchaeologyTimeline).
