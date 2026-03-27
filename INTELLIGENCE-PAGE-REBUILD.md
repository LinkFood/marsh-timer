# Intelligence Page Rebuild — Handoff Spec

> **This replaces INTELLIGENCE-PAGE-V2-HANDOFF.md.** The page has been redesigned from scratch based on mockup iteration (v1→v5). Reference mockups are in the repo root as `intelligence-v*.jsx` files in the DCD folder.

---

## The Big Idea

The Intelligence Page (`/intelligence`) is the **command center** — the brain's synthesis of what's happening across all 50 states right now. The main site (`/`) is the **workbench** — map, panels, chat, granular exploration. They're symbiotic:

- Intelligence Page answers: **"What is the brain seeing that I can't?"**
- Main site answers: **"Let me dig into the details myself."**

The Intelligence Page does NOT replace anything. The existing map, panels, grid layout, chat — all stay. This page is the front door that drives people into the existing site when they want depth.

---

## Layout: 3-Column Command Center

```
┌──────────────────────────────────────────────────────────────────────┐
│ HEADER: DCD | BRAIN 2.4M | CRONS 41/42 | ARCS 48 | EMB 849 | LIVE │
├──────────────────────────────────────────────────────────────────────┤
│ TICKER: scrolling event feed                                         │
├────────────┬─────────────────────────────────┬───────────────────────┤
│            │                                 │                       │
│  LEFT      │  CENTER                         │  RIGHT                │
│  220px     │  flex                            │  280px                │
│            │                                 │                       │
│  Migration │  Scout Brief                    │  Components           │
│  Solunar   │  ─────────────────────────      │  30-day Chart         │
│  ────────  │  Focus Story:                   │  Weather              │
│  Convergence│   Fusion Web | Brain Recognizes│  Disaster Watch       │
│  Rankings  │   + Live Signals                │  Track Record         │
│  (all 50)  │  ─────────────────────────      │  Data Sources         │
│            │  Patterns    | Outcome Windows  │                       │
│            │  ─────────────────────────      │                       │
│  ────────  │  Live Feed   | METAR + Brain    │                       │
│  NWS Alerts│              | Activity         │                       │
│            │                                 │                       │
├────────────┴─────────────────────────────────┴───────────────────────┤
│ CHAT: slide-over panel from right, triggered by header button        │
└──────────────────────────────────────────────────────────────────────┘
```

**Critical:** `height: calc(100vh - header - ticker)`. No page scroll. Each column scrolls independently. No dead space.

---

## Layout Freedom Note

The v5 mockup uses a fixed 3-column grid. But the existing site has `DeckContext` with grid presets and `PanelDock` for drag/rearrange. **Code has freedom to:**

- Keep it as a fixed layout (simpler, faster to ship)
- OR wire it into the existing panel/grid system so sections are rearrangeable
- OR start fixed and add customization later

James's call on this — either approach works. The content and data mapping below is what matters.

---

## Section-by-Section Spec

### Header Bar
- **What:** Brand + brain vitals + nav actions
- **Data:** `useOpsData` (brain total, cron health), `useStateArcs` (arc count), `useBrainActivity` (embeddings today)
- **Elements:**
  - DCD brand
  - BRAIN {count} | CRONS {healthy}/{total} | ARCS {count} | EMB {today}
  - "ASK BRAIN" button → toggles chat overlay
  - "MAP →" link → navigates to `/` (passes selected state if one is active)
  - GRADING: learning 0/18 (or accuracy % once grades land)
  - LIVE indicator (green dot + pulse)

### Event Ticker
- **What:** Scrolling horizontal feed of latest events
- **Data:** `useSignalFeed` — already merges convergence + weather + NWS + compound risk + disaster watch
- **Behavior:** CSS animation scroll, loops. Colored dots by event type.
- **Height:** 18-20px max. Compact.

### LEFT Column (220px)

#### Migration Momentum
- **Hook:** `useMurmurationIndex`
- **Shows:** Big number (index value), % change, direction label, top 5 spike states as pills, active state count
- **Shares row with Solunar** (2-col grid within left column)

#### Solunar
- **Hook:** `useSolunar`
- **Shows:** Moon phase name, illumination visual (half-circle), major/minor feed windows with times, 5-bar activity rating
- **Shares row with Migration**

#### Convergence Rankings
- **Hook:** `useConvergenceScores` (all 50 states), `useStateArcs` (for arc indicators), `useConvergenceHistory` (for sparklines)
- **Shows:** Numbered list, all states ranked by score. Each row:
  - Rank number
  - State abbreviation (bold, cyan if selected)
  - 8 domain pips (colored if active, dim if not) — from convergence score components
  - 30-day sparkline (from history hook)
  - Score number (color-coded: red ≥75, amber ≥70, cyan ≥65, dim otherwise)
- **Interaction:** Click state → updates selected state across entire page (center story, right panel, feed filter)
- **Row height:** ~22px. Must fit 16+ states visible without scrolling.
- **Sticky header** with "CONVERGENCE" label + active arc count

#### NWS Alerts
- **Hook:** `useNWSAlerts`
- **Shows:** Pinned at bottom of left column. State abbr (red), event name, county count. 3-5 most recent.
- **Compact:** 3 lines max.

### CENTER Column (flex)

#### Daily Intelligence Brief
- **Hook:** `useScoutReport`
- **Shows:** AI-generated morning brief in serif font. One paragraph. Compact.
- **Timestamp:** "Mar 27, 2026 06:00 UTC"

#### Focus Story (the hero section)
- **This is the page's reason for existing.** Shows what the brain sees for the selected state.

**Left half: Fusion Web (SVG)**
- Animated SVG visualization showing 8 domain nodes around a center score
- Nodes connected to center by lines — thicker/solid for strong signals, thinner/dashed for weak
- Line opacity pulses (CSS animation)
- Node size scales with domain score
- Center shows total score
- **Data:** `useConvergenceScores` for the selected state's component breakdown

**Right half: Brain Recognition + Signals**
- **"THE BRAIN RECOGNIZES"** card — the key differentiator
  - Pull from `arc.narrative` (hunt_state_arcs) or `arc.recognition_claim`
  - If no arc narrative yet, show "Narrator hasn't processed this arc yet" with pulse skeleton
  - Confidence bar + percentage from `arc.precedent_accuracy`
- **Live Signals** below the recognition card
  - Top 3-4 signals for this state from `useSignalFeed` or `useBrainJournal` filtered by state
  - Each shows: timestamp, domain icon pip, signal text
  - **Data:** `useBrainJournal(selectedState, 'brain')` or filter `useSignalFeed` by state

#### Middle Row (2-column split)

**Left: Cross-Domain Connections**
- **Hook:** `usePatternLinks` (72hr history, similarity scores)
- **Shows:** 4 cards in a stack. Each card:
  - State abbreviation
  - Similarity percentage with gradient line
  - One-line description of the connection
- **This is the brain's unique value** — connections humans can't see

**Right: Outcome Windows**
- **Hook:** `useStateArcs` (filtered to act === 'outcome'), `useConvergenceScores`
- **Shows:** All states currently in outcome phase with:
  - State abbr + score
  - Progress bar: signals received / signals needed
  - Deadline date
- **Purpose:** Shows the brain is actively grading itself. The clock is ticking on these calls.

#### Bottom Row (2-column split)

**Left: Live Feed**
- **Hook:** `useSignalFeed` (merged 30-item feed)
- **Shows:** Streaming activity: timestamp, colored dot, state, text
- **Filter options:** ALL | CRITICAL | {selected state}
- **Scrollable** within its container

**Right: METAR Events + Brain Activity (stacked)**

METAR Events:
- **Hook:** `useWeatherEvents`
- **Shows:** Real-time METAR station events: time, station code, state, event type, severity dot
- **Label:** "METAR EVENTS — 130 STATIONS"

Brain Activity:
- **Hook:** `useBrainActivity`
- **Shows:** Recent cron executions: status dot (green/red), function name (strip `hunt-` prefix), items processed, timestamp
- **Purpose:** Shows the brain is alive and working

### RIGHT Column (280px)

All sections scroll continuously — no tabs needed (v4 had tabs, v5 dropped them — either works, Code's call).

#### Component Breakdown
- **Hook:** `useConvergenceScores` for selected state
- **Shows:** Each of 8 domains with label, progress bar, score/max. Color-coded by domain. Bold green when ≥80%.

#### 30-Day Convergence Chart
- **Hook:** `useConvergenceHistory` or `useConvergenceHistoryAll` for top 5 states
- **Shows:** Multi-line sparkline — top 5 states overlapping on same axes. Color-coded legend below.
- **Purpose:** See who's building, who peaked, who's fading. Context for the rankings.

#### Current Conditions
- **Hook:** `useNationalWeather`
- **Shows:** 2×2 grid of top states. Each card: state abbr, temp (color-coded), wind, pressure, trend arrow (red=falling, green=rising).

#### Disaster Watch
- **Hook:** `useDisasterWatch`
- **Shows:** Long-range threat cards. Type, region, confidence %, timeframe, condition pills.

#### Track Record
- **Hook:** `useTrackRecord`
- **Shows:** Learning state until 10+ grades land. Then: overall accuracy %, per-source bars, recent grades.
- **This is critical** — shows the brain's honesty loop.

#### Data Source Health
- **Hook:** `useDataSourceHealth`
- **Shows:** Compact pill badges for all 14 sources. Green dot = online, red = stale/error.
- **Label:** "SOURCES — 13/14"

### Chat Overlay
- **Hook:** `useChat` (existing streaming SSE chat)
- **Trigger:** "ASK BRAIN" button in header
- **Behavior:** Slides in from right, overlays center+right columns. 380px wide.
- **Shows:**
  - Chat messages with markdown rendering (bold → cyan)
  - Suggested prompt pills: "Why is TX #1?", "Compare TX vs MS", "What grading happens next?", "Explain convergence"
  - Text input + send button
- **The chat already exists** — this just gives it a home on the Intelligence Page

---

## State Selection Flow

1. User clicks state in left column rankings
2. `selectedState` updates (useState or context)
3. Center: focus story updates (fusion web, recognition, signals)
4. Right: component breakdown, trend chart update
5. Feed: can filter to selected state
6. Header "MAP →" link passes `?state={selected}` to main site

**No new routes. No sub-pages. Everything updates in place.**

---

## What Already Exists (Don't Rebuild)

These components are built but not wired into IntelligencePage.tsx:

| Component | Location | Status |
|-----------|----------|--------|
| StateBoard | `src/components/intelligence/StateBoard.tsx` | Built — may need slimming for v5 density |
| ArcDetailView | `src/components/intelligence/ArcDetailView.tsx` | Built — has narrative, convergence, claims, grades, fingerprints |
| ArcTimeline | `src/components/intelligence/ArcTimeline.tsx` | Built — phase progress dots |
| ArcConvergence | `src/components/intelligence/ArcConvergence.tsx` | Built — component score bars |
| ArcClaimCard | `src/components/intelligence/ArcClaimCard.tsx` | Built — recognition claim display |
| TrackRecord | `src/components/intelligence/TrackRecord.tsx` | Built — learning state + accuracy when ready |
| CountdownClock | `src/components/intelligence/CountdownClock.tsx` | Built — deadline timer |
| FingerprintMatches | `src/components/intelligence/FingerprintMatches.tsx` | Built — historical pattern matches |
| StateArcCard | `src/components/intelligence/StateArcCard.tsx` | Built — compact arc card |

**Use or adapt these. Don't rewrite from scratch unless the v5 layout demands it.**

---

## New Components Needed

| Component | Purpose |
|-----------|---------|
| FusionWeb | SVG visualization of domain convergence. Animated nodes + center score. |
| BrainRecognition | "THE BRAIN RECOGNIZES" card with narrative + confidence bar |
| MigrationMomentum | Big number + change + direction from useMurmurationIndex |
| SolunarWidget | Compact moon phase + feed windows |
| OutcomeWindows | States in outcome phase with signal progress + deadlines |
| METARFeed | Real-time weather station events |
| BrainActivityFeed | Cron execution log |
| MultiSparkline | Multi-state 30-day trend chart |
| PatternLinkCards | Cross-domain connection cards |
| DataSourcePills | Compact source health indicators |
| ChatOverlay | Slide-in chat panel (wraps existing useChat) |

---

## Hooks Already Available (No Backend Work Needed)

Every section maps to an existing hook. No new edge functions required:

| Section | Hook | Notes |
|---------|------|-------|
| Header vitals | useOpsData, useBrainActivity | Already used on /ops |
| Ticker | useSignalFeed | Merged feed, 30 items |
| Migration | useMurmurationIndex | Momentum + direction |
| Solunar | useSolunar | Phase + windows |
| Rankings | useConvergenceScores, useConvergenceHistory | All 50 states |
| NWS | useNWSAlerts | Filtered to active |
| Scout Brief | useScoutReport | Daily AI brief |
| Focus Story | useStateArcs, useConvergenceScores | Arc narrative + components |
| Brain Recognition | useStateArcs | arc.narrative, arc.recognition_claim |
| Signals | useBrainJournal, useSignalFeed | Filter by state |
| Patterns | usePatternLinks | 72hr, similarity scores |
| Outcome Windows | useStateArcs | act === 'outcome' |
| Live Feed | useSignalFeed | Filterable |
| METAR | useWeatherEvents | 130 stations |
| Brain Activity | useBrainActivity | Cron log |
| Components | useConvergenceScores | Per-state breakdown |
| 30-day Chart | useConvergenceHistory/All | Multi-state trend |
| Weather | useNationalWeather | All 50 states |
| Disaster Watch | useDisasterWatch | Long-range |
| Track Record | useTrackRecord | Learning → accuracy |
| Data Sources | useDataSourceHealth | 28 sources |
| Chat | useChat | Existing SSE streaming |

---

## Database Notes

### Index Needed (from v2 handoff, still applies)
```sql
CREATE INDEX CONCURRENTLY idx_hunt_knowledge_journal
ON hunt_knowledge (content_type, created_at DESC);
```
This speeds up `useBrainJournal` queries across 2.4M rows.

### Realtime Subscriptions
The page should use Supabase Realtime where hooks support it (useStateArcs already does). For hooks that don't, polling at 30-60s intervals is fine. Don't over-engineer realtime — the crons fire on schedules anyway.

---

## Design System

- **Background:** `bg-gray-950` (#030712) for page, `bg-gray-900` (#0a0f1a) for cards
- **Borders:** `border-gray-800` (#1f2937)
- **Text:** Monospace for data, serif (Georgia) for narratives/briefs
- **Accent:** Cyan (#22d3ee) for primary, domain colors for category coding
- **Domain colors:** Weather red, Migration blue, BirdCast green, Solunar amber, Water sky, Pattern purple, Photo slate, Tide light cyan
- **Score tiers:** Red ≥75, Amber ≥70, Cyan ≥65, Dim otherwise
- **Fonts:** Match existing site — Playfair Display headings, Lora body, monospace for data
- **Mobile:** The 3-col collapses to single column. Left rankings become horizontal scroll. Right panel stacks below center. All sections should work at 375px.

---

## Build Order (Suggested)

1. **Layout shell** — 3-col grid, header, ticker. Get the bones rendering.
2. **Left column** — convergence rankings with sparklines, migration/solunar compact widgets, NWS alerts. These are all read-only data displays.
3. **Center top** — scout brief + focus story (fusion web SVG + brain recognition card). This is the hero.
4. **Right column** — component breakdown, 30-day chart, weather, track record, sources. Continuous scroll.
5. **Center middle** — pattern links + outcome windows split row.
6. **Center bottom** — live feed + METAR + brain activity split row.
7. **Chat overlay** — wire existing useChat into slide-over panel.
8. **State selection** — click state in rankings → everything updates.
9. **Polish** — animations, transitions, mobile responsive, loading skeletons.

---

## What NOT To Do

- Don't remove the main site (`/`). Intelligence Page is additive.
- Don't create new routes beyond `/intelligence`. No sub-pages.
- Don't build new edge functions. Every hook already exists.
- Don't use `{ count: 'exact' }` on hunt_knowledge. Ever.
- Don't over-engineer realtime. Polling is fine for most hooks.
- Don't make the page scroll as a whole. Each column scrolls independently.

---

## Reference Files

- **Mockup v5 (latest):** `DCD/intelligence-v5.jsx` — interactive React mockup with all sections
- **Mockup v4:** `DCD/intelligence-v4.jsx` — includes chat overlay
- **Mockup v3:** `DCD/intelligence-v3.jsx` — first full-data version
- **Mockup v1-v2:** `DCD/intelligence-command-center.jsx`, `DCD/intelligence-v2.jsx`
- **Current page:** `src/pages/IntelligencePage.tsx` — what exists now (single-column scroll)
- **Existing components:** `src/components/intelligence/` — 9 components, most unused
- **All hooks:** `src/hooks/` — 41 hooks, comprehensive data access
- **CLAUDE.md:** The brain's full architecture reference

---

## Freedom for Code + James

This spec defines **what** goes on the page and **where the data comes from**. It does NOT dictate exact pixel measurements, animation details, or component decomposition. Code should:

- Use the v5 mockup as a visual target, not a pixel-perfect requirement
- Adapt existing intelligence components where they fit
- Create new components where needed
- Choose the right abstraction level (fixed layout vs. panel system)
- Make mobile decisions that feel right
- Add sections or rearrange if something works better in practice

The mockups are the vision. The hooks are the data. Build the bridge.
