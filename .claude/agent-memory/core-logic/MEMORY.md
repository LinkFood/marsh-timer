# Core Logic Agent Memory — Duck Countdown

## Project
- **Location:** `/Users/jameschellis/marsh-timer`
- **STATUS 2026-07-02:** Fully redesigned. Mapbox + MapView.tsx monolith + 25-panel workbench are GONE. Now 3 surfaces + inline SVG only.

## Current Architecture (2026-07-02 redesign)
- **Routes (`src/App.tsx`):** `/` ExplorerLanding, `/date/:dateStr` DatePage, `/state/:stateAbbr` StatePage, `/court` CourtPage, `/ops`, `/auth`.
- **ExplorerLanding** (`src/pages/ExplorerLanding.tsx`, ~595 lines) — Today page. Left column narrative + right sticky rail (EventMap tile grid, layers feed, latest verdict). All load-time data is cheap REST or non-LLM edge fn; LLM chat fires only on user action.
- **DatePage** (`src/pages/DatePage.tsx`) — ±14-day archaeology timeline (merged dot-row), domain cards ("The record"), "Tell the story" LLM button, this-day-in-other-years precedents.
- **CourtPage** (`src/pages/CourtPage.tsx`) — docket (claims), live fires, verdict feed, "The Record" convergence-index postmortem (killed-index text lives here).
- **EventMap** (`src/components/EventMap.tsx`) — inline-SVG US tile grid (11×8), no Mapbox. Baseline fill = entries ingested today; overlay colors = event categories. NEVER renders convergence scores.

### Doctrine (hard rules)
- Inline SVG only. No chart libs (recharts is in package.json but do NOT use it). No Mapbox.
- Show don't predict. Denominators always (`Denominator` component). Dead convergence score never rendered.
- Every card headline goes through `src/lib/humanize.ts` first.

### Key data hooks
- `useDayArchive` — DOMAIN_GROUPS (10 groups), per-group bounded REST (content_type IN + effective_date eq + optional state). `useArchaeologyTimeline` — 4 PROBES (storm/migration/anomaly/alert) × ±14d, presence-only per-day cats, 1000-row saturation fallback.
- `useClaims` / `useClaimFires` — raw PostgREST reads of `hunt_claims` / `hunt_claim_fires`. Degrade to status 'unavailable' on 404 (tables may not exist yet). No retry.
- `useLatestLayers`, `useThisDayInHistory`, `useTodayEventMap`, `useTodaySignals` (bird/anomaly), `useTodayBriefing`.

### Temporal data state (decays — reverify)
- `hunt_claims` / `hunt_claim_fires` migration landing ~2026-07-02 night. **Verdicts (evaluated=true fires w/ hit/lift/control_n) empty for ~1-2 weeks** until windows close. Anything on rich verdict HISTORY renders thin/empty initially.
- `hunt_pattern_links` STALE since May 2026 — "Strings Draw Themselves" idea has no fresh data.

## Scoping Calibration
- (2026-03-07, STALE — pre-redesign Mapbox era) map-feature estimates no longer apply.
- **Cascade synergy insight (2026-07-02):** The July-2026 heat-wave cascade (drought -11d / ocean -9d / bird-silence -7d / heat day 0) is a hardcodable const. Build `src/data/cascade.ts` ONCE and 5 ideas become views on it (Lead-Lag Ribbon, 11-Day Rewind, Cascade Strip PNG, Sonify, Absence band). Always look for the shared-dataset spine before scoping a cluster of ideas separately.
- Verdict/court artifacts (Verdict Card, Receipt Printer, honesty scoreboard, Wall of Misses, Prove-Me-Wrong) all sit on `useClaimFires` — same data spine, all blocked/thin until verdicts accumulate.
- Layer-viz ideas (Loom, Coincidence Columns, Core Sample, Heartbeat, Echo) all = "un-merge the archaeology dot-row" on DatePage. One build covers several.
- OG images (Birthday / Prove-Me-Wrong unfurl) need `@vercel/og` (NOT installed; only `@vercel/edge`) + middleware currently redirect-only (no meta injection). Real new-dep work → defer.

## Duck–Front "founding-fact" test scope (2026-07-03) — see docs/DUCK-FRONT-TEST-SCOPE.md
- **eBird is the binding constraint.** `hunt-migration-monitor` pulls `recent?back=1` (snapshot; API caps back=30 → NO historical density). Stores `species='all-birds'` raw `sighting_count` (effort-confounded) in `hunt_migration_history`; **waterfowl breakdown is COMPUTED then discarded** from the table — but survives as `waterfowl:N` text inside `hunt_knowledge.content` (content_type migration-daily/-spike-*/-lull), so recoverable by parsing. ~13.3k rows = ~Oct2025→Jul2026 = n=1 fall season.
- **Fronts already detected daily.** `hunt-weather-watchdog` has a `cold_front` detector (temp drop >15°F d-o-d → `hunt_weather_events`), and its Open-Meteo `DailyForecast` carries `pressure_msl_mean` + `wind_direction_10m_dominant` — real front signature available for the recent (~5yr) window. ghcn-daily (1950-2025, hunt_knowledge) is temp+precip only (NO pressure/wind), and has NO daily cron so it does NOT overlap 2026 eBird → 76yr history useless for this test until EBD download exists.
- **The killer confound = birder-effort** (front→nice weekend→more checklists→more birds). Only real fix = eBird EBD Custom Download (Anseriformes + Sampling Event Data for party-hours); free but needs Cornell access agreement (days lead) + GB local TSV parse. MVE = 1 read-only script, 1-2 sessions, placebo-first; full = 4-6 sessions + EBD approval.

## S/M/L convention (file-count)
- S = 1-2 files, M = 3-5 files, L = 6+ files.
