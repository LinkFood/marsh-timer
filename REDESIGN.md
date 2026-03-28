# DCD Frontend Redesign — Claude Code Brief

> **Read this entire document before writing any code. Then open Chrome (`--chrome` flag), navigate to `localhost:8000`, and look at the site yourself before touching anything.**

---

## What This Project Is

Duck Countdown (duckcountdown.com) is an environmental pattern-recognition engine. It has a 2.4M-embedding vector brain that fuses data across 55 content types — weather, migration, water, solunar, BirdCast radar, drought, seismic, climate indices, and more — and draws odds based on historical pattern matching.

It does NOT predict. It says: "The last N times these conditions aligned, X happened Y% of the time." Then it watches to see if reality confirms or denies the pattern, grades itself, and adjusts confidence. The grading loop is the intelligence.

**The backend is killer. The frontend is broken.** Not broken as in errors — broken as in the person who built this (me) can't even use it to understand what the brain is synthesizing. The data fusion is happening in the database but the UI can't show the connections.

---

## The Problem (Read This Carefully)

### Current Layout (Homepage `/`)
The homepage is a 5-row grid:
1. Header bar (brand, nav icons, species selector)
2. Event ticker (scrolling alert strip)
3. **Map (Mapbox GL, takes ~70% of viewport)** — beautiful but mostly context
4. **Three panels crammed side-by-side at 33% width each:** Convergence Scores | Daily Brief | Brain Search
5. Bottom bar (category tabs: All, Intelligence, Migration, Weather, Analytics)

**Why this doesn't work:**
- The map is the hero but it's just a surveillance layer — the *actionable* intelligence is crushed into the bottom 30%
- Each bottom panel gets ~33% width — not enough for ANY of them to show their data properly
- Convergence Scores can only show one state expanded at a time
- Daily Brief text truncates mid-sentence
- Brain Search is a mostly-empty search box
- The three unrelated panels side-by-side = high cognitive load (eyes jump L→C→R across different data types)
- There are 25 lazy-loaded panels behind a panel system (drag, minimize, fullscreen, share, close) — way too much abstraction
- There are also a Brain Chat side panel, a chat history panel, and 8+ top nav icons that open different overlays
- **Result: you can't see what's fusing. You see a score (79) and some bars but you can't see WHY — what connected to what.**

### Brain Journal (`/intelligence`)
This page actually works better. It shows:
- State cards ranked by convergence score in tiers (CRITICAL / ELEVATED / normal)
- Arc phases: OUTCOME, RECOGNITION, BUILDUP
- Narrative text explaining what the brain is seeing
- Domain tags per state
- A brain activity feed at the bottom with compound risk alerts

**But even this page has problems:**
- The cards are walls of text — the fusion moment is invisible
- No inline drill-down (can't expand a state card to see component breakdown)
- State filter bar isn't sticky — you scroll past 23 CRITICAL cards to filter
- No visual encoding for the odds or pattern match history

### Ops Page (`/ops`)
Actually well-designed. Two clean columns, clear hierarchy. The homepage should learn from this.

---

## The Product Identity

This is NOT a hunting app (even though the brand is "Duck Countdown"). Hunting was the first lens. The brain is domain-agnostic — it works for any domain where environmental patterns matter.

**What it actually is:** A data fusion terminal. Think of it like a trading terminal for environmental intelligence. I'm a day trader — I read my ES/NQ charts with custom indicators (JAC·PULSE, BX-Trender, 12GA BB) and I need to be able to read DCD the same way. Fixed positions. Clear visual language. Everything visible at once. Glance and know.

**The hybrid model:** Hunting is the accessible entry point. The brain intelligence (fusion, odds, self-grading) is the premium tier. But right now I'm the only user and I need to be able to see what the system is doing before worrying about anyone else.

---

## The Target Layout: Environmental Trading Terminal

Three columns, fixed positions, everything visible at once. Like Bloomberg meets your trading charts.

### Left Column: The Scoreboard (~280px fixed)
- All 50 states ranked by convergence score
- **Each row: rank | state abbr | mini-bars showing domain contributions | score**
- The mini-bars are the key innovation — like JAC·PULSE dots but for convergence domains. Each domain gets a color, bar WIDTH = its contribution to the score. You can scan which domains are driving a state at a glance without reading numbers.
- Color coding: Weather=red, Migration=blue, BirdCast=green, Solunar=amber, Water=cyan, Pattern=purple, Photoperiod=gray, Tide=gray
- Click a state → loads detail in center + right columns
- This replaces the cramped "Convergence Scores" panel

### Center Column: Map + Fusion Panel
- **Top: Map (Mapbox GL, ~50% of column height)** — smaller, contextual role. Highlights selected state. Shows weather overlays and migration fronts.
- **Bottom: FUSION PANEL (the new thing that doesn't exist yet)** — this is the critical addition:
  - Shows WHAT CONNECTED TO WHAT to produce this score
  - Lists the specific signals that fused (pressure drop at KIAH + migration spike 163% + first_quarter moon + USGS flow rising)
  - Shows historical odds: "14 pattern matches in March Gulf states → 8 confirmed → 57% odds"
  - Shows live confirmation tracking: "Signal 1/3 confirmed (cold front). Waiting on 2 more."
  - This is what makes the fusion VISIBLE

### Right Column: State Detail (~320px fixed)
- **Arc Phase indicator** — 4 pips: Buildup → Recognition → Outcome → Grade (filled/active/future)
- **8-Component Breakdown** — compact grid showing all 8 convergence domains with mini bars and values
- **Brain Track Record** — per-state accuracy stats (empty/learning state until grades come in)
- **Timeline** — reverse-chronological event log for this state (confirmed signals, compound risk alerts, migration spikes, etc.)

### Persistent Elements
- **Top bar:** Brand + brain stats (entry count, crons, arcs, today's embeds) + grading status
- **Ticker:** Scrolling alert strip (keep this, it works)

---

## Technical Context

### Stack
- React 18 + TypeScript + Vite + Tailwind
- Mapbox GL JS (satellite-streets-v12, globe projection)
- Supabase (Postgres + pgvector, Edge Functions in Deno)
- Vercel hosting (auto-deploy on push)
- React Router 6 (`/`, `/:species`, `/:species/:stateAbbr`, `/auth`, `/ops`, `/intelligence`)

### Key Files to Understand
```
src/
  layout/
    DeckLayout.tsx           # THE MAIN LAYOUT — this is what we're rebuilding
    MapRegion.tsx            # Draggable map container
    PanelDock.tsx            # CSS Grid 12-col panel system — likely getting killed
    PanelDockMobile.tsx      # Mobile panel stack
    BottomBar.tsx            # Category filters + panel controls
  contexts/
    DeckContext.tsx           # Species, selectedState, gridPreset, mapHeight, etc.
    LayerContext.tsx          # 27+ map layers
    MapActionContext.tsx      # flyTo, flyToCoords, setMapMode
  components/
    MapView.tsx              # Mapbox GL — keep this
    HeaderBar.tsx            # Brand + nav — simplify
    BrainHeartbeat.tsx       # Live status — keep
    EventTicker.tsx          # Scrolling alerts — keep
  panels/
    PanelRegistry.ts         # 25 panels cataloged — most of these become data sources, not UI panels
    PanelWrapper.tsx         # Panel chrome (drag, minimize, fullscreen) — kill this
  pages/
    IntelligencePage.tsx     # /intelligence — the Brain Journal (keep as alternate view)
    OpsPage.tsx              # /ops — keep as-is
```

### Key Edge Functions (Brain Readers)
- `hunt-state-brief` — generates AI narrative brief per state
- `hunt-intelligence-feed` — brain activity feed
- `hunt-convergence-alerts-pm` — convergence alert data
- `hunt-search` — brain vector search
- `hunt-alerts` — active alerts

### Existing Hooks (in `src/hooks/`)
There are 31 data hooks. Key ones:
- Convergence scores per state
- Weather data per state
- Migration data per state
- BirdCast data
- Solunar data
- Alert data
- Brain search

### Design System
- Dark theme: `bg-gray-950`, cyan/teal accents (`#5eead4` primary)
- Fonts: Playfair Display (headings), Lora (body)
- For the terminal layout, switch body to a mono/system font for the data-dense areas
- Keep Playfair for the brand only

---

## Build Order

### Phase 1: New Layout Shell
1. Create `TerminalLayout.tsx` — the three-column grid
2. Left column: `ConvergenceScoreboard.tsx` — state list with inline mini-bars
3. Wire up existing convergence score hooks to populate the scoreboard
4. Make `/` route render `TerminalLayout` instead of `DeckLayout`
5. Keep `DeckLayout` accessible at `/map` as a legacy/alternate view

### Phase 2: State Detail (Right Column)
1. `StateDetailPanel.tsx` — arc phase indicator, component breakdown grid, timeline
2. Wire to existing hooks (convergence scores, alerts, weather events)
3. Click state in scoreboard → populates right column

### Phase 3: Fusion Panel (Center Column, below map)
1. `FusionPanel.tsx` — the new component showing what connected to what
2. This likely needs a NEW edge function: `hunt-state-fusion` that pulls together:
   - Active convergence signals for the state
   - Pattern matches from `hunt_pattern_links`
   - Alert outcomes from `hunt_alert_outcomes`
   - Historical odds calculation
3. This is the hardest piece and the most important

### Phase 4: Map Integration
1. Shrink MapView to fit the center-top area
2. Click state in scoreboard → map flies to and highlights that state
3. Keep existing layer toggles accessible from a small control

---

## Rules

- **Read CLAUDE.md first** — it has absolute rules about the backend (embedding law, Supabase pins, etc.)
- **Don't break the backend** — we're only touching frontend layout. No edge function changes in Phase 1-2.
- **Mobile can wait** — get the desktop terminal layout right first. Mobile is a separate pass.
- **Keep `/intelligence` and `/ops` working** — don't regress those routes.
- **Use `--chrome` to verify** — after every significant change, screenshot the result and verify it looks right. Don't code blind.
- **Commit often** — Vercel auto-deploys on push. Small commits = easy rollback.
- **The mini-bars in the scoreboard are the visual signature** — each domain gets a consistent color, bar width = contribution. This is the JAC·PULSE equivalent for environmental convergence. Get this right.

---

## What Success Looks Like

I open DCD and in 2 seconds I can see:
1. **Which states are hot** (left column, top of scoreboard, red scores)
2. **Why they're hot** (mini-bars show which domains are maxed)
3. **What fused** (center fusion panel shows the specific signals + historical odds)
4. **What's confirmed** (fusion panel shows signal 1/3, 2/3, etc.)
5. **Where we are in the arc** (right column, 4-pip phase indicator)

No clicking around. No reading paragraphs. No hunting through panels. Everything visible at once, in fixed positions, like reading a trading screen.
