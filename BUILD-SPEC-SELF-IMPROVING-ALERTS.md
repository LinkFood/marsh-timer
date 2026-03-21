# BUILD SPEC: Self-Improving Alert Feedback Loop

**Purpose:** This document is a complete build spec for Claude Code. Follow it step by step. Every alert the brain fires should be tracked, graded, and the grade embedded back into hunt_knowledge — making the brain smarter with every prediction, right or wrong.

**Repo:** `/sessions/happy-determined-rubin/mnt/marsh-timer`
**Supabase project:** `rvhyotvklfowklzjahdd`

---

## CONTEXT: What Already Exists

Before building, understand the current landscape.

### Active Self-Graders (already running, embed grades into hunt_knowledge)
- `hunt-forecast-tracker` — daily, scores predicted vs actual weather. Embeds `content_type='forecast-accuracy'`.
- `hunt-migration-report-card` — daily, grades 7-day-old convergence predictions vs actual migration. Embeds `content_type='migration-report-card'`. Grades: confirmed, missed, surprise, quiet.
- `hunt-convergence-report-card` — weekly, aggregates model performance. Embeds `content_type='convergence-report-card'`.

### Active Alert Generators
- `hunt-convergence-alerts` — daily 8:15am UTC. Detects score spikes (jump ≥15, or cross 70 threshold). Inserts into `hunt_convergence_alerts` table AND embeds into hunt_knowledge. Has throttling (24hr per state).
- `hunt-alerts` — on-demand. Bulk forecast → filter interesting → vector search historical patterns → scored alerts for user delivery.
- `hunt-nws-monitor` — every 3hr. NWS severe weather alerts → embed.

### Dormant Intelligence (built, NOT on cron schedules)
- `hunt-anomaly-detector` — statistical outlier detection (2σ). Embeds `content_type='anomaly-alert'`.
- `hunt-correlation-engine` — cross-domain pattern discovery. Embeds `content_type='correlation-discovery'`.
- `hunt-disaster-watch` — climate index signatures vs pre-disaster patterns. Embeds `content_type='disaster-watch'`.

### Existing Infrastructure
- `_shared/cronLog.ts` — `logCronRun({ functionName, status, summary, errorMessage, durationMs })`
- `_shared/brainScan.ts` — `scanBrainOnWrite()` and `enrichWithPatternScan()` for query-on-write pattern matching
- `_shared/cors.ts` — `handleCors(req)` returns Response | null
- `_shared/response.ts` — `successResponse(data)`, `errorResponse(msg, status)`
- `_shared/supabase.ts` — `createSupabaseClient()` returns service-role client
- `hunt-generate-embedding` — Voyage AI embedding endpoint, accepts `{ input, input_type }`, returns 512-dim vector
- `search_hunt_knowledge_v2` — RPC for filtered vector search with recency boost
- `hunt_pattern_links` — table linking two hunt_knowledge entries by similarity

### Critical Conventions (DO NOT DEVIATE)
```typescript
// IMPORTS — exact versions, exact paths
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleCors } from '../_shared/cors.ts';
import { successResponse, errorResponse } from '../_shared/response.ts';
import { createSupabaseClient } from '../_shared/supabase.ts';
import { logCronRun } from '../_shared/cronLog.ts';

// TIMING
const startTime = Date.now();

// EMBEDDING — call hunt-generate-embedding, NOT Voyage directly
const embRes = await fetch(
  `${Deno.env.get('SUPABASE_URL')}/functions/v1/hunt-generate-embedding`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
    },
    body: JSON.stringify({ input: textToEmbed, input_type: 'document' }),
  }
);
const { embedding } = await embRes.json();

// BATCH EMBEDDING — for multiple texts
async function batchEmbed(texts: string[], inputType = 'document'): Promise<number[][]> {
  const results: number[][] = [];
  for (const text of texts) {
    const res = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/hunt-generate-embedding`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ input: text, input_type: inputType }),
      }
    );
    const { embedding } = await res.json();
    results.push(embedding);
  }
  return results;
}

// KNOWLEDGE INSERT — batch in groups of 50
const KNOWLEDGE_BATCH = 50;

// BRAIN SEARCH — via RPC
const { data } = await supabase.rpc('search_hunt_knowledge_v2', {
  query_embedding: embedding,
  match_threshold: 0.3,
  match_count: 5,
  filter_content_types: ['migration-spike-extreme', 'migration-spike-significant', 'weather-event'],
  filter_state_abbr: stateAbbr,
  filter_species: null,
  filter_date_from: null,
  filter_date_to: null,
  recency_weight: 0.1,
  exclude_du_report: true,
});

// CRON LOG — EVERY exit path, no exceptions
await logCronRun({
  functionName: 'hunt-alert-grader',
  status: 'success',
  summary: { graded: 12, confirmed: 5, missed: 3, false_alarm: 2, partial: 2 },
  durationMs: Date.now() - startTime,
});

// CONSOLE LOGGING
console.log('[hunt-alert-grader] Graded 12 alerts');
console.error('[hunt-alert-grader] Fatal:', error.message);
console.warn('[hunt-alert-grader] No alerts to grade, logging and returning');

// DATE HANDLING
const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
```

**Pin supabase-js to @2.84.0. Pin std to @0.168.0. All functions: verify_jwt = false.**

---

## PHASE 1: Schema — Alert Outcome Tracking

### Migration: `supabase/migrations/YYYYMMDD_alert_outcome_tracking.sql`

```sql
-- Add outcome tracking columns to hunt_convergence_alerts
ALTER TABLE hunt_convergence_alerts
ADD COLUMN IF NOT EXISTS predicted_outcome jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS outcome_window_hours integer DEFAULT 72,
ADD COLUMN IF NOT EXISTS outcome_checked boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS outcome_grade text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS outcome_reasoning text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS outcome_checked_at timestamptz DEFAULT NULL;

-- Index for the grader to find ungraded alerts efficiently
CREATE INDEX IF NOT EXISTS idx_convergence_alerts_ungraded
ON hunt_convergence_alerts (outcome_checked, created_at)
WHERE outcome_checked = false;

-- Table for tracking ALL alert types (not just convergence)
CREATE TABLE IF NOT EXISTS hunt_alert_outcomes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_source text NOT NULL,           -- 'convergence-alert', 'anomaly-alert', 'disaster-watch', 'nws-alert', 'weather-event'
  alert_knowledge_id uuid REFERENCES hunt_knowledge(id),  -- the hunt_knowledge entry for this alert
  state_abbr text,
  alert_date date NOT NULL,
  predicted_outcome jsonb NOT NULL,     -- { "claim": "...", "expected_signals": [...], "severity": "..." }
  outcome_window_hours integer DEFAULT 72,
  outcome_deadline timestamptz NOT NULL,
  outcome_checked boolean DEFAULT false,
  outcome_grade text,                   -- 'confirmed', 'partially_confirmed', 'missed', 'false_alarm'
  outcome_signals_found jsonb,          -- actual signals found during grading
  outcome_reasoning text,               -- why this grade was given
  grade_knowledge_id uuid,              -- the hunt_knowledge entry for the grade (feedback loop)
  graded_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_outcomes_ungraded
ON hunt_alert_outcomes (outcome_checked, outcome_deadline)
WHERE outcome_checked = false;

CREATE INDEX IF NOT EXISTS idx_alert_outcomes_source
ON hunt_alert_outcomes (alert_source, state_abbr);

CREATE INDEX IF NOT EXISTS idx_alert_outcomes_grade
ON hunt_alert_outcomes (outcome_grade, alert_source);

-- Calibration materialized view (refreshed by hunt-alert-calibration)
CREATE TABLE IF NOT EXISTS hunt_alert_calibration (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_source text NOT NULL,
  state_abbr text,                      -- NULL = national
  window_days integer NOT NULL,         -- 30, 60, 90
  total_alerts integer NOT NULL,
  confirmed integer DEFAULT 0,
  partially_confirmed integer DEFAULT 0,
  missed integer DEFAULT 0,
  false_alarm integer DEFAULT 0,
  accuracy_rate numeric(5,4),           -- confirmed+partial / total
  precision_rate numeric(5,4),          -- confirmed / (confirmed+false_alarm)
  updated_at timestamptz DEFAULT now(),
  UNIQUE(alert_source, state_abbr, window_days)
);
```

Push this migration. No data changes, safe to run.

---

## PHASE 2: Modify Alert Generators to Track Predictions

### 2A: Modify `hunt-convergence-alerts/index.ts`

After the existing insert into `hunt_convergence_alerts`, add an insert into `hunt_alert_outcomes`:

```typescript
// AFTER the convergence alert is inserted and embedded into hunt_knowledge:
const outcomeDeadline = new Date();
outcomeDeadline.setUTCHours(outcomeDeadline.getUTCHours() + 72);

await supabase.from('hunt_alert_outcomes').insert({
  alert_source: 'convergence-alert',
  alert_knowledge_id: knowledgeEntryId, // ID from the hunt_knowledge insert
  state_abbr: alert.state_abbr,
  alert_date: today,
  predicted_outcome: {
    claim: alert.reasoning,
    expected_signals: ['migration-spike', 'weather-event', 'convergence-score-increase'],
    severity: alert.alert_type,
    score: alert.score,
    previous_score: alert.previous_score,
    change: alert.change,
  },
  outcome_window_hours: 72,
  outcome_deadline: outcomeDeadline.toISOString(),
});
```

**Important:** The hunt_knowledge insert for the alert needs to RETURN the id. If the current code doesn't capture it, modify the insert to use `.select('id').single()` and capture `knowledgeEntryId`. If the current code doesn't embed the alert into hunt_knowledge, add embedding (follow the pattern from hunt-forecast-tracker).

### 2B: Modify `hunt-anomaly-detector/index.ts`

Same pattern. After embedding anomaly alerts into hunt_knowledge, insert into hunt_alert_outcomes:

```typescript
await supabase.from('hunt_alert_outcomes').insert({
  alert_source: 'anomaly-alert',
  alert_knowledge_id: knowledgeEntryId,
  state_abbr: anomaly.state_abbr || null,
  alert_date: today,
  predicted_outcome: {
    claim: anomaly.title,
    expected_signals: ['follow-up-activity'],
    severity: anomaly.metadata.severity, // 'extreme', 'high', 'elevated'
    z_score: anomaly.metadata.z_score,
    check_type: anomaly.metadata.check_type,
  },
  outcome_window_hours: 72,
  outcome_deadline: outcomeDeadline.toISOString(),
});
```

### 2C: Modify `hunt-disaster-watch/index.ts`

Longer outcome window (168 hours / 7 days) because disaster signatures play out slowly:

```typescript
await supabase.from('hunt_alert_outcomes').insert({
  alert_source: 'disaster-watch',
  alert_knowledge_id: knowledgeEntryId,
  state_abbr: null, // disaster-watch is national
  alert_date: today,
  predicted_outcome: {
    claim: signature.title,
    expected_signals: ['nws-alert', 'weather-event', 'anomaly-alert'],
    confidence: signature.metadata.confidence,
    signature_type: signature.metadata.signature_type,
    conditions: signature.metadata.conditions,
  },
  outcome_window_hours: 168,
  outcome_deadline: outcomeDeadline.toISOString(),
});
```

---

## PHASE 3: Build `hunt-alert-grader` Edge Function

**New file:** `supabase/functions/hunt-alert-grader/index.ts`
**Schedule:** Daily 11:30am UTC (after migration-report-card at 11am)
**Config:** Add to `supabase/config.toml`: `[functions.hunt-alert-grader]` with `verify_jwt = false`

### Logic:

1. Query `hunt_alert_outcomes` where `outcome_checked = false` AND `outcome_deadline < NOW()`.
2. For each ungraded alert:
   a. Read the original alert from hunt_knowledge using `alert_knowledge_id`.
   b. Generate an embedding for the query: `"What happened in {state_abbr} between {alert_date} and {deadline}?"`.
   c. Search hunt_knowledge via `search_hunt_knowledge_v2` with:
      - `filter_state_abbr`: the alert's state
      - `filter_content_types`: the alert's `predicted_outcome.expected_signals`
      - `filter_date_from`: alert_date
      - `filter_date_to`: deadline date
      - `match_count`: 10
      - `match_threshold`: 0.25 (lower threshold — we want to find anything)
   d. Also do a direct query (non-vector) for recent entries in that state/date window:
      ```typescript
      const { data: recentActivity } = await supabase
        .from('hunt_knowledge')
        .select('id, title, content_type, metadata, effective_date')
        .eq('state_abbr', alert.state_abbr)
        .gte('created_at', alert.alert_date)
        .lte('created_at', alert.outcome_deadline)
        .in('content_type', [
          'migration-spike-extreme', 'migration-spike-significant', 'migration-spike-moderate',
          'weather-event', 'nws-alert', 'anomaly-alert', 'convergence-score'
        ])
        .order('created_at', { ascending: false })
        .limit(20);
      ```
   e. Grade based on what was found:
      - **confirmed**: 3+ matching signals found, OR 1+ high-relevance vector matches (similarity > 0.7)
      - **partially_confirmed**: 1-2 matching signals, OR vector matches between 0.5-0.7
      - **false_alarm**: 0 matching signals AND no relevant vector matches AND the alert was high severity
      - **missed**: 0 matching signals but alert was low/medium severity (not wrong, just nothing happened)

3. For each graded alert, build a grade text and embed it:
   ```
   Title: "Alert Grade: {confirmed|missed|false_alarm|partial} — {state_abbr} {alert_date}"
   Content: "On {alert_date}, {alert_source} fired for {state_abbr}: '{original_claim}'.
   Outcome window: {alert_date} to {deadline}.
   Signals found: {list of actual signals with dates and content_types}.
   Grade: {grade}. Reasoning: {explanation of why this grade}.
   {If false_alarm: 'Conditions that were present but did NOT lead to predicted outcome: {conditions}. This suggests {insight}.'}
   {If confirmed: 'Pattern validated. Conditions that preceded this outcome: {conditions}.'}"

   content_type: 'alert-grade'
   tags: [alert_source, outcome_grade, state_abbr]
   state_abbr: alert.state_abbr
   effective_date: alert.alert_date
   metadata: {
     alert_source, outcome_grade, original_claim, signals_found_count,
     signals_found: [...], alert_knowledge_id, accuracy_context
   }
   ```

4. After embedding the grade, update hunt_alert_outcomes:
   ```typescript
   await supabase.from('hunt_alert_outcomes').update({
     outcome_checked: true,
     outcome_grade: grade,
     outcome_signals_found: signalsFound,
     outcome_reasoning: reasoning,
     grade_knowledge_id: gradeKnowledgeId,
     graded_at: new Date().toISOString(),
   }).eq('id', alert.id);
   ```

5. Call `enrichWithPatternScan()` on the grade embedding — this links the grade to related entries in the brain via hunt_pattern_links.

6. Log via `logCronRun` on EVERY exit path.

### Key design decision:
The grade text is written to be maximally useful for future vector searches. When a new alert fires and the system searches for "cold front in Arkansas," it should find both the original alert AND the grade. The grade text explicitly includes the conditions, the outcome, and the lesson learned. This is how the brain learns.

---

## PHASE 4: Build `hunt-alert-calibration` Edge Function

**New file:** `supabase/functions/hunt-alert-calibration/index.ts`
**Schedule:** Weekly Sunday 1pm UTC (after convergence-report-card at noon)
**Config:** Add to `supabase/config.toml`

### Logic:

1. For each `alert_source` type ('convergence-alert', 'anomaly-alert', 'disaster-watch', 'nws-alert'):
   a. For each time window (30, 60, 90 days):
      b. Query `hunt_alert_outcomes` where `outcome_checked = true` in that window.
      c. Group by `state_abbr` (plus one NULL row for national).
      d. Count: total, confirmed, partially_confirmed, missed, false_alarm.
      e. Calculate:
         - `accuracy_rate` = (confirmed + partially_confirmed) / total
         - `precision_rate` = confirmed / (confirmed + false_alarm) — avoids div/0

2. Upsert into `hunt_alert_calibration` table (ON CONFLICT update).

3. For each alert_source, embed a national summary:
   ```
   Title: "Alert Calibration: {alert_source} — {window_days}d rolling"
   Content: "Rolling {window_days}-day accuracy for {alert_source} alerts:
   Total: {total}. Confirmed: {confirmed} ({pct}%). Partially confirmed: {partial} ({pct}%).
   Missed: {missed} ({pct}%). False alarm: {false_alarm} ({pct}%).
   Overall accuracy: {accuracy_rate}%. Precision: {precision_rate}%.
   {Top 3 most accurate states: ...}
   {Top 3 least accurate states: ...}
   {If accuracy < 50%: 'This alert type is underperforming. Consider adjusting thresholds or adding input signals.'}
   {If accuracy > 80%: 'This alert type is highly reliable.'}"

   content_type: 'alert-calibration'
   tags: [alert_source, 'calibration', window_days + 'd']
   effective_date: today
   metadata: {
     alert_source, window_days, total, confirmed, partial, missed, false_alarm,
     accuracy_rate, precision_rate, top_states, bottom_states
   }
   ```

4. Log via `logCronRun` on EVERY exit path.

---

## PHASE 5: Modify Alert Generators to Be Grade-Aware

### 5A: Modify `hunt-convergence-alerts/index.ts`

BEFORE firing a new alert, search the brain for calibration data:

```typescript
// Search for past accuracy on this alert type + state
const calibrationQuery = `convergence alert accuracy ${stateAbbr}`;
const calibrationEmb = await embed(calibrationQuery, 'query');
const { data: calibrationHits } = await supabase.rpc('search_hunt_knowledge_v2', {
  query_embedding: calibrationEmb,
  match_threshold: 0.5,
  match_count: 3,
  filter_content_types: ['alert-calibration', 'alert-grade'],
  filter_state_abbr: stateAbbr,
  filter_species: null,
  filter_date_from: ninetyDaysAgo,
  filter_date_to: null,
  recency_weight: 0.2,
  exclude_du_report: true,
});

// Also check the calibration table directly for fast lookup
const { data: calibration } = await supabase
  .from('hunt_alert_calibration')
  .select('accuracy_rate, precision_rate, total_alerts')
  .eq('alert_source', 'convergence-alert')
  .eq('state_abbr', stateAbbr)
  .eq('window_days', 90)
  .single();

// Adjust alert behavior based on track record
let confidenceModifier = '';
if (calibration && calibration.total_alerts >= 5) {
  const accuracy = Number(calibration.accuracy_rate);
  if (accuracy < 0.4) {
    // Suppress or downgrade — this alert type is unreliable here
    console.log(`[hunt-convergence-alerts] Suppressing alert for ${stateAbbr} — 90d accuracy only ${(accuracy * 100).toFixed(0)}%`);
    continue; // skip this alert
  } else if (accuracy > 0.75) {
    confidenceModifier = `Historical accuracy for this pattern in ${stateAbbr}: ${(accuracy * 100).toFixed(0)}% (based on ${calibration.total_alerts} alerts).`;
  } else {
    confidenceModifier = `Historical accuracy: ${(accuracy * 100).toFixed(0)}% over ${calibration.total_alerts} alerts.`;
  }
}

// Include confidence in alert reasoning
const enrichedReasoning = confidenceModifier
  ? `${alert.reasoning}\n\n${confidenceModifier}`
  : alert.reasoning;
```

### 5B: Apply same pattern to `hunt-anomaly-detector` and `hunt-alerts`

Same search-before-fire pattern. Adjust thresholds per alert type:
- **anomaly-alert**: Suppress if accuracy < 30% (anomalies are noisier)
- **disaster-watch**: Never suppress (too high stakes), but include accuracy context
- **hunt-alerts** (user-facing): Always include historical accuracy in the response text

---

## PHASE 6: Activate Dormant Intelligence on Cron Schedules

Add these to Supabase cron schedule (via Dashboard → Database → pg_cron, or via SQL):

```sql
-- Anomaly Detector: daily at 9:30am UTC (after convergence engine at 8am, before scout report at 9am... adjust if needed)
SELECT cron.schedule(
  'hunt-anomaly-detector',
  '30 9 * * *',
  $$SELECT net.http_post(
    url := 'https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-anomaly-detector',
    headers := '{"Authorization": "Bearer SERVICE_ROLE_KEY"}'::jsonb
  )$$
);

-- Correlation Engine: daily at 10:30am UTC
SELECT cron.schedule(
  'hunt-correlation-engine',
  '30 10 * * *',
  $$SELECT net.http_post(
    url := 'https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-correlation-engine',
    headers := '{"Authorization": "Bearer SERVICE_ROLE_KEY"}'::jsonb
  )$$
);

-- Disaster Watch: weekly Wednesday 6am UTC
SELECT cron.schedule(
  'hunt-disaster-watch',
  '0 6 * * 3',
  $$SELECT net.http_post(
    url := 'https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-disaster-watch',
    headers := '{"Authorization": "Bearer SERVICE_ROLE_KEY"}'::jsonb
  )$$
);

-- Alert Grader: daily at 11:30am UTC
SELECT cron.schedule(
  'hunt-alert-grader',
  '30 11 * * *',
  $$SELECT net.http_post(
    url := 'https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-alert-grader',
    headers := '{"Authorization": "Bearer SERVICE_ROLE_KEY"}'::jsonb
  )$$
);

-- Alert Calibration: weekly Sunday 1pm UTC
SELECT cron.schedule(
  'hunt-alert-calibration',
  '0 13 * * 0',
  $$SELECT net.http_post(
    url := 'https://rvhyotvklfowklzjahdd.supabase.co/functions/v1/hunt-alert-calibration',
    headers := '{"Authorization": "Bearer SERVICE_ROLE_KEY"}'::jsonb
  )$$
);
```

**Replace SERVICE_ROLE_KEY with the actual key in the cron schedule.**

---

## BUILD ORDER

Do these in sequence. Each phase builds on the previous one.

1. **Push the migration** (Phase 1). No dependencies, safe, schema only.
2. **Build `hunt-alert-grader`** (Phase 3). This is the core — the grading engine. Deploy it. Test manually by calling it via curl. It will find 0 alerts to grade initially (no outcome tracking yet), which is fine — it should log "0 alerts to grade" and exit cleanly.
3. **Modify `hunt-convergence-alerts`** to write to `hunt_alert_outcomes` (Phase 2A). Deploy. Now every new convergence alert creates an outcome tracking row.
4. **Wait 3+ days** for outcome windows to close. The grader will find alerts to grade on day 4.
5. **Build `hunt-alert-calibration`** (Phase 4). Deploy. It will be empty initially, starts populating after grader has run for a week.
6. **Modify `hunt-convergence-alerts` to be grade-aware** (Phase 5A). Deploy. Now the loop is closed for convergence alerts.
7. **Activate `hunt-anomaly-detector` on cron** (Phase 6). Modify it to write to `hunt_alert_outcomes` (Phase 2B). Deploy.
8. **Activate `hunt-correlation-engine` on cron** (Phase 6). No outcome tracking needed initially — correlations are discoveries, not predictions.
9. **Activate `hunt-disaster-watch` on cron** (Phase 6). Modify it to write to `hunt_alert_outcomes` (Phase 2C). Deploy.
10. **Modify `hunt-alerts` (user-facing) to include accuracy context** (Phase 5B). Last, because it needs calibration data to exist first.

---

## THE FLYWHEEL

Once all phases are active, this is the daily loop:

```
6:00 AM  — Weather watchdog runs, embeds forecasts + events
6:30 AM  — NASA POWER runs
7:00 AM  — Migration monitor runs, detects spikes
8:00 AM  — Convergence engine scores all 50 states
8:15 AM  — Convergence alerts fire (NOW writes to hunt_alert_outcomes)
           → Before firing, checks hunt_alert_calibration for accuracy history
           → Suppresses alerts with <40% historical accuracy
           → Includes accuracy context in alert text
9:00 AM  — Scout report generates daily brief
9:30 AM  — Anomaly detector runs (NOW on cron), embeds outliers
           → Writes to hunt_alert_outcomes with 72hr window
10:00 AM — Forecast tracker grades yesterday's weather predictions
10:30 AM — Correlation engine discovers cross-domain links
11:00 AM — Migration report card grades 7-day-old predictions
11:30 AM — ALERT GRADER runs
           → Finds alerts with closed outcome windows
           → Searches brain for what actually happened
           → Grades: confirmed / partial / missed / false_alarm
           → Embeds grade + reasoning back into hunt_knowledge
           → Grade text includes WHY it was right or wrong
           → enrichWithPatternScan links grade to related entries

Sunday 12:00 PM — Convergence report card (weekly)
Sunday  1:00 PM — ALERT CALIBRATION runs
           → Aggregates grades by source/state/window
           → Updates hunt_alert_calibration table
           → Embeds calibration summary into hunt_knowledge
           → Next week's alerts now have updated accuracy data

Wednesday 6:00 AM — Disaster watch runs (weekly)
           → Checks climate indices vs disaster signatures
           → Writes to hunt_alert_outcomes with 168hr window
```

Every false alarm teaches the brain. Every confirmed alert reinforces the pattern. Every grade is a searchable vector. The brain gets smarter every single day — not because a human tuned it, but because it graded itself.

---

## NEW CONTENT TYPES ADDED TO BRAIN

After this build, hunt_knowledge will have these new content_types:
- `alert-grade` — individual alert outcome grades with reasoning
- `alert-calibration` — rolling accuracy summaries per alert type/state

These join the existing self-grading types:
- `forecast-accuracy` (from hunt-forecast-tracker)
- `migration-report-card` (from hunt-migration-report-card)
- `convergence-report-card` (from hunt-convergence-report-card)

---

## TESTING CHECKLIST

- [ ] Migration runs cleanly (no conflicts with existing tables)
- [ ] `hunt-alert-grader` handles 0 alerts gracefully (logs, returns success)
- [ ] `hunt-alert-grader` grades a real alert correctly after 72hr window closes
- [ ] `hunt-alert-grader` embeds grade into hunt_knowledge with correct content_type/tags/metadata
- [ ] `hunt-alert-calibration` computes accuracy correctly (test with known grades)
- [ ] `hunt-convergence-alerts` suppresses alerts when accuracy < 40%
- [ ] `hunt-convergence-alerts` includes accuracy context in alert text when data exists
- [ ] All three dormant functions (anomaly, correlation, disaster) run on cron without errors
- [ ] All functions call `logCronRun` on EVERY exit path (check hunt-cron-health after each deploy)
- [ ] No regressions in existing crons (check hunt-cron-health dashboard after full deploy)

---

## NOTES

- **One backfill pipe at a time.** This build doesn't involve backfilling, but don't run it concurrently with a backfill pipe. The alert grader does vector searches which need IO headroom.
- **verify_jwt = false** for all new functions. Auth handled in code.
- **Pin supabase-js@2.84.0 and std@0.168.0.** No exceptions.
- **Every early return calls logCronRun.** If the grader finds 0 alerts, it logs `{ status: 'success', summary: { graded: 0 } }` and returns.
- **The correlation engine doesn't need outcome tracking** — it discovers relationships, it doesn't predict. But its discoveries DO feed into the alert generators as additional signal.
