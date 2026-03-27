# Synthesis Agent & Intelligence Page — Build Handoff

> **Read CLAUDE.md first.** It has the full architecture, the vision, the arc model, and the rules. This document is the build spec for the synthesis agent and the Intelligence Page that renders it.

---

## What You're Building

The synthesis agent is the layer that turns discrete pipeline outputs into coherent narrative arcs per state. Today the convergence engine scores, the alert system fires, the grader grades — but nothing connects the dots. Nothing says "Texas has been building for 3 days, here's the full story."

You're building two things:

1. **The Arc Reactor** — an event-driven state machine that tracks narrative arcs per state. No new cron. It hooks into existing functions that already detect transitions.
2. **The Intelligence Page** — the frontend that renders the arcs in real time. The primary product page.

Plus a narrator layer (Sonnet for live narratives, Opus for grade reasoning) and arc fingerprinting (embedding completed arcs for historical pattern matching).

---

## Part 1: Database — `hunt_state_arcs` Table

Create this table. This is the spine of the entire system.

```sql
CREATE TABLE hunt_state_arcs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  state_abbr TEXT NOT NULL,
  arc_id UUID DEFAULT gen_random_uuid() NOT NULL,
  current_act TEXT NOT NULL CHECK (current_act IN ('buildup', 'recognition', 'outcome', 'grade', 'closed')),
  act_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,

  -- Act 1: Buildup
  buildup_signals JSONB DEFAULT '{}',
  -- Expected shape: { domains: string[], convergence_score: number, score_trend: number[], trigger: string, anomalies: string[] }

  -- Act 2: Recognition
  recognition_claim JSONB DEFAULT '{}',
  -- Expected shape: { claim: string, alert_id: uuid, precedents: number, precedent_hit_rate: float, pattern_type: string, expected_signals: string[] }
  recognition_alert_id UUID,

  -- Act 3: Outcome
  outcome_deadline TIMESTAMPTZ,
  outcome_signals JSONB DEFAULT '[]',
  -- Expected shape: [{ signal: string, timestamp: string, match_type: string, source: string }]

  -- Act 4: Grade
  grade TEXT CHECK (grade IN ('confirmed', 'partially_confirmed', 'missed', 'false_alarm')),
  grade_reasoning TEXT,
  -- grade_reasoning is Opus-generated: which component was right, which was noise, how to adjust

  -- Meta
  precedent_accuracy FLOAT,
  narrative TEXT,
  -- Latest Sonnet-generated narrative for this arc

  fingerprint_embedding vector(512),
  -- Embedded after arc closes. The full arc (signals + claim + outcome + grade + reasoning) as one vector.

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_state_arcs_state ON hunt_state_arcs(state_abbr);
CREATE INDEX idx_state_arcs_active ON hunt_state_arcs(current_act) WHERE current_act != 'closed';
CREATE INDEX idx_state_arcs_open ON hunt_state_arcs(state_abbr, current_act) WHERE current_act != 'closed';
CREATE INDEX idx_state_arcs_fingerprint ON hunt_state_arcs USING ivfflat (fingerprint_embedding vector_cosine_ops) WITH (lists = 20);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_state_arcs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER state_arcs_updated_at
  BEFORE UPDATE ON hunt_state_arcs
  FOR EACH ROW EXECUTE FUNCTION update_state_arcs_updated_at();

-- Enable Realtime
ALTER TABLE hunt_state_arcs REPLICA IDENTITY FULL;
```

**A state can have multiple simultaneous arcs.** Texas could have a weather convergence arc AND a separate drought-migration arc. `arc_id` makes each independent. The frontend groups by state and shows all active arcs.

---

## Part 2: The Arc Reactor — Event-Driven Hooks

No new cron. Add 10-20 lines to these existing functions. Each function already detects the relevant transition — it just needs to write the arc state.

### 2A: hook into `hunt-convergence-scan` (Act 1 → Act 2)

This function already detects compound-risk (3+ domains converging) and writes to hunt_alert_outcomes. Add arc logic after the compound-risk alert is created:

```typescript
// After compound-risk alert is created and outcome record inserted...

// Check for existing open arc for this state
const { data: existingArc } = await supabase
  .from('hunt_state_arcs')
  .select('id, current_act')
  .eq('state_abbr', state_abbr)
  .neq('current_act', 'closed')
  .order('opened_at', { ascending: false })
  .limit(1)
  .maybeSingle();

if (!existingArc) {
  // No open arc — create new arc directly in recognition (buildup was implicit)
  const { error: arcErr } = await supabase.from('hunt_state_arcs').insert({
    state_abbr,
    current_act: 'recognition',
    buildup_signals: {
      domains: Object.keys(domains),
      convergence_score: totalScore,
      trigger: `${convergingCount} domains converging: ${Object.keys(domains).join(', ')}`,
    },
    recognition_claim: {
      claim: `${convergingCount} domains converging in ${state_abbr}`,
      alert_id: outcomeId, // from the hunt_alert_outcomes insert
      expected_signals: ['nws-alert', 'weather-event', 'storm-event'],
      pattern_type: 'compound-risk',
    },
    recognition_alert_id: outcomeId,
    outcome_deadline: outcomeDeadline,
  });
  if (arcErr) console.error(`[${FUNCTION_NAME}] Arc insert failed:`, arcErr.message);
  else {
    // Fire narrator for this state (event-triggered)
    fetch(`${SUPABASE_URL}/functions/v1/hunt-arc-narrator`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state_abbr, trigger: 'arc_created' }),
    }).catch(() => {});
  }
} else if (existingArc.current_act === 'buildup') {
  // Arc exists in buildup — transition to recognition
  await supabase.from('hunt_state_arcs').update({
    current_act: 'recognition',
    act_started_at: new Date().toISOString(),
    recognition_claim: {
      claim: `${convergingCount} domains converging in ${state_abbr}`,
      alert_id: outcomeId,
      expected_signals: ['nws-alert', 'weather-event', 'storm-event'],
      pattern_type: 'compound-risk',
    },
    recognition_alert_id: outcomeId,
    outcome_deadline: outcomeDeadline,
  }).eq('id', existingArc.id);

  // Fire narrator
  fetch(`${SUPABASE_URL}/functions/v1/hunt-arc-narrator`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state_abbr, trigger: 'act_transition' }),
  }).catch(() => {});
}
```

### 2B: hook into `hunt-convergence-engine` (Act 1 creation for rising signals)

This function scores all 50 states daily. After scoring, check for states with rapidly rising scores that don't yet have an alert but show buildup:

```typescript
// After scoring is complete for a state...

if (convergingDomains >= 2 && scoreDelta > 15) {
  // Score rising fast, 2+ domains — check for open arc
  const { data: existingArc } = await supabase
    .from('hunt_state_arcs')
    .select('id')
    .eq('state_abbr', state_abbr)
    .neq('current_act', 'closed')
    .limit(1)
    .maybeSingle();

  if (!existingArc) {
    // Create buildup arc
    await supabase.from('hunt_state_arcs').insert({
      state_abbr,
      current_act: 'buildup',
      buildup_signals: {
        domains: convergingDomainNames,
        convergence_score: totalScore,
        score_trend: [yesterdayScore, totalScore],
        trigger: `Score rose ${scoreDelta} points, ${convergingDomains} domains converging`,
      },
    });
  } else {
    // Update buildup signals on existing arc
    await supabase.from('hunt_state_arcs').update({
      buildup_signals: {
        domains: convergingDomainNames,
        convergence_score: totalScore,
        score_trend: [yesterdayScore, totalScore],
        trigger: `Score rose ${scoreDelta} points, ${convergingDomains} domains converging`,
      },
    }).eq('id', existingArc.id);
  }
}
```

### 2C: hook into `hunt-alert-grader` (Act 3 → Act 4)

This function already grades alerts. After grading, update the arc:

```typescript
// After grading an alert...

// Find the arc linked to this alert
const { data: arc } = await supabase
  .from('hunt_state_arcs')
  .select('id, state_abbr, current_act, recognition_claim, buildup_signals, outcome_signals')
  .eq('recognition_alert_id', alertOutcomeId)
  .neq('current_act', 'closed')
  .maybeSingle();

if (arc) {
  // Update arc to grade act
  await supabase.from('hunt_state_arcs').update({
    current_act: 'grade',
    act_started_at: new Date().toISOString(),
    grade: outcomeGrade, // confirmed, partially_confirmed, missed, false_alarm
  }).eq('id', arc.id);

  // Fire Opus for grade reasoning (this is the one call worth Opus)
  fetch(`${SUPABASE_URL}/functions/v1/hunt-arc-narrator`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state_abbr: arc.state_abbr,
      trigger: 'grade_assigned',
      arc_id: arc.id,
      use_opus: true, // narrator uses Opus for grade reasoning
    }),
  }).catch(() => {});
}
```

### 2D: Outcome signal detection (during Act 3)

When new data arrives for a state that has an open arc in recognition/outcome, check if it's a confirmation signal. Add to `hunt-nws-monitor` and `hunt-weather-watchdog`:

```typescript
// After processing NWS alerts or weather events for a state...

if (significantEvent) {
  const { data: openArc } = await supabase
    .from('hunt_state_arcs')
    .select('id, current_act, outcome_signals')
    .eq('state_abbr', state_abbr)
    .in('current_act', ['recognition', 'outcome'])
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (openArc) {
    const newSignal = {
      signal: eventType, // e.g. "Severe Thunderstorm Warning"
      timestamp: new Date().toISOString(),
      match_type: 'direct_confirmation',
      source: FUNCTION_NAME,
    };
    const updatedSignals = [...(openArc.outcome_signals || []), newSignal];

    await supabase.from('hunt_state_arcs').update({
      current_act: 'outcome',
      act_started_at: openArc.current_act === 'recognition' ? new Date().toISOString() : undefined,
      outcome_signals: updatedSignals,
    }).eq('id', openArc.id);

    // Fire narrator — outcome signal arrived
    fetch(`${SUPABASE_URL}/functions/v1/hunt-arc-narrator`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ state_abbr, trigger: 'outcome_signal' }),
    }).catch(() => {});
  }
}
```

---

## Part 3: The Narrator — `hunt-arc-narrator` (NEW Edge Function)

New edge function. Called two ways:
1. **Event-triggered:** by the arc reactor hooks (immediate, for specific state)
2. **Daily cron:** sweeps all active arcs and regenerates narratives

### Inputs

```typescript
interface NarratorRequest {
  state_abbr?: string;    // specific state (event trigger) or null (daily sweep)
  trigger?: string;       // 'arc_created' | 'act_transition' | 'outcome_signal' | 'grade_assigned' | 'daily_sweep'
  arc_id?: string;        // specific arc (optional)
  use_opus?: boolean;     // true for grade reasoning only
}
```

### What it does

For each arc it processes:

1. **Reads context:**
   - The arc row (current_act, signals, claim, outcome_signals, grade)
   - Current convergence score + 3-day trend from hunt_convergence_scores
   - Active pattern links for this state from hunt_pattern_links (last 72h)
   - Previous narrative from the arc row (for continuity)
   - Calibration accuracy for this state from hunt_alert_calibration
   - If Act 2+: search hunt_knowledge for similar historical arc-fingerprints

2. **Calls the right model:**
   - **Sonnet** for all narratives (buildup, recognition, outcome updates)
   - **Opus** for grade reasoning only (when `use_opus: true` or `trigger === 'grade_assigned'`)

3. **Sonnet prompt for narrative:**

```
You are the Duck Countdown Brain — an environmental pattern recognition engine. You are writing the live narrative for an active intelligence arc in ${state_abbr}.

Current arc state:
- Act: ${current_act}
- Opened: ${opened_at}
- Buildup signals: ${JSON.stringify(buildup_signals)}
- Recognition claim: ${JSON.stringify(recognition_claim)}
- Outcome deadline: ${outcome_deadline}
- Outcome signals received: ${JSON.stringify(outcome_signals)}
- Convergence score: ${score} (trend: ${trend})
- Historical accuracy for this pattern type: ${precedent_accuracy}%

Similar historical arcs (from fingerprint search):
${similar_arcs}

Previous narrative (for continuity):
${previous_narrative}

Write 3-5 sentences. Be specific — cite actual numbers, domains, signals. Never say "will happen" — say "the last N times this pattern appeared, X happened." Show your reasoning. If this is a buildup, say what you're watching for. If recognition, state the claim and the historical basis. If outcome, describe what signals have arrived vs what was expected. Be honest about uncertainty.
```

4. **Opus prompt for grade reasoning (Act 4 only):**

```
You are the Duck Countdown Brain performing a post-mortem on a completed intelligence arc.

The arc:
- State: ${state_abbr}
- Buildup signals: ${JSON.stringify(buildup_signals)}
- Claim made: ${JSON.stringify(recognition_claim)}
- Outcome signals received: ${JSON.stringify(outcome_signals)}
- Grade: ${grade}
- Convergence components at time of claim: ${components}
- Historical accuracy for this pattern type before this arc: ${precedent_accuracy}%

Analyze this arc:
1. Which convergence component was the strongest signal? Which was noise?
2. If missed or false_alarm: what signal was misleading? What was missing from the data?
3. If confirmed: what was the earliest reliable signal? Could recognition have happened sooner?
4. How should the brain adjust weighting for similar future patterns?

Be specific. Reference actual data. This reasoning feeds back into the brain's learning loop — it must be honest and actionable, not generic.
```

5. **Writes results:**
   - Updates `narrative` on the arc row
   - Updates `grade_reasoning` on the arc row (Opus calls only)
   - Writes the narrative to `hunt_state_briefs` for the Intelligence Page
   - If grade reasoning was generated: embed the full reasoning into hunt_knowledge as content_type `arc-grade-reasoning` (THE EMBEDDING LAW)

6. **Arc closing + fingerprinting:**
   - If `trigger === 'grade_assigned'` and grade reasoning is complete:
   - Concatenate: buildup_signals + recognition_claim + outcome_signals + grade + grade_reasoning
   - Embed via Voyage AI → store as `fingerprint_embedding` on the arc row
   - Also embed into hunt_knowledge as content_type `arc-fingerprint` with full arc context
   - Set `current_act = 'closed'`, `closed_at = now()`

### Daily cron

Add to pg_cron schedule: run hunt-arc-narrator at **9:00 AM UTC** (after convergence-engine at 8:00 and convergence-alerts at 8:15). Daily sweep mode: processes all arcs where `current_act != 'closed'`. This ensures every active arc gets a fresh narrative daily even if no event triggered it.

---

## Part 4: Arc Fingerprint Search

When the narrator processes an arc in Act 1 or Act 2, it should search for similar completed arcs:

```typescript
// Search for similar historical arcs
const arcDescription = `${state_abbr} ${buildup_signals.domains.join(' ')} convergence ${buildup_signals.trigger}`;
const embedding = await generateEmbedding(arcDescription, 'document');

const { data: similarArcs } = await supabase.rpc('search_hunt_knowledge_v3', {
  query_embedding: embedding,
  match_threshold: 0.65,
  match_count: 5,
  filter_content_type: 'arc-fingerprint',
  // Don't filter by state — we want cross-state pattern matches
});
```

This is the feature nobody else has. "This buildup in Texas looks 87% similar to a November 2024 buildup in Louisiana that was confirmed. That arc's weather component was the strongest signal."

---

## Part 5: Intelligence Page Frontend

### Route

`/intelligence` — already exists (initial build March 26). Rebuild it to render arc data.

### Data Flow

```
hunt_state_arcs (Realtime subscription) → State Board + Arc Detail
hunt_state_briefs (Realtime subscription) → Narrative display
hunt_convergence_scores (existing hook) → Score badges
hunt_alert_calibration (existing hook) → Accuracy display
```

### Page Layout

```
┌──────────────────────────────────────────────────────────────┐
│  DUCK COUNTDOWN — ENVIRONMENTAL INTELLIGENCE                  │
│  Brain: 2.4M+ entries | Active Arcs: 7 | Graded: 12 | 62%   │
│  ● LIVE                                                       │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  STATE BOARD                                                  │
│                                                               │
│  ┌─ CRITICAL ─────────────────────────────────────────────┐  │
│  │ TX  ●RECOGNITION  Score:83  Weather+Migration+Water    │  │
│  │     "4 domains converging. Last 14 matches: 57% conf." │  │
│  │     Claim deadline: 6d 23h  [View Arc →]               │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │ OK  ●OUTCOME  Score:71  Weather+BirdCast               │  │
│  │     "Confirmation signal: NWS Severe T-storm Warning"   │  │
│  │     Claim deadline: 2d 4h  [View Arc →]                │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─ ELEVATED ─────────────────────────────────────────────┐  │
│  │ MS  ●BUILDUP  Score:58  Water+Drought                  │  │
│  │ LA  ●BUILDUP  Score:54  Weather+Migration              │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                               │
│  ┌─ QUIET ────────────────────────────────────────────────┐  │
│  │ CA 32 | NY 28 | FL 25 | WA 22 | ... (46 more)         │  │
│  └─────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────┬───────────────────────────────────────┐
│  LIVE FEED            │  TRACK RECORD                         │
│                       │                                       │
│  12:16 TX entered     │  Compound-risk: 62% (12 arcs)        │
│    RECOGNITION —      │  TX: 67% (6 arcs)                    │
│    4 domains          │  OK: 50% (4 arcs)                    │
│                       │  Gulf states March: 71% (7 arcs)     │
│  12:15 TX weather     │                                       │
│    event: -3.2mb      │  Recent grades:                       │
│    pressure drop      │  ✓ OK compound-risk CONFIRMED         │
│    at KDFW            │  ✗ AR compound-risk MISSED            │
│                       │  ◐ MS compound-risk PARTIAL           │
│  11:30 OK outcome     │                                       │
│    signal: NWS        │  "Learning..." (12 arcs graded,       │
│    Severe T-storm     │   need 50+ for reliable stats)        │
│                       │                                       │
└──────────────────────┴───────────────────────────────────────┘
```

### Arc Detail View (click "View Arc →")

When user clicks a state with an active arc, show:

**Top:** Full narrative from the narrator (the Sonnet-generated story)

**Timeline:** Visual timeline showing act transitions with timestamps:
```
● BUILDUP (Mar 23)  →  ● RECOGNITION (Mar 24)  →  ◌ OUTCOME (waiting)  →  ○ GRADE
                        "4 domains converging"      Deadline: Mar 31
```

**For Act 3 states — Split View:**
Left: The claim — what the brain said would happen
Right: Reality — outcome signals arriving in real time

**Fingerprint Matches:** "This arc looks 87% similar to:" + list of historical arcs with their outcomes

**Convergence Breakdown:** The 8-component score visualization (already exists in ConvergencePanel — reuse)

### Supabase Realtime Subscriptions

```typescript
// Subscribe to arc state changes
supabase
  .channel('intelligence-arcs')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'hunt_state_arcs',
  }, (payload) => {
    // Update state board + arc detail
  })
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'hunt_state_briefs',
  }, (payload) => {
    // Update narratives
  })
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'hunt_knowledge',
    filter: 'content_type=in.(compound-risk-alert,anomaly-alert,correlation-discovery,alert-grade,weather-realtime,nws-alert)',
  }, (payload) => {
    // Live feed events
  })
  .subscribe();
```

**Note:** Filtered Realtime subscriptions require `REPLICA IDENTITY FULL` on the table. Already set for hunt_state_arcs in the migration above. Run this for hunt_knowledge if not already set:

```sql
ALTER TABLE hunt_knowledge REPLICA IDENTITY FULL;
-- WARNING: This is a 2.4M row table. REPLICA IDENTITY FULL increases WAL size.
-- Monitor WAL after enabling. If it's too much, remove the filter and filter client-side instead.
```

### New Components

```
src/
  pages/
    IntelligencePage.tsx     # Main page — state board + feed + track record
  components/intelligence/
    StateBoard.tsx           # Ranked state grid with arc badges
    StateArcCard.tsx         # Individual state card (score, act, domains, countdown)
    ArcDetailView.tsx        # Expanded view when state clicked
    ArcTimeline.tsx          # Visual act progression timeline
    ArcSplitView.tsx         # Claim vs reality for Act 3
    LiveFeed.tsx             # Real-time event stream
    TrackRecord.tsx          # Grading accuracy display
    FingerprintMatches.tsx   # Similar historical arcs
    CountdownClock.tsx       # Deadline countdown for Act 3
  hooks/
    useStateArcs.ts          # Realtime subscription to hunt_state_arcs
    useArcDetail.ts          # Full arc data for detail view
    useIntelFeed.ts          # Realtime feed events
    useTrackRecord.ts        # Grading stats from hunt_alert_calibration
```

### Styling

- Dark theme: bg-gray-950, cyan/teal accents (match existing site)
- Act badge colors: BUILDUP = amber, RECOGNITION = orange, OUTCOME = red, GRADE = green/red based on result, QUIET = gray
- Fonts: Playfair Display headings, Lora body
- Mobile-first: state board becomes vertical list, feed below it
- No map on this page. Map accessible from header for drill-down.

---

## Part 6: New Edge Function Summary

| Function | Type | Trigger | Model |
|----------|------|---------|-------|
| hunt-arc-narrator | Brain Reader | Event-driven (HTTP POST from reactor hooks) + daily cron 9:00 AM | Sonnet (narratives) + Opus (grade reasoning only) |

### Functions Modified (arc reactor hooks)

| Function | What to Add |
|----------|-------------|
| hunt-convergence-engine | Check for buildup conditions (2+ domains, score rising >15pts). Create Act 1 arc if none exists. |
| hunt-convergence-scan | After compound-risk alert: create arc in Act 2 or transition existing from Act 1 → Act 2. Fire narrator. |
| hunt-alert-grader | After grading: update arc to Act 4, record grade. Fire narrator with use_opus=true. |
| hunt-nws-monitor | After processing alerts: check for open arcs in this state, add outcome signal if match. Fire narrator. |
| hunt-weather-watchdog | After detecting events: check for open arcs, add outcome signal. Fire narrator. |

### Shared module addition

Add to `_shared/arcReactor.ts`:

```typescript
// Shared helpers for arc state management
export async function getOpenArc(supabase, state_abbr: string) { ... }
export async function createArc(supabase, state_abbr: string, act: string, data: any) { ... }
export async function transitionArc(supabase, arcId: string, newAct: string, data: any) { ... }
export async function addOutcomeSignal(supabase, arcId: string, signal: any) { ... }
export async function fireNarrator(state_abbr: string, trigger: string, opts?: { arc_id?: string, use_opus?: boolean }) { ... }
```

**IMPORTANT:** After creating `_shared/arcReactor.ts`, you must redeploy EVERY function that imports it (convergence-engine, convergence-scan, alert-grader, nws-monitor, weather-watchdog, arc-narrator).

---

## Part 7: pg_cron Registration

```sql
SELECT cron.schedule(
  'hunt-arc-narrator',
  '0 9 * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-arc-narrator',
    headers := '{"Authorization": "Bearer ' || current_setting('app.settings.service_role_key') || '", "Content-Type": "application/json"}'::jsonb,
    body := '{"trigger": "daily_sweep"}'::jsonb
  );
  $cron$
);
```

---

## Build Order

1. **Create hunt_state_arcs table** (migration SQL above)
2. **Create _shared/arcReactor.ts** (shared helpers)
3. **Create hunt-arc-narrator edge function** (the narrator)
4. **Hook into hunt-convergence-scan** (Act 1 → Act 2 transitions) — this is the most active trigger
5. **Hook into hunt-convergence-engine** (Act 1 buildup creation)
6. **Hook into hunt-alert-grader** (Act 3 → Act 4 transitions)
7. **Hook into hunt-nws-monitor + hunt-weather-watchdog** (outcome signal detection)
8. **Deploy all modified functions** (remember: shared module change = redeploy everything that imports it)
9. **Register pg_cron** for daily narrator sweep
10. **Build Intelligence Page frontend** — state board, live feed, track record, arc detail
11. **Test end-to-end** — manually invoke hunt-convergence-scan for a state with converging signals, verify arc created, narrator fires, page updates via Realtime

---

## Rules (from CLAUDE.md — do not break)

- **THE EMBEDDING LAW:** Arc grade reasoning and arc fingerprints MUST be embedded into hunt_knowledge
- Pin `supabase-js@2.84.0`, `std@0.168.0` in edge functions
- NEVER retry 4xx — only 5xx and network
- Every early-return in cron functions calls `logCronRun`
- Shared module change → redeploy EVERY function that imports it
- NEVER use `$$` in pg_cron — use `$cron$`/`$body$`
- NEVER use `{ count: 'exact' }` on hunt_knowledge — use `{ count: 'estimated' }`
- All hunt_ tables share Supabase project with JAC Agent OS — NEVER touch JAC tables
- Show don't predict. "The last N times these conditions aligned, here's what happened." Never "it WILL happen."

---

## What Success Looks Like

When this is done:
- Visit duckcountdown.com/intelligence
- See a state board with 3-8 active arcs, ranked by severity
- Each arc shows its act (buildup/recognition/outcome/grade), the convergence breakdown, and a countdown timer if in Act 3
- Click a state → see the full Sonnet-generated narrative, the timeline, the fingerprint matches
- Watch in real time as crons fire: a weather event triggers a convergence scan, which triggers an arc transition, which triggers the narrator, which updates the page — all within seconds
- See the track record: how often the brain has been right, per state, per pattern type
- See a completed arc with Opus-generated grade reasoning explaining what worked and what was noise
- Search completed arcs via fingerprint: "this buildup looks 87% similar to one that was confirmed"

This is the product. Everything else is infrastructure.
