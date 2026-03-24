# BUILD SPEC: Ops Dashboard — /ops Route

**Date:** March 22, 2026
**Priority:** HIGH — can't maintain 25 crons + 2M entries without visibility
**Vision:** One page where James can see everything happening under the hood, what's broken, and what needs attention — without touching code.

---

## The Problem

The site has 25 crons, 52 edge functions, 2.18M brain entries, a self-grading loop, convergence scans, web discovery curation, and backfill pipelines. The only way to see if any of it is working is a tiny Brain Activity panel that shows "2 ACTIVE CRONS" and the most recent log entry. The Admin Console panel exists but it's crammed into a grid slot and shows 20 rows max. There's no way to see trends, no way to know what broke at 3am, no way to tell if the brain is growing or stale, and no way to manually kick a cron that died.

James said it best: "stuff is going to break and that's fine and expected but I can't know what to fix without debugging."

---

## What Already Exists (Don't Rebuild)

| Component | What It Does | Keep/Extend |
|-----------|-------------|-------------|
| `hunt-cron-health` endpoint | Returns all 25 crons with health/SLA status | EXTEND — add content type counts, brain growth |
| `useAdminData.ts` hook | Fetches cron health + discoveries + failures + scans | EXTEND — add growth metrics |
| `useDataSourceHealth.ts` hook | 25 data sources with status/freshness | KEEP as-is |
| `useBrainActivity.ts` hook | Today's cron logs | KEEP as-is |
| `AdminConsolePanel.tsx` | 4-tab admin view (Crons/Discoveries/Failures/Scans) | EXTRACT logic, reuse in full page |
| `BrainHeartbeat.tsx` | Live status bar + health dropdown | KEEP on main site |
| `dataSourceCatalog.ts` | 25 source definitions with refresh intervals | KEEP as data source |

---

## What to Build: `/ops` Route

A full-page dashboard at `duckcountdown.com/ops`. Not a panel — a page. Auth-gated (only logged-in users, eventually role-based). Dark theme like the rest of the site.

### Layout: 4 Sections

```
┌──────────────────────────────────────────────────────────────────────┐
│  SYSTEM PULSE (always visible top bar)                               │
│  Brain: 2,185,066 | +1,247 today | 25 types | Crons: 2/25 | Errors: 3 │
└──────────────────────────────────────────────────────────────────────┘
┌─────────────────────────┬────────────────────────────────────────────┐
│                         │                                            │
│   CRON HEALTH           │   BRAIN GROWTH                             │
│   (left column, 40%)    │   (right column, 60%)                      │
│                         │                                            │
├─────────────────────────┼────────────────────────────────────────────┤
│                         │                                            │
│   DATA PIPELINE         │   ALERT PERFORMANCE                        │
│   (left column)         │   (right column)                           │
│                         │                                            │
└─────────────────────────┴────────────────────────────────────────────┘
```

---

### Section 1: System Pulse (Top Bar)

A single horizontal strip, always visible. The heartbeat for the whole system.

| Metric | Source | Display |
|--------|--------|---------|
| Brain Size | `hunt_knowledge` count | "2,185,066 entries" |
| Growth Today | Count where created_at > today | "+1,247 today" (green if >0, red if 0) |
| Content Types | Distinct content_type count | "27 types" |
| Crons Healthy | `hunt-cron-health` | "18/25 crons" (green/yellow/red threshold) |
| Errors (48h) | `hunt_cron_log` where status='error' | "3 errors" (red if >0) |
| Last Embed | Most recent created_at | "4m ago" |
| Uptime | How long since last error-free period | "6h clean" |

---

### Section 2: Cron Health Grid

**Purpose:** See all 25 crons at a glance. Which are healthy, which are late, which are dead.

```
┌──────────────────────────────────────────────────┐
│ CRON HEALTH                              [↻ 30s] │
├───┬──────────────────────┬────────┬──────┬───────┤
│ ● │ weather-realtime     │ 15min  │ 3m   │ 847ms │  ← green dot, on time
│ ● │ nws-monitor          │ 3hr    │ 1.2h │ 2.1s  │  ← green
│ ○ │ convergence-engine   │ daily  │ 26h  │ --    │  ← red, LATE
│ ○ │ migration-monitor    │ daily  │ 3d   │ --    │  ← red, DEAD
│ ○ │ birdcast             │ daily  │ 5d   │ --    │  ← red, DEAD
│ ● │ convergence-scan     │ event  │ 2m   │ 77s   │  ← yellow, slow
│ ...                                               │
└───────────────────────────────────────────────────┘
```

Each row shows:
- **Status dot:** Green (healthy), Yellow (slow/warning), Red (late/error/dead)
- **Name:** Function name (abbreviated)
- **Schedule:** Expected interval
- **Last Run:** How long ago
- **Duration:** Last execution time (flag if >60s)
- **Expand arrow:** Click to see last 5 runs, error messages, embedding count per run

**Sorting:** Errors first, then late, then healthy. Same logic as existing AdminConsolePanel but with more data.

**Data source:** `hunt-cron-health` endpoint (already returns all this data including `recent_history` array of last 5 runs).

---

### Section 3: Brain Growth

**Purpose:** Is the brain growing? What's feeding it? What's stale?

#### 3a: Growth Chart
Line chart showing brain entry count over last 30 days. Use `hunt_knowledge` with `GROUP BY DATE(created_at)` query.

This needs a **new RPC or API endpoint** — the existing hooks don't track growth over time.

**New endpoint: `hunt-ops-dashboard`** (or extend `hunt-cron-health`):
```sql
-- Brain growth by day (last 30 days)
SELECT DATE(created_at) as day, COUNT(*) as entries
FROM hunt_knowledge
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY day;

-- Content type breakdown
SELECT content_type, COUNT(*) as count
FROM hunt_knowledge
GROUP BY content_type
ORDER BY count DESC;

-- Data freshness per content type
SELECT content_type,
       MAX(created_at) as latest,
       COUNT(*) as total
FROM hunt_knowledge
GROUP BY content_type
ORDER BY latest DESC;
```

#### 3b: Content Type Breakdown
Horizontal bar chart showing entry count per content type. Sorted by count descending.

```
storm-event       ████████████████████████████  414,000
birdcast-hist     ███████████████               180,000
usgs-water        ██████████████                165,000
weather-realtime  ████████████                  142,000
earthquake-event  ████████                       70,000
drought-weekly    ██████                         55,000
...
```

#### 3c: Data Freshness Table
For each content type: name, total entries, newest entry date, oldest entry date. Flag any type where newest is >7 days old (stale).

---

### Section 4: Data Pipeline Status

**Purpose:** What's flowing, what's stuck, what needs backfilling.

#### 4a: Active Pipelines
Show currently running or recently completed backfill scripts:
- ebird-history: paused at TX/2022, ~40hr ETA
- storm-events: 414K done
- correlate-bio-environmental: ready to run

This is manual for now — could be tracked via a `hunt_pipeline_status` table later.

#### 4b: Web Discoveries Queue
From `hunt_web_discoveries` — how many pending, how many embedded, how many skipped. Already exists in AdminConsolePanel's Discoveries tab.

#### 4c: Convergence Scan Log
Last 20 convergence scan runs with state, domains found, alert triggered, duration. Already exists in AdminConsolePanel's Scans tab.

---

### Section 5: Alert Performance

**Purpose:** Is the self-grading loop working? Are alerts accurate?

| Metric | Source |
|--------|--------|
| Total alerts fired (30d) | `hunt_convergence_alerts` count |
| Graded | Count where outcome IS NOT NULL |
| Confirmed | outcome = 'confirmed' |
| Partial | outcome = 'partial' |
| Missed | outcome = 'missed' |
| False Alarm | outcome = 'false_alarm' |
| Accuracy | (confirmed + partial) / graded |
| Pending Grade | fired but outside grade window |

Show as a donut chart or simple scorecard. This is the self-improving loop made visible.

Also show: **Compound Risk Alerts** — the latest convergence alerts with multi-domain convergence. Already partially shown in AdminConsolePanel.

---

## Implementation Plan

### Step 1: New Route
**File:** `src/App.tsx`
Add route: `<Route path="/ops" element={<OpsPage />} />`

### Step 2: New Edge Function — `hunt-ops-dashboard`
Returns all ops data in one call:
```typescript
{
  brain: {
    total: number,
    growth_today: number,
    growth_by_day: { day: string, count: number }[],  // last 30 days
    content_types: { type: string, count: number, latest: string }[],
  },
  crons: { /* same as hunt-cron-health output */ },
  alerts: {
    total_30d: number,
    confirmed: number,
    partial: number,
    missed: number,
    false_alarm: number,
    pending: number,
    accuracy: number,
  },
  discoveries: {
    pending: number,
    embedded: number,
    skipped: number,
  },
  scans: { /* last 20 convergence scans */ }
}
```

### Step 3: New Hook — `useOpsData.ts`
Calls `hunt-ops-dashboard`, 60-second refresh. Returns typed data for all sections.

### Step 4: New Page — `src/pages/OpsPage.tsx`
Full-page layout with the 5 sections above. Uses:
- Recharts for growth chart + content type bars + alert donut
- Existing table patterns from AdminConsolePanel
- Same dark theme + Tailwind as rest of site

### Step 5: Auth Gate
Only show `/ops` route to authenticated users. Add a link in the header (gear icon or "Ops" button) visible only when logged in.

---

## What to Reuse vs Build New

| Component | Action |
|-----------|--------|
| Cron health grid | REUSE AdminConsolePanel cron tab logic, expand to full-width |
| Data source health | REUSE useDataSourceHealth hook + catalog |
| Failures list | REUSE AdminConsolePanel failures tab |
| Convergence scans | REUSE AdminConsolePanel scans tab |
| Web discoveries | REUSE AdminConsolePanel discoveries tab |
| Brain growth chart | NEW — needs new SQL query + Recharts line chart |
| Content type breakdown | NEW — needs new SQL query + Recharts bar chart |
| Data freshness table | NEW — needs new SQL query |
| Alert performance | NEW — needs query against hunt_convergence_alerts + hunt_alert_outcomes |
| System pulse bar | NEW — aggregates from existing endpoints |
| Ops page layout | NEW — full page, not a panel |

---

## Quick Wins (Can Do Without New Endpoint)

If you want to ship something fast before building the full `hunt-ops-dashboard` endpoint:

1. **Create `/ops` route** that renders AdminConsolePanel as a full page (not in a panel wrapper)
2. **Add brain count** to the top (already available via `useAdminData`)
3. **Add content type breakdown** via direct Supabase REST query from the frontend
4. **Link it from the header** (Ops button, auth-gated)

This gets you 80% of the value with minimal new code. The growth chart and alert performance can come in v2.

---

## Stale Data to Fix

| Issue | Fix |
|-------|-----|
| Brain Chat says "486K+ entries" | `src/components/HuntChat.tsx` — hardcoded string. Replace with live count from brain query |
| Brain Search says "Search 486K+ brain entries" | `src/panels/PanelRegistry.ts` — hardcoded description. Make dynamic |
| Widget Manager says "Search 486K+ brain entries" | Same source — PanelRegistry description |

These are cosmetic but they undermine trust. If the UI says 486K when the real number is 2.18M, it looks broken.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/App.tsx` | Add `/ops` route |
| `src/pages/OpsPage.tsx` | NEW — full ops dashboard page |
| `src/hooks/useOpsData.ts` | NEW — aggregated ops data hook |
| `supabase/functions/hunt-ops-dashboard/index.ts` | NEW — single endpoint for all ops data |
| `src/components/HuntChat.tsx` | Fix hardcoded "486K+" |
| `src/panels/PanelRegistry.ts` | Fix hardcoded "486K+" in Brain Search description |
