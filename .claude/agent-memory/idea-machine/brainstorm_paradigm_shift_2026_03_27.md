---
name: Paradigm Shift Brainstorm — March 27, 2026
description: 8 non-dashboard paradigms for DCD UX (Flight Deck, Intelligence Briefing, Trading Floor, Broadcast, ICU Monitor, Strategy Game, Mixing Board, Newspaper) + hybrid recommendation combining 3 strongest paradigms into layered architecture.
type: project
---

## Context
James asked: "What if this WASN'T a dashboard?" Explored 8 paradigms from other domains (mission control, CIA briefings, trading floors, sports broadcasts, ICU monitors, strategy games, mixing boards, newspapers). Each evaluated for core insight, specific UI concept, backend data surfaced, and honest tradeoffs.

## 8 Paradigms Evaluated

1. **Flight Deck / Deviation Board** — 50 state tiles, glow by convergence, pulse by data cadence. Information hierarchy through visual silence. "Nominal" vs "deviant." Solves equal-weight problem.
2. **Situation Room / Daily Brief** — Authored document, not UI. Fixed structure: summary, active arcs, grading report, watch list. "Grandpa on the porch" as text. Anti-density.
3. **Trading Floor / Watchlist + Tape** — Personal watchlist of 5-15 states, real-time event tape, screener for discovery. Expand-in-place depth. Bloomberg paradigm done correctly.
4. **Broadcast / Auto-Zoom** — Scoreboard default, system auto-zooms to events. Like ESPN cutting to a game-winning play. System-as-director. Risky calibration.
5. **ICU / Waveform Stack** — 8 domain signals as synchronized vertical waveforms. Convergence visible as vertical alignment. Maps to trader's multi-indicator chart.
6. **Strategy Map / Living Map** — Map IS the data. Animated migration flows, per-state arc-status visual treatment, weather fronts as advancing edges. Moonshot. WebGL territory.
7. **Mixing Board / Signal Board** — 50 columns x 8 bars. Spectrogram of environmental signal. 400 data points scannable. Abstract but dense.
8. **Newspaper / Front Page** — Variable-size story blocks based on importance. System-as-editor. "Opinion section" for brain self-assessment. Media product paradigm.

## Hybrid Recommendation (3-Layer Architecture)

- **Layer 1 — Deviation Board** (ambient default, 2-second scan): 50 tiles, glow/pulse
- **Layer 2 — Watchlist + Tape** (operator workspace, 10-min session): pinned states, live feed, expand-in-place
- **Layer 3 — Waveform Stack** (deep dive): 8-domain synchronized waveforms for single state

Plus:
- Daily Brief / Front Page as shareable EXPORT format, not primary UI
- Strategy Map ideas (migration flows, arc visual treatment) absorbed into existing Mapbox
- Signal Board as power-user easter egg view

## Key Insight
None of these paradigms works alone. The product needs LAYERS — different zoom levels for different attention spans. The current failure is showing everything at one zoom level.

## Awaiting User Reaction
Watch for:
- Does James lean toward the operator paradigms (Trading Floor, Waveform Stack) or the narrative paradigms (Daily Brief, Front Page)?
- Does the Deviation Board resonate as a front door?
- Does the Waveform Stack click as the natural "trading chart" analog?
- Does the hybrid layering make sense or does he want ONE paradigm committed to?
