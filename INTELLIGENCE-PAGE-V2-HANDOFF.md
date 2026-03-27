# Intelligence Page V2 — Complete Build Handoff

> **Read CLAUDE.md first.** Then read this document top to bottom before writing a single line of code.
>
> The synthesis agent backend is DONE. The arc reactor hooks are deployed. The narrator is firing. The hunt_state_arcs table exists and has 48 active arcs. This handoff is about fixing what's broken and building what's missing to turn the Intelligence Page into the actual product.

---

## Current State (Tested March 27, 2026)

**What works:**
- Page loads at `/intelligence` with "BRAIN JOURNAL — WATCH THE BRAIN THINK" header
- Header stats: 2,402,156 entries, 48 arcs, 0% accuracy, green health dot
- 48 active arc cards display in 2-column grid with act badges (OUTCOME/RECOGNITION), domain counts, countdown timers, truncated narratives
- State filter pills work — clicking a state highlights it and filters the journal feed
- Journal feed shows timestamped entries with colored type badges (COMPOUND RISK, CONVERGENCE, WEATHER)
- Click-to-expand on journal entries reveals full narrative text + metadata tags
- useStateArcs hook has Supabase Realtime subscription + 60s polling fallback
- useBrainJournal hook polls every 45s

**What's broken or missing (in priority order):**

| # | Issue | Severity |
|---|-------|----------|
| 1 | No ArcDetailView — clicking an arc card only toggles state filter, can't drill into the arc story | CRITICAL |
| 2 | No tier grouping — all 48 arcs in one flat grid, should be Critical/Elevated/Normal/Quiet | HIGH |
| 3 | Journal feed overwhelmed by raw weather events — compound risk & convergence buried | HIGH |
| 4 | Raw markdown in narratives — `**text**` renders as literal asterisks | HIGH |
| 5 | 0% accuracy shows raw number, should say "Learning..." until 10+ graded | MEDIUM |
| 6 | hunt_knowledge journal query hit 503 on first load (heavy query, 14 content_types across 2.4M rows) | MEDIUM |
| 7 | No pg_cron registered for hunt-arc-narrator daily sweep | MEDIUM |
| 8 | No FingerprintMatches UI | MEDIUM |
| 9 | No TrackRecord section (per-source, per-state accuracy breakdown) | MEDIUM |
| 10 | All 48 arc deadlines cluster at same time (~6d 18h) — no visual differentiation | LOW |

---

## Fix 1: ArcDetailView (CRITICAL)

This is the single most important missing piece. The entire product thesis is "watch the brain think through a story." Right now you can see cards but can't read the story.

### Behavior

When user clicks an arc card, open a detail panel (either a slide-over drawer from the right, or expand inline below the card — dealer's choice, but it needs to feel immediate, not a page navigation).

### What it shows

**A) Full Narrative** — the Sonnet-generated narrative from `arc.narrative`. Render markdown properly (bold, line breaks). If no narrative yet, show "Narrator hasn't processed this arc yet."

**B) Arc Timeline** — visual act progression with timestamps:
```
● BUILDUP (Mar 23 8:00a)  →  ● RECOGNITION (Mar 23 8:15a)  →  ◉ OUTCOME (active)  →  ○ GRADE
                                                                  Deadline: Apr 2
```
Use the existing ArcTimeline component but make sure it shows actual timestamps from `arc.act_started_at` and `arc.opened_at`.

**C) Convergence Breakdown** — show the 8-component scores for this state. Pull from `hunt_convergence_scores` for the arc's state. Display as horizontal bars or a radar chart:
```
Weather:    ████████████░░  18/25
Migration:  ██████████████  22/25
BirdCast:   ██████████░░░░  14/20
Solunar:    ████████░░░░░░  10/15
Water:      ████████████░░  12/15
Pattern:    ██████░░░░░░░░   8/15
Photoperiod:██████████░░░░   7/10
Tide:       ████░░░░░░░░░░   4/10
```

**D) Buildup Signals** — from `arc.buildup_signals`. Show domains as colored pills, the trigger description, score trend.

**E) Recognition Claim** — from `arc.recognition_claim`. "The brain claims: {claim}. Pattern type: {pattern_type}. Historical accuracy: {precedent_accuracy}%."

**F) Outcome Signals** — from `arc.outcome_signals`. List each signal with timestamp and source. If empty: "Watching for confirmation signals..."

**G) For graded arcs:** Show `arc.grade` as a large badge (CONFIRMED = green, PARTIAL = amber, MISSED = red, FALSE ALARM = red) and `arc.grade_reasoning` as the Opus-generated post-mortem.

**H) Fingerprint Matches** — search for similar historical arcs. Make an API call to the narrator or create a lightweight edge function that calls `search_hunt_knowledge_v3` with content_type filter `arc-fingerprint`. Show: "This pattern looks X% similar to [state] [date] which was [grade]."

### New files
```
src/components/intelligence/ArcDetailView.tsx    # The main detail panel
src/components/intelligence/ArcConvergence.tsx   # 8-component bar visualization
src/components/intelligence/ArcClaimCard.tsx     # Claim vs reality display
src/hooks/useArcDetail.ts                        # Fetches full arc + convergence + fingerprints
```

### How to wire it up

In `IntelligencePage.tsx`, replace the current `<button>` wrapper on arc cards:

```typescript
const [selectedArcId, setSelectedArcId] = useState<string | null>(null);

// In the arc grid:
<button key={a.id} onClick={() => setSelectedArcId(selectedArcId === a.id ? null : a.id)}>
  <ArcBanner arc={a} selected={selectedArcId === a.id} />
</button>

// Below the arc grid (or as a slide-over):
{selectedArcId && (
  <ArcDetailView
    arc={arcs.find(a => a.id === selectedArcId)!}
    onClose={() => setSelectedArcId(null)}
  />
)}
```

---

## Fix 2: Tier Grouping on State Board

Currently all 48 arcs display in one flat grid sorted by score. Group them by severity tier.

### Tier logic

```typescript
function getArcTier(arc: StateArc, score: number): 'critical' | 'elevated' | 'active' | 'quiet' {
  // Grade act is always important
  if (arc.current_act === 'grade') return 'critical';
  // High score + outcome = critical
  if (arc.current_act === 'outcome' && score >= 60) return 'critical';
  // Recognition or high-scoring outcome = elevated
  if (arc.current_act === 'recognition' || arc.current_act === 'outcome') return 'elevated';
  // Buildup = active
  if (arc.current_act === 'buildup') return 'active';
  return 'quiet';
}
```

### Display

```
┌─ CRITICAL (2) ──────────────────────────────────────┐
│ TX ●OUTCOME Score:83  7 domains  6d 17h             │
│ [full card with narrative preview + click to expand] │
│                                                      │
│ WI ●OUTCOME Score:71  6 domains  6d 19h             │
└──────────────────────────────────────────────────────┘

┌─ ELEVATED (8) ──────────────────────────────────────┐
│ GA ●RECOGNITION  FL ●RECOGNITION  AR ●RECOGNITION   │
│ [medium cards, 2-col grid]                           │
└──────────────────────────────────────────────────────┘

┌─ ACTIVE (38) ────────────────────────────────────────┐
│ [compact pills: state abbr + score + act dot]        │
│ OK 54 ● | MO 48 ● | MN 52 ● | IA 49 ● | ...       │
└──────────────────────────────────────────────────────┘
```

Critical tier: full arc cards (like current cards but bigger, with more narrative visible).
Elevated tier: medium cards in 2-column grid (current layout).
Active tier: compact row of pills — just state abbr + score + colored act dot. Clicking expands.

This prevents the 48-card wall of sameness.

---

## Fix 3: Journal Feed Priority & Filtering

The journal feed is currently overwhelmed by raw weather events (pressure_drop, high_wind, cold_front). The brain's actual thinking — compound risk alerts, convergence scores, grades, arc narratives — gets buried.

### Solution: Two-level filtering

**A) Add type filter tabs above the journal:**

```
[All] [Brain Activity] [Weather] [Migration] [Alerts] [Grades]
```

Where:
- **Brain Activity** = compound-risk-alert, convergence-score, anomaly-alert, correlation-discovery, state-brief, arc-grade-reasoning, arc-fingerprint
- **Weather** = weather-event, nws-alert
- **Migration** = migration-spike-extreme, migration-spike-significant, bio-absence-signal
- **Alerts** = nws-alert, disaster-watch, compound-risk-alert
- **Grades** = alert-grade, arc-grade-reasoning, arc-fingerprint

**B) Default to "Brain Activity" tab, not "All".** The raw weather data should be available but not the default view. Users who want to see every pressure drop can click "All" or "Weather."

**C) Priority ordering within each tab:** Sort by `signal_weight` DESC, then `created_at` DESC. This way high-signal events (compound risk at ×2.0) appear before low-signal events.

### Implementation

In `useBrainJournal.ts`, add a `typeFilter` parameter:

```typescript
const FILTER_PRESETS = {
  brain: ['compound-risk-alert', 'convergence-score', 'anomaly-alert', 'correlation-discovery', 'state-brief', 'arc-grade-reasoning', 'arc-fingerprint'],
  weather: ['weather-event', 'nws-alert'],
  migration: ['migration-spike-extreme', 'migration-spike-significant', 'bio-absence-signal'],
  alerts: ['nws-alert', 'disaster-watch', 'compound-risk-alert'],
  grades: ['alert-grade', 'arc-grade-reasoning', 'arc-fingerprint'],
};

export function useBrainJournal(stateFilter: string | null, typeFilter: string = 'brain', limit = 100) {
  // Use FILTER_PRESETS[typeFilter] instead of JOURNAL_TYPES for the content_type IN clause
  // Change order to: order=signal_weight.desc,created_at.desc
}
```

---

## Fix 4: Render Markdown in Narratives

The arc card narratives and the expanded journal entries show raw markdown (`**bold text**` renders as literal asterisks).

### Solution

Install a lightweight markdown renderer. Options:

**Option A (recommended): Simple regex replacement** — don't need a full markdown parser. The narratives only use `**bold**` and line breaks:

```typescript
function renderNarrative(text: string): JSX.Element {
  // Replace **text** with <strong>text</strong>
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <span>
      {parts.map((part, i) =>
        i % 2 === 1 ? <strong key={i} className="text-white/90">{part}</strong> : part
      )}
    </span>
  );
}
```

**Option B:** Use `react-markdown` (already may be in deps from the chat system). More robust but heavier.

Apply to:
1. `ArcBanner` component — the `arc.narrative` line-clamp
2. `JournalRow` component — the `entry.title` and `entry.content`
3. `ArcDetailView` — full narrative display

---

## Fix 5: "Learning..." State for Accuracy

In the header, show "Learning..." instead of "0%" when fewer than 10 alerts have been graded.

```typescript
// In IntelligencePage header stats section:
const totalGraded = opsData.alerts.confirmed + opsData.alerts.partial +
                    opsData.alerts.missed + opsData.alerts.false_alarm;

// Replace the accuracy display:
{totalGraded < 10 ? (
  <div className="flex flex-col items-center px-2">
    <span className="text-[9px] font-mono text-white/30 italic">Learning</span>
    <span className="text-[8px] font-mono text-white/40">{totalGraded}/10 graded</span>
  </div>
) : (
  <div className="flex flex-col items-center px-2">
    <span className={`text-sm font-mono font-bold ${opsData.alerts.accuracy >= 60 ? 'text-emerald-400' : 'text-amber-400'}`}>
      {opsData.alerts.accuracy}%
    </span>
    <span className="text-[8px] font-mono text-white/40">accuracy</span>
  </div>
)}
```

---

## Fix 6: Journal Query Performance

The hunt_knowledge query with 14 content_type filters across 2.4M rows hit a 503. Two fixes:

**A) Add a composite index:**

```sql
CREATE INDEX CONCURRENTLY idx_hunt_knowledge_journal
  ON hunt_knowledge (content_type, created_at DESC)
  WHERE content_type IN (
    'compound-risk-alert', 'convergence-score', 'anomaly-alert',
    'correlation-discovery', 'alert-grade', 'arc-grade-reasoning',
    'arc-fingerprint', 'state-brief', 'disaster-watch',
    'migration-spike-extreme', 'migration-spike-significant',
    'nws-alert', 'weather-event', 'bio-absence-signal'
  );
```

**B) Add a state filter to the index if state filtering is common:**

```sql
CREATE INDEX CONCURRENTLY idx_hunt_knowledge_journal_state
  ON hunt_knowledge (state_abbr, content_type, created_at DESC)
  WHERE content_type IN (
    'compound-risk-alert', 'convergence-score', 'anomaly-alert',
    'correlation-discovery', 'alert-grade', 'arc-grade-reasoning',
    'arc-fingerprint', 'state-brief', 'disaster-watch',
    'migration-spike-extreme', 'migration-spike-significant',
    'nws-alert', 'weather-event', 'bio-absence-signal'
  );
```

**C) Consider a time window filter.** The current query has no time constraint — it's pulling from the entire 2.4M table. Add a created_at filter for last 48 hours:

```typescript
// In useBrainJournal.ts:
const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
url += `&created_at=gte.${cutoff}`;
```

Run `CREATE INDEX CONCURRENTLY` — not plain `CREATE INDEX` — to avoid locking the table.

---

## Fix 7: Register pg_cron for Narrator Daily Sweep

The narrator has event-triggered mode working (fires when arc reactor hooks call it), but the daily sweep that refreshes ALL active arc narratives has no cron job.

```sql
SELECT cron.schedule(
  'hunt-arc-narrator-sweep',
  '0 9 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-arc-narrator',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{"trigger": "daily_sweep"}'::jsonb
  );
  $cron$
);
```

Also add it to the EXPECTED_CRONS in `hunt-cron-health` so it shows up on the ops dashboard.

---

## Fix 8: TrackRecord Section

Below the journal feed, add a Track Record section that shows the grading loop's performance.

### Data source

`hunt_alert_calibration` table (weekly aggregated accuracy stats).

### Display

```
┌─ TRACK RECORD ───────────────────────────────────────┐
│                                                       │
│  Overall: Learning... (3 graded, need 10+)            │
│                                                       │
│  By source:                                           │
│  compound-risk   ██████████░░░░  67%  (3/4 confirmed) │
│  convergence     ████████░░░░░░  50%  (2/4)           │
│                                                       │
│  By state:                                            │
│  TX: 2 graded (1 confirmed, 1 partial)               │
│  OK: 1 graded (1 confirmed)                          │
│                                                       │
│  Recent grades:                                       │
│  ✓ Mar 25 TX compound-risk CONFIRMED                 │
│  ◐ Mar 24 OK compound-risk PARTIAL                   │
│  ✗ Mar 23 AR compound-risk MISSED                    │
│                                                       │
│  If fewer than 10 total grades, show:                │
│  "The brain is still calibrating. First grades       │
│   started March 27. Reliable accuracy stats          │
│   require 50+ graded arcs."                          │
└──────────────────────────────────────────────────────┘
```

### New files
```
src/components/intelligence/TrackRecord.tsx
src/hooks/useTrackRecord.ts   # Pulls from hunt_alert_calibration + hunt_alert_outcomes
```

---

## Fix 9: Mobile Responsiveness

The page should work at 375px (mobile-first per CLAUDE.md).

### Changes needed:
- State board: single column on mobile, arc cards stack vertically
- Tier headers: full-width, sticky
- Journal feed: full-width, slightly smaller font
- State filter pills: horizontal scroll (already works)
- ArcDetailView: full-screen slide-up panel on mobile (like a modal sheet)
- Header stats: compress — show only entries count + health dot on small screens, full stats on sm+

---

## Fix 10: Arc Card Improvements

### A) Show convergence score prominently
Add the actual score number to each card. Currently it only shows domain count.

```typescript
// In ArcBanner:
<span className="text-lg font-mono font-bold text-cyan-400">{score}</span>
<span className="text-[8px] text-white/30">/ 135</span>
```

### B) Show which domains are converging
Display domain pills (Weather, Migration, BirdCast, etc.) from `arc.buildup_signals.domains`:

```typescript
{domains.map(d => (
  <span key={d} className="text-[7px] font-mono px-1.5 py-0.5 rounded bg-cyan-400/10 text-cyan-400/60">
    {d}
  </span>
))}
```

### C) Show narrative preview without markdown artifacts
Use the `renderNarrative()` helper from Fix 4.

### D) Color-code the card border by act
```
buildup: border-l-4 border-amber-400
recognition: border-l-4 border-orange-400
outcome: border-l-4 border-red-400
grade: border-l-4 border-emerald-400
```

---

## Page Structure (Final Layout)

```
┌──────────────────────────────────────────────────────┐
│  BRAIN JOURNAL — WATCH THE BRAIN THINK                │
│  ← back   2.4M entries | 48 arcs | Learning (3/10) ● │
└──────────────────────────────────────────────────────┘

┌─ CRITICAL ──────────────────────────────────────────┐
│  [Full arc cards — click to expand detail below]     │
│  TX ●OUTCOME  Score 83/135  7 domains  6d 17h       │
│  "TX compound risk — 7 domains converging..."        │
│  ┌ ArcDetailView (if expanded) ───────────────────┐ │
│  │ Full narrative, timeline, convergence bars,     │ │
│  │ claim, outcome signals, fingerprint matches     │ │
│  └────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘

┌─ ELEVATED ──────────────────────────────────────────┐
│  [Medium cards, 2-col grid]                          │
│  GA ●RECOGNITION  FL ●RECOGNITION  AR ●RECOGNITION  │
└──────────────────────────────────────────────────────┘

┌─ ACTIVE ────────────────────────────────────────────┐
│  [Compact pills]                                     │
│  OK 54 ● | MO 48 ● | MN 52 ● | IA 49 ● | ...      │
└──────────────────────────────────────────────────────┘

┌─ State Filter ──────────────────────────────────────┐
│  [All States] TX  MS  WI  NJ  MN  IA  OK  MO ...   │
└──────────────────────────────────────────────────────┘

┌─ Journal Type Filter ───────────────────────────────┐
│  [Brain Activity] [Weather] [Migration] [Alerts]     │
└──────────────────────────────────────────────────────┘

┌─ JOURNAL ───────────────────────────────────────────┐
│  TODAY 38 entries                                     │
│  ○ 06:14 AM  COMPOUND RISK  TX  ×2.0                │
│    COMPOUND RISK: TX — 6 domains converging          │
│    [click to expand full text + metadata]             │
│  ○ 04:08 AM  CONVERGENCE  TX                         │
│    TX convergence 2026-03-27                          │
│  ○ 03:18 AM  COMPOUND RISK  TX  ×2.0                │
│    COMPOUND RISK: TX — 6 domains converging          │
│  ...                                                 │
│  YESTERDAY 142 entries                               │
│  ...                                                 │
└──────────────────────────────────────────────────────┘

┌─ TRACK RECORD ──────────────────────────────────────┐
│  Learning... (3 graded, need 10+)                    │
│  By source: compound-risk 67% (3 arcs)               │
│  Recent: ✓ TX confirmed | ◐ OK partial               │
└──────────────────────────────────────────────────────┘
```

---

## Build Order

1. **Database:** Create the composite indexes on hunt_knowledge (Fix 6)
2. **Database:** Register pg_cron for narrator daily sweep (Fix 7)
3. **Frontend — Quick wins first:**
   - Fix 4: Markdown rendering in narratives (simple regex, apply everywhere)
   - Fix 5: "Learning..." state for accuracy
   - Fix 10: Arc card improvements (score, domain pills, border colors)
4. **Frontend — Tier grouping (Fix 2):** Restructure the arc grid into Critical/Elevated/Active
5. **Frontend — Journal filtering (Fix 3):** Add type filter tabs, default to "Brain Activity"
6. **Frontend — ArcDetailView (Fix 1):** The big one. Build the detail panel with full narrative, timeline, convergence bars, claim/outcome, fingerprint matches
7. **Frontend — TrackRecord (Fix 8-9):** Add the grading accuracy section
8. **Test end-to-end:** Load the page, verify tiers display, click an arc, see the detail view, filter by state, filter by type, check mobile at 375px

---

## Rules (from CLAUDE.md — do not break)

- **THE EMBEDDING LAW:** Every piece of data MUST be embedded. If you create new content types, embed them.
- Pin `supabase-js@2.84.0`, `std@0.168.0` in edge functions
- NEVER retry 4xx — only 5xx and network errors
- NEVER use `{ count: 'exact' }` on hunt_knowledge — use `{ count: 'estimated' }`
- All hunt_ tables share Supabase project with JAC Agent OS — NEVER touch JAC tables
- Dark theme: bg-gray-950, cyan/teal accents
- Fonts: Playfair Display (headings), Lora (body)
- Mobile-first: every feature works at 375px
- Show don't predict. "The last N times these conditions aligned, here's what happened." Never "it WILL happen."
- `CREATE INDEX CONCURRENTLY` on production tables — never plain `CREATE INDEX`

---

## What Success Looks Like

When this is done:
- Load `/intelligence` — see states grouped by Critical/Elevated/Active, not a flat wall of 48 identical cards
- Click Texas — see the full arc story: narrative, timeline, convergence breakdown, claim, outcome signals
- The narrative reads as actual prose, not `**raw markdown**`
- The journal defaults to brain activity (compound risks, convergences, grades) — not buried under raw weather noise
- Accuracy shows "Learning... (3/10 graded)" not a raw "0%"
- Track record section shows early grading results and explains the brain is still calibrating
- Page loads fast — no 503 from the journal query
- Narrator fires daily at 9 AM UTC refreshing all active arc narratives
- Works on mobile at 375px — single column, slide-up detail panels
- A visitor can understand what the brain is doing without any prior context — the page tells the story

This is the product. Everything else is infrastructure.
