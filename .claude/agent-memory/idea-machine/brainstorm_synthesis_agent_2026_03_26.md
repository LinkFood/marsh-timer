---
name: Synthesis Agent Brainstorm — March 26, 2026
description: 40+ ideas for the synthesis agent architecture, arc data model, narrative generation, visualization, v1 scope, embedding tricks, grading visibility, and wild novelty. Covers 8 categories. Generated after deep read of all existing pipeline functions, IntelligencePage, StateIntelView, and alert outcome schema.
type: project
---

## Context
2.4M brain entries, 55 content types, self-grading loop just starting to produce data, IntelligencePage has 50-state board + feed + track record but no synthesis layer. Arc model defined in CLAUDE.md but not built. Pipeline pieces (convergence-engine, alert-grader, convergence-scan, anomaly-detector, correlation-engine) all exist independently.

## Top Recommendations (ideas James should build first)
1. **Arc Reactor Lite (v1):** New `hunt_state_arcs` table + 15-min cron. Rules-based act detection. No LLM. Ship colored act badges on StateCards.
2. **Dual-Loop Architecture:** Fast reactor (event-driven, no LLM, state machine) + slow narrator (daily Sonnet per active state).
3. **Heartbeat data model:** Tiny arc table (state, act, arc_id, timestamps) + `hunt_arc_events` log for all transitions.
4. **Structured data + frontend rendering (Bloomberg Way):** No backend prose for primary view. Render the arc structurally. LLM only on drill-down.
5. **Arc Fingerprinting:** Embed completed arcs as composite vectors. Search them when new buildups start.

## Key Ideas by Category (40+ total)

### Architecture (5 ideas)
- A. Arc Table + Reactor (event-sourced state machine)
- B. Ticker Tape (narrative event log, synthesis as curation)
- C. Dual-Loop (fast reactor + slow narrator)
- D. Postgres-Native Matviews (zero edge function cost for base arc)
- E. War Room (per-state Realtime channels)

### Data Structure (4 ideas)
- A. The Dossier (maximally structured, all fields)
- B. The Heartbeat (minimal arc + event log)
- C. The Candle (OHLC model for completed arcs)
- D. Pressure System (continuous numerical state vs discrete acts)

### Narrative Generation (5 ideas)
- A. Structured Data + Frontend Rendering (Bloomberg Way)
- B. Template + LLM Hybrid (Mad Libs)
- C. Progressive Narrative Depth (3 tiers: free/cheap/expensive)
- D. Living Document (append-only, never rewritten)
- E. Commentary Track (facts + interpretation side by side)

### Visualization (8 ideas)
- A. Threat Board (corkboard with red string)
- B. Seismograph (continuous waveform per state)
- C. Stack Rank with Momentum Arrows
- D. State DNA Helix (8-component bars over time)
- E. Countdown Clock (literal timer on Act 3 states)
- F. Split Screen: Brain vs Reality
- G. Report Card Wall
- H. Audio Sonification

### Simplest V1 (3 ideas)
- A. Arc Reactor Lite (new table + cron + badges)
- B. Briefing Bot (extend hunt-state-brief with depth param)
- C. Just the Leaderboard (add momentum arrows to existing page)

### Embedding Tricks (6 ideas)
- A. State Similarity Search (current state vs historical states)
- B. Arc Fingerprinting (embed completed arcs, match new buildups)
- C. Negative Space Detection (absence of expected data)
- D. Cross-Domain Analogy Engine
- E. The Time Machine (this year vs last year at same date)
- F. Embedding Drift as Signal (centroid movement)

### Grading Visibility (7 ideas)
- A. The Scoreboard (running tally in header)
- B. Grade Replay (slow-motion walk-through)
- C. Accuracy by Season/Month/Region
- D. Dunning-Kruger Chart (confidence vs accuracy)
- E. Streak Counter
- F. Before/After Signal Weight
- G. Grade Notifications as Push Events

### Wild Novelty (10 ideas)
- A. Debate Mode (bull case vs bear case)
- B. Citizen Science Integration (user ground-truth voting)
- C. The Hindsight Machine (time-travel through brain history)
- D. Cross-State Contagion Map (temporal propagation viz)
- E. Morning Brief Email/SMS
- F. Regression Autopsy (automated post-mortems on failures)
- G. Environmental Genome Project (cluster completed arcs to discover event taxonomy)
- H. Adversarial Self-Testing (synthetic scenarios)
- I. The Grandmother Test ("Porch Mode" voice toggle)
- J. Ambient Intelligence Display (wall-mounted cycling view)

## Awaiting User Reaction
Watch for which ideas resonate. Arc Reactor Lite, Fingerprinting, Hindsight Machine, and Countdown Clocks are the author's picks.
